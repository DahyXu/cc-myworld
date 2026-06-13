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

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Stats = { LEVEL_CAP, maxHp, swordDamage, bowDamage, xpToNext };
})(typeof self !== 'undefined' ? self : globalThis);
