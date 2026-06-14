// shared/quests_def.js — 两端共享：NPC坐标、主线/日常任务、奖励、quest_id编解码（纯函数）
(function (root) {
  'use strict';
  const MobsDef = root.MyWorld.MobsDef;

  const NPC_X = 8.5, NPC_Z = 12.5, NPC_RANGE = 3;

  // 1~10级主线任务（替换旧CHAIN）
  // kind: kill/collect/boss/explore
  // type: mob类型 | 材料sub | boss id | 'dist'
  const MAIN_QUESTS = [
    { lvReq: 1,  kind: 'kill',    type: 'slime',         count: 5,   xpReward: 90,   coins: 30,  item: null },
    { lvReq: 2,  kind: 'collect', type: 'slime_gel',     count: 5,   xpReward: 120,  coins: 50,  item: null },
    { lvReq: 3,  kind: 'boss',    type: 'slime_king',    count: 1,   xpReward: 500,  coins: 100, item: { type: 'weapon', sub: 'sword', tier: 2, enh: 0 } },
    { lvReq: 4,  kind: 'explore', type: 'dist',          count: 150, xpReward: 150,  coins: 80,  item: null },
    { lvReq: 5,  kind: 'kill',    type: 'zombie',        count: 10,  xpReward: 225,  coins: 100, item: null },
    { lvReq: 6,  kind: 'boss',    type: 'zombie_lord',   count: 1,   xpReward: 800,  coins: 200, item: { type: 'weapon', sub: 'bow',   tier: 2, enh: 0 } },
    { lvReq: 7,  kind: 'collect', type: 'skeleton_bone', count: 8,   xpReward: 375,  coins: 150, item: null },
    { lvReq: 8,  kind: 'kill',    type: 'skeleton',      count: 10,  xpReward: 500,  coins: 180, item: null },
    { lvReq: 9,  kind: 'boss',    type: 'skeleton_mage', count: 1,   xpReward: 1200, coins: 300, item: { type: 'weapon', sub: 'sword', tier: 3, enh: 0 } },
    { lvReq: 10, kind: 'boss',    type: 'wolf_king',     count: 1,   xpReward: 2000, coins: 500, item: { type: 'weapon', sub: 'bow',   tier: 3, enh: 0 } },
  ];

  function questReward(type, count) {
    return Math.floor(count * MobsDef.TYPES[type].xp * 1.5);
  }

  function typeForLevel(level) {
    if (level <= 3) return 'slime';
    if (level <= 6) return 'zombie';
    if (level <= 9) return 'skeleton';
    return 'wolf';
  }

  // 返回第 mainIndex 条主线；mainIndex>=10 后发日常；等级不足返回 null
  function offer(mainIndex, level) {
    if (mainIndex < MAIN_QUESTS.length) {
      const mq = MAIN_QUESTS[mainIndex];
      if (level < mq.lvReq) return null;
      return { id: 'm:' + mq.type + ':' + mq.count, kind: 'm', questKind: mq.kind,
               type: mq.type, count: mq.count, xpReward: mq.xpReward, coins: mq.coins, item: mq.item };
    }
    const type = typeForLevel(level);
    const count = 8 + level;
    const reward = questReward(type, count);
    return { id: 'd:' + type + ':' + count, kind: 'd', questKind: 'kill',
             type, count, reward, xpReward: reward, coins: 0, item: null };
  }

  // 第 mainIndex 条主线定义（0-9；越界返回null）
  function mainQuestAt(mainIndex) {
    return mainIndex >= 0 && mainIndex < MAIN_QUESTS.length ? MAIN_QUESTS[mainIndex] : null;
  }

  // quest_id解码；支持 m:type:count / d:type:count；非法返回null
  function parse(id) {
    if (typeof id !== 'string') return null;
    const parts = id.split(':');
    if (parts.length !== 3) return null;
    const kind = parts[0], type = parts[1], count = parseInt(parts[2], 10);
    if (!(count > 0)) return null;

    if (kind === 'm') {
      const mq = MAIN_QUESTS.find(q => q.type === type && q.count === count);
      if (!mq) return null;
      return { kind: 'm', questKind: mq.kind, type, count,
               xpReward: mq.xpReward, coins: mq.coins, item: mq.item };
    }
    if (kind === 'd') {
      if (!MobsDef.TYPES[type]) return null;
      const reward = questReward(type, count);
      return { kind: 'd', questKind: 'kill', type, count, reward, xpReward: reward, coins: 0, item: null };
    }
    return null; // 'c' (旧链任务) 视为非法：登录时服务器会清除
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.QuestsDef = { NPC_X, NPC_Z, NPC_RANGE, MAIN_QUESTS, questReward, typeForLevel, offer, mainQuestAt, parse };
})(typeof self !== 'undefined' ? self : globalThis);
