// server/world_do.js — 世界 Durable Object：连接管理、状态同步、SQLite 持久化
// 权威职责：握手（种子/diff/在线玩家）、移动限速与兴趣管理、编辑仲裁与广播、进度落盘
import '../js/noise.js';
import '../js/world.js';
import '../shared/protocol.js';

const MW = globalThis.MyWorld;
const World = MW.World, P = MW.Protocol;

const SPAWN_X = 8.5, SPAWN_Z = 8.5;
const EYE = 1.62; // 与客户端 Player.EYE 一致（编辑距离校验用视点）

export class WorldDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.sql = ctx.storage.sql;
    // ws -> { pid, token, name, x, y, z, yaw, pitch, lastMoveMs, visible:Set<pid> }
    this.sessions = new Map();
    this.nextPid = 1;
    this.ctx.blockConcurrencyWhile(async () => { this.boot(); });
  }

  boot() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS edits (
      x INTEGER, y INTEGER, z INTEGER, id INTEGER, PRIMARY KEY (x, y, z))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS players (
      token TEXT PRIMARY KEY, name TEXT, x REAL, y REAL, z REAL,
      level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, hp INTEGER DEFAULT 20,
      quest_id TEXT, quest_progress INTEGER DEFAULT 0, chain_index INTEGER DEFAULT 0,
      last_seen INTEGER)`);
    const row = this.sql.exec(`SELECT value FROM meta WHERE key = 'seed'`).toArray()[0];
    if (row) {
      this.seed = parseInt(row.value, 10);
    } else {
      this.seed = (Math.random() * 0x7fffffff) | 0;
      this.sql.exec(`INSERT INTO meta (key, value) VALUES ('seed', ?)`, String(this.seed));
    }
    // 服务器侧世界：出生高度计算 + editReject 时读真实方块（M2 怪物物理也用它）
    this.world = World.create(this.seed);
    this.edits = new Map(); // "x,y,z" -> id
    for (const r of this.sql.exec(`SELECT x, y, z, id FROM edits`).toArray()) {
      this.edits.set(r.x + ',' + r.y + ',' + r.z, r.id);
      this.world.applyRemoteEdit(r.x, r.y, r.z, r.id);
    }
    // 休眠唤醒恢复：workerd 十几秒空闲即休眠 DO（连接保持打开），内存会话必须从
    // attachment + players 表重建，否则唤醒消息会被 rehello 吞掉、互见状态丢失。
    // 互见集置空即可：下一次 move 的 syncVisibility 会重新配对（客户端按 pid 去重）。
    for (const ws of this.ctx.getWebSockets()) {
      let a = null;
      try { a = ws.deserializeAttachment(); } catch {}
      if (!a || !a.token) continue;
      const row = this.sql.exec(`SELECT * FROM players WHERE token = ?`, a.token).toArray()[0];
      const s = {
        pid: a.pid, token: a.token, name: a.name,
        x: row ? row.x : SPAWN_X, y: row ? row.y : this.world.terrainHeight(8, 8) + 1, z: row ? row.z : SPAWN_Z,
        // 限速时钟取上次落盘时间：恢复的位置即彼时位置，位移预算 = 均速 × 实际经过时长；
        // 若取 Date.now()，唤醒 DO 的那条 move 自身 dt 会被压到 30ms 下限而被误拒拉回
        yaw: 0, pitch: 0, lastMoveMs: row && row.last_seen ? row.last_seen : Date.now() - 1000, visible: new Set(),
      };
      this.sessions.set(ws, s);
      if (a.pid >= this.nextPid) this.nextPid = a.pid + 1;
    }
    // 唤醒后续上周期落盘（休眠时 alarm 链可能已断）
    if (this.sessions.size > 0) this.ctx.storage.setAlarm(Date.now() + P.PERSIST_INTERVAL_MS);
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const s = this.sessions.get(ws);
    if (!s) {
      // 无会话（attachment 恢复失败或从未握手）：只接受 hello，其余回 rehello 兜底
      if (msg.t === 'hello') this.onHello(ws, msg);
      else this.send(ws, { t: 'rehello' });
      return;
    }
    if (msg.t === 'move') this.onMove(ws, s, msg);
    else if (msg.t === 'edit') this.onEdit(ws, s, msg);
    else if (msg.t === 'respawn') this.onRespawn(ws, s);
    else if (msg.t === 'hello') this.onHello(ws, msg); // 重复 hello：按重新握手处理
  }

  webSocketClose(ws, code, reason, wasClean) { this.dropSession(ws); }
  webSocketError(ws, error) { this.dropSession(ws); }

  // --- 握手 ---
  onHello(ws, msg) {
    const token = typeof msg.token === 'string' && /^[0-9a-f]{16,64}$/.test(msg.token) ? msg.token : null;
    if (!token) { try { ws.close(4001, 'bad token'); } catch {} return; }
    // 同凭证重复连接：踢掉旧连接（含本 ws 自己重复 hello 的情形——先移除再重建）
    for (const [ows, os] of Array.from(this.sessions)) {
      if (os.token === token) {
        this.persistSession(os); // 被顶替前先存位置，避免丢未落盘的移动
        this.sessions.delete(ows);
        this.notifyExit(os);
        if (ows !== ws) { try { ows.close(4000, 'replaced'); } catch {} }
      }
    }
    let x, y, z;
    const row = this.sql.exec(`SELECT * FROM players WHERE token = ?`, token).toArray()[0];
    if (row) { x = row.x; y = row.y; z = row.z; }
    else { x = SPAWN_X; z = SPAWN_Z; y = this.world.terrainHeight(8, 8) + 1; }
    const name = P.sanitizeName(msg.name != null ? msg.name : (row ? row.name : ''), '玩家' + this.nextPid);
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO players (token, name, x, y, z, last_seen) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen`,
      token, name, x, y, z, now);
    const s = { pid: this.nextPid++, token, name, x, y, z, yaw: 0, pitch: 0, lastMoveMs: now, visible: new Set() };
    this.sessions.set(ws, s);
    // 休眠存活凭据：唤醒后 boot() 经 getWebSockets + attachment 恢复会话（pid 延续）
    ws.serializeAttachment({ token: s.token, pid: s.pid, name: s.name });
    // 欢迎包：种子 + 全量方块 diff + 兴趣半径内在线玩家
    const edits = [];
    for (const [k, id] of this.edits) {
      const c = k.split(',');
      edits.push([+c[0], +c[1], +c[2], id]);
    }
    const players = [];
    for (const [ows, os] of this.sessions) {
      if (os === s) continue;
      if (P.inInterest(s.x, s.z, os.x, os.z)) {
        players.push({ pid: os.pid, name: os.name, x: os.x, y: os.y, z: os.z, yaw: os.yaw });
        s.visible.add(os.pid);
        os.visible.add(s.pid);
        this.send(ows, { t: 'penter', pid: s.pid, name: s.name, x: s.x, y: s.y, z: s.z, yaw: s.yaw });
      }
    }
    this.send(ws, { t: 'welcome', pid: s.pid, seed: this.seed, x: s.x, y: s.y, z: s.z, edits, players, online: this.sessions.size });
    this.broadcastOnline();
    this.ctx.storage.setAlarm(Date.now() + P.PERSIST_INTERVAL_MS);
  }

  // --- 移动：限速 + 互见集维护 ---
  onMove(ws, s, msg) {
    const now = Date.now();
    const r = P.clampMove(s, msg, now - s.lastMoveMs);
    // 拒绝时不推进 lastMoveMs：让 dt 从上次采纳累积，避免追赶包被连环误拒
    if (!r.ok) { this.send(ws, { t: 'teleport', x: s.x, y: s.y, z: s.z }); return; }
    s.lastMoveMs = now;
    s.x = r.x; s.y = r.y; s.z = r.z;
    if (isFinite(msg.yaw)) s.yaw = msg.yaw;
    if (isFinite(msg.pitch)) s.pitch = msg.pitch;
    this.syncVisibility(ws, s);
  }

  // 重算 s 与所有人的互见关系；保持可见者收 pmove
  syncVisibility(ws, s) {
    for (const [ows, os] of this.sessions) {
      if (os === s) continue;
      const can = P.inInterest(s.x, s.z, os.x, os.z);
      const had = s.visible.has(os.pid);
      if (can && !had) {
        s.visible.add(os.pid); os.visible.add(s.pid);
        this.send(ws, { t: 'penter', pid: os.pid, name: os.name, x: os.x, y: os.y, z: os.z, yaw: os.yaw });
        this.send(ows, { t: 'penter', pid: s.pid, name: s.name, x: s.x, y: s.y, z: s.z, yaw: s.yaw });
      } else if (!can && had) {
        s.visible.delete(os.pid); os.visible.delete(s.pid);
        this.send(ws, { t: 'pexit', pid: os.pid });
        this.send(ows, { t: 'pexit', pid: s.pid });
      } else if (can) {
        this.send(ows, { t: 'pmove', pid: s.pid, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch });
      }
    }
  }

  // --- 编辑：校验→落库→全员广播（编辑必须全员同步以保证世界一致） ---
  onEdit(ws, s, msg) {
    if (!P.validEdit(msg, s.x, s.y + EYE, s.z, World.CHUNK_Y)) {
      // 结构合法但被拒（如超距）→ 回发该格真实值供客户端回滚
      if (msg && Number.isInteger(msg.x) && Number.isInteger(msg.y) && Number.isInteger(msg.z) &&
          msg.y >= 0 && msg.y < World.CHUNK_Y) {
        const k = msg.x + ',' + msg.y + ',' + msg.z;
        let cur;
        if (this.edits.has(k)) {
          cur = this.edits.get(k);
        } else {
          this.world.ensureChunk(Math.floor(msg.x / World.CHUNK_X), Math.floor(msg.z / World.CHUNK_Z));
          cur = this.world.getBlock(msg.x, msg.y, msg.z);
        }
        this.send(ws, { t: 'editReject', x: msg.x, y: msg.y, z: msg.z, id: cur });
      }
      return;
    }
    const k = msg.x + ',' + msg.y + ',' + msg.z;
    this.edits.set(k, msg.id);
    this.world.applyRemoteEdit(msg.x, msg.y, msg.z, msg.id);
    this.sql.exec(
      `INSERT INTO edits (x, y, z, id) VALUES (?, ?, ?, ?)
       ON CONFLICT(x, y, z) DO UPDATE SET id = excluded.id`,
      msg.x, msg.y, msg.z, msg.id);
    for (const ows of this.sessions.keys()) {
      this.send(ows, { t: 'edit', x: msg.x, y: msg.y, z: msg.z, id: msg.id });
    }
  }

  // --- 掉出世界：服务器权威传送回出生点 ---
  onRespawn(ws, s) {
    s.x = SPAWN_X; s.z = SPAWN_Z;
    s.y = this.world.terrainHeight(8, 8) + 1;
    this.send(ws, { t: 'teleport', x: s.x, y: s.y, z: s.z });
    this.syncVisibility(ws, s);
  }

  // --- 断开 ---
  dropSession(ws) {
    const s = this.sessions.get(ws);
    this.sessions.delete(ws);
    if (!s) return;
    this.persistSession(s);
    this.notifyExit(s);
    this.broadcastOnline();
  }

  notifyExit(s) {
    for (const [ows, os] of this.sessions) {
      if (os.visible.delete(s.pid)) this.send(ows, { t: 'pexit', pid: s.pid });
    }
  }

  broadcastOnline() {
    for (const ows of this.sessions.keys()) {
      this.send(ows, { t: 'online', n: this.sessions.size });
    }
  }

  persistSession(s) {
    this.sql.exec(`UPDATE players SET x = ?, y = ?, z = ?, last_seen = ? WHERE token = ?`,
      s.x, s.y, s.z, Date.now(), s.token);
  }

  // 周期落盘（仅在线时续约下一次）
  async alarm() {
    for (const s of this.sessions.values()) this.persistSession(s);
    if (this.sessions.size > 0) {
      this.ctx.storage.setAlarm(Date.now() + P.PERSIST_INTERVAL_MS);
    }
  }

  send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
}
