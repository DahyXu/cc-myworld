// tests/test_protocol.js
'use strict';
const assert = require('node:assert');
require('../shared/protocol.js');
const P = globalThis.MyWorld.Protocol;

// inInterest：区块 Chebyshev 距离 ≤ 4 互见
assert.ok(P.inInterest(0, 0, 63, 0), '3 区块可见');
assert.ok(P.inInterest(0, 0, 64, 0), '4 区块边界可见');
assert.ok(!P.inInterest(0, 0, 80, 0), '5 区块不可见');
assert.ok(P.inInterest(-1, -1, -64, -64), '负坐标：区块 -1 与 -4 距离 3');
assert.ok(!P.inInterest(8, 8, 8, 88), 'z 方向 5 区块不可见');

// validEdit(msg, px, py, pz, chunkY)
assert.ok(P.validEdit({ x: 1, y: 30, z: 1, id: 8 }, 1.5, 30, 1.5, 64), '脚边放置合法');
assert.ok(!P.validEdit({ x: 1, y: -1, z: 1, id: 8 }, 1.5, 30, 1.5, 64), 'y 下越界');
assert.ok(!P.validEdit({ x: 1, y: 64, z: 1, id: 8 }, 1.5, 30, 1.5, 64), 'y 上越界');
assert.ok(!P.validEdit({ x: 1, y: 30, z: 1, id: 9 }, 1.5, 30, 1.5, 64), '非法方块 id');
assert.ok(!P.validEdit({ x: 1, y: 30, z: 1, id: 1.5 }, 1.5, 30, 1.5, 64), '非整数 id');
assert.ok(!P.validEdit({ x: 1.2, y: 30, z: 1, id: 8 }, 1.5, 30, 1.5, 64), '非整数坐标');
assert.ok(!P.validEdit({ x: 12, y: 30, z: 1, id: 8 }, 1.5, 30.5, 1.5, 64), '距离 11 超出 6+2');
assert.ok(P.validEdit({ x: 8, y: 30, z: 1, id: 0 }, 1.5, 30.5, 1.5, 64), '距离 7 在余量内');
assert.ok(!P.validEdit(null, 0, 0, 0, 64), '空消息');

// clampMove(prev, msg, dtMs)：超速回弹原位
let r = P.clampMove({ x: 0, y: 30, z: 0 }, { x: 0.45, y: 30, z: 0 }, 100);
assert.ok(r.ok && r.x === 0.45, '正常行走通过');
r = P.clampMove({ x: 0, y: 30, z: 0 }, { x: 5, y: 30, z: 0 }, 100);
assert.ok(!r.ok && r.x === 0 && r.y === 30, '水平瞬移拒绝并回原位');
r = P.clampMove({ x: 0, y: 30, z: 0 }, { x: 0, y: 26, z: 0 }, 100);
assert.ok(r.ok, '40m/s 坠落放行');
r = P.clampMove({ x: 0, y: 30, z: 0 }, { x: NaN, y: 30, z: 0 }, 100);
assert.ok(!r.ok, 'NaN 拒绝');
r = P.clampMove({ x: 0, y: 30, z: 0 }, { x: 0.2, y: 30, z: 0 }, 5);
assert.ok(r.ok, 'dt 下限 30ms：0.2 ≤ 9×0.03');

// sanitizeName
assert.strictEqual(P.sanitizeName('  小明  ', '甲'), '小明');
assert.strictEqual(P.sanitizeName('', '甲'), '甲');
assert.strictEqual(P.sanitizeName(null, '甲'), '甲');
assert.strictEqual(P.sanitizeName('a' + String.fromCharCode(0) + 'b' + String.fromCharCode(31) + 'c', '甲'), 'abc', '剥离控制字符');
assert.strictEqual(P.sanitizeName('张 三', '甲'), '张 三', '内部空格保留');
assert.strictEqual(P.sanitizeName('一二三四五六七八九十拾壹拾贰', '甲').length, 12, '裁到 12 字');

// backoffMs
assert.strictEqual(P.backoffMs(0), 1000);
assert.strictEqual(P.backoffMs(1), 2000);
assert.strictEqual(P.backoffMs(10), 15000, '封顶 15 秒');

console.log('test_protocol OK');
