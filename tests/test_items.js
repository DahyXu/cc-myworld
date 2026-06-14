'use strict';
const assert = require('node:assert');
require('../shared/items_def.js');
const I = globalThis.MyWorld.ItemsDef;

// Structure checks
assert.ok(I.DROP_TABLE.slime && I.DROP_TABLE.wolf);
assert.strictEqual(I.SHOP_BUY.length, 6);
assert.strictEqual(I.SHOP_SELL.wolf_fang, 35);
assert.strictEqual(I.ENH_MATERIAL.sword, 'wolf_fang');
assert.deepStrictEqual(I.ENH_COST, [0, 5, 10, 20]);

// rollDrop: deterministic rng = always 0 (all thresholds pass)
const alwaysZero = () => 0;
const drop = I.rollDrop('wolf', 1, alwaysZero);
assert.strictEqual(drop.items[0].type, 'material');
assert.strictEqual(drop.items[0].sub, 'wolf_fang');
assert.strictEqual(drop.items[0].qty, 1); // qtyMin + Math.floor(0*(2-1+1)) = 1
assert.ok(drop.coins >= 5);

// rollDrop: rng=1 means nothing hits (all rates < 1.0)
const alwaysOne = () => 1.0;
const miss = I.rollDrop('slime', 1, alwaysOne);
assert.strictEqual(miss.items.length, 0);
assert.strictEqual(miss.coins, 0);

// weaponMul
assert.strictEqual(I.weaponMul(1, 0), 1.0);
assert.strictEqual(I.weaponMul(2, 0), 1.5);
assert.strictEqual(I.weaponMul(3, 3), 2.5 * 1.6);
assert.strictEqual(I.weaponMul(1, 1), 1.0 * 1.2);

console.log('test_items OK');
