// shared/mobs_def.js — 两端共享：怪物模板、等级地带、营地确定性散布、AI 状态机（纯函数）
(function (root) {
  'use strict';

  // 出生点（与 server/world_do.js 的 SPAWN 一致，服务器直接引用本处常量）
  const SPAWN_X = 8.5, SPAWN_Z = 8.5;

  // 怪物模板：基准数值为各地带最低等级（speed 以玩家 4.5 为基准倍率换算）
  const TYPES = {
    slime:    { name: '史莱姆',   hp: 12, dmg: 1, speed: 0.7 * 4.5, xp: 8,  aggressive: false, ranged: false, atkRange: 1.5, atkCdMs: 1000, sight: 12, half: 0.35, height: 0.7 },
    zombie:   { name: '僵尸',     hp: 25, dmg: 2, speed: 0.8 * 4.5, xp: 15, aggressive: true,  ranged: false, atkRange: 1.5, atkCdMs: 1000, sight: 12, half: 0.3,  height: 1.8 },
    skeleton: { name: '骷髅弓手', hp: 20, dmg: 3, speed: 0.8 * 4.5, xp: 25, aggressive: true,  ranged: true,  atkRange: 14,  atkCdMs: 2000, sight: 16, half: 0.3,  height: 1.8, keepMin: 8, keepMax: 14 },
    wolf:     { name: '恶狼',     hp: 35, dmg: 5, speed: 1.3 * 4.5, xp: 40, aggressive: true,  ranged: false, atkRange: 1.5, atkCdMs: 1000, sight: 14, half: 0.4,  height: 0.9 },
  };

  // 等级地带（按离出生点水平距离）；d<60 安全区不刷怪
  const ZONES = [
    { min: 60,  max: 150,      type: 'slime',    lvMin: 1,  lvMax: 3 },
    { min: 150, max: 300,      type: 'zombie',   lvMin: 4,  lvMax: 6 },
    { min: 300, max: 500,      type: 'skeleton', lvMin: 7,  lvMax: 9 },
    { min: 500, max: Infinity, type: 'wolf',     lvMin: 10, lvMax: 12 },
  ];

  function zoneOf(d) {
    for (const z of ZONES) if (d >= z.min && d < z.max) return z;
    return null;
  }

  function zoneOfType(type) {
    for (const z of ZONES) if (z.type === type) return z;
    return null;
  }

  // 数值缩放：每比地带基准高 1 级，HP/伤害/经验 ×1.1（复利，向下取整）
  function mobStats(type, lv) {
    const t = TYPES[type];
    const base = zoneOfType(type).lvMin;
    const m = Math.pow(1.1, lv - base);
    return { hp: Math.floor(t.hp * m), dmg: Math.floor(t.dmg * m), xp: Math.floor(t.xp * m) };
  }

  // 32 位整数哈希（与世界种子组合，营地散布专用）
  function hash3(seed, a, b) {
    let h = (seed ^ (a * 0x9e3779b1) ^ (b * 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  // 区块 (ccx,ccz) 是否有营地：约 15% 概率；中心列/数量/各怪等级全部由哈希确定
  function campAt(seed, ccx, ccz) {
    const centerD = Math.hypot(ccx * 16 + 8 - SPAWN_X, ccz * 16 + 8 - SPAWN_Z);
    const zone = zoneOf(centerD);
    if (!zone) return null;
    const h = hash3(seed, ccx, ccz);
    if (h % 100 >= 15) return null;
    const lx = (h >>> 8) % 16, lz = (h >>> 12) % 16;
    const count = 3 + ((h >>> 16) % 3);
    const span = zone.lvMax - zone.lvMin + 1;
    const levels = [];
    for (let i = 0; i < count; i++) {
      levels.push(zone.lvMin + (hash3(seed, ccx * 31 + i + 1, ccz * 17 - i - 1) % span));
    }
    return { ccx, ccz, x: ccx * 16 + lx + 0.5, z: ccz * 16 + lz + 0.5, type: zone.type, count, levels };
  }

  // 扫描 (x,z) 周围 radiusChunks 半径内的全部营地
  function campsNear(seed, x, z, radiusChunks) {
    const pcx = Math.floor(x / 16), pcz = Math.floor(z / 16);
    const out = [];
    for (let cx = pcx - radiusChunks; cx <= pcx + radiusChunks; cx++) {
      for (let cz = pcz - radiusChunks; cz <= pcz + radiusChunks; cz++) {
        const c = campAt(seed, cx, cz);
        if (c) out.push(c);
      }
    }
    return out;
  }

  const LEASH = 24;       // 追击离营地超过即脱战回巢
  const WANDER_R = 8;     // 游走半径
  const HOME_EPS = 1.5;   // 回巢判定半径

  // AI 决策纯函数：输入怪物（type/state/aggroPid/hp）与环境，输出下一状态与意图。
  // env = { nearest: {dist,pid}|null（兴趣内最近存活玩家）, campDist: 怪物到营地水平距离 }
  // 返回 { state, attackPid?, shootPid?, retreat?, healed? }；位移目标由服务器按 state 取（chase→玩家，return→营地，idle→游走点）
  function aiStep(mob, env, now) {
    const t = TYPES[mob.type];
    const n = env.nearest;
    if (mob.state === 'return') {
      if (env.campDist <= HOME_EPS) return { state: 'idle', healed: true };
      return { state: 'return' };
    }
    if (mob.state === 'chase') {
      if (!n) return { state: 'return' };
      if (env.campDist > LEASH) return { state: 'return' };
      if (t.ranged) {
        if (n.dist < t.keepMin) return { state: 'chase', retreat: true };
        if (n.dist <= t.keepMax) return { state: 'chase', shootPid: n.pid };
        return { state: 'chase' };
      }
      if (n.dist <= t.atkRange) return { state: 'chase', attackPid: n.pid };
      return { state: 'chase' };
    }
    // idle/游走：主动怪见人即追；被动怪被打过（aggroPid）才追
    if (n && ((t.aggressive && n.dist <= t.sight) || (mob.aggroPid != null && n.dist <= t.sight * 2))) {
      return { state: 'chase' };
    }
    return { state: 'idle' };
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.MobsDef = {
    SPAWN_X, SPAWN_Z, TYPES, ZONES, LEASH, WANDER_R, HOME_EPS,
    zoneOf, zoneOfType, mobStats, campAt, campsNear, aiStep,
  };
})(typeof self !== 'undefined' ? self : globalThis);
