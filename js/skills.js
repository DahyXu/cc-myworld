// js/skills.js — 技能定义 + 客户端技能状态管理
(function (root) {
  'use strict';

  const SKILL_TABLE = [
    { id: 'vitality',      name: '体力强化', unlockLevel: 2,  kind: 'passive', description: '最大 HP +25' },
    { id: 'swiftness',     name: '疾步',     unlockLevel: 3,  kind: 'passive', description: '移速 +15%' },
    { id: 'chargedStrike', name: '蓄力一击', unlockLevel: 4,  kind: 'active',  key: 'Q', cooldown: 15, description: '下次攻击伤害 ×2.5，CD 15s' },
    { id: 'doubleJump',    name: '二段跳',   unlockLevel: 5,  kind: 'passive', description: '空中可再跳一次' },
    { id: 'regen',         name: '自愈',     unlockLevel: 6,  kind: 'passive', description: '每 6 秒回 3 HP' },
    { id: 'sprint',        name: '冲刺',     unlockLevel: 7,  kind: 'active',  key: 'G', cooldown: 10, duration: 1.5, description: '1.5s 内移速 ×3，CD 10s' },
    { id: 'resilience',    name: '坚韧',     unlockLevel: 8,  kind: 'passive', description: '受到伤害 -10%' },
    { id: 'rapidShot',     name: '连射',     unlockLevel: 9,  kind: 'passive', description: '弓箭攻速 +30%' },
    { id: 'lifesurge',     name: '生命涌现', unlockLevel: 10, kind: 'passive', description: '最大 HP +50' },
    { id: 'shockwave',     name: '冲击波',   unlockLevel: 12, kind: 'active',  key: 'R', cooldown: 25, description: '4 格内敌人受 15 伤害，CD 25s' },
    { id: 'flight',        name: '飞行',     unlockLevel: 15, kind: 'active',  key: 'F', cooldown: 60, duration: 30, description: '飞行模式持续 30s，CD 60s' },
    { id: 'warSoul',       name: '战魂',     unlockLevel: 17, kind: 'passive', description: '攻击伤害 +20%' },
    { id: 'hunter',        name: '猎手',     unlockLevel: 19, kind: 'passive', description: '获取 XP +25%' },
    { id: 'undying',       name: '不死之身', unlockLevel: 20, kind: 'passive', description: '致命伤时保留 1 HP（60s 内一次）' },
  ];

  const cooldowns = {};   // id -> remaining seconds
  const unlocked = new Set();
  let chargedReady = false;
  let sprintTimeLeft = 0;
  let flightTimeLeft = 0;

  // 快捷键 → 技能 id 的绑定（可由玩家在技能书中修改）
  const bindings = { Q: 'chargedStrike', G: 'sprint', R: 'shockwave', F: 'flight' };

  function getSkill(id) { return SKILL_TABLE.find(s => s.id === id); }

  // 根据等级重新计算解锁集合；返回本次新解锁技能名称列表
  function update(level) {
    const prev = new Set(unlocked);
    unlocked.clear();
    for (const sk of SKILL_TABLE) {
      if (level >= sk.unlockLevel) unlocked.add(sk.id);
    }
    const newlyUnlocked = [];
    for (const id of unlocked) {
      if (!prev.has(id)) {
        const sk = getSkill(id);
        if (sk) newlyUnlocked.push(sk.name);
      }
    }
    return newlyUnlocked;
  }

  function hasSkill(id) { return unlocked.has(id); }

  // 激活主动技能；返回是否成功（未解锁或冷却中则 false）
  function activate(id) {
    if (!hasSkill(id)) return false;
    if ((cooldowns[id] || 0) > 0) return false;
    const sk = getSkill(id);
    if (!sk || sk.kind !== 'active') return false;
    cooldowns[id] = sk.cooldown;
    if (id === 'chargedStrike') chargedReady = true;
    if (id === 'sprint') sprintTimeLeft = sk.duration;
    if (id === 'flight') flightTimeLeft = sk.duration;
    return true;
  }

  // 消费蓄力一击状态（攻击时调用，消费后清除）
  function consumeCharged() {
    if (!chargedReady) return false;
    chargedReady = false;
    return true;
  }

  function getBoundSkill(key) { return bindings[key] || null; }
  function getBoundKey(id) {
    for (const [k, v] of Object.entries(bindings)) { if (v === id) return k; }
    return null;
  }
  // 将 key（Q/G/R/F）绑定到指定主动技能；返回是否成功
  function bind(key, id) {
    if (!['Q', 'G', 'R', 'F'].includes(key)) return false;
    const sk = getSkill(id);
    if (!sk || sk.kind !== 'active' || !unlocked.has(id)) return false;
    for (const k of Object.keys(bindings)) { if (bindings[k] === id) delete bindings[k]; }
    bindings[key] = id;
    return true;
  }

  function isOnCooldown(id) { return (cooldowns[id] || 0) > 0; }
  function cooldownLeft(id) { return cooldowns[id] || 0; }

  // 每帧减少冷却与持续计时
  function tick(dt) {
    for (const id of Object.keys(cooldowns)) {
      if (cooldowns[id] > 0) cooldowns[id] = Math.max(0, cooldowns[id] - dt);
      if (cooldowns[id] <= 0) delete cooldowns[id];
    }
    if (sprintTimeLeft > 0) sprintTimeLeft = Math.max(0, sprintTimeLeft - dt);
    if (flightTimeLeft > 0) flightTimeLeft = Math.max(0, flightTimeLeft - dt);
  }

  function getFlightTimeLeft() { return flightTimeLeft; }
  function forceEndFlight() { flightTimeLeft = 0; }
  function isSprintActive() { return sprintTimeLeft > 0; }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Skills = {
    SKILL_TABLE, update, hasSkill, activate, consumeCharged,
    getBoundSkill, getBoundKey, bind,
    isOnCooldown, cooldownLeft, tick,
    getFlightTimeLeft, forceEndFlight, isSprintActive,
  };
})(typeof self !== 'undefined' ? self : globalThis);
