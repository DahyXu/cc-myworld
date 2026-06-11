// tests/test_remote_edit.js — applyRemoteEdit：已生成直写，未生成走 pending
'use strict';
const assert = require('node:assert');
require('../js/noise.js');
require('../js/world.js');
const W = globalThis.MyWorld.World;

// 已生成区块：直写生效并标脏
const w = W.create(123);
w.ensureChunk(0, 0);
w.getChunk(0, 0).dirty = false;
w.applyRemoteEdit(5, 30, 5, 8);
assert.strictEqual(w.getBlock(5, 30, 5), 8, '直写生效');
assert.strictEqual(w.getChunk(0, 0).dirty, true, '直写标脏');

// 未生成区块：不触发生成，先寄存；ensureChunk 后生效（覆盖地形）
w.applyRemoteEdit(100, 10, 100, 8); // 区块 (6,6)
assert.strictEqual(w.getChunk(6, 6), null, '远端编辑不触发区块生成');
w.ensureChunk(6, 6);
assert.strictEqual(w.getBlock(100, 10, 100), 8, '生成后 pending 编辑生效');

// 挖除（id=0）同样覆盖地形
w.applyRemoteEdit(120, 1, 120, 0); // 区块 (7,7)，y=1 原本必为实心
w.ensureChunk(7, 7);
assert.strictEqual(w.getBlock(120, 1, 120), 0, '生成后 pending 挖除生效');

// 同格多次编辑：后到者赢
const w2 = W.create(321);
w2.applyRemoteEdit(100, 10, 100, 5);
w2.applyRemoteEdit(100, 10, 100, 8);
w2.ensureChunk(6, 6);
assert.strictEqual(w2.getBlock(100, 10, 100), 8, '同格后到者赢');

// y 越界忽略，不报错
w.applyRemoteEdit(5, -1, 5, 8);
w.applyRemoteEdit(5, 64, 5, 8);

console.log('test_remote_edit OK');
