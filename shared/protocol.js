// shared/protocol.js — 两端共享：协议常量与纯校验函数
(function (root) {
  'use strict';

  const INTEREST_CHUNKS = 4;         // 实体兴趣半径（区块，Chebyshev）
  const REACH = 6;                   // 挖放射程（与客户端一致）
  const REACH_SLACK = 2;             // 服务器校验余量（位置上报有滞后）
  const MAX_HSPEED = 9;              // 水平限速 m/s（步行 4.5 的 2 倍余量）
  const MAX_HSPEED_SPRINT = 16;      // 冲刺限速 m/s（4.5×3=13.5 + 安全余量，level>=7 解锁）
  const MAX_VSPEED = 45;             // 垂直限速 m/s（最大坠落 40 + 余量）
  const MOVE_INTERVAL_MS = 100;      // 客户端位置上报周期
  const PERSIST_INTERVAL_MS = 30000; // 在线进度周期落盘
  const RECONNECT_BASE_MS = 1000, RECONNECT_MAX_MS = 15000;
  const VALID_BLOCK_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

  // —— M2 战斗常量 ——
  const MELEE_RANGE = 3.5;          // 剑射程（格）
  const MELEE_CD_MS = 500;          // 剑冷却
  const BOW_CD_MS = 1000;           // 弓冷却
  const ARROW_SPEED = 30;           // 箭初速（格/秒）
  const ARROW_GRAVITY = 18;         // 箭重力（弱于实体重力，弹道更平）
  const ARROW_LIFE_MS = 5000;       // 箭最长存活
  const INVULN_MS = 500;            // 玩家受击无敌
  const REGEN_DELAY_MS = 5000;      // 脱战回血延迟
  const DEATH_RESPAWN_MS = 3000;    // 死亡到复活
  const MOB_TICK_MS = 100;          // 服务器游戏 tick
  const CAMP_ACTIVE_CHUNKS = 5;     // 营地激活半径（区块）
  const KNOCKBACK_H = 6, KNOCKBACK_V = 3; // 近战击退冲量

  // 区块尺寸 16 与 World.CHUNK_X 一致（protocol 不依赖 world，避免加载顺序耦合）
  function chunkOf(v) { return Math.floor(v / 16); }

  // 两个世界坐标是否在彼此兴趣半径内
  function inInterest(ax, az, bx, bz) {
    return Math.max(Math.abs(chunkOf(ax) - chunkOf(bx)),
                    Math.abs(chunkOf(az) - chunkOf(bz))) <= INTEREST_CHUNKS;
  }

  // 编辑消息校验：结构、方块 id、y 范围、与玩家视点距离
  function validEdit(msg, px, py, pz, chunkY) {
    if (!msg || !Number.isInteger(msg.x) || !Number.isInteger(msg.y) || !Number.isInteger(msg.z)) return false;
    if (!Number.isInteger(msg.id) || VALID_BLOCK_IDS.indexOf(msg.id) === -1) return false;
    if (msg.y < 0 || msg.y >= chunkY) return false;
    const dx = msg.x + 0.5 - px, dy = msg.y + 0.5 - py, dz = msg.z + 0.5 - pz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) <= REACH + REACH_SLACK;
  }

  // 移动限速：返回服务器采纳的位置；超速/非法则 ok=false 并保留原位（拉回）
  // maxHSpeed 由调用方按玩家等级传入（sprint 解锁后用 MAX_HSPEED_SPRINT）
  function clampMove(prev, msg, dtMs, maxHSpeed = MAX_HSPEED) {
    if (!msg || !isFinite(msg.x) || !isFinite(msg.y) || !isFinite(msg.z)) {
      return { ok: false, x: prev.x, y: prev.y, z: prev.z };
    }
    // 下限用 MOVE_INTERVAL_MS*0.8 而非 30ms：避免网络抖动导致两包到达过近时速度预算过小
    const dt = Math.max(dtMs, MOVE_INTERVAL_MS * 0.8) / 1000;
    const dh = Math.hypot(msg.x - prev.x, msg.z - prev.z);
    const dv = Math.abs(msg.y - prev.y);
    if (dh > maxHSpeed * dt || dv > MAX_VSPEED * dt) {
      return { ok: false, x: prev.x, y: prev.y, z: prev.z };
    }
    return { ok: true, x: msg.x, y: msg.y, z: msg.z };
  }

  // 昵称清洗：去控制字符（码点 <32、127 与 128~159）、trim、裁到 12 字；空则用 fallback
  function sanitizeName(name, fallback) {
    const raw = String(name == null ? '' : name);
    let s = '';
    for (const ch of raw) {
      const c = ch.charCodeAt(0);
      if (c >= 32 && c !== 127 && (c < 128 || c > 159)) s += ch;
    }
    s = s.trim().slice(0, 12);
    return s.length > 0 ? s : fallback;
  }

  // 重连退避：第 attempt 次（从 0 起）的等待毫秒
  function backoffMs(attempt) {
    return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, attempt));
  }

  // 近战意图校验：mobId 为非空短字符串
  function validAttack(msg) {
    return !!(msg && typeof msg.id === 'string' && msg.id.length > 0 && msg.id.length <= 24);
  }

  // 射箭意图校验：方向分量有限且模非零（服务器自行归一化）
  function validShoot(msg) {
    if (!msg || !isFinite(msg.dx) || !isFinite(msg.dy) || !isFinite(msg.dz)) return false;
    return Math.hypot(msg.dx, msg.dy, msg.dz) > 1e-6;
  }

  // 任务意图校验：无负载，仅防 null/非对象
  function validQuestMsg(msg) {
    return !!msg && typeof msg === 'object';
  }

  // —— 背包常量与校验 ——
  const INV_SLOTS = 40; // 0-29 backpack, 30-39 hotbar

  function validInvArrange(msg) {
    return !!(msg && Array.isArray(msg.slots) && msg.slots.length === INV_SLOTS);
  }
  function validBuy(msg) {
    return !!(msg && (msg.sub === 'sword' || msg.sub === 'bow') &&
      (msg.tier === 1 || msg.tier === 2 || msg.tier === 3));
  }
  function validSell(msg) {
    const VALID = ['slime_gel', 'zombie_rags', 'skeleton_bone', 'wolf_fang'];
    return !!(msg && VALID.indexOf(msg.sub) >= 0 &&
      Number.isInteger(msg.qty) && msg.qty > 0 && msg.qty <= 640);
  }
  function validEnhance(msg) {
    return !!(msg && Number.isInteger(msg.slot) && msg.slot >= 0 && msg.slot < INV_SLOTS);
  }

  function validPvpAttack(msg) {
    return !!(msg && Number.isInteger(msg.pid) && msg.pid > 0);
  }

  function validTeamPid(msg) {
    return !!(msg && Number.isInteger(msg.pid) && msg.pid > 0);
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Protocol = {
    INTEREST_CHUNKS, REACH, REACH_SLACK, MAX_HSPEED, MAX_HSPEED_SPRINT, MAX_VSPEED,
    MOVE_INTERVAL_MS, PERSIST_INTERVAL_MS, VALID_BLOCK_IDS,
    MELEE_RANGE, MELEE_CD_MS, BOW_CD_MS, ARROW_SPEED, ARROW_GRAVITY, ARROW_LIFE_MS,
    INVULN_MS, REGEN_DELAY_MS, DEATH_RESPAWN_MS, MOB_TICK_MS, CAMP_ACTIVE_CHUNKS,
    KNOCKBACK_H, KNOCKBACK_V,
    INV_SLOTS, validInvArrange, validBuy, validSell, validEnhance,
    validPvpAttack, validTeamPid,
    inInterest, validEdit, clampMove, sanitizeName, backoffMs, validAttack, validShoot, validQuestMsg,
  };
})(typeof self !== 'undefined' ? self : globalThis);
