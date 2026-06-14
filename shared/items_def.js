// shared/items_def.js — 两端共享：掉落表、商店价格、强化配方（纯数据+纯函数）
(function (root) {
  'use strict';

  const DROP_TABLE = {
    slime:    { sub: 'slime_gel',     qtyMin: 1, qtyMax: 2, rate: 0.8, coinMin: 1,  coinMax: 3,  coinRate: 0.4 },
    zombie:   { sub: 'zombie_rags',   qtyMin: 1, qtyMax: 2, rate: 0.8, coinMin: 2,  coinMax: 6,  coinRate: 0.4 },
    skeleton: { sub: 'skeleton_bone', qtyMin: 1, qtyMax: 3, rate: 0.8, coinMin: 3,  coinMax: 9,  coinRate: 0.4 },
    wolf:     { sub: 'wolf_fang',     qtyMin: 1, qtyMax: 2, rate: 0.8, coinMin: 5,  coinMax: 15, coinRate: 0.4 },
  };

  const WEAPON_DROP = {
    zombie:   { sub: 'sword', tier: 2, rate: 0.02 },
    skeleton: { sub: 'bow',   tier: 2, rate: 0.02 },
    wolf:     { sub: 'sword', tier: 3, rate: 0.01 },
  };

  const SHOP_BUY = [
    { sub: 'sword', tier: 1, price: 50   },
    { sub: 'bow',   tier: 1, price: 50   },
    { sub: 'sword', tier: 2, price: 500  },
    { sub: 'bow',   tier: 2, price: 500  },
    { sub: 'sword', tier: 3, price: 2000 },
    { sub: 'bow',   tier: 3, price: 2000 },
  ];

  const SHOP_SELL = { slime_gel: 5, zombie_rags: 10, skeleton_bone: 20, wolf_fang: 35 };

  const ENH_MATERIAL = { sword: 'wolf_fang', bow: 'skeleton_bone' };

  const ENH_COST = [0, 5, 10, 20];

  const ENH_RATE = [0, 1.0, 0.8, 0.5];

  const TIER_MUL = [1.0, 1.5, 2.5];

  const ENH_BONUS = [0, 0.2, 0.4, 0.6];

  function rollDrop(type, lv, rng) {
    if (!rng) rng = Math.random.bind(Math);
    const result = { items: [], coins: 0 };
    const d = DROP_TABLE[type];
    if (!d) return result;
    if (rng() < d.rate) {
      const qty = d.qtyMin + Math.floor(rng() * (d.qtyMax - d.qtyMin + 1));
      result.items.push({ type: 'material', sub: d.sub, qty });
    }
    if (rng() < d.coinRate) {
      const base = d.coinMin + Math.floor(rng() * (d.coinMax - d.coinMin + 1));
      result.coins = base + Math.floor(base * (lv - 1) * 0.1);
    }
    const wd = WEAPON_DROP[type];
    if (wd && rng() < wd.rate) {
      result.items.push({ type: 'weapon', sub: wd.sub, tier: wd.tier, enh: 0 });
    }
    return result;
  }

  function weaponMul(tier, enh) {
    const t = Math.min(Math.max(tier, 1), 3);
    const e = Math.min(Math.max(enh, 0), 3);
    return TIER_MUL[t - 1] * (1 + ENH_BONUS[e]);
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.ItemsDef = {
    DROP_TABLE, WEAPON_DROP, SHOP_BUY, SHOP_SELL,
    ENH_MATERIAL, ENH_COST, ENH_RATE, TIER_MUL, ENH_BONUS,
    rollDrop, weaponMul,
  };
})(typeof self !== 'undefined' ? self : globalThis);
