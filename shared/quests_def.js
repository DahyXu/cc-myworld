// shared/quests_def.js — 两端共享：NPC 坐标、任务链、日常生成、奖励、quest_id 编解码（纯函数）
(function (root) {
  'use strict';
  const MobsDef = root.MyWorld.MobsDef;

  // NPC「长老」固定在出生点旁（出生点 SPAWN 8.5,8.5，长老在 +z 4 格处，玩家出生即可见）
  const NPC_X = 8.5, NPC_Z = 12.5, NPC_RANGE = 3;

  // 10 环固定任务链：依次引导四个地带（史莱姆→僵尸→骷髅→恶狼）
  const CHAIN = [
    { type: 'slime', count: 5 }, { type: 'slime', count: 10 },
    { type: 'zombie', count: 5 }, { type: 'zombie', count: 10 },
    { type: 'skeleton', count: 5 }, { type: 'skeleton', count: 10 },
    { type: 'wolf', count: 5 }, { type: 'wolf', count: 8 },
    { type: 'wolf', count: 12 }, { type: 'wolf', count: 15 },
  ];

  // 奖励经验 = floor(数量 × 怪基准经验 × 1.5)；交任务是经验大头
  function questReward(type, count) {
    return Math.floor(count * MobsDef.TYPES[type].xp * 1.5);
  }

  // 等级 → 对应地带怪种（日常用）
  function typeForLevel(level) {
    if (level <= 3) return 'slime';
    if (level <= 6) return 'zombie';
    if (level <= 9) return 'skeleton';
    return 'wolf';
  }

  // 接取时应发的任务：链未走完发链任务，否则按等级发日常
  function offer(chainIndex, level) {
    if (chainIndex < CHAIN.length) {
      const c = CHAIN[chainIndex];
      return make('c', c.type, c.count);
    }
    const type = typeForLevel(level);
    const count = 8 + level; // 日常数量随等级
    return make('d', type, count);
  }

  function make(kind, type, count) {
    return { id: kind + ':' + type + ':' + count, kind, type, count, reward: questReward(type, count) };
  }

  // quest_id 解码：kind:type:count → {kind,type,count,reward}；非法返回 null
  function parse(id) {
    if (typeof id !== 'string') return null;
    const m = id.split(':');
    if (m.length !== 3) return null;
    const kind = m[0], type = m[1], count = parseInt(m[2], 10);
    if ((kind !== 'c' && kind !== 'd') || !MobsDef.TYPES[type] || !(count > 0)) return null;
    return { kind, type, count, reward: questReward(type, count) };
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.QuestsDef = { NPC_X, NPC_Z, NPC_RANGE, CHAIN, questReward, typeForLevel, offer, parse };
})(typeof self !== 'undefined' ? self : globalThis);
