// shared/bosses_def.js — Boss定义（两端共享，纯数据）
(function (root) {
  'use strict';

  const BOSSES = [
    {
      id: 'slime_king', name: '史莱姆王', type: 'slime',
      x: 120, z: 8.5, hp: 120, dmg: 3, speed: 0.7 * 4.5,
      xp: 500, coins: 100, skill: 'split',
      loot: { type: 'weapon', sub: 'sword', tier: 2, enh: 0 },
      respawnMs: 15 * 60 * 1000,
    },
    {
      id: 'zombie_lord', name: '僵尸领主', type: 'zombie',
      x: 225, z: 8.5, hp: 250, dmg: 6, speed: 0.8 * 4.5,
      xp: 800, coins: 200, skill: 'aoe',
      loot: { type: 'weapon', sub: 'bow', tier: 2, enh: 0 },
      respawnMs: 15 * 60 * 1000,
    },
    {
      id: 'skeleton_mage', name: '骷髅法师', type: 'skeleton',
      x: 400, z: 8.5, hp: 200, dmg: 9, speed: 0.8 * 4.5,
      xp: 1200, coins: 300, skill: 'summon',
      loot: { type: 'weapon', sub: 'sword', tier: 3, enh: 0 },
      respawnMs: 15 * 60 * 1000,
    },
    {
      id: 'wolf_king', name: '狼王', type: 'wolf',
      x: 650, z: 8.5, hp: 350, dmg: 15, speed: 1.3 * 4.5,
      xp: 2000, coins: 500, skill: 'dash',
      loot: { type: 'weapon', sub: 'bow', tier: 3, enh: 0 },
      respawnMs: 15 * 60 * 1000,
    },
  ];

  function bossById(id) {
    return BOSSES.find(b => b.id === id) || null;
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.BossesDef = { BOSSES, bossById };
})(typeof self !== 'undefined' ? self : globalThis);
