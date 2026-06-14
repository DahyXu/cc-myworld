// server/world_do.js — 世界 Durable Object：连接管理、状态同步、SQLite 持久化
// 权威职责：握手（种子/diff/在线玩家）、移动限速与兴趣管理、编辑仲裁与广播、进度落盘
import '../js/noise.js';
import '../js/blocks.js';
import '../js/world.js';
import '../shared/protocol.js';
import '../shared/physics.js';
import '../shared/stats.js';
import '../shared/mobs_def.js';
import '../shared/quests_def.js';
import '../shared/items_def.js';
import '../shared/bosses_def.js';

const MW = globalThis.MyWorld;
const World = MW.World, P = MW.Protocol;
const Physics = MW.Physics, Stats = MW.Stats, MobsDef = MW.MobsDef, QuestsDef = MW.QuestsDef;
const ItemsDef = MW.ItemsDef;
const BossesDef = MW.BossesDef;

const SPAWN_X = MobsDef.SPAWN_X, SPAWN_Z = MobsDef.SPAWN_Z;
const EYE = 1.62; // 与客户端 Player.EYE 一致（编辑距离校验用视点）

export class WorldDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.sql = ctx.storage.sql;
    // ws -> { pid, token, name, x, y, z, yaw, pitch, lastMoveMs, visible:Set<pid> }
    this.sessions = new Map();
    this.nextPid = 1;
    // —— M2 怪物运行时状态（不持久化：DO 重启/休眠即重置，有意设计）——
    this.mobs = new Map();        // mobId -> mob
    this.activeCamps = new Map(); // campKey "ccx_ccz" -> { camp, mobIds: [] }
    this.arrows = new Map();      // arrowId -> arrow
    this.nextArrowId = 1;
    this.bosses = new Map();
    this.tickTimer = null;
    this.idleTicks = 0;
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
    try { this.sql.exec(`ALTER TABLE players ADD COLUMN coins INTEGER DEFAULT 0`); } catch {}
    this.sql.exec(`CREATE TABLE IF NOT EXISTS inventory (
      pid   TEXT NOT NULL,
      slot  INTEGER NOT NULL,
      item  TEXT NOT NULL,
      PRIMARY KEY (pid, slot)
    )`);
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
    for (const ws of this.ctx.getWebSockets()) {
      let a = null;
      try { a = ws.deserializeAttachment(); } catch {}
      if (!a || !a.token) continue;
      const row = this.sql.exec(`SELECT * FROM players WHERE token = ?`, a.token).toArray()[0];
      const lvl = row && row.level ? row.level : 1;
      const mhp = Stats.maxHp(lvl);
      const s = {
        pid: a.pid, token: a.token, name: a.name,
        x: row ? row.x : SPAWN_X, y: row ? row.y : this.world.terrainHeight(8, 8) + 1, z: row ? row.z : SPAWN_Z,
        // 限速时钟取上次落盘时间：恢复的位置即彼时位置，位移预算 = 均速 × 实际经过时长；
        // 若取 Date.now()，唤醒 DO 的那条 move 自身 dt 会被压到 30ms 下限而被误拒拉回
        yaw: 0, pitch: 0, lastMoveMs: row && row.last_seen ? row.last_seen : Date.now() - 1000, visible: new Set(),
        level: lvl, xp: row && isFinite(row.xp) ? row.xp : 0,
        questId: row ? row.quest_id : null,
        questProg: row && isFinite(row.quest_progress) ? row.quest_progress : 0,
        mainIndex: row && isFinite(row.chain_index) ? row.chain_index : 0,
        hp: row && isFinite(row.hp) && row.hp > 0 ? Math.min(row.hp, mhp) : mhp, maxHp: mhp,
        dead: false, deadUntil: 0, invulnUntil: 0, lastHurtAt: 0, nextRegenAt: 0, atkReadyAt: 0, bowReadyAt: 0,
      };
      s.coins = row && isFinite(row.coins) ? row.coins : 0;
      s.inv = new Array(40).fill(null);
      for (const r of this.sql.exec(`SELECT slot, item FROM inventory WHERE pid = ?`, a.token).toArray()) {
        if (r.slot >= 0 && r.slot < 40) { try { s.inv[r.slot] = JSON.parse(r.item); } catch {} }
      }
      this.sessions.set(ws, s);
      if (a.pid >= this.nextPid) this.nextPid = a.pid + 1;
    }
    // 重建互见集：休眠前已互见的客户端两端都渲染着对方，恢复配对即可（不重发 penter）。
    // 若置空不重建，断线方的 pexit 会因 visible 集为空而漏发，对端残留幽灵小人
    const arr = Array.from(this.sessions.values());
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        if (P.inInterest(arr[i].x, arr[i].z, arr[j].x, arr[j].z)) {
          arr[i].visible.add(arr[j].pid);
          arr[j].visible.add(arr[i].pid);
        }
      }
    }
    // 唤醒后续上周期落盘（休眠时 alarm 链可能已断）
    if (this.sessions.size > 0) this.ctx.storage.setAlarm(Date.now() + P.PERSIST_INTERVAL_MS);
    // 休眠唤醒后若恢复了会话，立即恢复游戏 tick（否则纯挂机客户端旁的营地不会复活）
    if (this.sessions.size > 0) this.ensureTick();
    // Boss 运行时初始化（DO 重启后立即复活）
    for (const def of BossesDef.BOSSES) {
      this.world.ensureChunk(Math.floor(def.x / 16), Math.floor(def.z / 16));
      const t = MobsDef.TYPES[def.type];
      const by = this.world.terrainHeight(Math.floor(def.x), Math.floor(def.z)) + 1;
      this.bosses.set(def.id, {
        def,
        x: def.x, y: by, z: def.z,
        half: t.half, height: t.height,
        vx: 0, vy: 0, vz: 0, onGround: true,
        hp: def.hp, maxHp: def.hp,
        dead: false, respawnAt: 0,
        aggroPid: null, atkReadyAt: 0,
        splitDone: false, summonedIds: [],
        lastAoeAt: 0, lastSummonAt: 0,
      });
    }
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
    else if (msg.t === 'attack') this.onAttack(ws, s, msg);
    else if (msg.t === 'shoot') this.onShoot(ws, s, msg);
    else if (msg.t === 'respawn') this.onRespawn(ws, s);
    else if (msg.t === 'questAccept') { if (P.validQuestMsg(msg)) this.onQuestAccept(ws, s); }
    else if (msg.t === 'questTurnIn') { if (P.validQuestMsg(msg)) this.onQuestTurnIn(ws, s); }
    else if (msg.t === 'inv_arrange') { if (P.validInvArrange(msg)) this.onInvArrange(ws, s, msg); }
    else if (msg.t === 'buy')         { if (P.validBuy(msg))        this.onBuy(ws, s, msg); }
    else if (msg.t === 'sell')        { if (P.validSell(msg))       this.onSell(ws, s, msg); }
    else if (msg.t === 'enhance')     { if (P.validEnhance(msg))    this.onEnhance(ws, s, msg); }
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
    const level = row && row.level ? row.level : 1;
    const maxHp = Stats.maxHp(level);
    const hp = row && isFinite(row.hp) && row.hp > 0 ? Math.min(row.hp, maxHp) : maxHp;
    const s = { pid: this.nextPid++, token, name, x, y, z, yaw: 0, pitch: 0, lastMoveMs: now, visible: new Set(),
      level, xp: row && isFinite(row.xp) ? row.xp : 0,
      questId: row ? row.quest_id : null,
      questProg: row && isFinite(row.quest_progress) ? row.quest_progress : 0,
      mainIndex: row && isFinite(row.chain_index) ? row.chain_index : 0,
      coins: row && isFinite(row.coins) ? row.coins : 0,
      hp, maxHp, dead: false, deadUntil: 0, invulnUntil: 0, lastHurtAt: 0, nextRegenAt: 0, atkReadyAt: 0, bowReadyAt: 0 };
    this.sessions.set(ws, s);
    // 旧版 'c:...' quest id 在新版 parse 中返回 null，清除避免卡死接任务入口
    if (s.questId && !QuestsDef.parse(s.questId)) {
      s.questId = null; s.questProg = 0;
    }
    s.inv = new Array(40).fill(null);
    const invRows = this.sql.exec(`SELECT slot, item FROM inventory WHERE pid = ?`, token).toArray();
    if (invRows.length > 0) {
      for (const r of invRows) {
        if (r.slot >= 0 && r.slot < 40) { try { s.inv[r.slot] = JSON.parse(r.item); } catch {} }
      }
    } else {
      s.inv[30] = { type: 'weapon', sub: 'sword', tier: 1, enh: 0 };
      s.inv[31] = { type: 'weapon', sub: 'bow',   tier: 1, enh: 0 };
      this.saveInventory(s);
    }
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
    const mobs = [];
    for (const m of this.mobs.values()) {
      if (!m.dead && P.inInterest(m.x, m.z, s.x, s.z)) mobs.push(this.mobSpawnMsg(m));
    }
    const qstate = this.questStateMsg(s).quest;
    this.send(ws, { t: 'welcome', pid: s.pid, seed: this.seed, x: s.x, y: s.y, z: s.z, edits, players, online: this.sessions.size,
      hp: s.hp, maxHp: s.maxHp, level: s.level, xp: s.xp, xpNext: this.xpNext(s.level), quest: qstate, mobs });
    this.send(ws, { t: 'inv_state', coins: s.coins, slots: s.inv });
    const bossStates = [];
    for (const [bid, boss] of this.bosses) {
      bossStates.push({
        id: bid, name: boss.def.name, type: boss.def.type,
        x: boss.x, y: boss.y, z: boss.z,
        hp: boss.hp, maxHp: boss.maxHp,
        alive: !boss.dead,
        respawnIn: boss.dead ? Math.max(0, Math.floor((boss.respawnAt - Date.now()) / 1000)) : 0,
      });
    }
    this.send(ws, { t: 'bossState', bosses: bossStates });
    this.broadcastOnline();
    this.ctx.storage.setAlarm(Date.now() + P.PERSIST_INTERVAL_MS);
    this.ensureTick();
  }

  // --- 移动：限速 + 互见集维护 ---
  onMove(ws, s, msg) {
    if (s.dead) return;
    const now = Date.now();
    const r = P.clampMove(s, msg, now - s.lastMoveMs);
    // 拒绝时不推进 lastMoveMs：让 dt 从上次采纳累积，避免追赶包被连环误拒
    if (!r.ok) { this.send(ws, { t: 'teleport', x: s.x, y: s.y, z: s.z }); return; }
    s.lastMoveMs = now;
    s.x = r.x; s.y = r.y; s.z = r.z;
    if (isFinite(msg.yaw)) s.yaw = msg.yaw;
    if (isFinite(msg.pitch)) s.pitch = msg.pitch;
    this.syncVisibility(ws, s);
    this.ensureTick(); // 玩家移动可能令新营地进入激活半径
    // 探索任务：检测水平距离是否达标，自动完成进度
    if (s.questId && s.questProg === 0) {
      const q = QuestsDef.parse(s.questId);
      if (q && q.kind === 'm' && q.questKind === 'explore') {
        const dist = Math.hypot(s.x - SPAWN_X, s.z - SPAWN_Z);
        if (dist >= q.count) {
          s.questProg = 1;
          this.send(ws, this.questStateMsg(s));
          this.persistSession(s);
        }
      }
    }
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

  gainOneItem(s, item) {
    if (item.type === 'block' || item.type === 'material') {
      for (let i = 0; i < 40; i++) {
        const sl = s.inv[i];
        if (!sl || sl.type !== item.type || (sl.qty || 0) >= 64) continue;
        if (item.type === 'block' && sl.id !== item.id) continue;
        if (item.type === 'material' && sl.sub !== item.sub) continue;
        sl.qty = Math.min(64, (sl.qty || 1) + (item.qty || 1));
        return i;
      }
    }
    for (let i = 0; i < 40; i++) {
      if (!s.inv[i]) { s.inv[i] = Object.assign({}, item); return i; }
    }
    return -1;
  }

  gainItems(ws, s, items) {
    const changes = [];
    for (const item of items) {
      const slot = this.gainOneItem(s, item);
      if (slot >= 0) changes.push({ slot, item: s.inv[slot] });
    }
    if (changes.length > 0) this.send(ws, { t: 'inv_delta', changes });
  }

  gainCoins(ws, s, amount) {
    s.coins = (s.coins || 0) + amount;
    this.send(ws, { t: 'inv_delta', coins: s.coins });
  }

  onBuy(ws, s, msg) {
    if (s.dead || !this.nearNpc(s)) return;
    const entry = ItemsDef.SHOP_BUY.find(e => e.sub === msg.sub && e.tier === msg.tier);
    if (!entry || s.coins < entry.price) { this.send(ws, { t: 'inv_delta', coins: s.coins }); return; }
    s.coins -= entry.price;
    this.gainItems(ws, s, [{ type: 'weapon', sub: msg.sub, tier: msg.tier, enh: 0 }]);
    this.send(ws, { t: 'inv_delta', coins: s.coins });
    this.persistSession(s);
  }

  onSell(ws, s, msg) {
    if (s.dead || !this.nearNpc(s)) return;
    const price = ItemsDef.SHOP_SELL[msg.sub];
    if (!price) return;
    let available = 0;
    for (const it of s.inv) if (it && it.type === 'material' && it.sub === msg.sub) available += it.qty;
    const qty = Math.min(msg.qty, available);
    if (qty <= 0) return;
    let toRemove = qty;
    const changes = [];
    for (let i = 0; i < 40 && toRemove > 0; i++) {
      const it = s.inv[i];
      if (!it || it.type !== 'material' || it.sub !== msg.sub) continue;
      const take = Math.min(it.qty, toRemove);
      it.qty -= take; toRemove -= take;
      if (it.qty <= 0) s.inv[i] = null;
      changes.push({ slot: i, item: s.inv[i] });
    }
    s.coins = (s.coins || 0) + qty * price;
    this.send(ws, { t: 'inv_delta', changes, coins: s.coins });
    this.persistSession(s);
  }

  onEnhance(ws, s, msg) {
    if (s.dead) return;
    const weapon = s.inv[msg.slot];
    if (!weapon || weapon.type !== 'weapon' || weapon.enh >= 3) return;
    const nextEnh = weapon.enh + 1;
    const matSub = ItemsDef.ENH_MATERIAL[weapon.sub];
    const cost = ItemsDef.ENH_COST[nextEnh];
    let available = 0;
    for (const it of s.inv) if (it && it.type === 'material' && it.sub === matSub) available += it.qty;
    if (available < cost) return;
    let toRemove = cost;
    const changes = [];
    for (let i = 0; i < 40 && toRemove > 0; i++) {
      const it = s.inv[i];
      if (!it || it.type !== 'material' || it.sub !== matSub) continue;
      const take = Math.min(it.qty, toRemove);
      it.qty -= take; toRemove -= take;
      if (it.qty <= 0) s.inv[i] = null;
      changes.push({ slot: i, item: s.inv[i] });
    }
    const succeeded = Math.random() < ItemsDef.ENH_RATE[nextEnh];
    if (succeeded) {
      weapon.enh = nextEnh;
    } else if (nextEnh === 3 && weapon.enh > 1) {
      weapon.enh = 1;
    }
    changes.push({ slot: msg.slot, item: weapon });
    this.send(ws, { t: 'inv_delta', changes });
    this.persistSession(s);
  }

  onInvArrange(ws, s, msg) {
    const pool = s.inv.filter(Boolean).map(it => JSON.stringify(it));
    const newInv = new Array(40).fill(null);
    for (let i = 0; i < 40; i++) {
      const ci = msg.slots[i];
      if (!ci) continue;
      const key = JSON.stringify(ci);
      const idx = pool.indexOf(key);
      if (idx < 0) return;
      pool.splice(idx, 1);
      newInv[i] = ci;
    }
    if (pool.length > 0) return;
    s.inv = newInv;
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
    if (msg.id === 0) {
      let curId;
      if (this.edits.has(k)) {
        curId = this.edits.get(k);
      } else {
        this.world.ensureChunk(Math.floor(msg.x / World.CHUNK_X), Math.floor(msg.z / World.CHUNK_Z));
        curId = this.world.getBlock(msg.x, msg.y, msg.z);
      }
      if (curId > 0) this.gainItems(ws, s, [{ type: 'block', id: curId, qty: 1 }]);
    }
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
    s.lastMoveMs = Date.now(); // 位置已权威重置，限速时钟同步归零，避免长闲置攒出超大位移预算
    this.send(ws, { t: 'teleport', x: s.x, y: s.y, z: s.z });
    this.syncVisibility(ws, s);
  }

  // NPC 邻近校验（位置上报有滞后，给 1 格余量）
  nearNpc(s) {
    return Math.hypot(s.x - QuestsDef.NPC_X, s.z - QuestsDef.NPC_Z) <= QuestsDef.NPC_RANGE + 1;
  }

  onQuestAccept(ws, s) {
    if (s.dead || s.questId || !this.nearNpc(s)) return; // 已有任务/不在 NPC 旁：忽略
    const q = QuestsDef.offer(s.mainIndex, s.level);
    if (!q) return; // 等级不足
    s.questId = q.id; s.questProg = 0;
    this.send(ws, this.questStateMsg(s));
  }

  onQuestTurnIn(ws, s) {
    if (s.dead || !s.questId || !this.nearNpc(s)) return;
    const q = QuestsDef.parse(s.questId);
    if (!q) return;

    if (q.kind === 'm' && q.questKind === 'collect') {
      // collect：校验并扣除背包中的材料
      let have = 0;
      for (const it of s.inv) {
        if (it && it.type === 'material' && it.sub === q.type) have += (it.qty || 1);
      }
      if (have < q.count) return;
      let toRemove = q.count;
      const changes = [];
      for (let i = 0; i < 40 && toRemove > 0; i++) {
        const it = s.inv[i];
        if (!it || it.type !== 'material' || it.sub !== q.type) continue;
        const take = Math.min(it.qty || 1, toRemove);
        it.qty = (it.qty || 1) - take; toRemove -= take;
        if (it.qty <= 0) s.inv[i] = null;
        changes.push({ slot: i, item: s.inv[i] });
      }
      if (changes.length > 0) this.send(ws, { t: 'inv_delta', changes });
    } else {
      // explore: questProg=1表示已到达；kill/boss/daily: questProg需达到count
      if (q.questKind === 'explore' ? s.questProg < 1 : s.questProg < q.count) return;
    }

    // 奖励
    this.gainXp(ws, s, q.xpReward || q.reward || 0);
    if (q.coins > 0) this.gainCoins(ws, s, q.coins);
    if (q.item) this.gainItems(ws, s, [Object.assign({}, q.item)]);

    // 推进索引
    if (q.kind === 'm') s.mainIndex++;
    s.questId = null; s.questProg = 0;
    this.send(ws, this.questStateMsg(s));
    this.persistSession(s);
  }

  // ====== M2 怪物模拟 ======

  // 有事可做就保证 tick 在跑；空转 5 秒自停（允许 DO 休眠）
  ensureTick() {
    this.idleTicks = 0;
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), P.MOB_TICK_MS);
  }

  stopTick() {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
  }

  campKey(c) { return c.ccx + '_' + c.ccz; }
  mobId(c, slot) { return c.ccx + '_' + c.ccz + '_' + slot; }

  // 营地激活扫描：有玩家在 5 区块内 → 激活并生成怪；超出保持半径 → 整体移除（再激活全量重生）
  scanCamps() {
    const want = new Map(); // 激活集（5 区块）
    const keep = new Set(); // 保持集（6 区块滞回：防玩家在边界来回导致整营反复重生）
    for (const s of this.sessions.values()) {
      if (s.dead) continue;
      for (const c of MobsDef.campsNear(this.seed, s.x, s.z, P.CAMP_ACTIVE_CHUNKS)) {
        want.set(this.campKey(c), c);
      }
      for (const c of MobsDef.campsNear(this.seed, s.x, s.z, P.CAMP_ACTIVE_CHUNKS + 1)) {
        keep.add(this.campKey(c));
      }
    }
    for (const [key, c] of want) {
      if (!this.activeCamps.has(key)) this.activateCamp(key, c);
    }
    for (const [key, entry] of Array.from(this.activeCamps)) {
      if (!keep.has(key)) this.deactivateCamp(key, entry);
    }
  }

  activateCamp(key, c) {
    // 预生成营地周围 5×5 区块（怪物物理与落点需要真实地形；服务器区块永不淘汰）。
    // 注意：首次激活同步生成 25 区块会让该 tick 顿一下——一次性成本、永不重复，M2 接受
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        this.world.ensureChunk(c.ccx + dx, c.ccz + dz);
    const entry = { camp: c, mobIds: [] };
    for (let i = 0; i < c.count; i++) {
      const id = this.mobId(c, i);
      const t = MobsDef.TYPES[c.type];
      const st = MobsDef.mobStats(c.type, c.levels[i]);
      const ang = (i / c.count) * Math.PI * 2;
      const mx = c.x + Math.cos(ang) * 2, mz = c.z + Math.sin(ang) * 2;
      // 落点高度按各怪所在列取地表：坡地上用营地中心高度会嵌墙/悬空
      const my = this.world.terrainHeight(Math.floor(mx), Math.floor(mz)) + 1;
      const mob = Physics.createBody(mx, my, mz, t.half, t.height);
      Object.assign(mob, {
        id, type: c.type, lv: c.levels[i], hp: st.hp, maxHp: st.hp, dmg: st.dmg, xp: st.xp,
        speed: t.speed, yaw: 0, state: 'idle', aggroPid: null, atkReadyAt: 0,
        dead: false, respawnAt: 0, wanderUntil: 0, tx: c.x, tz: c.z, campX: c.x, campZ: c.z, key,
      });
      this.mobs.set(id, mob);
      entry.mobIds.push(id);
      this.broadcastMob(mob, this.mobSpawnMsg(mob));
    }
    this.activeCamps.set(key, entry);
  }

  deactivateCamp(key, entry) {
    for (const id of entry.mobIds) {
      const mob = this.mobs.get(id);
      if (mob && !mob.dead) this.broadcastMob(mob, { t: 'mobDespawn', id });
      this.mobs.delete(id);
    }
    this.activeCamps.delete(key);
  }

  mobSpawnMsg(m) {
    return { t: 'mobSpawn', id: m.id, type: m.type, lv: m.lv, x: m.x, y: m.y, z: m.z, hp: m.hp, maxHp: m.maxHp };
  }

  // 给兴趣范围内的玩家广播怪物事件
  broadcastMob(mob, msg) {
    for (const [ws, s] of this.sessions) {
      if (P.inInterest(mob.x, mob.z, s.x, s.z)) this.send(ws, msg);
    }
  }

  broadcastBoss(boss, msg) {
    for (const [ws, s] of this.sessions) {
      if (P.inInterest(boss.x, boss.z, s.x, s.z)) this.send(ws, msg);
    }
  }

  bossSpawnMsg(boss) {
    const def = boss.def;
    return { t: 'bossSpawn', id: def.id, name: def.name, type: def.type,
      x: boss.x, y: boss.y, z: boss.z, hp: boss.hp, maxHp: boss.maxHp };
  }

  // 兴趣内最近的存活玩家
  nearestPlayer(mob) {
    let best = null;
    for (const s of this.sessions.values()) {
      if (s.dead) continue;
      const d = Math.hypot(s.x - mob.x, s.z - mob.z);
      if (d <= MobsDef.TYPES[mob.type].sight * 2 + 8 && (!best || d < best.dist)) {
        best = { dist: d, pid: s.pid, x: s.x, y: s.y, z: s.z, session: s };
      }
    }
    return best;
  }

  sessionByPid(pid) {
    for (const [ws, s] of this.sessions) if (s.pid === pid) return [ws, s];
    return [null, null];
  }

  tick() {
    const now = Date.now();
    let busy = false;
    this.tickN = (this.tickN || 0) + 1;
    if (this.tickN % 10 === 1) this.scanCamps(); // 1Hz 扫描激活
    for (const mob of this.mobs.values()) {
      busy = true;
      this.tickMob(mob, now);
    }
    for (const boss of this.bosses.values()) {
      if (!boss.dead) busy = true;
      this.tickBoss(boss, now);
    }
    this.tickArrows(now);
    if (this.arrows.size > 0) busy = true;
    busy = this.tickPlayers(now) || busy;
    if (busy) this.idleTicks = 0;
    else if (++this.idleTicks > 50) this.stopTick(); // 空转 5 秒自停
  }

  tickMob(mob, now) {
    const dt = P.MOB_TICK_MS / 1000;
    // 死亡：到点原地重生（满血、回营地落点）
    if (mob.dead) {
      if (now >= mob.respawnAt) {
        const st = MobsDef.mobStats(mob.type, mob.lv);
        mob.hp = st.hp; mob.dead = false; mob.state = 'idle'; mob.aggroPid = null;
        mob.x = mob.campX; mob.z = mob.campZ;
        mob.y = this.world.terrainHeight(Math.floor(mob.x), Math.floor(mob.z)) + 1;
        mob.vx = mob.vy = mob.vz = 0;
        this.broadcastMob(mob, this.mobSpawnMsg(mob));
      }
      return;
    }
    const near = this.nearestPlayer(mob);
    const campDist = Math.hypot(mob.x - mob.campX, mob.z - mob.campZ);
    const r = MobsDef.aiStep(mob, { nearest: near ? { dist: near.dist, pid: near.pid } : null, campDist }, now);
    mob.state = r.state;
    if (r.healed) { mob.hp = mob.maxHp; mob.aggroPid = null; }

    // 位移目标
    let tx = null, tz = null, speedMul = 1;
    if (r.state === 'return') { tx = mob.campX; tz = mob.campZ; }
    else if (r.state === 'chase' && near) {
      if (r.retreat) { tx = mob.x + (mob.x - near.x); tz = mob.z + (mob.z - near.z); } // 反向远离
      else if (!r.shootPid && !r.attackPid) { tx = near.x; tz = near.z; }
    } else if (r.state === 'idle') {
      // 游走：到期换营地 8 格内随机点
      if (now >= mob.wanderUntil) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * MobsDef.WANDER_R;
        mob.tx = mob.campX + Math.cos(a) * rr; mob.tz = mob.campZ + Math.sin(a) * rr;
        mob.wanderUntil = now + 2000 + Math.random() * 2000;
      }
      if (Math.hypot(mob.tx - mob.x, mob.tz - mob.z) > 0.8) { tx = mob.tx; tz = mob.tz; speedMul = 0.5; }
    }

    // 速度与跳跃
    if (tx != null) {
      const dx = tx - mob.x, dz = tz - mob.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.05) {
        const sp = mob.speed * speedMul;
        mob.vx = dx / len * sp; mob.vz = dz / len * sp;
        mob.yaw = Math.atan2(-mob.vx, -mob.vz);
        // 10Hz tick 下半隐式欧拉对跳跃顶点有离散低估：v=9 顶点仅 0.9 格跳不上台阶，取 10（顶点 1.2 格）
        if (mob.onGround && Physics.blockedAhead(mob, this.world, dx, dz)) Physics.tryJump(mob, 10);
        if (mob.type === 'slime' && mob.onGround) Physics.tryJump(mob, 5); // 史莱姆弹跳移动（纯观感，不用于爬台阶）
      } else { mob.vx = 0; mob.vz = 0; }
    } else { mob.vx = 0; mob.vz = 0; }

    const px = mob.x, py = mob.y, pz = mob.z;
    Physics.step(mob, this.world, dt);
    // 掉出世界兜底：传回营地
    if (mob.y < -10) {
      mob.x = mob.campX; mob.z = mob.campZ;
      mob.y = this.world.terrainHeight(Math.floor(mob.x), Math.floor(mob.z)) + 1;
      mob.vx = mob.vy = mob.vz = 0;
    }

    // 攻击意图（回巢途中无敌不攻击；伤害结算在 Task 6 接入 damagePlayer）
    if (r.attackPid != null && now >= mob.atkReadyAt) {
      mob.atkReadyAt = now + MobsDef.TYPES[mob.type].atkCdMs;
      const [, victim] = this.sessionByPid(r.attackPid);
      if (victim) this.damagePlayer(victim, mob.dmg, now);
    }
    if (r.shootPid != null && now >= mob.atkReadyAt) {
      mob.atkReadyAt = now + MobsDef.TYPES[mob.type].atkCdMs;
      const [, victim] = this.sessionByPid(r.shootPid);
      if (victim) this.spawnArrow(mob.x, mob.y + mob.height * 0.8, mob.z,
        victim.x - mob.x, victim.y + 1.4 - (mob.y + mob.height * 0.8), victim.z - mob.z, 0, mob.dmg);
    }

    // 位置广播（有移动才发）
    if (Math.abs(mob.x - px) + Math.abs(mob.y - py) + Math.abs(mob.z - pz) > 0.001) {
      this.broadcastMob(mob, { t: 'mobMove', id: mob.id, x: mob.x, y: mob.y, z: mob.z, yaw: mob.yaw });
    }
  }

  tickBoss(boss, now) {
    const dt = P.MOB_TICK_MS / 1000;
    const def = boss.def;
    const t = MobsDef.TYPES[def.type];

    if (boss.dead) {
      if (now >= boss.respawnAt) {
        boss.hp = boss.maxHp; boss.dead = false;
        boss.x = def.x; boss.z = def.z;
        boss.y = this.world.terrainHeight(Math.floor(def.x), Math.floor(def.z)) + 1;
        boss.vx = boss.vy = boss.vz = 0;
        boss.splitDone = false; boss.summonedIds = [];
        boss.lastAoeAt = 0; boss.lastSummonAt = 0;
        this.broadcastBoss(boss, this.bossSpawnMsg(boss));
        for (const ws2 of this.sessions.keys()) {
          this.send(ws2, { t: 'bossRespawn', id: def.id });
        }
      }
      return;
    }

    // 寻找兴趣内最近存活玩家（视野20格）
    let near = null;
    for (const s of this.sessions.values()) {
      if (s.dead) continue;
      const d = Math.hypot(s.x - boss.x, s.z - boss.z);
      if (d <= 20 * 2 + 8 && (!near || d < near.dist)) {
        near = { dist: d, pid: s.pid, x: s.x, y: s.y, z: s.z };
      }
    }

    // 移动
    let tx = null, tz = null, speedMul = 1;
    if (near && near.dist <= 20) {
      if (def.skill === 'dash' && near.dist > 5) speedMul = 3;
      if (!t.ranged) {
        tx = near.x; tz = near.z;
      } else {
        if (near.dist < t.keepMin) { tx = boss.x + (boss.x - near.x); tz = boss.z + (boss.z - near.z); }
        else if (near.dist > t.keepMax) { tx = near.x; tz = near.z; }
      }
    }

    if (tx != null) {
      const dx = tx - boss.x, dz = tz - boss.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.05) {
        boss.vx = dx / len * def.speed * speedMul;
        boss.vz = dz / len * def.speed * speedMul;
        boss.yaw = Math.atan2(-boss.vx, -boss.vz);
        if (boss.onGround && Physics.blockedAhead(boss, this.world, dx, dz)) Physics.tryJump(boss, 10);
      } else { boss.vx = 0; boss.vz = 0; }
    } else { boss.vx = 0; boss.vz = 0; }

    const px = boss.x, py = boss.y, pz = boss.z;
    Physics.step(boss, this.world, dt);
    if (boss.y < -10) {
      boss.x = def.x; boss.z = def.z;
      boss.y = this.world.terrainHeight(Math.floor(def.x), Math.floor(def.z)) + 1;
      boss.vx = boss.vy = boss.vz = 0;
    }

    // 攻击
    if (near && now >= boss.atkReadyAt) {
      if (!t.ranged && near.dist <= t.atkRange) {
        boss.atkReadyAt = now + t.atkCdMs;
        const [, victim] = this.sessionByPid(near.pid);
        if (victim) this.damagePlayer(victim, def.dmg, now);
      } else if (t.ranged && near.dist >= t.keepMin && near.dist <= t.keepMax) {
        boss.atkReadyAt = now + t.atkCdMs;
        const [, victim] = this.sessionByPid(near.pid);
        if (victim) this.spawnArrow(
          boss.x, boss.y + boss.height * 0.8, boss.z,
          victim.x - boss.x, victim.y + 1.4 - (boss.y + boss.height * 0.8), victim.z - boss.z,
          0, def.dmg);
      }
    }

    // 技能：分裂（史莱姆王）
    if (def.skill === 'split' && !boss.splitDone && boss.hp <= boss.maxHp / 2) {
      boss.splitDone = true;
      for (let i = 0; i < 2; i++) {
        const ang = (i / 2) * Math.PI * 2;
        const mx = boss.x + Math.cos(ang) * 3, mz = boss.z + Math.sin(ang) * 3;
        const my = this.world.terrainHeight(Math.floor(mx), Math.floor(mz)) + 1;
        const ts = MobsDef.TYPES['slime'];
        const mob = Physics.createBody(mx, my, mz, ts.half, ts.height);
        const sid = 'bsplit_' + now + '_' + i;
        Object.assign(mob, {
          id: sid, type: 'slime', lv: 3, hp: 36, maxHp: 36, dmg: 2, xp: 0,
          speed: ts.speed, yaw: 0, state: 'idle', aggroPid: null, atkReadyAt: 0,
          dead: false, respawnAt: 0, wanderUntil: 0, tx: mx, tz: mz, campX: mx, campZ: mz, key: 'boss_split',
        });
        this.mobs.set(sid, mob);
        this.broadcastMob(mob, this.mobSpawnMsg(mob));
      }
    }

    // 技能：腐化之气（僵尸领主）
    if (def.skill === 'aoe' && now - boss.lastAoeAt >= 10000) {
      boss.lastAoeAt = now;
      for (const [, s] of this.sessions) {
        if (s.dead) continue;
        if (Math.hypot(s.x - boss.x, s.z - boss.z) <= 3) this.damagePlayer(s, 4, now);
      }
    }

    // 技能：召唤骷髅（骷髅法师）
    if (def.skill === 'summon' && now - boss.lastSummonAt >= 30000) {
      boss.lastSummonAt = now;
      for (let i = 0; i < 2; i++) {
        const ang = (i / 2) * Math.PI * 2;
        const mx = boss.x + Math.cos(ang) * 4, mz = boss.z + Math.sin(ang) * 4;
        const my = this.world.terrainHeight(Math.floor(mx), Math.floor(mz)) + 1;
        const tk = MobsDef.TYPES['skeleton'];
        const st = MobsDef.mobStats('skeleton', 8);
        const mob = Physics.createBody(mx, my, mz, tk.half, tk.height);
        const kid = 'bsummon_' + now + '_' + i;
        Object.assign(mob, {
          id: kid, type: 'skeleton', lv: 8, hp: st.hp, maxHp: st.hp, dmg: st.dmg, xp: 0,
          speed: tk.speed, yaw: 0, state: 'idle', aggroPid: null, atkReadyAt: 0,
          dead: false, respawnAt: 0, wanderUntil: 0, tx: mx, tz: mz, campX: mx, campZ: mz, key: 'boss_summon',
        });
        this.mobs.set(kid, mob);
        boss.summonedIds.push(kid);
        this.broadcastMob(mob, this.mobSpawnMsg(mob));
      }
    }

    // 位置广播
    if (Math.abs(boss.x - px) + Math.abs(boss.y - py) + Math.abs(boss.z - pz) > 0.001) {
      this.broadcastBoss(boss, { t: 'bossMove', id: def.id, x: boss.x, y: boss.y, z: boss.z, yaw: boss.yaw || 0 });
    }
  }

  // ====== M2 战斗结算 ======

  // 近战：服务器复核冷却与射程后结算（客户端预选目标只是意图）
  onAttack(ws, s, msg) {
    if (s.dead || !P.validAttack(msg)) return;
    const now = Date.now();
    if (now < s.atkReadyAt) return;
    const mob = this.mobs.get(msg.id);
    const boss = mob ? null : this.bosses.get(msg.id);
    if (!mob && !boss) return;
    if (mob && mob.dead) return;
    if (boss && boss.dead) return;
    const target = mob || boss;
    const ex = s.x, ey = s.y + EYE, ez = s.z;
    const d = Math.hypot(target.x - ex, target.y + target.height / 2 - ey, target.z - ez);
    if (d > P.MELEE_RANGE + 1) return;
    s.atkReadyAt = now + P.MELEE_CD_MS;
    const kx = target.x - s.x, kz = target.z - s.z;
    const kl = Math.hypot(kx, kz) || 1;
    if (mob) { mob.vx += kx / kl * P.KNOCKBACK_H; mob.vz += kz / kl * P.KNOCKBACK_H; if (mob.onGround) mob.vy = P.KNOCKBACK_V; }
    const sw = (s.inv && Number.isInteger(msg.slot)) ? s.inv[30 + msg.slot] : null;
    const swordMul = (sw && sw.type === 'weapon' && sw.sub === 'sword') ? ItemsDef.weaponMul(sw.tier, sw.enh) : 1;
    const dmg = Math.floor(Stats.swordDamage(s.level) * swordMul);
    if (mob) this.hurtMob(mob, dmg, s, now);
    else this.hurtBoss(boss, dmg, ws, s, now);
    this.ensureTick();
  }

  // 射箭：从玩家视点出发，方向归一化
  onShoot(ws, s, msg) {
    if (s.dead || !P.validShoot(msg)) return;
    const now = Date.now();
    if (now < s.bowReadyAt) return;
    s.bowReadyAt = now + P.BOW_CD_MS;
    const len = Math.hypot(msg.dx, msg.dy, msg.dz);
    const bw = s.inv ? s.inv.slice(30).find(it => it && it.type === 'weapon' && it.sub === 'bow') : null;
    const bowMul = bw ? ItemsDef.weaponMul(bw.tier, bw.enh) : 1;
    this.spawnArrow(s.x, s.y + EYE, s.z, msg.dx / len, msg.dy / len, msg.dz / len, s.pid, Math.floor(Stats.bowDamage(s.level) * bowMul));
    this.ensureTick();
  }

  // xpNext：客户端经验条用；满级返回 0（条显示满格）
  xpNext(level) {
    const n = Stats.xpToNext(level);
    return n === Infinity ? 0 : n;
  }

  // 当前任务状态消息（quest 为 {type,count,progress} 或 null）
  questStateMsg(s) {
    if (!s.questId) return { t: 'questState', quest: null };
    const q = QuestsDef.parse(s.questId);
    if (!q) return { t: 'questState', quest: null };
    return { t: 'questState', quest: { type: q.type, count: q.count, progress: s.questProg, questKind: q.questKind } };
  }

  // 给玩家加经验，处理连升级（回满血+金光），下发 xpGain/levelUp
  gainXp(ws, s, amount) {
    const r = Stats.applyXp(s.level, s.xp, amount);
    s.xp = r.xp;
    if (r.leveled) {
      s.level = r.level;
      s.maxHp = Stats.maxHp(s.level);
      s.hp = s.maxHp; // 升级回满血
      this.send(ws, { t: 'levelUp', level: s.level, maxHp: s.maxHp, hp: s.hp });
      for (const [ows, os] of this.sessions) {
        if (os === s) continue;
        if (P.inInterest(s.x, s.z, os.x, os.z)) this.send(ows, { t: 'pLevelUp', pid: s.pid, x: s.x, y: s.y, z: s.z });
      }
    }
    this.send(ws, { t: 'xpGain', xp: s.xp, level: s.level, xpNext: this.xpNext(s.level) });
  }

  // 最后一击击杀结算：给经验 + 匹配怪种任务计数
  grantKill(attacker, mob) {
    const [ws, s] = this.sessionByPid(attacker.pid);
    if (!s || s.dead) return; // 离线/不存在的射手：丢弃（无离线补偿，spec 接受）
    this.gainXp(ws, s, MobsDef.mobStats(mob.type, mob.lv).xp);
    if (s.questId) {
      const q = QuestsDef.parse(s.questId);
      if (q && q.type === mob.type && s.questProg < q.count) {
        s.questProg++;
        this.send(ws, this.questStateMsg(s));
      }
    }
    const drop = ItemsDef.rollDrop(mob.type, mob.lv);
    if (drop.items.length > 0) this.gainItems(ws, s, drop.items);
    if (drop.coins > 0) this.gainCoins(ws, s, drop.coins);
  }

  hurtMob(mob, dmg, attacker, now) {
    if (mob.state === 'return') return; // 回巢途中无敌（防风筝逃课，spec 明确）
    mob.hp -= dmg;
    mob.aggroPid = attacker.pid; // 被动怪被打才反击
    if (mob.state === 'idle') mob.state = 'chase';
    if (mob.hp <= 0) {
      mob.hp = 0; mob.dead = true;
      mob.respawnAt = now + 30000; // 死后 30 秒原地重生
      this.broadcastMob(mob, { t: 'mobDie', id: mob.id });
      this.grantKill(attacker, mob); // 经验 + 任务计数（最后一击归属）
    } else {
      this.broadcastMob(mob, { t: 'mobHurt', id: mob.id, hp: mob.hp, dmg });
    }
  }

  hurtBoss(boss, dmg, ws, s, now) {
    if (boss.dead) return;
    boss.hp -= dmg;
    boss.aggroPid = s.pid;
    if (boss.hp <= 0) {
      boss.hp = 0; boss.dead = true;
      boss.respawnAt = now + boss.def.respawnMs;
      // 清除召唤物（骷髅法师）
      for (const mid of boss.summonedIds) {
        const m = this.mobs.get(mid);
        if (m && !m.dead) { this.broadcastMob(m, { t: 'mobDie', id: m.id }); this.mobs.delete(mid); }
      }
      boss.summonedIds = [];
      this.broadcastBoss(boss, { t: 'bossDie', id: boss.def.id, respawnIn: Math.floor(boss.def.respawnMs / 1000) });
      for (const ws2 of this.sessions.keys()) {
        this.send(ws2, { t: 'bossDied', id: boss.def.id, respawnIn: Math.floor(boss.def.respawnMs / 1000) });
      }
      this.grantBossKill(ws, s, boss);
    } else {
      this.broadcastBoss(boss, { t: 'bossHurt', id: boss.def.id, hp: boss.hp, maxHp: boss.maxHp, dmg });
    }
  }

  grantBossKill(ws, s, boss) {
    this.gainXp(ws, s, boss.def.xp);
    this.gainCoins(ws, s, boss.def.coins);
    this.gainItems(ws, s, [Object.assign({}, boss.def.loot)]);
    if (s.questId) {
      const q = QuestsDef.parse(s.questId);
      if (q && q.kind === 'm' && q.questKind === 'boss' && q.type === boss.def.id && s.questProg < q.count) {
        s.questProg++;
        this.send(ws, this.questStateMsg(s));
      }
    }
    // 其他附近玩家：30%经验分成
    for (const [ows, os] of this.sessions) {
      if (os.pid === s.pid) continue;
      if (P.inInterest(boss.x, boss.z, os.x, os.z)) {
        this.gainXp(ows, os, Math.floor(boss.def.xp * 0.3));
      }
    }
  }

  // ownerPid>0 为玩家箭（只打怪），0 为怪物箭（只打玩家）
  spawnArrow(x, y, z, dx, dy, dz, ownerPid, dmg) {
    const len = Math.hypot(dx, dy, dz) || 1;
    const a = {
      id: 'a' + this.nextArrowId++, own: ownerPid, dmg,
      x: x + dx / len * 0.6, y: y + dy / len * 0.6, z: z + dz / len * 0.6,
      vx: dx / len * P.ARROW_SPEED, vy: dy / len * P.ARROW_SPEED, vz: dz / len * P.ARROW_SPEED,
      dieAt: Date.now() + P.ARROW_LIFE_MS,
    };
    this.arrows.set(a.id, a);
    // 广播给兴趣内玩家；玩家自己的箭不回发（客户端已本地预表现）
    for (const [ws2, s2] of this.sessions) {
      if (s2.pid === ownerPid) continue;
      if (P.inInterest(a.x, a.z, s2.x, s2.z)) {
        this.send(ws2, { t: 'arrowSpawn', id: a.id, x: a.x, y: a.y, z: a.z, vx: a.vx, vy: a.vy, vz: a.vz, own: ownerPid });
      }
    }
    this.ensureTick();
  }

  // 逐 tick 积分弹道：先按 0.5 格采样找最早方块命中并截断线段，再在截断段上判实体
  // （若实体判定先吃整段，一 tick 3 格的箭会隔薄墙命中墙后目标——spec 要求箭被方块挡住）
  tickArrows(now) {
    const dt = P.MOB_TICK_MS / 1000;
    for (const [id, a] of Array.from(this.arrows)) {
      const x0 = a.x, y0 = a.y, z0 = a.z;
      a.vy -= P.ARROW_GRAVITY * dt;
      a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
      // 方块命中：求截断点（无命中则截断点=本 tick 终点）
      let bx = a.x, by = a.y, bz = a.z, blockHit = false;
      const segLen = Math.hypot(a.x - x0, a.y - y0, a.z - z0);
      const steps = Math.max(1, Math.ceil(segLen / 0.5));
      for (let i = 1; i <= steps; i++) {
        const f = i / steps;
        const sx = x0 + (a.x - x0) * f, sy = y0 + (a.y - y0) * f, sz = z0 + (a.z - z0) * f;
        if (MW.Blocks.isSolid(this.world.getBlock(Math.floor(sx), Math.floor(sy), Math.floor(sz)))) {
          bx = sx; by = sy; bz = sz; blockHit = true;
          break;
        }
      }
      let hit = null; // {x,y,z}
      // 实体判定（只在截断段上）：玩家箭打怪，怪物箭打玩家
      if (a.own > 0) {
        for (const mob of this.mobs.values()) {
          if (mob.dead) continue;
          if (Physics.segmentHitsBox(x0, y0, z0, bx, by, bz, mob)) {
            const [, atk] = this.sessionByPid(a.own);
            this.hurtMob(mob, a.dmg, atk || { pid: a.own }, now);
            hit = { x: bx, y: by, z: bz };
            break;
          }
        }
        if (!hit) {
          for (const boss of this.bosses.values()) {
            if (boss.dead) continue;
            if (Physics.segmentHitsBox(x0, y0, z0, bx, by, bz, boss)) {
              const [ws2, atk] = this.sessionByPid(a.own);
              this.hurtBoss(boss, a.dmg, ws2, atk || { pid: a.own, questId: null, dead: false }, now);
              hit = { x: bx, y: by, z: bz };
              break;
            }
          }
        }
      } else {
        for (const s of this.sessions.values()) {
          if (s.dead) continue;
          if (Physics.segmentHitsBox(x0, y0, z0, bx, by, bz, { x: s.x, y: s.y, z: s.z, half: 0.3, height: 1.8 })) {
            this.damagePlayer(s, a.dmg, now);
            hit = { x: bx, y: by, z: bz };
            break;
          }
        }
      }
      if (!hit && blockHit) hit = { x: bx, y: by, z: bz };
      if (hit || now >= a.dieAt || a.y < -20) {
        const px = hit ? hit.x : a.x, py = hit ? hit.y : a.y, pz = hit ? hit.z : a.z;
        this.arrows.delete(id);
        for (const [ws2, s2] of this.sessions) {
          if (P.inInterest(px, pz, s2.x, s2.z)) this.send(ws2, { t: 'arrowDie', id, x: px, y: py, z: pz });
        }
      }
    }
  }

  // 玩家受伤：无敌帧 → 扣血 → 死亡进入复活倒计时
  damagePlayer(s, dmg, now) {
    if (s.dead || now < s.invulnUntil) return;
    s.hp -= dmg;
    s.invulnUntil = now + P.INVULN_MS;
    s.lastHurtAt = now;
    const [ws] = this.sessionByPid(s.pid);
    if (s.hp <= 0) {
      s.hp = 0; s.dead = true; s.deadUntil = now + P.DEATH_RESPAWN_MS;
      s.xp = Stats.xpAfterDeath(s.xp); // 扣当前等级进度 10%，不降级
      if (ws) { this.send(ws, { t: 'playerDie' }); this.send(ws, { t: 'xpGain', xp: s.xp, level: s.level, xpNext: this.xpNext(s.level) }); }
    } else if (ws) {
      this.send(ws, { t: 'playerHurt', hp: s.hp, dmg });
    }
  }

  // 玩家逐 tick：复活倒计时与脱战回血；返回是否有事在做
  tickPlayers(now) {
    let busy = false;
    for (const [ws, s] of this.sessions) {
      if (s.dead) {
        busy = true;
        if (now >= s.deadUntil) {
          s.dead = false;
          s.hp = s.maxHp;
          s.x = SPAWN_X; s.z = SPAWN_Z;
          s.y = this.world.terrainHeight(8, 8) + 1;
          s.lastMoveMs = now;
          this.send(ws, { t: 'teleport', x: s.x, y: s.y, z: s.z });
          this.send(ws, { t: 'hpUpdate', hp: s.hp, max: s.maxHp });
          this.syncVisibility(ws, s);
        }
        continue;
      }
      if (s.hp < s.maxHp) {
        busy = true;
        if (now - s.lastHurtAt >= P.REGEN_DELAY_MS && now >= s.nextRegenAt) {
          s.hp = Math.min(s.maxHp, s.hp + 1);
          s.nextRegenAt = now + 1000;
          this.send(ws, { t: 'hpUpdate', hp: s.hp, max: s.maxHp });
        }
      }
    }
    return busy;
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

  saveInventory(s) {
    this.sql.exec(`DELETE FROM inventory WHERE pid = ?`, s.token);
    for (let i = 0; i < 40; i++) {
      if (s.inv[i] !== null) {
        this.sql.exec(`INSERT INTO inventory (pid, slot, item) VALUES (?, ?, ?)`,
          s.token, i, JSON.stringify(s.inv[i]));
      }
    }
  }

  persistSession(s) {
    // 死亡中落库视同已复活：出生点 + 满血（复活计时跨断线不保留，直接兑现其结果）
    const px = s.dead ? SPAWN_X : s.x, pz = s.dead ? SPAWN_Z : s.z;
    const py = s.dead ? this.world.terrainHeight(8, 8) + 1 : s.y;
    const ph = s.dead ? s.maxHp : s.hp;
    this.sql.exec(`UPDATE players SET x = ?, y = ?, z = ?, hp = ?, level = ?, xp = ?, quest_id = ?, quest_progress = ?, chain_index = ?, coins = ?, last_seen = ? WHERE token = ?`,
      px, py, pz, ph, s.level, s.xp, s.questId, s.questProg, s.mainIndex, s.coins || 0, Date.now(), s.token);
    this.saveInventory(s);
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
