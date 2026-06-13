// shared/stats.js — 两端共享：属性成长、伤害公式、经验曲线（初版数值集中在此调整）
(function (root) {
  'use strict';

  const LEVEL_CAP = 20;

  // HP 上限 / 剑伤害 / 弓伤害：随等级线性成长
  function maxHp(level) { return 20 + 5 * (level - 1); }
  function swordDamage(level) { return 3 + 1 * (level - 1); }
  function bowDamage(level) { return Math.floor(2 + 0.8 * (level - 1)); }

  // 升到下一级所需经验；到顶返回 Infinity（M3 升级结算用）
  function xpToNext(level) {
    if (level >= LEVEL_CAP) return Infinity;
    return Math.floor(25 * Math.pow(level, 1.5));
  }

  // 施加经验增益：xp 是当前等级内进度。逐级结算（可连升），满级吞没多余经验
  // 返回 { level, xp, leveled }；leveled=true 表示本次至少升了一级
  function applyXp(level, xp, gain) {
    xp += gain;
    let leveled = false;
    while (level < LEVEL_CAP && xp >= xpToNext(level)) {
      xp -= xpToNext(level);
      level++;
      leveled = true;
    }
    if (level >= LEVEL_CAP) xp = 0; // 满级不再积累进度
    return { level, xp, leveled };
  }

  // 死亡惩罚：扣当前等级进度的 10%（向下取整的损失，不降级）
  function xpAfterDeath(xp) {
    return xp - Math.floor(xp * 0.1);
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Stats = { LEVEL_CAP, maxHp, swordDamage, bowDamage, xpToNext, applyXp, xpAfterDeath };
})(typeof self !== 'undefined' ? self : globalThis);
