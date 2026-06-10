# 网页版「我的世界」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建双击 index.html 即可游玩的浏览器版 Minecraft 风格体素游戏（无限世界、挖放方块、8 种方块、快捷栏）。

**Architecture:** Three.js (UMD, 本地 lib/three.min.js) 负责渲染；自研体素引擎分为 8 个 JS 模块，通过 `window.MyWorld` 命名空间通信，script 标签顺序加载。纯逻辑模块（噪声/世界/网格/物理/射线）写成浏览器+Node 双兼容的 IIFE，用零依赖 Node 脚本做自动化测试；渲染与 UI 在浏览器中人工+工具验证。

**Tech Stack:** Three.js r128 (已下载至 lib/three.min.js)、原生 JS (无构建工具)、Node v24 (仅用于跑测试，游戏本身不依赖)。

**模块兼容模式（所有 js/ 文件统一采用）：**

```js
(function (root) {
  'use strict';
  // ...模块代码...
  root.MyWorld = root.MyWorld || {};
  root.MyWorld.模块名 = 模块对象;
})(typeof self !== 'undefined' ? self : globalThis);
```

Node 测试里 `require('../js/xxx.js')` 后从 `globalThis.MyWorld.*` 取用；浏览器里挂在 `window.MyWorld.*`。

**测试约定：** 测试文件放 `tests/`，零依赖（只用 `node:assert`），断言失败即非零退出码。统一跑法：`node tests/run_all.js`（依次 require 所有 test_*.js）。

---

### Task 1: 柏林噪声模块 noise.js

**Files:**
- Create: `js/noise.js`
- Test: `tests/test_noise.js`

- [ ] **Step 1.1: 写失败测试**

```js
// tests/test_noise.js
'use strict';
const assert = require('node:assert');
require('../js/noise.js');
const Noise = globalThis.MyWorld.Noise;

// 同种子确定性
const a = Noise.create(12345), b = Noise.create(12345);
for (let i = 0; i < 50; i++) {
  const x = i * 1.37, y = i * 0.71;
  assert.strictEqual(a.perlin2(x, y), b.perlin2(x, y), 'same seed must be deterministic');
}
// 不同种子产生不同序列
const c = Noise.create(99999);
let diff = false;
for (let i = 0; i < 50; i++) if (a.perlin2(i * 1.37, i * 0.71) !== c.perlin2(i * 1.37, i * 0.71)) { diff = true; break; }
assert.ok(diff, 'different seeds must differ');
// 值域大致在 [-1,1]
for (let i = 0; i < 500; i++) {
  const v = a.perlin2(i * 0.913, i * 1.531);
  assert.ok(v >= -1.001 && v <= 1.001, 'perlin2 out of range: ' + v);
}
// 非整点应有非零值（整点恰好为 0 是柏林噪声特性）
assert.notStrictEqual(a.perlin2(0.5, 0.5), 0);
// fbm2 值域与确定性
for (let i = 0; i < 200; i++) {
  const v = a.fbm2(i * 0.37, i * 0.61, 4, 2, 0.5);
  assert.ok(v >= -1.001 && v <= 1.001, 'fbm2 out of range: ' + v);
}
assert.strictEqual(a.fbm2(3.3, 4.4, 4, 2, 0.5), b.fbm2(3.3, 4.4, 4, 2, 0.5));
console.log('test_noise OK');
```

- [ ] **Step 1.2: 运行确认失败**

Run: `node tests/test_noise.js`
Expected: FAIL（Cannot find module '../js/noise.js'）

- [ ] **Step 1.3: 实现 noise.js**

```js
// js/noise.js — 种子化柏林噪声 + fBm
(function (root) {
  'use strict';

  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const GRAD = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function create(seed) {
    const rand = mulberry32(seed);
    const perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

    function grad(hash, x, y) {
      const g = GRAD[hash & 7];
      return g[0] * x + g[1] * y;
    }

    function perlin2(x, y) {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
      const xf = x - Math.floor(x), yf = y - Math.floor(y);
      const u = fade(xf), v = fade(yf);
      const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
      const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
      // 振幅归一化：二维柏林理论极值 ±sqrt(2)/2
      return lerp(
        lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
        lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
        v
      ) * 1.41421356;
    }

    function fbm2(x, y, octaves, lacunarity, gain) {
      let sum = 0, amp = 1, freq = 1, norm = 0;
      for (let i = 0; i < octaves; i++) {
        sum += amp * perlin2(x * freq, y * freq);
        norm += amp;
        amp *= gain; freq *= lacunarity;
      }
      return sum / norm;
    }

    return { perlin2, fbm2 };
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Noise = { create };
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 1.4: 运行确认通过**

Run: `node tests/test_noise.js`
Expected: `test_noise OK`

注意：若值域断言失败（柏林噪声乘 1.41421356 后偶超 ±1），把测试阈值放宽到 ±1.05 或将系数改为 1.2 —— 以实测为准，保证确定性断言不动摇。

- [ ] **Step 1.5: 提交**

```bash
git add js/noise.js tests/test_noise.js
git commit -m "feat: 种子化柏林噪声模块"
```

---

### Task 2: 方块注册表 blocks.js

**Files:**
- Create: `js/blocks.js`
- Test: `tests/test_blocks.js`

贴图图集布局：4×4 格、每格 16px（canvas 共 64×64px）。瓦片索引：0=草顶 1=草侧 2=泥土 3=石头 4=原木侧 5=原木顶 6=木板 7=树叶 8=沙子 9=砖块。

- [ ] **Step 2.1: 写失败测试（仅测 Node 可测的注册表部分）**

```js
// tests/test_blocks.js
'use strict';
const assert = require('node:assert');
require('../js/blocks.js');
const Blocks = globalThis.MyWorld.Blocks;

assert.strictEqual(Blocks.AIR, 0);
const ids = [1,2,3,4,5,6,7,8];
for (const id of ids) {
  const b = Blocks.BLOCKS[id];
  assert.ok(b, 'block ' + id + ' missing');
  assert.ok(typeof b.name === 'string' && b.name.length > 0);
  assert.strictEqual(b.solid, true);
  for (const k of ['top','side','bottom']) {
    assert.ok(Number.isInteger(b.tex[k]) && b.tex[k] >= 0 && b.tex[k] < 16, 'tex index in atlas');
  }
}
// 草方块三面贴图不同
const grass = Blocks.BLOCKS[1];
assert.notStrictEqual(grass.tex.top, grass.tex.side);
assert.notStrictEqual(grass.tex.side, grass.tex.bottom);
// isSolid 辅助
assert.strictEqual(Blocks.isSolid(0), false);
assert.strictEqual(Blocks.isSolid(3), true);
assert.strictEqual(Blocks.isSolid(255), false); // 未注册 id 不算实心
// 快捷栏顺序
assert.deepStrictEqual(Blocks.HOTBAR, [1,2,3,4,5,6,7,8]);
console.log('test_blocks OK');
```

- [ ] **Step 2.2: 运行确认失败**

Run: `node tests/test_blocks.js`
Expected: FAIL（Cannot find module '../js/blocks.js'）

- [ ] **Step 2.3: 实现 blocks.js（注册表 + 浏览器端图集绘制）**

```js
// js/blocks.js — 方块注册表 + 程序化像素贴图图集
(function (root) {
  'use strict';

  const AIR = 0;
  // 瓦片索引: 0草顶 1草侧 2泥土 3石头 4原木侧 5原木顶 6木板 7树叶 8沙子 9砖块
  const BLOCKS = {
    1: { name: '草方块', solid: true, tex: { top: 0, side: 1, bottom: 2 } },
    2: { name: '泥土',   solid: true, tex: { top: 2, side: 2, bottom: 2 } },
    3: { name: '石头',   solid: true, tex: { top: 3, side: 3, bottom: 3 } },
    4: { name: '原木',   solid: true, tex: { top: 5, side: 4, bottom: 5 } },
    5: { name: '木板',   solid: true, tex: { top: 6, side: 6, bottom: 6 } },
    6: { name: '树叶',   solid: true, tex: { top: 7, side: 7, bottom: 7 } },
    7: { name: '沙子',   solid: true, tex: { top: 8, side: 8, bottom: 8 } },
    8: { name: '砖块',   solid: true, tex: { top: 9, side: 9, bottom: 9 } },
  };
  const HOTBAR = [1, 2, 3, 4, 5, 6, 7, 8];

  function isSolid(id) { return !!(BLOCKS[id] && BLOCKS[id].solid); }

  const ATLAS_TILES = 4;   // 4×4 瓦片
  const TILE_PX = 16;

  // 简单确定性伪随机（贴图噪点用，与世界种子无关）
  function texRand(seed) {
    let s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // 在 ctx 的 (ox,oy) 处画一个 16×16 瓦片：底色 + 噪点斑驳
  function speckle(ctx, ox, oy, base, spots, rnd, density) {
    ctx.fillStyle = base;
    ctx.fillRect(ox, oy, TILE_PX, TILE_PX);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        if (rnd() < density) {
          ctx.fillStyle = spots[Math.floor(rnd() * spots.length)];
          ctx.fillRect(ox + x, oy + y, 1, 1);
        }
      }
    }
  }

  // 仅浏览器调用：绘制图集 canvas
  function buildAtlas() {
    const size = ATLAS_TILES * TILE_PX;
    const canvas = root.document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const rnd = texRand(424242);
    const T = TILE_PX;
    const at = (i) => [(i % ATLAS_TILES) * T, Math.floor(i / ATLAS_TILES) * T];

    let [ox, oy] = at(0); // 0 草顶
    speckle(ctx, ox, oy, '#5fa841', ['#4e9434', '#6db64c', '#549c3a'], rnd, 0.45);
    [ox, oy] = at(1); // 1 草侧：泥土 + 顶部草边
    speckle(ctx, ox, oy, '#8a6244', ['#7a543a', '#9a7050', '#6e4a32'], rnd, 0.4);
    ctx.fillStyle = '#5fa841'; ctx.fillRect(ox, oy, T, 3);
    for (let x = 0; x < T; x++) if (rnd() < 0.6) { ctx.fillRect(ox + x, oy + 3, 1, 1); }
    [ox, oy] = at(2); // 2 泥土
    speckle(ctx, ox, oy, '#8a6244', ['#7a543a', '#9a7050', '#6e4a32'], rnd, 0.4);
    [ox, oy] = at(3); // 3 石头
    speckle(ctx, ox, oy, '#8e8e8e', ['#7c7c7c', '#9c9c9c', '#868686'], rnd, 0.4);
    [ox, oy] = at(4); // 4 原木侧：竖条树皮
    for (let x = 0; x < T; x++) {
      const shade = ['#6b4a2a', '#5d3f23', '#7a5631'][x % 3];
      ctx.fillStyle = shade; ctx.fillRect(ox + x, oy, 1, T);
      for (let y = 0; y < T; y++) if (rnd() < 0.12) { ctx.fillStyle = '#523619'; ctx.fillRect(ox + x, oy + y, 1, 1); }
    }
    [ox, oy] = at(5); // 5 原木顶：年轮
    ctx.fillStyle = '#6b4a2a'; ctx.fillRect(ox, oy, T, T);
    ctx.fillStyle = '#c8a06a'; ctx.fillRect(ox + 2, oy + 2, T - 4, T - 4);
    ctx.fillStyle = '#a8825a'; ctx.fillRect(ox + 4, oy + 4, T - 8, T - 8);
    ctx.fillStyle = '#c8a06a'; ctx.fillRect(ox + 6, oy + 6, T - 12, T - 12);
    [ox, oy] = at(6); // 6 木板：横板 + 接缝
    ctx.fillStyle = '#b08850'; ctx.fillRect(ox, oy, T, T);
    ctx.fillStyle = '#8f6b3c';
    for (let y = 3; y < T; y += 4) ctx.fillRect(ox, oy + y, T, 1);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (rnd() < 0.08) { ctx.fillStyle = '#9c7844'; ctx.fillRect(ox + x, oy + y, 1, 1); }
    [ox, oy] = at(7); // 7 树叶
    speckle(ctx, ox, oy, '#3a7a2a', ['#2e6620', '#468c34', '#255a1a'], rnd, 0.55);
    [ox, oy] = at(8); // 8 沙子
    speckle(ctx, ox, oy, '#dccfa0', ['#cfc290', '#e8dcb0', '#c4b684'], rnd, 0.4);
    [ox, oy] = at(9); // 9 砖块：红砖 + 灰浆错缝
    ctx.fillStyle = '#9c5a4a'; ctx.fillRect(ox, oy, T, T);
    ctx.fillStyle = '#c9c2b8';
    for (let y = 0; y < T; y += 4) ctx.fillRect(ox, oy + y, T, 1);
    for (let row = 0; row < 4; row++) {
      const off = (row % 2) * 4;
      for (let x = off; x < T; x += 8) ctx.fillRect(ox + x, oy + row * 4, 1, 4);
    }
    return canvas;
  }

  // 瓦片 i 的 UV 范围（THREE 的 v 轴向上，canvas 的 y 轴向下，需翻转）
  function tileUV(i) {
    const col = i % ATLAS_TILES, row = Math.floor(i / ATLAS_TILES);
    const s = 1 / ATLAS_TILES;
    return { u0: col * s, v0: 1 - (row + 1) * s, u1: (col + 1) * s, v1: 1 - row * s };
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Blocks = { AIR, BLOCKS, HOTBAR, isSolid, buildAtlas, tileUV, ATLAS_TILES, TILE_PX };
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 2.4: 运行确认通过**

Run: `node tests/test_blocks.js`
Expected: `test_blocks OK`

- [ ] **Step 2.5: 提交**

```bash
git add js/blocks.js tests/test_blocks.js
git commit -m "feat: 方块注册表与程序化贴图图集"
```

### Task 3: 世界与地形生成 world.js

**Files:**
- Create: `js/world.js`
- Test: `tests/test_world.js`

核心设计：区块 16×64×16，数据 `Uint8Array`，索引 `x + z*16 + y*256`。树叶可跨区块——目标区块已存在则直写并标 dirty，不存在则进 pending 队列、该区块生成完地形后套用。**顺序无关性**是关键正确性属性（先生成 A 再 B，与先 B 再 A，最终方块完全一致），由测试锁定。

- [ ] **Step 3.1: 写失败测试**

```js
// tests/test_world.js
'use strict';
const assert = require('node:assert');
require('../js/noise.js');
require('../js/blocks.js');
require('../js/world.js');
const W = globalThis.MyWorld.World;

assert.strictEqual(W.CHUNK_X, 16);
assert.strictEqual(W.CHUNK_Y, 64);
assert.strictEqual(W.CHUNK_Z, 16);

// 同种子确定性
const w1 = W.create(1337), w2 = W.create(1337);
w1.ensureChunk(0, 0); w2.ensureChunk(0, 0);
assert.ok(Buffer.from(w1.getChunk(0,0).data).equals(Buffer.from(w2.getChunk(0,0).data)), 'same seed same chunk');

// 不同种子不同
const w3 = W.create(42);
w3.ensureChunk(0, 0);
assert.ok(!Buffer.from(w1.getChunk(0,0).data).equals(Buffer.from(w3.getChunk(0,0).data)), 'diff seed diff chunk');

// 地表结构：顶面是草(1)或沙(7)，其上是空气，往下泥土/沙，深处石头
for (const [x, z] of [[3,3],[8,12],[15,0],[0,15]]) {
  const h = w1.terrainHeight(x, z);
  assert.ok(h >= 2 && h <= 54, 'height in range: ' + h);
  const top = w1.getBlock(x, h, z);
  assert.ok(top === 1 || top === 7, 'surface grass or sand, got ' + top);
  // 地表正上方要么空气要么树（原木4/树叶6）
  const above = w1.getBlock(x, h + 1, z);
  assert.ok(above === 0 || above === 4 || above === 6, 'above surface: ' + above);
  const mid = w1.getBlock(x, h - 2, z);
  assert.ok(mid === 2 || mid === 7, 'subsurface dirt or sand, got ' + mid);
  assert.strictEqual(w1.getBlock(x, Math.max(0, h - 6), z), 3, 'deep stone');
}

// 未生成区块读到空气；y 越界读到空气
assert.strictEqual(w1.getBlock(500, 30, 500), 0);
assert.strictEqual(w1.getBlock(3, -1, 3), 0);
assert.strictEqual(w1.getBlock(3, 64, 3), 0);

// setBlock / getBlock 往返 + dirty 标记
const w4 = W.create(7);
w4.ensureChunk(0, 0);
w4.getChunk(0, 0).dirty = false;
w4.setBlock(5, 30, 5, 8);
assert.strictEqual(w4.getBlock(5, 30, 5), 8);
assert.strictEqual(w4.getChunk(0, 0).dirty, true);
// 边界放置要把相邻区块也标 dirty（已存在时）
w4.ensureChunk(-1, 0);
w4.getChunk(-1, 0).dirty = false;
w4.getChunk(0, 0).dirty = false;
w4.setBlock(0, 30, 5, 8); // x=0 是区块 (0,0) 的西边界
assert.strictEqual(w4.getChunk(-1, 0).dirty, true, 'neighbor dirty on border edit');

// 生成顺序无关性（pending 机制正确性的核心断言）
const wa = W.create(777), wb = W.create(777);
wa.ensureChunk(0, 0); wa.ensureChunk(1, 0); wa.ensureChunk(0, 1);
wb.ensureChunk(0, 1); wb.ensureChunk(1, 0); wb.ensureChunk(0, 0);
for (const k of ['0,0', '1,0', '0,1']) {
  assert.ok(Buffer.from(wa.chunks.get(k).data).equals(Buffer.from(wb.chunks.get(k).data)), 'order independent: ' + k);
}

// 至少能找到树（多扫几个区块，找原木 id=4）
const wt = W.create(2024);
let foundLog = false;
for (let cx = 0; cx < 4 && !foundLog; cx++) for (let cz = 0; cz < 4 && !foundLog; cz++) {
  wt.ensureChunk(cx, cz);
  const d = wt.getChunk(cx, cz).data;
  for (let i = 0; i < d.length; i++) if (d[i] === 4) { foundLog = true; break; }
}
assert.ok(foundLog, 'trees exist in 4x4 chunks');
console.log('test_world OK');
```

- [ ] **Step 3.2: 运行确认失败**

Run: `node tests/test_world.js`
Expected: FAIL（Cannot find module '../js/world.js'）

- [ ] **Step 3.3: 实现 world.js**

```js
// js/world.js — 区块存储 + 无限地形生成
(function (root) {
  'use strict';
  const Noise = root.MyWorld.Noise;

  const CHUNK_X = 16, CHUNK_Y = 64, CHUNK_Z = 16;
  const SAND_LEVEL = 22;       // 地表低于等于此高度 → 沙地
  const TREE_THRESHOLD = 0.97; // 成树的哈希门槛（配合 5×5 局部最大值保证间距）

  function idx(x, y, z) { return x + z * CHUNK_X + y * CHUNK_X * CHUNK_Z; }
  function key(cx, cz) { return cx + ',' + cz; }

  // 与生成顺序无关的列哈希（决定树的位置与形态）
  function hash2(seed, x, z) {
    let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function create(seed) {
    const noise = Noise.create(seed);
    const chunks = new Map();
    const pending = new Map(); // key -> [{lx,ly,lz,id,onlyAir}]

    function terrainHeight(x, z) {
      const big = noise.fbm2(x * 0.012, z * 0.012, 4, 2, 0.5);
      const detail = noise.fbm2(x * 0.06 + 100, z * 0.06 + 100, 2, 2, 0.5);
      let h = Math.floor(26 + big * 18 + detail * 4);
      if (h < 2) h = 2;
      if (h > CHUNK_Y - 10) h = CHUNK_Y - 10;
      return h;
    }

    function getChunk(cx, cz) { return chunks.get(key(cx, cz)) || null; }

    function getBlock(x, y, z) {
      if (y < 0 || y >= CHUNK_Y) return 0;
      const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
      const c = chunks.get(key(cx, cz));
      if (!c) return 0;
      return c.data[idx(x - cx * CHUNK_X, y, z - cz * CHUNK_Z)];
    }

    // 玩家编辑：保证区块存在、写入、标脏（含边界相邻区块）
    function setBlock(x, y, z, id) {
      if (y < 0 || y >= CHUNK_Y) return;
      const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
      const c = ensureChunk(cx, cz);
      const lx = x - cx * CHUNK_X, lz = z - cz * CHUNK_Z;
      c.data[idx(lx, y, lz)] = id;
      c.dirty = true;
      markNeighborDirty(cx, cz, lx, lz);
    }

    function markNeighborDirty(cx, cz, lx, lz) {
      const touch = (ncx, ncz) => { const n = getChunk(ncx, ncz); if (n) n.dirty = true; };
      if (lx === 0) touch(cx - 1, cz);
      if (lx === CHUNK_X - 1) touch(cx + 1, cz);
      if (lz === 0) touch(cx, cz - 1);
      if (lz === CHUNK_Z - 1) touch(cx, cz + 1);
    }

    // 地形生成期写入：本区块直写；他区块已存在→直写+标脏；不存在→pending
    function genWrite(curChunk, curCx, curCz, x, y, z, id, onlyAir) {
      if (y < 0 || y >= CHUNK_Y) return;
      const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
      const lx = x - cx * CHUNK_X, lz = z - cz * CHUNK_Z;
      if (cx === curCx && cz === curCz) {
        const i = idx(lx, y, lz);
        if (!onlyAir || curChunk.data[i] === 0) curChunk.data[i] = id;
        return;
      }
      const other = getChunk(cx, cz);
      if (other) {
        const i = idx(lx, y, lz);
        if (!onlyAir || other.data[i] === 0) { other.data[i] = id; other.dirty = true; }
      } else {
        const k = key(cx, cz);
        if (!pending.has(k)) pending.set(k, []);
        pending.get(k).push({ lx, ly: y, lz, id, onlyAir });
      }
    }

    // 该列是否成树：哈希超门槛且为 5×5 邻域严格最大值（保证树间距 ≥2）
    function hasTree(x, z) {
      const r = hash2(seed, x, z);
      if (r < TREE_THRESHOLD) return false;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        if (dx === 0 && dz === 0) continue;
        if (hash2(seed, x + dx, z + dz) >= r) return false;
      }
      return true;
    }

    function ensureChunk(cx, cz) {
      const k = key(cx, cz);
      let c = chunks.get(k);
      if (c) return c;
      c = { cx, cz, data: new Uint8Array(CHUNK_X * CHUNK_Y * CHUNK_Z), dirty: true };
      chunks.set(k, c);

      // 1) 地形柱
      for (let lz = 0; lz < CHUNK_Z; lz++) {
        for (let lx = 0; lx < CHUNK_X; lx++) {
          const wx = cx * CHUNK_X + lx, wz = cz * CHUNK_Z + lz;
          const h = terrainHeight(wx, wz);
          const sandy = h <= SAND_LEVEL;
          for (let y = 0; y <= h; y++) {
            let id;
            if (y === h) id = sandy ? 7 : 1;
            else if (y >= h - 3) id = sandy ? 7 : 2;
            else id = 3;
            c.data[idx(lx, y, lz)] = id;
          }
        }
      }

      // 2) 树（树干一定在本列所属区块内；树叶可跨界走 genWrite）
      for (let lz = 0; lz < CHUNK_Z; lz++) {
        for (let lx = 0; lx < CHUNK_X; lx++) {
          const wx = cx * CHUNK_X + lx, wz = cz * CHUNK_Z + lz;
          const h = terrainHeight(wx, wz);
          if (h <= SAND_LEVEL) continue;          // 沙地不长树
          if (!hasTree(wx, wz)) continue;
          const r2 = hash2(seed, wx + 7919, wz + 104729);
          const th = 4 + Math.floor(r2 * 3);       // 树干高 4~6
          const topY = h + th;
          if (topY + 2 >= CHUNK_Y) continue;       // 太高放不下就不长
          for (let y = h + 1; y <= topY; y++) genWrite(c, cx, cz, wx, y, wz, 4, false);
          // 树叶：下两层 5×5（最上一层去四角）、再上一层 3×3、顶上十字
          for (let dy = -1; dy <= 0; dy++) {
            for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
              if (dx === 0 && dz === 0 && dy <= 0) continue; // 树干位置
              if (dy === 0 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue; // 去角
              genWrite(c, cx, cz, wx + dx, topY + dy, wz + dz, 6, true);
            }
          }
          for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
            if (!(dx === 0 && dz === 0)) genWrite(c, cx, cz, wx + dx, topY + 1, wz + dz, 6, true);
          }
          genWrite(c, cx, cz, wx, topY + 1, wz, 6, true);
          genWrite(c, cx, cz, wx + 1, topY + 2, wz, 6, true);
          genWrite(c, cx, cz, wx - 1, topY + 2, wz, 6, true);
          genWrite(c, cx, cz, wx, topY + 2, wz + 1, 6, true);
          genWrite(c, cx, cz, wx, topY + 2, wz - 1, 6, true);
          genWrite(c, cx, cz, wx, topY + 2, wz, 6, true);
        }
      }

      // 3) 套用其他区块生成时寄存到本区块的 pending 写入
      const pend = pending.get(k);
      if (pend) {
        for (const p of pend) {
          const i = idx(p.lx, p.ly, p.lz);
          if (!p.onlyAir || c.data[i] === 0) c.data[i] = p.id;
        }
        pending.delete(k);
      }

      // 4) 新区块出现，已存在的四邻需要重构网格（边界面剔除会变化）
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const n = getChunk(cx + dx, cz + dz);
        if (n) n.dirty = true;
      }
      return c;
    }

    return { seed, chunks, getChunk, ensureChunk, getBlock, setBlock, terrainHeight, key };
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.World = { create, CHUNK_X, CHUNK_Y, CHUNK_Z };
})(typeof self !== 'undefined' ? self : globalThis);
```

实现注意：`hasTree` 内 `dy <= 0` 那行的条件其实恒真（dy 只取 -1/0），意图是「树干贯穿的两层中心不放叶」——保持原样即可。树干列 `dx===0&&dz===0` 在两层 5×5 中都跳过（那里是原木）。

- [ ] **Step 3.4: 运行确认通过**

Run: `node tests/test_world.js`
Expected: `test_world OK`

若「顺序无关性」断言失败，排查方向：树叶直写他区块时是否漏了 onlyAir 判断；pending 套用是否在地形与本区块树之后；树干是否意外跨区块（不应发生——树干列属于本区块）。

- [ ] **Step 3.5: 提交**

```bash
git add js/world.js tests/test_world.js
git commit -m "feat: 区块世界与无限地形生成（含跨区块树木）"
```

### Task 4: 区块网格构建 mesher.js

**Files:**
- Create: `js/mesher.js`
- Test: `tests/test_mesher.js`

输出纯数组（不依赖 THREE），main.js 再包装成 BufferGeometry——这样 Node 可测。面剔除：仅当相邻格非实心才出面。顶点色 = 面方向明暗 × AO 系数。顶点坐标直接用世界坐标（mesh 放原点即可）。

- [ ] **Step 4.1: 写失败测试**

```js
// tests/test_mesher.js
'use strict';
const assert = require('node:assert');
require('../js/noise.js');
require('../js/blocks.js');
require('../js/world.js');
require('../js/mesher.js');
const Mesher = globalThis.MyWorld.Mesher;

// 模拟世界：仅 (0,0,0) 一个草方块
function singleBlockWorld() {
  return { getBlock: (x, y, z) => (x === 0 && y === 0 && z === 0 ? 1 : 0) };
}

const g1 = Mesher.buildChunkGeometryData(singleBlockWorld(), 0, 0);
assert.strictEqual(g1.positions.length, 6 * 4 * 3, 'single block 6 faces 24 verts');
assert.strictEqual(g1.indices.length, 6 * 6, '36 indices');
assert.strictEqual(g1.uvs.length, 6 * 4 * 2);
assert.strictEqual(g1.colors.length, 6 * 4 * 3);
assert.strictEqual(g1.normals.length, 6 * 4 * 3);
// 顶点坐标都在 [0,1] 内（方块在原点）
for (const v of g1.positions) assert.ok(v >= 0 && v <= 1);

// 相邻两块共面剔除：两块沿 x 相邻 → 共 10 面
const twoWorld = { getBlock: (x, y, z) => ((y === 0 && z === 0 && (x === 0 || x === 1)) ? 3 : 0) };
const g2 = Mesher.buildChunkGeometryData(twoWorld, 0, 0);
assert.strictEqual(g2.positions.length / 12, 10, 'two adjacent blocks expose 10 faces');

// 顶面无遮挡时颜色应为最亮 1.0；底面最暗 0.5
// 找法线 (0,1,0) 的顶点，其颜色应全为 1.0
let foundTop = false, foundBottom = false;
for (let i = 0; i < g1.normals.length; i += 3) {
  if (g1.normals[i + 1] === 1) { assert.ok(Math.abs(g1.colors[i] - 1.0) < 1e-6, 'top brightness 1.0, got ' + g1.colors[i]); foundTop = true; }
  if (g1.normals[i + 1] === -1) { assert.ok(Math.abs(g1.colors[i] - 0.5) < 1e-6, 'bottom brightness 0.5'); foundBottom = true; }
}
assert.ok(foundTop && foundBottom);

// AO：在 (1,1,0) 放一块，则 (0,0,0) 顶面靠近它的顶点应变暗（< 1.0）
const aoWorld = { getBlock: (x, y, z) => ((x === 0 && y === 0 && z === 0) || (x === 1 && y === 1 && z === 0) ? 3 : 0) };
const g3 = Mesher.buildChunkGeometryData(aoWorld, 0, 0);
let darkened = false;
for (let i = 0; i < g3.normals.length; i += 3) {
  if (g3.normals[i + 1] === 1 && g3.positions[i] === 1) { // 顶面 x=1 侧顶点
    if (g3.colors[i] < 0.99) darkened = true;
  }
}
assert.ok(darkened, 'AO darkens top-face verts near occluder');

// UV：草方块顶面用瓦片 0 → u∈[0,0.25], v∈[0.75,1]
// 通过法线定位顶面 4 个顶点的 uv
const vertsPerFace = 4;
for (let f = 0; f < 6; f++) {
  const ni = f * vertsPerFace * 3;
  if (g1.normals[ni + 1] === 1) {
    for (let v = 0; v < 4; v++) {
      const u = g1.uvs[f * 8 + v * 2], vv = g1.uvs[f * 8 + v * 2 + 1];
      assert.ok(u >= 0 && u <= 0.25 + 1e-9, 'top face u in tile 0');
      assert.ok(vv >= 0.75 - 1e-9 && vv <= 1, 'top face v in tile 0');
    }
  }
}

// 真实世界冒烟测试：生成一个区块能构出网格且不抛异常
const W = globalThis.MyWorld.World;
const w = W.create(99);
w.ensureChunk(0, 0);
const g4 = Mesher.buildChunkGeometryData(w, 0, 0);
assert.ok(g4.positions.length > 0 && g4.indices.length % 6 === 0);
console.log('test_mesher OK');
```

- [ ] **Step 4.2: 运行确认失败**

Run: `node tests/test_mesher.js`
Expected: FAIL（Cannot find module '../js/mesher.js'）

- [ ] **Step 4.3: 实现 mesher.js**

```js
// js/mesher.js — 区块网格数据构建：面剔除 + 方向明暗 + 顶点 AO
(function (root) {
  'use strict';
  const Blocks = root.MyWorld.Blocks;
  const W = root.MyWorld.World;
  const CX = W.CHUNK_X, CY = W.CHUNK_Y, CZ = W.CHUNK_Z;

  // 面定义（corner 顺序与索引 [0,1,2, 2,1,3] 配合，保证从外侧看逆时针）
  const FACES = [
    { dir: [-1, 0, 0], bright: 0.7, tex: 'side', corners: [
      { pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] },
      { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] } ] },
    { dir: [1, 0, 0], bright: 0.7, tex: 'side', corners: [
      { pos: [1, 1, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [0, 0] },
      { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] } ] },
    { dir: [0, -1, 0], bright: 0.5, tex: 'bottom', corners: [
      { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 0, 1], uv: [0, 0] },
      { pos: [1, 0, 0], uv: [1, 1] }, { pos: [0, 0, 0], uv: [0, 1] } ] },
    { dir: [0, 1, 0], bright: 1.0, tex: 'top', corners: [
      { pos: [0, 1, 1], uv: [1, 1] }, { pos: [1, 1, 1], uv: [0, 1] },
      { pos: [0, 1, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 0] } ] },
    { dir: [0, 0, -1], bright: 0.82, tex: 'side', corners: [
      { pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] },
      { pos: [1, 1, 0], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 1] } ] },
    { dir: [0, 0, 1], bright: 0.82, tex: 'side', corners: [
      { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] },
      { pos: [0, 1, 1], uv: [0, 1] }, { pos: [1, 1, 1], uv: [1, 1] } ] },
  ];
  const AO_FACTOR = [1.0, 0.82, 0.66, 0.52];

  // 顶点 AO：corner 在面平面内两个切向的邻居 + 对角
  function vertexAO(solidAt, bx, by, bz, dir, cpos) {
    const axis = dir[0] !== 0 ? 0 : (dir[1] !== 0 ? 1 : 2);
    const t1 = (axis + 1) % 3, t2 = (axis + 2) % 3;
    const base = [bx + dir[0], by + dir[1], bz + dir[2]]; // 面外一层
    const s1 = cpos[t1] === 1 ? 1 : -1;
    const s2 = cpos[t2] === 1 ? 1 : -1;
    const o1 = [0, 0, 0], o2 = [0, 0, 0];
    o1[t1] = s1; o2[t2] = s2;
    const side1 = solidAt(base[0] + o1[0], base[1] + o1[1], base[2] + o1[2]) ? 1 : 0;
    const side2 = solidAt(base[0] + o2[0], base[1] + o2[1], base[2] + o2[2]) ? 1 : 0;
    const corner = solidAt(base[0] + o1[0] + o2[0], base[1] + o1[1] + o2[1], base[2] + o1[2] + o2[2]) ? 1 : 0;
    const occ = (side1 && side2) ? 3 : side1 + side2 + corner;
    return AO_FACTOR[occ];
  }

  // worldLike 只需提供 getBlock(x,y,z)
  function buildChunkGeometryData(worldLike, cx, cz) {
    const get = (x, y, z) => worldLike.getBlock(x, y, z);
    const solidAt = (x, y, z) => Blocks.isSolid(get(x, y, z));
    const positions = [], normals = [], uvs = [], colors = [], indices = [];
    const x0 = cx * CX, z0 = cz * CZ;

    for (let ly = 0; ly < CY; ly++) {
      for (let lz = 0; lz < CZ; lz++) {
        for (let lx = 0; lx < CX; lx++) {
          const wx = x0 + lx, wy = ly, wz = z0 + lz;
          const id = get(wx, wy, wz);
          if (!Blocks.isSolid(id)) continue;
          const def = Blocks.BLOCKS[id];
          for (const face of FACES) {
            const nx = wx + face.dir[0], ny = wy + face.dir[1], nz = wz + face.dir[2];
            if (solidAt(nx, ny, nz)) continue; // 被遮挡，剔除
            const tile = def.tex[face.tex];
            const { u0, v0, u1, v1 } = Blocks.tileUV(tile);
            const ndx = positions.length / 3;
            for (const c of face.corners) {
              positions.push(wx + c.pos[0], wy + c.pos[1], wz + c.pos[2]);
              normals.push(face.dir[0], face.dir[1], face.dir[2]);
              uvs.push(u0 + c.uv[0] * (u1 - u0), v0 + c.uv[1] * (v1 - v0));
              const ao = vertexAO(solidAt, wx, wy, wz, face.dir, c.pos);
              const b = face.bright * ao;
              colors.push(b, b, b);
            }
            indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
          }
        }
      }
    }
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      colors: new Float32Array(colors),
      // 顶点数超过 65535 时索引必须用 Uint32（满方块区块会超）
      indices: positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
    };
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Mesher = { buildChunkGeometryData };
})(typeof self !== 'undefined' ? self : globalThis);
```

实现注意：索引类型按顶点数（positions.length/3）选择 Uint16/Uint32，上面代码已处理。

- [ ] **Step 4.4: 运行确认通过**

Run: `node tests/test_mesher.js`
Expected: `test_mesher OK`

UV 断言若失败：检查 tileUV 的 v 轴翻转（THREE v 向上、canvas y 向下）；AO 断言若失败：检查 vertexAO 的切向轴选取（axis+1、axis+2 取模）。

- [ ] **Step 4.5: 提交**

```bash
git add js/mesher.js tests/test_mesher.js
git commit -m "feat: 区块网格构建（面剔除+方向明暗+顶点AO）"
```

### Task 5: 玩家物理 player.js

**Files:**
- Create: `js/player.js`
- Test: `tests/test_player.js`

碰撞箱 0.6×1.8×0.6（pos 为脚底中心），视点高 1.62。逐轴移动+子步进（每子步 ≤0.5 格防穿透），撞到实心方块就贴面并清零该轴速度。参数：走速 4.5、重力 30、跳跃初速 9（≈1.25 格跳高）。

- [ ] **Step 5.1: 写失败测试**

```js
// tests/test_player.js
'use strict';
const assert = require('node:assert');
require('../js/blocks.js');
require('../js/player.js');
const Player = globalThis.MyWorld.Player;

// 模拟世界：y<10 全是石头（地表面在 y=10），x>=5 处有一堵高墙
function flatWorld() {
  return { getBlock: (x, y, z) => (y < 10 ? 3 : 0) };
}
function wallWorld() {
  return { getBlock: (x, y, z) => (y < 10 || (x >= 5 && y < 30) ? 3 : 0) };
}
const IDLE = { forward: false, back: false, left: false, right: false, jump: false };

// 1) 重力下落并停在地面：脚底 y=10
{
  const w = flatWorld();
  const p = Player.create(0.5, 20, 0.5);
  for (let i = 0; i < 200; i++) Player.update(p, w, 1 / 60, IDLE);
  assert.ok(Math.abs(p.y - 10) < 0.01, 'rests on ground, y=' + p.y);
  assert.strictEqual(p.onGround, true);
  assert.strictEqual(p.vy, 0);
}

// 2) 走向墙被挡住：x 不超过 5 - 0.3
{
  const w = wallWorld();
  const p = Player.create(0.5, 10, 0.5);
  p.yaw = -Math.PI / 2; // 面向 +x（yaw=0 面向 -z，右手系绕 y）
  const input = { ...IDLE, forward: true };
  for (let i = 0; i < 300; i++) Player.update(p, w, 1 / 60, input);
  assert.ok(p.x < 5 - 0.29, 'blocked by wall, x=' + p.x);
  assert.ok(p.x > 4.5, 'but got close to wall, x=' + p.x);
}

// 3) 跳跃：上升超过 1 格再落回
{
  const w = flatWorld();
  const p = Player.create(0.5, 10, 0.5);
  Player.update(p, w, 1 / 60, IDLE); // 先落稳一帧
  let maxY = 10;
  const jumpInput = { ...IDLE, jump: true };
  for (let i = 0; i < 120; i++) {
    Player.update(p, w, 1 / 60, i === 0 ? jumpInput : IDLE);
    maxY = Math.max(maxY, p.y);
  }
  assert.ok(maxY > 11, 'jump height > 1 block, max=' + maxY);
  assert.ok(Math.abs(p.y - 10) < 0.01, 'lands back');
}

// 4) 空中不能二段跳
{
  const w = flatWorld();
  const p = Player.create(0.5, 15, 0.5);
  const jumpInput = { ...IDLE, jump: true };
  Player.update(p, w, 1 / 60, jumpInput); // 空中按跳
  assert.ok(p.vy <= 0, 'no double jump in air');
}

// 5) yaw=0 朝 -z 前进
{
  const w = flatWorld();
  const p = Player.create(0.5, 10, 0.5);
  const input = { ...IDLE, forward: true };
  for (let i = 0; i < 60; i++) Player.update(p, w, 1 / 60, input);
  assert.ok(p.z < 0.5 - 1, 'moves toward -z, z=' + p.z);
  assert.ok(Math.abs(p.x - 0.5) < 0.01, 'x unchanged');
}

// 6) 头顶有方块时跳跃被顶住：天花板在 y=12（脚底最高 12-1.8=10.2）
{
  const w = { getBlock: (x, y, z) => (y < 10 || y === 12 ? 3 : 0) };
  const p = Player.create(0.5, 10, 0.5);
  Player.update(p, w, 1 / 60, IDLE);
  const jumpInput = { ...IDLE, jump: true };
  let maxY = 10;
  for (let i = 0; i < 60; i++) {
    Player.update(p, w, 1 / 60, i === 0 ? jumpInput : IDLE);
    maxY = Math.max(maxY, p.y);
  }
  assert.ok(maxY <= 12 - 1.8 + 0.01, 'ceiling blocks jump, max=' + maxY);
}
console.log('test_player OK');
```

- [ ] **Step 5.2: 运行确认失败**

Run: `node tests/test_player.js`
Expected: FAIL（Cannot find module '../js/player.js'）

- [ ] **Step 5.3: 实现 player.js**

```js
// js/player.js — 玩家物理：AABB 碰撞、重力、行走跳跃
(function (root) {
  'use strict';
  const Blocks = root.MyWorld.Blocks;

  const HALF = 0.3, HEIGHT = 1.8, EYE = 1.62;
  const SPEED = 4.5, GRAVITY = 30, JUMP_V = 9, MAX_FALL = 40;
  const EPS = 0.001;

  function create(x, y, z) {
    return { x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: false };
  }

  function boxIntersectsSolid(world, minx, miny, minz, maxx, maxy, maxz) {
    const x0 = Math.floor(minx), x1 = Math.floor(maxx - 1e-9);
    const y0 = Math.floor(miny), y1 = Math.floor(maxy - 1e-9);
    const z0 = Math.floor(minz), z1 = Math.floor(maxz - 1e-9);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
          if (Blocks.isSolid(world.getBlock(x, y, z))) return true;
    return false;
  }

  function intersects(world, p) {
    return boxIntersectsSolid(world, p.x - HALF, p.y, p.z - HALF, p.x + HALF, p.y + HEIGHT, p.z + HALF);
  }

  function moveAxis(p, world, axis, delta) {
    if (delta === 0) return;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.5));
    const step = delta / steps;
    for (let i = 0; i < steps; i++) {
      p[axis] += step;
      if (!intersects(world, p)) continue;
      // 撞上：贴面 + 清零该轴速度
      if (axis === 'y') {
        if (step < 0) { p.y = Math.floor(p.y) + 1 + EPS; p.vy = 0; p.onGround = true; }
        else { p.y = Math.ceil(p.y + HEIGHT) - 1 - HEIGHT - EPS; p.vy = 0; }
      } else if (axis === 'x') {
        if (step < 0) p.x = Math.floor(p.x - HALF) + 1 + HALF + EPS;
        else p.x = Math.ceil(p.x + HALF) - 1 - HALF - EPS;
        p.vx = 0;
      } else {
        if (step < 0) p.z = Math.floor(p.z - HALF) + 1 + HALF + EPS;
        else p.z = Math.ceil(p.z + HALF) - 1 - HALF - EPS;
        p.vz = 0;
      }
      break;
    }
  }

  function update(p, world, dt, input) {
    // 水平意图速度（yaw=0 面向 -z）
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    let mx = 0, mz = 0;
    if (input.forward) { mx += fx; mz += fz; }
    if (input.back) { mx -= fx; mz -= fz; }
    if (input.right) { mx += rx; mz += rz; }
    if (input.left) { mx -= rx; mz -= rz; }
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx = mx / len * SPEED; mz = mz / len * SPEED; }
    p.vx = mx; p.vz = mz;

    if (input.jump && p.onGround) { p.vy = JUMP_V; p.onGround = false; }
    p.vy -= GRAVITY * dt;
    if (p.vy < -MAX_FALL) p.vy = -MAX_FALL;

    p.onGround = false;
    moveAxis(p, world, 'y', p.vy * dt);
    moveAxis(p, world, 'x', p.vx * dt);
    moveAxis(p, world, 'z', p.vz * dt);
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Player = { create, update, HALF, HEIGHT, EYE };
})(typeof self !== 'undefined' ? self : globalThis);
```

实现注意：`onGround` 在每帧 Y 轴移动前重置为 false、仅在向下碰撞时置 true——顺序是「先重置、先 Y 后 XZ」。贴面公式里 `Math.floor(p.y)+1` 取的是穿入格的上表面；若测试 1 失败检查 EPS 与 floor 边界。测试 4 的前提是创建时 onGround=false。

- [ ] **Step 5.4: 运行确认通过**

Run: `node tests/test_player.js`
Expected: `test_player OK`

- [ ] **Step 5.5: 提交**

```bash
git add js/player.js tests/test_player.js
git commit -m "feat: 玩家物理（AABB碰撞/重力/跳跃）"
```

---

### Task 6: 体素射线 interact.js

**Files:**
- Create: `js/interact.js`
- Test: `tests/test_interact.js`

Amanatides-Woo DDA 体素遍历：从眼睛位置沿视线逐格推进，返回命中方块坐标与命中面法线（放置位置 = 命中格 + 法线）。

- [ ] **Step 6.1: 写失败测试**

```js
// tests/test_interact.js
'use strict';
const assert = require('node:assert');
require('../js/blocks.js');
require('../js/interact.js');
const Raycast = globalThis.MyWorld.Raycast;

// 仅 (0,0,0) 一个实心方块的世界
const one = { getBlock: (x, y, z) => (x === 0 && y === 0 && z === 0 ? 3 : 0) };

// 1) 自上而下命中顶面
{
  const r = Raycast.cast(one, 0.5, 3.5, 0.5, 0, -1, 0, 6);
  assert.strictEqual(r.hit, true);
  assert.deepStrictEqual([r.x, r.y, r.z], [0, 0, 0]);
  assert.deepStrictEqual([r.nx, r.ny, r.nz], [0, 1, 0], 'top face normal');
}
// 2) 自下而上命中底面
{
  const r = Raycast.cast(one, 0.5, -2.5, 0.5, 0, 1, 0, 6);
  assert.strictEqual(r.hit, true);
  assert.deepStrictEqual([r.nx, r.ny, r.nz], [0, -1, 0], 'bottom face normal');
}
// 3) 沿 -x 方向命中东面
{
  const r = Raycast.cast(one, 3.5, 0.5, 0.5, -1, 0, 0, 6);
  assert.strictEqual(r.hit, true);
  assert.deepStrictEqual([r.nx, r.ny, r.nz], [1, 0, 0], 'east face normal');
}
// 4) 超出 maxDist 不命中
{
  const r = Raycast.cast(one, 0.5, 20, 0.5, 0, -1, 0, 6);
  assert.strictEqual(r.hit, false);
}
// 5) 斜向命中（含分量为 0 的安全处理）
{
  const d = Math.hypot(1, -1);
  const r = Raycast.cast(one, -1.5, 2.5, 0.5, 1 / d, -1 / d, 0, 10);
  assert.strictEqual(r.hit, true);
  assert.deepStrictEqual([r.x, r.y, r.z], [0, 0, 0]);
}
// 6) 空世界不命中
{
  const empty = { getBlock: () => 0 };
  const r = Raycast.cast(empty, 0, 0, 0, 0, 0, -1, 6);
  assert.strictEqual(r.hit, false);
}
console.log('test_interact OK');
```

- [ ] **Step 6.2: 运行确认失败**

Run: `node tests/test_interact.js`
Expected: FAIL（Cannot find module '../js/interact.js'）

- [ ] **Step 6.3: 实现 interact.js**

```js
// js/interact.js — DDA 体素射线（Amanatides & Woo）
(function (root) {
  'use strict';
  const Blocks = root.MyWorld.Blocks;

  function cast(world, ox, oy, oz, dx, dy, dz, maxDist) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? x + 1 - ox : ox - x) / Math.abs(dx)) : Infinity;
    let tMaxY = dy !== 0 ? ((dy > 0 ? y + 1 - oy : oy - y) / Math.abs(dy)) : Infinity;
    let tMaxZ = dz !== 0 ? ((dz > 0 ? z + 1 - oz : oz - z) / Math.abs(dz)) : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;

    while (t <= maxDist) {
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
      }
      if (t > maxDist) break;
      if (Blocks.isSolid(world.getBlock(x, y, z))) {
        return { hit: true, x, y, z, nx, ny, nz };
      }
    }
    return { hit: false, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Raycast = { cast };
})(typeof self !== 'undefined' ? self : globalThis);
```

实现注意：起点所在格不检测（玩家眼睛所在格必为空气）；三轴 tMax 公式同构。

- [ ] **Step 6.4: 运行确认通过**

Run: `node tests/test_interact.js`
Expected: `test_interact OK`

- [ ] **Step 6.5: 提交**

```bash
git add js/interact.js tests/test_interact.js
git commit -m "feat: DDA体素射线"
```

---

### Task 7: 测试汇总 run_all.js

**Files:**
- Create: `tests/run_all.js`

- [ ] **Step 7.1: 实现**

```js
// tests/run_all.js — 依次跑全部测试，任一失败即非零退出
'use strict';
const files = ['test_noise.js', 'test_blocks.js', 'test_world.js', 'test_mesher.js', 'test_player.js', 'test_interact.js'];
for (const f of files) require('./' + f);
console.log('ALL TESTS PASSED');
```

注意：各测试文件 require 同一份模块会被 Node 缓存，模块用 `root.MyWorld = root.MyWorld || {}` 幂等挂载，不冲突。

- [ ] **Step 7.2: 运行确认全绿**

Run: `node tests/run_all.js`
Expected: 各测试 OK 后输出 `ALL TESTS PASSED`

- [ ] **Step 7.3: 提交**

```bash
git add tests/run_all.js
git commit -m "test: 测试汇总入口"
```

### Task 8: 页面与 HUD（index.html + ui.js）

**Files:**
- Create: `index.html`
- Create: `js/ui.js`

浏览器端无单元测试，正确性由 Task 10 浏览器验证覆盖。

- [ ] **Step 8.1: 实现 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>我的世界 - 网页版</title>
<style>
  html, body { margin: 0; padding: 0; overflow: hidden; height: 100%; background: #000; }
  canvas { display: block; }
  /* 十字准星 */
  #crosshair {
    position: fixed; left: 50%; top: 50%; width: 20px; height: 20px;
    transform: translate(-50%, -50%); pointer-events: none; z-index: 10;
  }
  #crosshair::before, #crosshair::after {
    content: ''; position: absolute; background: rgba(255,255,255,0.85);
    mix-blend-mode: difference;
  }
  #crosshair::before { left: 9px; top: 0; width: 2px; height: 20px; }
  #crosshair::after { left: 0; top: 9px; width: 20px; height: 2px; }
  /* 快捷栏 */
  #hotbar {
    position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%);
    display: flex; gap: 4px; z-index: 10; pointer-events: none;
  }
  .slot {
    width: 48px; height: 48px; position: relative;
    background: rgba(0,0,0,0.45); border: 2px solid #888; border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
  }
  .slot.selected { border-color: #fff; box-shadow: 0 0 6px #fff; }
  .slot canvas { width: 36px; height: 36px; image-rendering: pixelated; }
  .slot span {
    position: absolute; left: 3px; top: 1px; color: #fff;
    font: 11px/1 sans-serif; text-shadow: 1px 1px 0 #000;
  }
  /* 开始/暂停遮罩 */
  #overlay {
    position: fixed; inset: 0; z-index: 20; display: flex;
    align-items: center; justify-content: center;
    background: rgba(0,0,0,0.55); cursor: pointer;
  }
  #overlay .panel {
    background: rgba(20,20,20,0.92); color: #eee; padding: 28px 40px;
    border-radius: 10px; font-family: sans-serif; text-align: center;
    border: 1px solid #555; max-width: 420px;
  }
  #overlay h1 { margin: 0 0 14px; font-size: 26px; color: #7ec850; }
  #overlay p { margin: 6px 0; font-size: 14px; line-height: 1.7; }
  #overlay .go { margin-top: 16px; font-size: 16px; color: #ffd24a; }
  kbd {
    background: #333; border: 1px solid #666; border-bottom-width: 2px;
    border-radius: 3px; padding: 1px 6px; font-size: 12px;
  }
  /* WebGL 不可用提示 */
  #nogl {
    position: fixed; inset: 0; z-index: 30; display: none;
    align-items: center; justify-content: center; color: #fff;
    background: #222; font: 16px sans-serif;
  }
</style>
</head>
<body>
<div id="crosshair"></div>
<div id="hotbar"></div>
<div id="overlay">
  <div class="panel">
    <h1>我的世界 · 网页版</h1>
    <p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动　<kbd>空格</kbd> 跳跃　鼠标转视角</p>
    <p>左键挖方块　右键放方块</p>
    <p><kbd>1</kbd>~<kbd>8</kbd> 或滚轮选择方块　<kbd>ESC</kbd> 暂停</p>
    <p class="go">点击任意处开始游戏</p>
  </div>
</div>
<div id="nogl">你的浏览器不支持 WebGL，无法运行游戏。请更换或升级浏览器。</div>
<script src="lib/three.min.js"></script>
<script src="js/noise.js"></script>
<script src="js/blocks.js"></script>
<script src="js/world.js"></script>
<script src="js/mesher.js"></script>
<script src="js/player.js"></script>
<script src="js/interact.js"></script>
<script src="js/ui.js"></script>
<script src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 8.2: 实现 js/ui.js**

```js
// js/ui.js — 快捷栏与遮罩
(function (root) {
  'use strict';
  const Blocks = root.MyWorld.Blocks;
  let slots = [];

  function buildHotbar(atlasCanvas) {
    const bar = root.document.getElementById('hotbar');
    bar.innerHTML = '';
    slots = [];
    Blocks.HOTBAR.forEach((id, i) => {
      const slot = root.document.createElement('div');
      slot.className = 'slot';
      const cv = root.document.createElement('canvas');
      cv.width = 32; cv.height = 32;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      const t = Blocks.BLOCKS[id].tex.side;
      const sx = (t % Blocks.ATLAS_TILES) * Blocks.TILE_PX;
      const sy = Math.floor(t / Blocks.ATLAS_TILES) * Blocks.TILE_PX;
      ctx.drawImage(atlasCanvas, sx, sy, Blocks.TILE_PX, Blocks.TILE_PX, 0, 0, 32, 32);
      const num = root.document.createElement('span');
      num.textContent = i + 1;
      slot.appendChild(cv);
      slot.appendChild(num);
      slot.title = Blocks.BLOCKS[id].name;
      bar.appendChild(slot);
      slots.push(slot);
    });
    selectSlot(0);
  }

  function selectSlot(i) {
    slots.forEach((s, j) => s.classList.toggle('selected', j === i));
  }

  function showOverlay(show) {
    root.document.getElementById('overlay').style.display = show ? 'flex' : 'none';
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.UI = { buildHotbar, selectSlot, showOverlay };
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 8.3: 提交**

```bash
git add index.html js/ui.js
git commit -m "feat: 游戏页面与HUD（准星/快捷栏/遮罩）"
```

---

### Task 9: 主程序 main.js

**Files:**
- Create: `js/main.js`

串起全部模块：渲染器、材质、区块流式加载、输入、指针锁定、挖放、高亮、主循环。常量：渲染半径 4 区块（切比雪夫距离）、卸载半径 6、每帧最多生成 2 个新区块网格、每帧最多重构 4 个脏区块、交互距离 6 格。

- [ ] **Step 9.1: 实现 js/main.js**

```js
// js/main.js — 游戏主程序
(function (root) {
  'use strict';
  const MW = root.MyWorld;
  const Blocks = MW.Blocks, World = MW.World, Mesher = MW.Mesher;
  const Player = MW.Player, Raycast = MW.Raycast, UI = MW.UI;

  const RENDER_RADIUS = 4, UNLOAD_RADIUS = 6;
  const MAX_GEN_PER_FRAME = 2, MAX_REMESH_PER_FRAME = 4, REACH = 6;

  // --- 渲染器（WebGL 检查）---
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false });
  } catch (e) {
    document.getElementById('nogl').style.display = 'flex';
    document.getElementById('overlay').style.display = 'none';
    return;
  }
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const SKY = 0x87ceeb;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 40, 90);
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.rotation.order = 'YXZ';

  // --- 材质（光照全部烘焙进顶点色，用 Basic 材质即可）---
  const atlas = Blocks.buildAtlas();
  const tex = new THREE.CanvasTexture(atlas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  const material = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true });

  // --- 世界与玩家 ---
  const seed = (Math.random() * 0x7fffffff) | 0;
  const world = World.create(seed);
  const spawnX = 8.5, spawnZ = 8.5;
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) world.ensureChunk(cx, cz);
  const player = Player.create(spawnX, world.terrainHeight(8, 8) + 1, spawnZ);

  // --- 区块网格管理 ---
  const meshes = new Map();
  function buildMesh(cx, cz) {
    const k = world.key(cx, cz);
    const old = meshes.get(k);
    if (old) { scene.remove(old); old.geometry.dispose(); meshes.delete(k); }
    const d = Mesher.buildChunkGeometryData(world, cx, cz);
    if (d.positions.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2));
    g.setAttribute('color', new THREE.BufferAttribute(d.colors, 3));
    g.setIndex(new THREE.BufferAttribute(d.indices, 1));
    const m = new THREE.Mesh(g, material);
    scene.add(m);
    meshes.set(k, m);
  }
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    buildMesh(cx, cz);
    world.getChunk(cx, cz).dirty = false;
  }

  function updateChunks() {
    const pcx = Math.floor(player.x / World.CHUNK_X), pcz = Math.floor(player.z / World.CHUNK_Z);
    // 1) 缺失区块按距离排序补齐（限额）
    const wanted = [];
    for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
      for (let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz++) {
        const cx = pcx + dx, cz = pcz + dz;
        if (!meshes.has(world.key(cx, cz))) wanted.push([cx, cz, dx * dx + dz * dz]);
      }
    }
    wanted.sort((a, b) => a[2] - b[2]);
    let budget = MAX_GEN_PER_FRAME;
    for (const [cx, cz] of wanted) {
      if (budget-- <= 0) break;
      world.ensureChunk(cx, cz);
      buildMesh(cx, cz);
      world.getChunk(cx, cz).dirty = false;
    }
    // 2) 脏区块重构（挖放方块、邻块生成都会标脏）
    let remesh = MAX_REMESH_PER_FRAME;
    for (const c of world.chunks.values()) {
      if (remesh <= 0) break;
      if (c.dirty && meshes.has(world.key(c.cx, c.cz))) {
        buildMesh(c.cx, c.cz);
        c.dirty = false;
        remesh--;
      }
    }
    // 3) 卸载远处网格（保留方块数据）
    for (const [k, m] of meshes) {
      const c = world.chunks.get(k);
      if (Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) > UNLOAD_RADIUS) {
        scene.remove(m);
        m.geometry.dispose();
        meshes.delete(k);
      }
    }
  }

  // --- 选中方块高亮 ---
  const hl = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
    new THREE.LineBasicMaterial({ color: 0x000000 })
  );
  hl.visible = false;
  scene.add(hl);

  // --- 输入 ---
  const input = { forward: false, back: false, left: false, right: false, jump: false };
  const KEYMAP = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', Space: 'jump' };
  let hotbarIndex = 0;
  window.addEventListener('keydown', (e) => {
    if (KEYMAP[e.code]) { input[KEYMAP[e.code]] = true; if (e.code === 'Space') e.preventDefault(); }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 8) { hotbarIndex = n - 1; UI.selectSlot(hotbarIndex); }
  });
  window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) input[KEYMAP[e.code]] = false; });
  window.addEventListener('wheel', (e) => {
    hotbarIndex = (hotbarIndex + (e.deltaY > 0 ? 1 : -1) + 8) % 8;
    UI.selectSlot(hotbarIndex);
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- 指针锁定 ---
  function isLocked() { return document.pointerLockElement === renderer.domElement; }
  document.getElementById('overlay').addEventListener('click', () => renderer.domElement.requestPointerLock());
  document.addEventListener('pointerlockchange', () => UI.showOverlay(!isLocked()));
  document.addEventListener('mousemove', (e) => {
    if (!isLocked()) return;
    player.yaw -= e.movementX * 0.0024;
    player.pitch -= e.movementY * 0.0024;
    const lim = Math.PI / 2 - 0.01;
    if (player.pitch > lim) player.pitch = lim;
    if (player.pitch < -lim) player.pitch = -lim;
  });

  // --- 视线方向（yaw=0 朝 -z）---
  function viewDir() {
    const cp = Math.cos(player.pitch);
    return { x: -Math.sin(player.yaw) * cp, y: Math.sin(player.pitch), z: -Math.cos(player.yaw) * cp };
  }

  // --- 挖 / 放 ---
  document.addEventListener('mousedown', (e) => {
    if (!isLocked()) return;
    const d = viewDir();
    const r = Raycast.cast(world, player.x, player.y + Player.EYE, player.z, d.x, d.y, d.z, REACH);
    if (!r.hit) return;
    if (e.button === 0) {
      world.setBlock(r.x, r.y, r.z, 0);
    } else if (e.button === 2) {
      const tx = r.x + r.nx, ty = r.y + r.ny, tz = r.z + r.nz;
      if (ty < 0 || ty >= World.CHUNK_Y) return;
      // 不允许把方块放进玩家碰撞箱
      const overlap = !(tx + 1 <= player.x - Player.HALF || tx >= player.x + Player.HALF ||
                        ty + 1 <= player.y || ty >= player.y + Player.HEIGHT ||
                        tz + 1 <= player.z - Player.HALF || tz >= player.z + Player.HALF);
      if (overlap) return;
      world.setBlock(tx, ty, tz, Blocks.HOTBAR[hotbarIndex]);
    }
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- HUD ---
  UI.buildHotbar(atlas);

  // --- 主循环 ---
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;

    if (isLocked()) Player.update(player, world, dt, input);
    if (player.y < -10) { // 掉出世界兜底
      player.x = spawnX; player.z = spawnZ;
      player.y = world.terrainHeight(8, 8) + 2;
      player.vy = 0;
    }

    updateChunks();

    camera.position.set(player.x, player.y + Player.EYE, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);

    const d = viewDir();
    const r = Raycast.cast(world, player.x, player.y + Player.EYE, player.z, d.x, d.y, d.z, REACH);
    if (r.hit) { hl.visible = true; hl.position.set(r.x + 0.5, r.y + 0.5, r.z + 0.5); }
    else hl.visible = false;

    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  // 调试句柄（浏览器自动化验证用）
  root.MyWorld.game = { world, player, meshes, seed };
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 9.2: 全量逻辑测试回归**

Run: `node tests/run_all.js`
Expected: `ALL TESTS PASSED`（main.js 是浏览器代码，不影响 Node 测试，此步防回归）

- [ ] **Step 9.3: 提交**

```bash
git add js/main.js
git commit -m "feat: 主循环/区块流式加载/交互与指针锁定"
```

---

### Task 10: 浏览器验证 + README

**Files:**
- Create: `README.md`
- Verify: 浏览器中实际运行游戏

- [ ] **Step 10.1: 浏览器自动化验证**

用浏览器工具（Claude Preview 或 Chrome MCP）打开 `file:///D:/github/cc-myworld/index.html`，依次确认：

1. 截图：可见地形（绿色草地/山丘）、十字准星、底部 8 格快捷栏、开始遮罩文字
2. 控制台无报错（warning 可接受）
3. 用 JS eval 验证游戏状态：
   - `MyWorld.game.seed` 为数字
   - `MyWorld.game.meshes.size >= 25`（初始 5×5 区块已构网格）
   - `MyWorld.game.player.y > 0`（玩家站在地表）
4. 区块流式加载：eval `MyWorld.game.player.x += 80; MyWorld.game.player.z += 80;` 等待 3 秒后检查 `MyWorld.game.world.chunks.size` 明显增加，且截图可见新地形（无大面积空洞）
5. 挖放逻辑（绕过指针锁定直接调用）：eval `const g = MyWorld.game; const h = g.world.terrainHeight(8,8); g.world.setBlock(8, h, 8, 0); g.world.getBlock(8, h, 8)` 应返回 0，且下一帧后对应区块重构不报错

Expected: 全部通过；任何控制台报错都要修复后重测。

- [ ] **Step 10.2: 写 README.md**

```markdown
# 我的世界 · 网页版

用 Three.js 构建的浏览器版 Minecraft 风格体素游戏。**双击 `index.html` 即可游玩**，无需安装、无需联网、无需构建。

## 玩法

| 操作 | 按键 |
|------|------|
| 移动 | W / A / S / D |
| 跳跃 | 空格 |
| 视角 | 鼠标 |
| 挖方块 | 鼠标左键 |
| 放方块 | 鼠标右键 |
| 选方块 | 数字键 1~8 或滚轮 |
| 暂停 | ESC |

## 特性

- 无限世界：柏林噪声地形（平原/丘陵/山地/沙地），随走随生成，走回头路地形不变
- 8 种方块：草、泥土、石头、原木、木板、树叶、沙子、砖块
- 程序化像素贴图：零图片素材，全部用 canvas 代码绘制
- 区块化渲染：面剔除 + 顶点 AO，流畅 60 FPS

## 开发

逻辑模块（噪声/世界/网格/物理/射线）有 Node 单元测试：

​```bash
node tests/run_all.js
​```

刷新页面会生成新的随机世界。
```

注意：上面代码块内的 ``` 转义仅为计划文档展示，实际写 README 时用正常的三反引号。

- [ ] **Step 10.3: 最终提交**

```bash
git add README.md
git commit -m "docs: README 与游玩说明"
```

- [ ] **Step 10.4: 完成检查清单（对照设计文档验证标准）**

- 地形：山地起伏、有树、低洼有沙 → Step 10.1-1
- 移动跳跃碰撞 → Node 测试 (test_player) + 用户试玩确认
- 挖放方块与高亮 → Step 10.1-5 + 用户试玩确认
- 快捷栏切换 → 截图确认 UI + 用户试玩确认
- 无限世界与确定性 → Node 测试 (test_world) + Step 10.1-4
- ESC 恢复 → 用户试玩确认
- 控制台无报错 → Step 10.1-2

指针锁定相关交互（鼠标视角/左右键）无法完全自动化，最终由用户试玩验收。




