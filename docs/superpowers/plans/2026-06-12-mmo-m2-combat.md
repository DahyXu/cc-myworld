# M2 怪物与战斗 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M1 多人创造模式之上加入怪物与战斗：四种等级地带怪物（确定性营地散布 + 服务器 AI tick）、剑与弓的战斗、玩家 HP/受击/死亡复活/脱战回血、战斗 HUD——成为「能打怪的联机世界」。

**Architecture:** 物理从 js/player.js 提取为 shared/physics.js（盒子尺寸参数化，玩家/怪物两端通用）。怪物运行时状态只存内存（DO 重启/休眠重置，spec 已接受），营地位置由种子+区块哈希纯函数推算。WorldDO 用 setInterval 跑 10Hz 游戏 tick（怪物 AI/箭矢弹道/回血/复活），无事可做时自停以允许 DO 休眠。战斗全部服务器结算：客户端只发意图（attack/shoot），命中/伤害/死亡由服务器广播。箭矢只广播 spawn 与终点（两端用同一常量各自积分弹道，不逐 tick 同步）。

**Tech Stack:** 与 M1 一致——Three.js UMD、原生 WebSocket、Cloudflare DO（SQLite/Hibernation API）、wrangler（npx）、node:assert 零框架测试。

**范围（spec M2 里程碑）：** 共享物理提取、营地与 AI、剑与弓、玩家 HP/死亡复活、战斗 HUD。**经验/等级结算、NPC 与任务链属 M3**——本期怪物死亡不发经验，players 表的 level/xp 列不改动（伤害公式按已存 level 取值，M3 接通升级后自动生效）。

**现有代码约定（务必遵守）：**
- 模块为 IIFE 挂 `globalThis.MyWorld.*`：`(function (root) { ... })(typeof self !== 'undefined' ? self : globalThis)`
- 浏览器依赖顺序由 index.html script 标签保证；Node 测试 `require` 副作用加载；server/ 下以 `import '../xxx.js'` 副作用导入
- 测试零框架：`node:assert` + 末尾 `console.log('test_xxx OK')`，`tests/run_all.js` 串行执行
- 注释、UI 文案全部中文
- 本地 dev 必须 `npx wrangler dev --port 8787 --persist-to ../cc-myworld-state`（watcher 无视 .assetsignore，状态写项目内会无限热重载）

---

## 文件总览

| 文件 | 操作 | 职责 |
|------|------|------|
| `shared/stats.js` | 新建 | 属性/伤害/经验曲线公式（M2 用伤害与 HP 上限，曲线给 M3） |
| `tests/test_stats.js` | 新建 | stats 单测 |
| `shared/physics.js` | 新建 | 参数化盒子物理：重力/三轴扫掠碰撞/跳跃/前方挡路检测/线段-AABB 相交 |
| `tests/test_physics.js` | 新建 | physics 单测（含怪物尺寸参数化用例） |
| `js/player.js` | 修改 | 改为 Physics 门面，公开 API 与字段不变（test_player 回归保证） |
| `shared/mobs_def.js` | 新建 | 怪物模板/等级地带/数值缩放/营地确定性散布/AI 状态机纯函数 |
| `tests/test_mobs.js` | 新建 | mobs_def 单测 |
| `shared/protocol.js` | 修改 | 新增战斗常量与 attack/shoot 校验 |
| `tests/test_protocol.js` | 修改 | 追加战斗校验用例 |
| `server/world_do.js` | 修改 | 游戏 tick（营地激活/AI/箭/回血/复活）、attack/shoot 结算、hp 持久化 |
| `tests/manual/combat_probe.js` | 新建 | 战斗链路探针（走到营地→砍怪→被反击→怪死） |
| `js/combat.js` | 新建 | 快捷栏物品表、武器图标、手持模型与挥击、攻击/射箭输入与冷却、本地箭预表现 |
| `js/hud.js` | 新建 | 血条/红闪/死亡黑屏/世界空间伤害飘字 |
| `js/entities.js` | 修改 | 新增怪物（4 种体素模型+等级名牌+受击血条+死亡倒地）与箭矢渲染 |
| `js/ui.js` | 修改 | buildHotbar 参数化为 10 格物品表（武器图标绘制器由调用方传入） |
| `index.html` | 修改 | HUD DOM/CSS、新 script 标签、快捷栏 10 格样式 |
| `js/main.js` | 修改 | 数字键 0、武器/方块输入路由、战斗消息接线、死亡门控、Combat/Hud 帧更新 |
| `tests/run_all.js` | 修改 | 注册 test_stats / test_physics / test_mobs |
| `README.md` | 修改 | 玩法与特性补战斗内容 |

**消息协议（M2 新增）：**
- C→S：`attack{id}`（近战某怪）、`shoot{dx,dy,dz}`（朝向射箭）
- S→C：`mobSpawn{id,type,lv,x,y,z,hp,maxHp}`、`mobMove{id,x,y,z,yaw}`、`mobHurt{id,hp,dmg}`、`mobDie{id}`、`mobDespawn{id}`（出兴趣范围）、`arrowSpawn{id,x,y,z,vx,vy,vz,own}`（own=玩家pid或0=怪）、`arrowDie{id,x,y,z}`、`hpUpdate{hp,max}`（仅本人）、`playerHurt{hp,dmg}`（仅受害者）、`playerDie{}`（仅死者）
- `welcome` 追加字段：`hp`、`maxHp`、`mobs:[mobSpawn 形状]`

**M2 已知取舍（有意设计，实现时不要"顺手修"）：**
- 怪物运行时状态不持久化：DO 重启/休眠唤醒全部重置回营地满血（spec 明确）
- 营地无人邻近即整体移除，再激活时全量重生（比 spec 的"冻结只记计时"更简，玩家无感知差异）
- 箭矢不逐 tick 同步：两端按同一常量独立积分，服务器只广播起点与终点（命中权威在服务器）
- 近战与仇恨不做视线遮挡判定（穿墙仇恨/贴墙挥击可行但影响小；骷髅的箭走真实弹道会被方块挡住）
- 怪物之间无碰撞（可重叠）；怪物落入虚空（y<-10）直接传送回营地中心
- 无 PVP：玩家的剑与箭对玩家无效；怪物的箭对怪物无效
- M2 不结算经验：mobDie 不发 xpGain，击杀归属与任务计数 M3 实现
- 低基伤怪物的等级伤害缩放被取整吞掉（史莱姆/僵尸全地带同伤，HP/经验仍随级增长）：伤害公式微调留给 M3 数值平衡
- 被动怪被打后追击「最近的玩家」而非「打它的人」（aiStep 只看 nearest，aggroPid 仅作开关）：协作场景可接受的有意简化
- 营地门口拉锯：主动怪回巢满血后玩家仍在视野会立即再追——回巢无敌防风筝的既定后果，非缺陷
- 只要有玩家驻留在任一营地保持半径内，tick 持续运行、DO 不休眠（按驻留时长计费）——「营地只在有人时活动」设计的固有成本

---

### Task 1: shared/stats.js — 属性与伤害公式（TDD）

**Files:**
- Create: `shared/stats.js`
- Test: `tests/test_stats.js`
- Modify: `tests/run_all.js`

- [ ] **Step 1: 写失败测试**

创建 `tests/test_stats.js`：

```js
// tests/test_stats.js — 属性成长、伤害公式、经验曲线
'use strict';
const assert = require('node:assert');
require('../shared/stats.js');
const S = globalThis.MyWorld.Stats;

// HP 上限 = 20 + 5×(等级-1)
assert.strictEqual(S.maxHp(1), 20);
assert.strictEqual(S.maxHp(5), 40);
assert.strictEqual(S.maxHp(20), 115);

// 剑伤害 = 3 + 1×(等级-1)
assert.strictEqual(S.swordDamage(1), 3);
assert.strictEqual(S.swordDamage(10), 12);

// 弓伤害 = floor(2 + 0.8×(等级-1))
assert.strictEqual(S.bowDamage(1), 2);
assert.strictEqual(S.bowDamage(2), 2, 'floor(2.8)=2');
assert.strictEqual(S.bowDamage(11), 10);

// 经验曲线：升到下一级需 floor(25×当前等级^1.5)，上限 20 级
assert.strictEqual(S.xpToNext(1), 25);
assert.strictEqual(S.xpToNext(10), 790);
assert.strictEqual(S.xpToNext(20), Infinity, '到顶不再升级');
assert.strictEqual(S.LEVEL_CAP, 20);

console.log('test_stats OK');
```

- [ ] **Step 2: 运行确认失败**

Run: `node tests/test_stats.js`
Expected: FAIL，`Cannot find module '../shared/stats.js'`

- [ ] **Step 3: 实现 shared/stats.js**

```js
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
```

- [ ] **Step 4: 运行确认通过**

Run: `node tests/test_stats.js`
Expected: `test_stats OK`

- [ ] **Step 5: 注册 run_all 并全量回归**

`tests/run_all.js` 的文件数组改为：

```js
const files = ['test_noise.js', 'test_blocks.js', 'test_world.js', 'test_mesher.js', 'test_player.js', 'test_interact.js', 'test_protocol.js', 'test_remote_edit.js', 'test_stats.js'];
```

Run: `node tests/run_all.js`
Expected: `ALL TESTS PASSED`

- [ ] **Step 6: 提交**

```bash
git add shared/stats.js tests/test_stats.js tests/run_all.js
git commit -m "feat: 共享属性与伤害公式（HP上限/剑弓伤害/经验曲线）"
```

---

### Task 2: shared/physics.js 提取 + js/player.js 重构（TDD）

**Files:**
- Create: `shared/physics.js`
- Test: `tests/test_physics.js`
- Modify: `js/player.js`（整文件替换）
- Modify: `tests/run_all.js`

- [ ] **Step 1: 写失败测试**

创建 `tests/test_physics.js`：

```js
// tests/test_physics.js — 参数化盒子物理：与 test_player 同口径 + 怪物尺寸用例
'use strict';
const assert = require('node:assert');
require('../js/blocks.js');
require('../shared/physics.js');
const P = globalThis.MyWorld.Physics;

// 模拟世界：y<10 全石头；x>=5 一堵墙
const flat = { getBlock: (x, y, z) => (y < 10 ? 3 : 0) };
const wall = { getBlock: (x, y, z) => (y < 10 || (x >= 5 && y < 30) ? 3 : 0) };
// 一格台阶：x>=5 处地面抬高到 y=11
const stepUp = { getBlock: (x, y, z) => (y < 10 || (x >= 5 && y < 11) ? 3 : 0) };

// 1) 重力下落停在地面（玩家尺寸）
{
  const b = P.createBody(0.5, 20, 0.5, 0.3, 1.8);
  for (let i = 0; i < 200; i++) P.step(b, flat, 1 / 60);
  assert.ok(Math.abs(b.y - 10) < 0.01, 'rests on ground, y=' + b.y);
  assert.strictEqual(b.onGround, true);
  assert.strictEqual(b.vy, 0);
}

// 2) 横向撞墙被挡（速度直接给在 body 上）
{
  const b = P.createBody(0.5, 10, 0.5, 0.3, 1.8);
  for (let i = 0; i < 300; i++) { b.vx = 4.5; b.vz = 0; P.step(b, wall, 1 / 60); }
  assert.ok(b.x < 5 - 0.29, 'blocked by wall, x=' + b.x);
  assert.ok(b.x > 4.5, 'got close, x=' + b.x);
}

// 3) 跳跃只在地面生效
{
  const b = P.createBody(0.5, 10, 0.5, 0.3, 1.8);
  P.step(b, flat, 1 / 60);
  assert.strictEqual(P.tryJump(b, 9), true, '地面起跳');
  assert.ok(b.vy > 0);
  assert.strictEqual(P.tryJump(b, 9), false, '空中不可二段跳');
}

// 4) 天花板顶住：y=12 有方块，1.8 高的身体最高到 10.2
{
  const w = { getBlock: (x, y, z) => (y < 10 || y === 12 ? 3 : 0) };
  const b = P.createBody(0.5, 10, 0.5, 0.3, 1.8);
  P.step(b, w, 1 / 60);
  P.tryJump(b, 9);
  let maxY = 10;
  for (let i = 0; i < 60; i++) { P.step(b, w, 1 / 60); maxY = Math.max(maxY, b.y); }
  assert.ok(maxY <= 12 - 1.8 + 0.01, 'ceiling blocks, max=' + maxY);
}

// 5) 尺寸参数化：0.7 高的小怪能钻进 1 格净空（y=11 处有天花板、地面 y=10）
{
  const gap = { getBlock: (x, y, z) => (y < 10 || (x >= 3 && y === 11) ? 3 : 0) };
  const slime = P.createBody(0.5, 10, 0.5, 0.35, 0.7);
  for (let i = 0; i < 300; i++) { slime.vx = 3; slime.vz = 0; P.step(slime, gap, 1 / 60); }
  assert.ok(slime.x > 4, '矮身体钻过 1 格净空, x=' + slime.x);
  const tall = P.createBody(0.5, 10, 0.5, 0.3, 1.8);
  for (let i = 0; i < 300; i++) { tall.vx = 3; tall.vz = 0; P.step(tall, gap, 1 / 60); }
  assert.ok(tall.x < 3, '高身体被 1 格净空挡住, x=' + tall.x);
}

// 6) blockedAhead：面前 1 格台阶可检出，平地与高墙区分
{
  const b = P.createBody(4.5, 10, 0.5, 0.3, 1.8);
  P.step(b, stepUp, 1 / 60);
  assert.strictEqual(P.blockedAhead(b, stepUp, 1, 0), true, '台阶挡路');
  assert.strictEqual(P.blockedAhead(b, flat, 1, 0), false, '平地无阻');
  const w = P.createBody(4.5, 10, 0.5, 0.3, 1.8);
  P.step(w, wall, 1 / 60);
  assert.strictEqual(P.blockedAhead(w, wall, 1, 0), true, '高墙也算挡路（跳不跳得上由物理决定）');
}

// 7) segmentHitsBox：线段与 AABB 相交
{
  const box = { x: 5, y: 10, z: 5, half: 0.5, height: 1 }; // 中心列 (5,5)，脚底 y=10
  assert.ok(P.segmentHitsBox(0, 10.5, 5, 10, 10.5, 5, box), '正穿过');
  assert.ok(!P.segmentHitsBox(0, 10.5, 7, 10, 10.5, 7, box), '旁边掠过');
  assert.ok(!P.segmentHitsBox(0, 12, 5, 10, 12, 5, box), '从头顶掠过');
  assert.ok(P.segmentHitsBox(5, 20, 5, 5, 5, 5, box), '竖直下穿');
  assert.ok(!P.segmentHitsBox(0, 10.5, 5, 4, 10.5, 5, box), '没够到');
}

// 8) 10Hz 服务器 tick 下自动跳上 1 格台阶（消费方回归：半隐式欧拉离散低估顶点，v=10 顶点 1.2 格）
{
  const b = P.createBody(4.0, 10, 0.5, 0.4, 0.9); // 恶狼尺寸
  for (let i = 0; i < 50; i++) {
    b.vx = 4.0; b.vz = 0;
    if (b.onGround && P.blockedAhead(b, stepUp, 1, 0)) P.tryJump(b, 10);
    P.step(b, stepUp, 0.1);
  }
  assert.ok(Math.abs(b.y - 11) < 0.05, '10Hz 下跳上台阶, y=' + b.y);
  assert.ok(b.x > 5, '站上台阶, x=' + b.x);
}

console.log('test_physics OK');
```

- [ ] **Step 2: 运行确认失败**

Run: `node tests/test_physics.js`
Expected: FAIL，`Cannot find module '../shared/physics.js'`

- [ ] **Step 3: 实现 shared/physics.js**

```js
// shared/physics.js — 两端共享：参数化盒子物理（玩家/怪物通用）
// 身体 = { x,y,z, vx,vy,vz, onGround, half, height }，原点在脚底中心
(function (root) {
  'use strict';
  const Blocks = root.MyWorld.Blocks;

  const GRAVITY = 30, MAX_FALL = 40;
  const EPS = 0.001;

  function createBody(x, y, z, half, height) {
    return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, half, height };
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

  function intersects(world, b) {
    return boxIntersectsSolid(world, b.x - b.half, b.y, b.z - b.half, b.x + b.half, b.y + b.height, b.z + b.half);
  }

  function moveAxis(b, world, axis, delta) {
    if (delta === 0) return;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.5));
    const step = delta / steps;
    for (let i = 0; i < steps; i++) {
      b[axis] += step;
      if (!intersects(world, b)) continue;
      // 撞上：贴面 + 清零该轴速度
      if (axis === 'y') {
        if (step < 0) { b.y = Math.floor(b.y) + 1 + EPS; b.vy = 0; b.onGround = true; }
        else { b.y = Math.ceil(b.y + b.height) - 1 - b.height - EPS; b.vy = 0; }
      } else if (axis === 'x') {
        if (step < 0) b.x = Math.floor(b.x - b.half) + 1 + b.half + EPS;
        else b.x = Math.ceil(b.x + b.half) - 1 - b.half - EPS;
        b.vx = 0;
      } else {
        if (step < 0) b.z = Math.floor(b.z - b.half) + 1 + b.half + EPS;
        else b.z = Math.ceil(b.z + b.half) - 1 - b.half - EPS;
        b.vz = 0;
      }
      break;
    }
  }

  // 一步物理：重力 + 三轴扫掠位移（水平速度由调用方在 step 前设置）
  function step(b, world, dt) {
    b.vy -= GRAVITY * dt;
    if (b.vy < -MAX_FALL) b.vy = -MAX_FALL;
    b.onGround = false;
    moveAxis(b, world, 'y', b.vy * dt);
    moveAxis(b, world, 'x', b.vx * dt);
    moveAxis(b, world, 'z', b.vz * dt);
  }

  // 仅在地面时起跳；返回是否跳了
  function tryJump(b, v) {
    if (!b.onGround) return false;
    b.vy = v;
    b.onGround = false;
    return true;
  }

  // 前方脚边是否有实心方块挡路（怪物自动跳台阶用）：取移动方向上身体边缘外 1 格、脚踝高度处的方块
  function blockedAhead(b, world, dirx, dirz) {
    const len = Math.hypot(dirx, dirz);
    if (len === 0) return false;
    const px = b.x + (dirx / len) * (b.half + 1);
    const pz = b.z + (dirz / len) * (b.half + 1);
    return Blocks.isSolid(world.getBlock(Math.floor(px), Math.floor(b.y + 0.1), Math.floor(pz)));
  }

  // 线段与实体盒相交（slab 法）；box = { x,y,z(脚底中心), half, height }
  function segmentHitsBox(x0, y0, z0, x1, y1, z1, box) {
    const minx = box.x - box.half, maxx = box.x + box.half;
    const miny = box.y, maxy = box.y + box.height;
    const minz = box.z - box.half, maxz = box.z + box.half;
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    let t0 = 0, t1 = 1;
    const axes = [[x0, dx, minx, maxx], [y0, dy, miny, maxy], [z0, dz, minz, maxz]];
    for (const [o, d, lo, hi] of axes) {
      if (d === 0) { if (o < lo || o > hi) return false; continue; }
      let a = (lo - o) / d, b2 = (hi - o) / d;
      if (a > b2) { const t = a; a = b2; b2 = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b2);
      if (t0 > t1) return false;
    }
    return true;
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Physics = { GRAVITY, MAX_FALL, createBody, step, tryJump, blockedAhead, segmentHitsBox, intersects };
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: 运行确认通过**

Run: `node tests/test_physics.js`
Expected: `test_physics OK`

- [ ] **Step 5: 重构 js/player.js 为 Physics 门面（整文件替换）**

公开 API 与字段保持不变（`create/update/HALF/HEIGHT/EYE`，对象含 `x,y,z,vx,vy,vz,yaw,pitch,onGround`），test_player 与 main.js 零改动：

```js
// js/player.js — 玩家：输入→速度/跳跃，物理委托 shared/physics.js
(function (root) {
  'use strict';
  const Physics = root.MyWorld.Physics;

  const HALF = 0.3, HEIGHT = 1.8, EYE = 1.62;
  const SPEED = 4.5, JUMP_V = 9;

  function create(x, y, z) {
    const b = Physics.createBody(x, y, z, HALF, HEIGHT);
    b.yaw = 0; b.pitch = 0;
    return b;
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

    if (input.jump) Physics.tryJump(p, JUMP_V);
    Physics.step(p, world, dt);
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Player = { create, update, HALF, HEIGHT, EYE, SPEED };
})(typeof self !== 'undefined' ? self : globalThis);
```

注意：`tests/test_player.js` 顶部需要补一行依赖（physics 在 player 之前加载）。把

```js
require('../js/blocks.js');
require('../js/player.js');
```

改为：

```js
require('../js/blocks.js');
require('../shared/physics.js');
require('../js/player.js');
```

- [ ] **Step 6: 注册 run_all 并全量回归**

`tests/run_all.js` 数组在 `'test_stats.js'` 后追加 `'test_physics.js'`。

Run: `node tests/run_all.js`
Expected: `ALL TESTS PASSED`（test_player 必须仍然全过——这是提取的回归保证）

- [ ] **Step 7: 提交**

```bash
git add shared/physics.js tests/test_physics.js js/player.js tests/test_player.js tests/run_all.js
git commit -m "feat: 物理提取为共享模块（尺寸参数化），player 改为门面"
```

---

### Task 3: shared/mobs_def.js — 怪物定义/地带/营地/AI（TDD）

**Files:**
- Create: `shared/mobs_def.js`
- Test: `tests/test_mobs.js`
- Modify: `tests/run_all.js`

- [ ] **Step 1: 写失败测试**

创建 `tests/test_mobs.js`：

```js
// tests/test_mobs.js — 地带判定、数值缩放、营地确定性散布、AI 状态机
'use strict';
const assert = require('node:assert');
require('../shared/mobs_def.js');
const M = globalThis.MyWorld.MobsDef;

// 地带：d<60 安全区
assert.strictEqual(M.zoneOf(0), null);
assert.strictEqual(M.zoneOf(59.9), null);
assert.strictEqual(M.zoneOf(60).type, 'slime');
assert.strictEqual(M.zoneOf(149).type, 'slime');
assert.strictEqual(M.zoneOf(150).type, 'zombie');
assert.strictEqual(M.zoneOf(300).type, 'skeleton');
assert.strictEqual(M.zoneOf(500).type, 'wolf');
assert.strictEqual(M.zoneOf(99999).type, 'wolf');

// 数值缩放：每比地带基准高 1 级 ×1.1 复利向下取整
const s1 = M.mobStats('slime', 1);
assert.deepStrictEqual([s1.hp, s1.dmg, s1.xp], [12, 1, 8], '基准值');
const s3 = M.mobStats('slime', 3);
assert.strictEqual(s3.hp, Math.floor(12 * 1.1 * 1.1), '高 2 级复利');
const w10 = M.mobStats('wolf', 10);
assert.deepStrictEqual([w10.hp, w10.dmg, w10.xp], [35, 5, 40], 'wolf 基准 10 级');

// 营地散布：确定性 + 约 15% 密度 + 安全区无营地
{
  const a = M.campAt(12345, 10, 10);
  const b = M.campAt(12345, 10, 10);
  assert.deepStrictEqual(a, b, '同种子同区块结果一致');
  const c = M.campAt(54321, 10, 10);
  // 不同种子允许不同（不强断言内容，只要求确定性不抛错）
  assert.ok(c === null || typeof c.x === 'number');
  assert.strictEqual(M.campAt(12345, 0, 0), null, '出生区块在安全区，无营地');
  let n = 0, total = 0;
  for (let cx = 5; cx < 45; cx++) for (let cz = 5; cz < 45; cz++) {
    total++;
    const camp = M.campAt(777, cx, cz);
    if (camp) {
      n++;
      assert.ok(camp.count >= 3 && camp.count <= 5, '3~5 只');
      const zone = M.zoneOf(Math.hypot(camp.x - M.SPAWN_X, camp.z - M.SPAWN_Z));
      assert.ok(zone && zone.type === camp.type, '营地类型与地带一致');
      assert.strictEqual(camp.levels.length, camp.count);
      for (const lv of camp.levels) assert.ok(lv >= zone.lvMin && lv <= zone.lvMax, '等级在地带范围内');
    }
  }
  const ratio = n / total;
  assert.ok(ratio > 0.08 && ratio < 0.25, '密度约 15%，实测 ' + ratio.toFixed(3));
}

// campsNear：扫描方圆 N 区块
{
  const list = M.campsNear(777, 8.5, 8.5, 20);
  assert.ok(Array.isArray(list));
  // 地带按区块中心判定，营地列在块内最多偏移 ~11 格，故下限放宽到 48
  for (const c of list) assert.ok(Math.hypot(c.x - 8.5, c.z - 8.5) >= 48, '都在安全区外（含列偏移余量）');
}

// AI 状态机
const T = M.TYPES;
function mk(state) { return { type: 'zombie', state, aggroPid: null, hp: 25 }; }
// 主动怪：玩家进视野 → chase
{
  const r = M.aiStep(mk('idle'), { nearest: { dist: 8, pid: 1 }, campDist: 2 }, 0);
  assert.strictEqual(r.state, 'chase');
}
// 视野外不追
{
  const r = M.aiStep(mk('idle'), { nearest: { dist: 20, pid: 1 }, campDist: 2 }, 0);
  assert.strictEqual(r.state, 'idle');
}
// 被动怪（史莱姆）：未被打不追
{
  const m = { type: 'slime', state: 'idle', aggroPid: null, hp: 12 };
  const r = M.aiStep(m, { nearest: { dist: 3, pid: 1 }, campDist: 2 }, 0);
  assert.strictEqual(r.state, 'idle');
  m.aggroPid = 1; // 被打过
  const r2 = M.aiStep(m, { nearest: { dist: 3, pid: 1 }, campDist: 2 }, 0);
  assert.strictEqual(r2.state, 'chase');
}
// 追击超 24 格脱战回巢；回巢到家转 idle 并标记治疗
{
  const r = M.aiStep(mk('chase'), { nearest: { dist: 3, pid: 1 }, campDist: 25 }, 0);
  assert.strictEqual(r.state, 'return');
  const r2 = M.aiStep(mk('return'), { nearest: { dist: 3, pid: 1 }, campDist: 1 }, 0);
  assert.strictEqual(r2.state, 'idle');
  assert.strictEqual(r2.healed, true);
  const r3 = M.aiStep(mk('return'), { nearest: null, campDist: 10 }, 0);
  assert.strictEqual(r3.state, 'return', '回巢途中保持回巢');
}
// 近战怪贴身出攻击意图
{
  const r = M.aiStep(mk('chase'), { nearest: { dist: 1.2, pid: 7 }, campDist: 5 }, 0);
  assert.strictEqual(r.state, 'chase');
  assert.strictEqual(r.attackPid, 7);
}
// 骷髅：保持 8~14 格——太近后退、区间内射箭、太远接近
{
  const sk = { type: 'skeleton', state: 'chase', aggroPid: null, hp: 20 };
  const near = M.aiStep(sk, { nearest: { dist: 5, pid: 2 }, campDist: 5 }, 0);
  assert.strictEqual(near.retreat, true, '太近后退');
  const mid = M.aiStep(sk, { nearest: { dist: 10, pid: 2 }, campDist: 5 }, 0);
  assert.strictEqual(mid.shootPid, 2, '区间内射箭');
  assert.ok(!mid.retreat);
  const far = M.aiStep(sk, { nearest: { dist: 15, pid: 2 }, campDist: 5 }, 0);
  assert.ok(!far.shootPid && !far.retreat, '太远只接近');
}
// 追击目标消失（死亡/离线/出兴趣）→ 回巢
{
  const r = M.aiStep(mk('chase'), { nearest: null, campDist: 5 }, 0);
  assert.strictEqual(r.state, 'return');
}

console.log('test_mobs OK');
```

- [ ] **Step 2: 运行确认失败**

Run: `node tests/test_mobs.js`
Expected: FAIL，`Cannot find module '../shared/mobs_def.js'`

- [ ] **Step 3: 实现 shared/mobs_def.js**

```js
// shared/mobs_def.js — 两端共享：怪物模板、等级地带、营地确定性散布、AI 状态机（纯函数）
(function (root) {
  'use strict';

  // 出生点（与 server/world_do.js 的 SPAWN 一致，服务器直接引用本处常量）
  const SPAWN_X = 8.5, SPAWN_Z = 8.5;

  // 怪物模板：基准数值为各地带最低等级（speed 以玩家 4.5 为基准倍率换算）
  const TYPES = {
    slime:    { name: '史莱姆',   hp: 12, dmg: 1, speed: 0.7 * 4.5, xp: 8,  aggressive: false, ranged: false, atkRange: 1.5, atkCdMs: 1000, sight: 12, half: 0.35, height: 0.7 },
    zombie:   { name: '僵尸',     hp: 25, dmg: 2, speed: 0.8 * 4.5, xp: 15, aggressive: true,  ranged: false, atkRange: 1.5, atkCdMs: 1000, sight: 12, half: 0.3,  height: 1.8 },
    skeleton: { name: '骷髅弓手', hp: 20, dmg: 3, speed: 0.8 * 4.5, xp: 25, aggressive: true,  ranged: true,  atkRange: 14,  atkCdMs: 2000, sight: 16, half: 0.3,  height: 1.8, keepMin: 8, keepMax: 14 },
    wolf:     { name: '恶狼',     hp: 35, dmg: 5, speed: 1.3 * 4.5, xp: 40, aggressive: true,  ranged: false, atkRange: 1.5, atkCdMs: 1000, sight: 14, half: 0.4,  height: 0.9 },
  };

  // 等级地带（按离出生点水平距离）；d<60 安全区不刷怪
  const ZONES = [
    { min: 60,  max: 150,      type: 'slime',    lvMin: 1,  lvMax: 3 },
    { min: 150, max: 300,      type: 'zombie',   lvMin: 4,  lvMax: 6 },
    { min: 300, max: 500,      type: 'skeleton', lvMin: 7,  lvMax: 9 },
    { min: 500, max: Infinity, type: 'wolf',     lvMin: 10, lvMax: 12 },
  ];

  function zoneOf(d) {
    for (const z of ZONES) if (d >= z.min && d < z.max) return z;
    return null;
  }

  function zoneOfType(type) {
    for (const z of ZONES) if (z.type === type) return z;
    return null;
  }

  // 数值缩放：每比地带基准高 1 级，HP/伤害/经验 ×1.1（复利，向下取整）
  function mobStats(type, lv) {
    const t = TYPES[type];
    const base = zoneOfType(type).lvMin;
    const m = Math.pow(1.1, lv - base);
    return { hp: Math.floor(t.hp * m), dmg: Math.floor(t.dmg * m), xp: Math.floor(t.xp * m) };
  }

  // 32 位整数哈希（与世界种子组合，营地散布专用）
  function hash3(seed, a, b) {
    let h = (seed ^ (a * 0x9e3779b1) ^ (b * 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  // 区块 (ccx,ccz) 是否有营地：约 15% 概率；中心列/数量/各怪等级全部由哈希确定
  function campAt(seed, ccx, ccz) {
    const centerD = Math.hypot(ccx * 16 + 8 - SPAWN_X, ccz * 16 + 8 - SPAWN_Z);
    const zone = zoneOf(centerD);
    if (!zone) return null;
    const h = hash3(seed, ccx, ccz);
    if (h % 100 >= 15) return null;
    const lx = (h >>> 8) % 16, lz = (h >>> 12) % 16;
    const count = 3 + ((h >>> 16) % 3);
    const span = zone.lvMax - zone.lvMin + 1;
    const levels = [];
    for (let i = 0; i < count; i++) {
      levels.push(zone.lvMin + (hash3(seed, ccx * 31 + i + 1, ccz * 17 - i - 1) % span));
    }
    return { ccx, ccz, x: ccx * 16 + lx + 0.5, z: ccz * 16 + lz + 0.5, type: zone.type, count, levels };
  }

  // 扫描 (x,z) 周围 radiusChunks 半径内的全部营地
  function campsNear(seed, x, z, radiusChunks) {
    const pcx = Math.floor(x / 16), pcz = Math.floor(z / 16);
    const out = [];
    for (let cx = pcx - radiusChunks; cx <= pcx + radiusChunks; cx++) {
      for (let cz = pcz - radiusChunks; cz <= pcz + radiusChunks; cz++) {
        const c = campAt(seed, cx, cz);
        if (c) out.push(c);
      }
    }
    return out;
  }

  const LEASH = 24;       // 追击离营地超过即脱战回巢
  const WANDER_R = 8;     // 游走半径
  const HOME_EPS = 1.5;   // 回巢判定半径

  // AI 决策纯函数：输入怪物（type/state/aggroPid/hp）与环境，输出下一状态与意图。
  // env = { nearest: {dist,pid}|null（兴趣内最近存活玩家）, campDist: 怪物到营地水平距离 }
  // 返回 { state, attackPid?, shootPid?, retreat?, healed? }；位移目标由服务器按 state 取（chase→玩家，return→营地，idle→游走点）
  function aiStep(mob, env, now) {
    const t = TYPES[mob.type];
    const n = env.nearest;
    if (mob.state === 'return') {
      if (env.campDist <= HOME_EPS) return { state: 'idle', healed: true };
      return { state: 'return' };
    }
    if (mob.state === 'chase') {
      if (!n) return { state: 'return' };
      if (env.campDist > LEASH) return { state: 'return' };
      if (t.ranged) {
        if (n.dist < t.keepMin) return { state: 'chase', retreat: true };
        if (n.dist <= t.keepMax) return { state: 'chase', shootPid: n.pid };
        return { state: 'chase' };
      }
      if (n.dist <= t.atkRange) return { state: 'chase', attackPid: n.pid };
      return { state: 'chase' };
    }
    // idle/游走：主动怪见人即追；被动怪被打过（aggroPid）才追
    if (n && ((t.aggressive && n.dist <= t.sight) || (mob.aggroPid != null && n.dist <= t.sight * 2))) {
      return { state: 'chase' };
    }
    return { state: 'idle' };
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.MobsDef = {
    SPAWN_X, SPAWN_Z, TYPES, ZONES, LEASH, WANDER_R, HOME_EPS,
    zoneOf, zoneOfType, mobStats, campAt, campsNear, aiStep,
  };
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: 运行确认通过**

Run: `node tests/test_mobs.js`
Expected: `test_mobs OK`

- [ ] **Step 5: 注册 run_all 并全量回归**

`tests/run_all.js` 数组在 `'test_physics.js'` 后追加 `'test_mobs.js'`。

Run: `node tests/run_all.js`
Expected: `ALL TESTS PASSED`

- [ ] **Step 6: 提交**

```bash
git add shared/mobs_def.js tests/test_mobs.js tests/run_all.js
git commit -m "feat: 怪物定义模块（模板/地带/缩放/营地散布/AI 状态机）"
```

---

### Task 4: shared/protocol.js — 战斗常量与校验（TDD）

**Files:**
- Modify: `shared/protocol.js`
- Modify: `tests/test_protocol.js`

- [ ] **Step 1: 追加失败测试**

`tests/test_protocol.js` 在 `console.log('test_protocol OK');` 之前插入：

```js
// 战斗常量存在性
assert.strictEqual(P.MELEE_RANGE, 3.5);
assert.strictEqual(P.MELEE_CD_MS, 500);
assert.strictEqual(P.BOW_CD_MS, 1000);
assert.strictEqual(P.ARROW_SPEED, 30);
assert.strictEqual(P.ARROW_GRAVITY, 18); // 两端独立积分弹道，必须锁值
assert.strictEqual(P.ARROW_LIFE_MS, 5000);
assert.strictEqual(P.INVULN_MS, 500);
assert.strictEqual(P.REGEN_DELAY_MS, 5000);
assert.strictEqual(P.DEATH_RESPAWN_MS, 3000);
assert.strictEqual(P.MOB_TICK_MS, 100);
assert.strictEqual(P.CAMP_ACTIVE_CHUNKS, 5);
assert.strictEqual(P.KNOCKBACK_H, 6);
assert.strictEqual(P.KNOCKBACK_V, 3);

// validAttack：id 必须是非空短字符串
assert.ok(P.validAttack({ id: '3_4_0' }));
assert.ok(!P.validAttack({ id: '' }));
assert.ok(!P.validAttack({ id: 123 }));
assert.ok(P.validAttack({ id: 'x'.repeat(24) }), '24 字上界放行');
assert.ok(!P.validAttack({ id: 'x'.repeat(25) }), '25 字越界拒绝');
assert.ok(!P.validAttack({ id: 'x'.repeat(40) }));
assert.ok(!P.validAttack(null));

// validShoot：方向有限且非零
assert.ok(P.validShoot({ dx: 1, dy: 0, dz: 0 }));
assert.ok(P.validShoot({ dx: 0.3, dy: -0.5, dz: 0.8 }));
assert.ok(!P.validShoot({ dx: 0, dy: 0, dz: 0 }));
assert.ok(!P.validShoot({ dx: NaN, dy: 0, dz: 1 }));
assert.ok(!P.validShoot(null));
```

- [ ] **Step 2: 运行确认失败**

Run: `node tests/test_protocol.js`
Expected: FAIL（MELEE_RANGE undefined）

- [ ] **Step 3: 实现**

`shared/protocol.js` 在 `const VALID_BLOCK_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8];` 之后插入：

```js
  // —— M2 战斗常量 ——
  const MELEE_RANGE = 3.5;          // 剑射程（格）
  const MELEE_CD_MS = 500;          // 剑冷却
  const BOW_CD_MS = 1000;           // 弓冷却
  const ARROW_SPEED = 30;           // 箭初速（格/秒）
  const ARROW_GRAVITY = 18;         // 箭重力（弱于实体重力，弹道更平）
  const ARROW_LIFE_MS = 5000;       // 箭最长存活
  const INVULN_MS = 500;            // 玩家受击无敌
  const REGEN_DELAY_MS = 5000;      // 脱战回血延迟
  const DEATH_RESPAWN_MS = 3000;    // 死亡到复活
  const MOB_TICK_MS = 100;          // 服务器游戏 tick
  const CAMP_ACTIVE_CHUNKS = 5;     // 营地激活半径（区块）
  const KNOCKBACK_H = 6, KNOCKBACK_V = 3; // 近战击退冲量
```

在 `function backoffMs(attempt)` 整个函数之后插入：

```js
  // 近战意图校验：mobId 为非空短字符串
  function validAttack(msg) {
    return !!(msg && typeof msg.id === 'string' && msg.id.length > 0 && msg.id.length <= 24);
  }

  // 射箭意图校验：方向分量有限且模非零（服务器自行归一化）
  function validShoot(msg) {
    if (!msg || !isFinite(msg.dx) || !isFinite(msg.dy) || !isFinite(msg.dz)) return false;
    return Math.hypot(msg.dx, msg.dy, msg.dz) > 1e-6;
  }
```

导出对象 `root.MyWorld.Protocol = { ... }` 改为（在原导出列表上追加新名字）：

```js
  root.MyWorld.Protocol = {
    INTEREST_CHUNKS, REACH, REACH_SLACK, MAX_HSPEED, MAX_VSPEED,
    MOVE_INTERVAL_MS, PERSIST_INTERVAL_MS, VALID_BLOCK_IDS,
    MELEE_RANGE, MELEE_CD_MS, BOW_CD_MS, ARROW_SPEED, ARROW_GRAVITY, ARROW_LIFE_MS,
    INVULN_MS, REGEN_DELAY_MS, DEATH_RESPAWN_MS, MOB_TICK_MS, CAMP_ACTIVE_CHUNKS,
    KNOCKBACK_H, KNOCKBACK_V,
    inInterest, validEdit, clampMove, sanitizeName, backoffMs, validAttack, validShoot,
  };
```

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `node tests/test_protocol.js` → `test_protocol OK`
Run: `node tests/run_all.js` → `ALL TESTS PASSED`

- [ ] **Step 5: 提交**

```bash
git add shared/protocol.js tests/test_protocol.js
git commit -m "feat: 协议补战斗常量与 attack/shoot 校验"
```

---

### Task 5: WorldDO 怪物模拟（营地激活/AI tick/兴趣同步）

**Files:**
- Modify: `server/world_do.js`
- Create: `tests/manual/mobs_probe.js`

- [ ] **Step 1: 加导入与状态**

`server/world_do.js` 顶部导入区改为（新增三行 import，保持原有的不动）：

```js
import '../js/noise.js';
import '../js/blocks.js';
import '../js/world.js';
import '../shared/protocol.js';
import '../shared/physics.js';
import '../shared/stats.js';
import '../shared/mobs_def.js';
```

> 注意：M1 的导入里没有 `../js/blocks.js`（world.js 自身不依赖它），但 physics.js 需要 `Blocks.isSolid`，必须在 physics 之前导入。

模块常量区把

```js
const MW = globalThis.MyWorld;
const World = MW.World, P = MW.Protocol;

const SPAWN_X = 8.5, SPAWN_Z = 8.5;
```

改为：

```js
const MW = globalThis.MyWorld;
const World = MW.World, P = MW.Protocol;
const Physics = MW.Physics, Stats = MW.Stats, MobsDef = MW.MobsDef;

const SPAWN_X = MobsDef.SPAWN_X, SPAWN_Z = MobsDef.SPAWN_Z;
```

构造函数 `this.nextPid = 1;` 之后插入：

```js
    // —— M2 怪物运行时状态（不持久化：DO 重启/休眠即重置，有意设计）——
    this.mobs = new Map();        // mobId -> mob
    this.activeCamps = new Map(); // campKey "ccx_ccz" -> { camp, mobIds: [] }
    this.arrows = new Map();      // arrowId -> arrow
    this.nextArrowId = 1;
    this.tickTimer = null;
    this.idleTicks = 0;
```

- [ ] **Step 2: 实现怪物模拟方法**

在 `// --- 断开 ---` 注释（`dropSession` 之前）插入以下整段：

```js
  // ====== M2 怪物模拟 ======

  // 有事可做就保证 tick 在跑；空转 5 秒自停（允许 DO 休眠）
  ensureTick() {
    this.idleTicks = 0;
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), P.MOB_TICK_MS);
  }

  stopTick() {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
  }

  campKey(c) { return c.ccx + '_' + c.ccz; }
  mobId(c, slot) { return c.ccx + '_' + c.ccz + '_' + slot; }

  // 营地激活扫描：有玩家在 5 区块内 → 激活并生成怪；超出保持半径 → 整体移除（再激活全量重生）
  scanCamps() {
    const want = new Map(); // 激活集（5 区块）
    const keep = new Set(); // 保持集（6 区块滞回：防玩家在边界来回导致整营反复重生）
    for (const s of this.sessions.values()) {
      if (s.dead) continue;
      for (const c of MobsDef.campsNear(this.seed, s.x, s.z, P.CAMP_ACTIVE_CHUNKS)) {
        want.set(this.campKey(c), c);
      }
      for (const c of MobsDef.campsNear(this.seed, s.x, s.z, P.CAMP_ACTIVE_CHUNKS + 1)) {
        keep.add(this.campKey(c));
      }
    }
    for (const [key, c] of want) {
      if (!this.activeCamps.has(key)) this.activateCamp(key, c);
    }
    for (const [key, entry] of Array.from(this.activeCamps)) {
      if (!keep.has(key)) this.deactivateCamp(key, entry);
    }
  }

  activateCamp(key, c) {
    // 预生成营地周围 5×5 区块（怪物物理与落点需要真实地形；服务器区块永不淘汰）。
    // 注意：首次激活同步生成 25 区块会让该 tick 顿一下——一次性成本、永不重复，M2 接受
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        this.world.ensureChunk(c.ccx + dx, c.ccz + dz);
    const entry = { camp: c, mobIds: [] };
    for (let i = 0; i < c.count; i++) {
      const id = this.mobId(c, i);
      const t = MobsDef.TYPES[c.type];
      const st = MobsDef.mobStats(c.type, c.levels[i]);
      const ang = (i / c.count) * Math.PI * 2;
      const mx = c.x + Math.cos(ang) * 2, mz = c.z + Math.sin(ang) * 2;
      // 落点高度按各怪所在列取地表：坡地上用营地中心高度会嵌墙/悬空
      const my = this.world.terrainHeight(Math.floor(mx), Math.floor(mz)) + 1;
      const mob = Physics.createBody(mx, my, mz, t.half, t.height);
      Object.assign(mob, {
        id, type: c.type, lv: c.levels[i], hp: st.hp, maxHp: st.hp, dmg: st.dmg, xp: st.xp,
        speed: t.speed, yaw: 0, state: 'idle', aggroPid: null, atkReadyAt: 0,
        dead: false, respawnAt: 0, wanderUntil: 0, tx: c.x, tz: c.z, campX: c.x, campZ: c.z, key,
      });
      this.mobs.set(id, mob);
      entry.mobIds.push(id);
      this.broadcastMob(mob, this.mobSpawnMsg(mob));
    }
    this.activeCamps.set(key, entry);
  }

  deactivateCamp(key, entry) {
    for (const id of entry.mobIds) {
      const mob = this.mobs.get(id);
      if (mob && !mob.dead) this.broadcastMob(mob, { t: 'mobDespawn', id });
      this.mobs.delete(id);
    }
    this.activeCamps.delete(key);
  }

  mobSpawnMsg(m) {
    return { t: 'mobSpawn', id: m.id, type: m.type, lv: m.lv, x: m.x, y: m.y, z: m.z, hp: m.hp, maxHp: m.maxHp };
  }

  // 给兴趣范围内的玩家广播怪物事件
  broadcastMob(mob, msg) {
    for (const [ws, s] of this.sessions) {
      if (P.inInterest(mob.x, mob.z, s.x, s.z)) this.send(ws, msg);
    }
  }

  // 兴趣内最近的存活玩家
  nearestPlayer(mob) {
    let best = null;
    for (const s of this.sessions.values()) {
      if (s.dead) continue;
      const d = Math.hypot(s.x - mob.x, s.z - mob.z);
      if (d <= MobsDef.TYPES[mob.type].sight * 2 + 8 && (!best || d < best.dist)) {
        best = { dist: d, pid: s.pid, x: s.x, y: s.y, z: s.z, session: s };
      }
    }
    return best;
  }

  sessionByPid(pid) {
    for (const [ws, s] of this.sessions) if (s.pid === pid) return [ws, s];
    return [null, null];
  }

  tick() {
    const now = Date.now();
    let busy = false;
    this.tickN = (this.tickN || 0) + 1;
    if (this.tickN % 10 === 1) this.scanCamps(); // 1Hz 扫描激活
    for (const mob of this.mobs.values()) {
      busy = true;
      this.tickMob(mob, now);
    }
    this.tickArrows(now);
    if (this.arrows.size > 0) busy = true;
    busy = this.tickPlayers(now) || busy;
    if (busy) this.idleTicks = 0;
    else if (++this.idleTicks > 50) this.stopTick(); // 空转 5 秒自停
  }

  tickMob(mob, now) {
    const dt = P.MOB_TICK_MS / 1000;
    // 死亡：到点原地重生（满血、回营地落点）
    if (mob.dead) {
      if (now >= mob.respawnAt) {
        const st = MobsDef.mobStats(mob.type, mob.lv);
        mob.hp = st.hp; mob.dead = false; mob.state = 'idle'; mob.aggroPid = null;
        mob.x = mob.campX; mob.z = mob.campZ;
        mob.y = this.world.terrainHeight(Math.floor(mob.x), Math.floor(mob.z)) + 1;
        mob.vx = mob.vy = mob.vz = 0;
        this.broadcastMob(mob, this.mobSpawnMsg(mob));
      }
      return;
    }
    const near = this.nearestPlayer(mob);
    const campDist = Math.hypot(mob.x - mob.campX, mob.z - mob.campZ);
    const r = MobsDef.aiStep(mob, { nearest: near ? { dist: near.dist, pid: near.pid } : null, campDist }, now);
    mob.state = r.state;
    if (r.healed) { mob.hp = mob.maxHp; mob.aggroPid = null; }

    // 位移目标
    let tx = null, tz = null, speedMul = 1;
    if (r.state === 'return') { tx = mob.campX; tz = mob.campZ; }
    else if (r.state === 'chase' && near) {
      if (r.retreat) { tx = mob.x + (mob.x - near.x); tz = mob.z + (mob.z - near.z); } // 反向远离
      else if (!r.shootPid && !r.attackPid) { tx = near.x; tz = near.z; }
    } else if (r.state === 'idle') {
      // 游走：到期换营地 8 格内随机点
      if (now >= mob.wanderUntil) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * MobsDef.WANDER_R;
        mob.tx = mob.campX + Math.cos(a) * rr; mob.tz = mob.campZ + Math.sin(a) * rr;
        mob.wanderUntil = now + 2000 + Math.random() * 2000;
      }
      if (Math.hypot(mob.tx - mob.x, mob.tz - mob.z) > 0.8) { tx = mob.tx; tz = mob.tz; speedMul = 0.5; }
    }

    // 速度与跳跃
    if (tx != null) {
      const dx = tx - mob.x, dz = tz - mob.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.05) {
        const sp = mob.speed * speedMul;
        mob.vx = dx / len * sp; mob.vz = dz / len * sp;
        mob.yaw = Math.atan2(-mob.vx, -mob.vz);
        // 10Hz tick 下半隐式欧拉对跳跃顶点有离散低估：v=9 顶点仅 0.9 格跳不上台阶，取 10（顶点 1.2 格）
        if (mob.onGround && Physics.blockedAhead(mob, this.world, dx, dz)) Physics.tryJump(mob, 10);
        if (mob.type === 'slime' && mob.onGround) Physics.tryJump(mob, 5); // 史莱姆弹跳移动（纯观感，不用于爬台阶）
      } else { mob.vx = 0; mob.vz = 0; }
    } else { mob.vx = 0; mob.vz = 0; }

    const px = mob.x, py = mob.y, pz = mob.z;
    Physics.step(mob, this.world, dt);
    // 掉出世界兜底：传回营地
    if (mob.y < -10) {
      mob.x = mob.campX; mob.z = mob.campZ;
      mob.y = this.world.terrainHeight(Math.floor(mob.x), Math.floor(mob.z)) + 1;
      mob.vx = mob.vy = mob.vz = 0;
    }

    // 攻击意图（回巢途中无敌不攻击；伤害结算在 Task 6 接入 damagePlayer）
    if (r.attackPid != null && now >= mob.atkReadyAt) {
      mob.atkReadyAt = now + MobsDef.TYPES[mob.type].atkCdMs;
      const [, victim] = this.sessionByPid(r.attackPid);
      if (victim) this.damagePlayer(victim, mob.dmg, now);
    }
    if (r.shootPid != null && now >= mob.atkReadyAt) {
      mob.atkReadyAt = now + MobsDef.TYPES[mob.type].atkCdMs;
      const [, victim] = this.sessionByPid(r.shootPid);
      if (victim) this.spawnArrow(mob.x, mob.y + mob.height * 0.8, mob.z,
        victim.x - mob.x, victim.y + 1.4 - (mob.y + mob.height * 0.8), victim.z - mob.z, 0, mob.dmg);
    }

    // 位置广播（有移动才发）
    if (Math.abs(mob.x - px) + Math.abs(mob.y - py) + Math.abs(mob.z - pz) > 0.001) {
      this.broadcastMob(mob, { t: 'mobMove', id: mob.id, x: mob.x, y: mob.y, z: mob.z, yaw: mob.yaw });
    }
  }
```

> `damagePlayer` / `spawnArrow` / `tickArrows` / `tickPlayers` 在 Task 6 实现。**本任务为了让模块可加载**，先在同一段末尾追加四个占位方法（Task 6 整体替换它们）：

```js
  // Task 6 实现：先放空壳保证可运行
  damagePlayer(victim, dmg, now) {}
  spawnArrow(x, y, z, dx, dy, dz, ownerPid, dmg) {}
  tickArrows(now) {}
  tickPlayers(now) { return false; }
```

- [ ] **Step 3: 接通触发点与 welcome**

`onHello` 中 `this.send(ws, { t: 'welcome', ... })` 一行改为（追加 hp/maxHp/mobs 字段；hp 取值在 Task 6 接入 DB，本任务先用满血常量）：

```js
    const mobs = [];
    for (const m of this.mobs.values()) {
      if (!m.dead && P.inInterest(m.x, m.z, s.x, s.z)) mobs.push(this.mobSpawnMsg(m));
    }
    this.send(ws, { t: 'welcome', pid: s.pid, seed: this.seed, x: s.x, y: s.y, z: s.z, edits, players, online: this.sessions.size, hp: 20, maxHp: 20, mobs });
```

`onHello` 末尾 `this.ctx.storage.setAlarm(...)` 之后加一行：

```js
    this.ensureTick();
```

`onMove` 末尾 `this.syncVisibility(ws, s);` 之后加一行：

```js
    this.ensureTick(); // 玩家移动可能令新营地进入激活半径
```

`boot()` 末尾（持久化 alarm 续约行 `if (this.sessions.size > 0) this.ctx.storage.setAlarm(...)` 之后）加：

```js
    // 休眠唤醒后若恢复了会话，立即恢复游戏 tick（否则纯挂机客户端旁的营地不会复活）
    if (this.sessions.size > 0) this.ensureTick();
```

> 注意：怪物的 mobSpawn/mobMove 按"玩家当前位置是否在兴趣内"逐 tick 判定即可，玩家移动导致的怪物进出兴趣不必精确维护进出事件——客户端对未知 id 的 mobMove 静默忽略、对重复 mobSpawn 走 upsert（Task 8 实现），自然收敛。

- [ ] **Step 4: 语法检查 + 回归**

Run: `node --check server/world_do.js` → 无输出
Run: `node tests/run_all.js` → `ALL TESTS PASSED`

- [ ] **Step 5: 创建怪物观察探针 tests/manual/mobs_probe.js**

```js
// tests/manual/mobs_probe.js — 走到最近史莱姆营地，观察 mobSpawn/mobMove
// 先启动: npx wrangler dev --port 8787 --persist-to ../cc-myworld-state
// 运行: node tests/manual/mobs_probe.js
'use strict';
const assert = require('node:assert');
require('../../shared/mobs_def.js');
const MobsDef = globalThis.MyWorld.MobsDef;
const URL_WS = process.argv[2] || 'ws://127.0.0.1:8787/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tok() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

(async () => {
  const ws = new WebSocket(URL_WS);
  const seen = { spawn: [], move: 0 };
  let welcome = null;
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') welcome = m;
    else if (m.t === 'mobSpawn') seen.spawn.push(m);
    else if (m.t === 'mobMove') seen.move++;
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('连不上，dev 在跑吗'))); });
  ws.send(JSON.stringify({ t: 'hello', token: tok(), name: '探针' }));
  while (!welcome) await sleep(50);

  // 用种子推算最近的史莱姆营地（与服务器同一纯函数）
  const camps = MobsDef.campsNear(welcome.seed, welcome.x, welcome.z, 12)
    .filter((c) => c.type === 'slime')
    .sort((a, b) => Math.hypot(a.x - welcome.x, a.z - welcome.z) - Math.hypot(b.x - welcome.x, b.z - welcome.z));
  assert.ok(camps.length > 0, '12 区块内有史莱姆营地');
  const camp = camps[0];
  console.log('目标营地', camp.x.toFixed(1), camp.z.toFixed(1), '怪数', camp.count);

  // 以 0.8 格/100ms 走过去（服务器限速 0.9/100ms）
  let x = welcome.x, z = welcome.z;
  const y = welcome.y + 0.5;
  for (let i = 0; i < 3000; i++) {
    const dx = camp.x - x, dz = camp.z - z;
    const d = Math.hypot(dx, dz);
    if (d < 30) break; // 进入兴趣半径（4 区块=64 格）内一段后即可
    x += dx / d * 0.8; z += dz / d * 0.8;
    ws.send(JSON.stringify({ t: 'move', x, y, z, yaw: 0, pitch: 0 }));
    await sleep(100);
  }
  // 轮询等待激活扫描（1Hz）与首批游走：首次激活要同步生成 25 区块，慢机器上给足 10 秒
  for (let i = 0; i < 100 && !(seen.spawn.length >= camp.count && seen.move > 0); i++) await sleep(100);

  assert.ok(seen.spawn.length >= camp.count, '收到整营 mobSpawn，实收 ' + seen.spawn.length);
  assert.ok(seen.spawn.every((m) => m.type === 'slime' && m.hp > 0 && m.maxHp >= 12), 'mobSpawn 字段合法');
  assert.ok(seen.move > 0, '收到 mobMove（游走中），实收 ' + seen.move);
  console.log('mobs_probe OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: 跑探针**

确保 dev 在跑（`npx wrangler dev --port 8787 --persist-to ../cc-myworld-state`）。

Run: `node tests/manual/mobs_probe.js`
Expected: 退出码 0（stdout 末行可能因刷新竞争看不到，以 `$LASTEXITCODE` 判定）

> 探针要走 ~60+ 格、模拟 1~2 分钟，耐心等待；失败看 dev 终端堆栈。

- [ ] **Step 7: 提交**

```bash
git add server/world_do.js tests/manual/mobs_probe.js
git commit -m "feat: WorldDO 怪物模拟（营地激活/AI tick/游走追击/兴趣广播）"
```

---

### Task 6: WorldDO 战斗结算（attack/shoot/箭/玩家伤害/死亡复活/回血）

**Files:**
- Modify: `server/world_do.js`
- Create: `tests/manual/combat_probe.js`

- [ ] **Step 1: 消息分发与会话字段**

`webSocketMessage` 的分发链 `else if (msg.t === 'respawn') this.onRespawn(ws, s);` 之前插入两行：

```js
    else if (msg.t === 'attack') this.onAttack(ws, s, msg);
    else if (msg.t === 'shoot') this.onShoot(ws, s, msg);
```

`onHello` 中创建会话的一行：

```js
    const s = { pid: this.nextPid++, token, name, x, y, z, yaw: 0, pitch: 0, lastMoveMs: now, visible: new Set() };
```

改为（追加战斗字段；hp 从 players 行恢复，無行则满血）：

```js
    const level = row && row.level ? row.level : 1;
    const maxHp = Stats.maxHp(level);
    const hp = row && isFinite(row.hp) && row.hp > 0 ? Math.min(row.hp, maxHp) : maxHp;
    const s = { pid: this.nextPid++, token, name, x, y, z, yaw: 0, pitch: 0, lastMoveMs: now, visible: new Set(),
      level, hp, maxHp, dead: false, deadUntil: 0, invulnUntil: 0, lastHurtAt: 0, nextRegenAt: 0, atkReadyAt: 0, bowReadyAt: 0 };
```

welcome 一行里 Task 5 暂填的 `hp: 20, maxHp: 20` 改为 `hp: s.hp, maxHp: s.maxHp`。

boot() 休眠恢复循环里构造会话的 `const s = { ... };` 同样追加战斗字段（hp 从行恢复）：

```js
      const lvl = row && row.level ? row.level : 1;
      const mhp = Stats.maxHp(lvl);
      const s = {
        pid: a.pid, token: a.token, name: a.name,
        x: row ? row.x : SPAWN_X, y: row ? row.y : this.world.terrainHeight(8, 8) + 1, z: row ? row.z : SPAWN_Z,
        // 限速时钟取上次落盘时间：恢复的位置即彼时位置，位移预算 = 均速 × 实际经过时长；
        // 若取 Date.now()，唤醒 DO 的那条 move 自身 dt 会被压到 30ms 下限而被误拒拉回
        yaw: 0, pitch: 0, lastMoveMs: row && row.last_seen ? row.last_seen : Date.now() - 1000, visible: new Set(),
        level: lvl, hp: row && isFinite(row.hp) && row.hp > 0 ? Math.min(row.hp, mhp) : mhp, maxHp: mhp,
        dead: false, deadUntil: 0, invulnUntil: 0, lastHurtAt: 0, nextRegenAt: 0, atkReadyAt: 0, bowReadyAt: 0,
      };
```

`persistSession` 的 UPDATE 改为同时落 hp（死亡中落库视同已复活，防"死亡瞬间断线→重连原地满血"绕过复活语义）：

```js
  persistSession(s) {
    // 死亡中落库视同已复活：出生点 + 满血（复活计时跨断线不保留，直接兑现其结果）
    const px = s.dead ? SPAWN_X : s.x, pz = s.dead ? SPAWN_Z : s.z;
    const py = s.dead ? this.world.terrainHeight(8, 8) + 1 : s.y;
    const ph = s.dead ? s.maxHp : s.hp;
    this.sql.exec(`UPDATE players SET x = ?, y = ?, z = ?, hp = ?, last_seen = ? WHERE token = ?`,
      px, py, pz, ph, Date.now(), s.token);
  }
```

`onMove` 开头加死亡门控（死亡期间忽略位置上报，避免尸体漂移）：

```js
  onMove(ws, s, msg) {
    if (s.dead) return;
```

- [ ] **Step 2: 用完整实现替换 Task 5 的四个空壳方法**

删除 Task 5 放的 `damagePlayer/spawnArrow/tickArrows/tickPlayers` 空壳，在原位置写入：

```js
  // ====== M2 战斗结算 ======

  // 近战：服务器复核冷却与射程后结算（客户端预选目标只是意图）
  onAttack(ws, s, msg) {
    if (s.dead || !P.validAttack(msg)) return;
    const now = Date.now();
    if (now < s.atkReadyAt) return;
    const mob = this.mobs.get(msg.id);
    if (!mob || mob.dead) return;
    const ex = s.x, ey = s.y + EYE, ez = s.z;
    const d = Math.hypot(mob.x - ex, mob.y + mob.height / 2 - ey, mob.z - ez);
    if (d > P.MELEE_RANGE + 1) return; // 位置上报滞后留 1 格余量
    s.atkReadyAt = now + P.MELEE_CD_MS;
    // 击退：水平远离攻击者 + 小幅上抛
    const kx = mob.x - s.x, kz = mob.z - s.z;
    const kl = Math.hypot(kx, kz) || 1;
    mob.vx += kx / kl * P.KNOCKBACK_H; mob.vz += kz / kl * P.KNOCKBACK_H;
    if (mob.onGround) mob.vy = P.KNOCKBACK_V;
    this.hurtMob(mob, Stats.swordDamage(s.level), s, now);
    this.ensureTick();
  }

  // 射箭：从玩家视点出发，方向归一化
  onShoot(ws, s, msg) {
    if (s.dead || !P.validShoot(msg)) return;
    const now = Date.now();
    if (now < s.bowReadyAt) return;
    s.bowReadyAt = now + P.BOW_CD_MS;
    const len = Math.hypot(msg.dx, msg.dy, msg.dz);
    this.spawnArrow(s.x, s.y + EYE, s.z, msg.dx / len, msg.dy / len, msg.dz / len, s.pid, Stats.bowDamage(s.level));
    this.ensureTick();
  }

  hurtMob(mob, dmg, attacker, now) {
    if (mob.state === 'return') return; // 回巢途中无敌（防风筝逃课，spec 明确）
    mob.hp -= dmg;
    mob.aggroPid = attacker.pid; // 被动怪被打才反击
    if (mob.state === 'idle') mob.state = 'chase';
    if (mob.hp <= 0) {
      mob.hp = 0; mob.dead = true;
      mob.respawnAt = now + 30000; // 死后 30 秒原地重生
      this.broadcastMob(mob, { t: 'mobDie', id: mob.id });
      // M3 在此结算经验与任务计数（最后一击归属 attacker.pid）
    } else {
      this.broadcastMob(mob, { t: 'mobHurt', id: mob.id, hp: mob.hp, dmg });
    }
  }

  // ownerPid>0 为玩家箭（只打怪），0 为怪物箭（只打玩家）
  spawnArrow(x, y, z, dx, dy, dz, ownerPid, dmg) {
    const len = Math.hypot(dx, dy, dz) || 1;
    const a = {
      id: 'a' + this.nextArrowId++, own: ownerPid, dmg,
      x: x + dx / len * 0.6, y: y + dy / len * 0.6, z: z + dz / len * 0.6,
      vx: dx / len * P.ARROW_SPEED, vy: dy / len * P.ARROW_SPEED, vz: dz / len * P.ARROW_SPEED,
      dieAt: Date.now() + P.ARROW_LIFE_MS,
    };
    this.arrows.set(a.id, a);
    // 广播给兴趣内玩家；玩家自己的箭不回发（客户端已本地预表现）
    for (const [ws2, s2] of this.sessions) {
      if (s2.pid === ownerPid) continue;
      if (P.inInterest(a.x, a.z, s2.x, s2.z)) {
        this.send(ws2, { t: 'arrowSpawn', id: a.id, x: a.x, y: a.y, z: a.z, vx: a.vx, vy: a.vy, vz: a.vz, own: ownerPid });
      }
    }
    this.ensureTick();
  }

  // 逐 tick 积分弹道：先按 0.5 格采样找最早方块命中并截断线段，再在截断段上判实体
  // （若实体判定先吃整段，一 tick 3 格的箭会隔薄墙命中墙后目标——spec 要求箭被方块挡住）
  tickArrows(now) {
    const dt = P.MOB_TICK_MS / 1000;
    for (const [id, a] of Array.from(this.arrows)) {
      const x0 = a.x, y0 = a.y, z0 = a.z;
      a.vy -= P.ARROW_GRAVITY * dt;
      a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
      // 方块命中：求截断点（无命中则截断点=本 tick 终点）
      let bx = a.x, by = a.y, bz = a.z, blockHit = false;
      const segLen = Math.hypot(a.x - x0, a.y - y0, a.z - z0);
      const steps = Math.max(1, Math.ceil(segLen / 0.5));
      for (let i = 1; i <= steps; i++) {
        const f = i / steps;
        const sx = x0 + (a.x - x0) * f, sy = y0 + (a.y - y0) * f, sz = z0 + (a.z - z0) * f;
        if (MW.Blocks.isSolid(this.world.getBlock(Math.floor(sx), Math.floor(sy), Math.floor(sz)))) {
          bx = sx; by = sy; bz = sz; blockHit = true;
          break;
        }
      }
      let hit = null; // {x,y,z}
      // 实体判定（只在截断段上）：玩家箭打怪，怪物箭打玩家
      if (a.own > 0) {
        for (const mob of this.mobs.values()) {
          if (mob.dead) continue;
          if (Physics.segmentHitsBox(x0, y0, z0, bx, by, bz, mob)) {
            const [, atk] = this.sessionByPid(a.own);
            this.hurtMob(mob, a.dmg, atk || { pid: a.own }, now);
            hit = { x: bx, y: by, z: bz };
            break;
          }
        }
      } else {
        for (const s of this.sessions.values()) {
          if (s.dead) continue;
          if (Physics.segmentHitsBox(x0, y0, z0, bx, by, bz, { x: s.x, y: s.y, z: s.z, half: 0.3, height: 1.8 })) {
            this.damagePlayer(s, a.dmg, now);
            hit = { x: bx, y: by, z: bz };
            break;
          }
        }
      }
      if (!hit && blockHit) hit = { x: bx, y: by, z: bz };
      if (hit || now >= a.dieAt || a.y < -20) {
        const px = hit ? hit.x : a.x, py = hit ? hit.y : a.y, pz = hit ? hit.z : a.z;
        this.arrows.delete(id);
        for (const [ws2, s2] of this.sessions) {
          if (P.inInterest(px, pz, s2.x, s2.z)) this.send(ws2, { t: 'arrowDie', id, x: px, y: py, z: pz });
        }
      }
    }
  }

  // 玩家受伤：无敌帧 → 扣血 → 死亡进入复活倒计时
  damagePlayer(s, dmg, now) {
    if (s.dead || now < s.invulnUntil) return;
    s.hp -= dmg;
    s.invulnUntil = now + P.INVULN_MS;
    s.lastHurtAt = now;
    const [ws] = this.sessionByPid(s.pid);
    if (s.hp <= 0) {
      s.hp = 0; s.dead = true; s.deadUntil = now + P.DEATH_RESPAWN_MS;
      if (ws) this.send(ws, { t: 'playerDie' });
      // M3 在此结算死亡经验惩罚
    } else if (ws) {
      this.send(ws, { t: 'playerHurt', hp: s.hp, dmg });
    }
  }

  // 玩家逐 tick：复活倒计时与脱战回血；返回是否有事在做
  tickPlayers(now) {
    let busy = false;
    for (const [ws, s] of this.sessions) {
      if (s.dead) {
        busy = true;
        if (now >= s.deadUntil) {
          s.dead = false;
          s.hp = s.maxHp;
          s.x = SPAWN_X; s.z = SPAWN_Z;
          s.y = this.world.terrainHeight(8, 8) + 1;
          s.lastMoveMs = now;
          this.send(ws, { t: 'teleport', x: s.x, y: s.y, z: s.z });
          this.send(ws, { t: 'hpUpdate', hp: s.hp, max: s.maxHp });
          this.syncVisibility(ws, s);
        }
        continue;
      }
      if (s.hp < s.maxHp) {
        busy = true;
        if (now - s.lastHurtAt >= P.REGEN_DELAY_MS && now >= s.nextRegenAt) {
          s.hp = Math.min(s.maxHp, s.hp + 1);
          s.nextRegenAt = now + 1000;
          this.send(ws, { t: 'hpUpdate', hp: s.hp, max: s.maxHp });
        }
      }
    }
    return busy;
  }
```

> 同时把 Task 5 里 `tickMob` 中两处调用（`this.damagePlayer(victim, mob.dmg, now)` 与 `this.spawnArrow(...)`）确认无改动即可——签名已对齐。

- [ ] **Step 3: 语法检查 + 回归**

Run: `node --check server/world_do.js` → 无输出
Run: `node tests/run_all.js` → `ALL TESTS PASSED`

- [ ] **Step 4: 创建战斗探针 tests/manual/combat_probe.js**

```js
// tests/manual/combat_probe.js — 战斗链路：走到史莱姆营地→砍死一只→挨打→验证回血开始
// 先启动: npx wrangler dev --port 8787 --persist-to ../cc-myworld-state
// 运行: node tests/manual/combat_probe.js
'use strict';
const assert = require('node:assert');
require('../../js/noise.js');
require('../../js/world.js');
require('../../shared/mobs_def.js');
const MobsDef = globalThis.MyWorld.MobsDef;
const World = globalThis.MyWorld.World;
const URL_WS = process.argv[2] || 'ws://127.0.0.1:8787/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tok() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

(async () => {
  const ws = new WebSocket(URL_WS);
  let welcome = null;
  const mobs = new Map(); // id -> {hp,maxHp,x,y,z,type}
  const ev = { hurt: [], die: [], selfHurt: [], hpUp: [] };
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') { welcome = m; for (const mb of m.mobs) mobs.set(mb.id, mb); }
    else if (m.t === 'mobSpawn') mobs.set(m.id, m);
    else if (m.t === 'mobMove') { const mb = mobs.get(m.id); if (mb) { mb.x = m.x; mb.y = m.y; mb.z = m.z; } }
    else if (m.t === 'mobHurt') { ev.hurt.push(m); const mb = mobs.get(m.id); if (mb) mb.hp = m.hp; }
    else if (m.t === 'mobDie') { ev.die.push(m); mobs.delete(m.id); }
    else if (m.t === 'playerHurt') ev.selfHurt.push(m);
    else if (m.t === 'hpUpdate') ev.hpUp.push(m);
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('连不上'))); });
  ws.send(JSON.stringify({ t: 'hello', token: tok(), name: '战斗探针' }));
  while (!welcome) await sleep(50);

  const camp = MobsDef.campsNear(welcome.seed, welcome.x, welcome.z, 12)
    .filter((c) => c.type === 'slime')
    .sort((a, b) => Math.hypot(a.x - welcome.x, a.z - welcome.z) - Math.hypot(b.x - welcome.x, b.z - welcome.z))[0];
  assert.ok(camp, '附近有史莱姆营地');

  // 走到营地边 3 格：用同种子的本地世界贴地走（服务器近战校验用 3D 距离，必须跟随地形高度）
  const lw = World.create(welcome.seed);
  const groundY = (px, pz) => lw.terrainHeight(Math.floor(px), Math.floor(pz)) + 1;
  let x = welcome.x, z = welcome.z;
  for (let i = 0; i < 5000; i++) {
    const dx = camp.x - x, dz = camp.z - z;
    const d = Math.hypot(dx, dz);
    if (d < 3) break;
    const step = Math.min(0.8, d);
    x += dx / d * step; z += dz / d * step;
    ws.send(JSON.stringify({ t: 'move', x, y: groundY(x, z), z, yaw: 0, pitch: 0 }));
    await sleep(100);
  }
  await sleep(2000);
  assert.ok(mobs.size > 0, '看到怪了');

  // 持续砍最近的怪直到死（冷却 500ms；怪会被击退/移动，循环重选最近）
  let killed = null;
  for (let i = 0; i < 120 && !killed; i++) {
    let best = null, bd = 1e9;
    for (const mb of mobs.values()) {
      const d = Math.hypot(mb.x - x, mb.z - z);
      if (d < bd) { bd = d; best = mb; }
    }
    if (best && bd <= 3.2) {
      ws.send(JSON.stringify({ t: 'attack', id: best.id }));
    } else if (best) {
      // 追上去（贴地）
      const dx = best.x - x, dz = best.z - z, d = Math.hypot(dx, dz);
      x += dx / d * Math.min(0.8, d); z += dz / d * Math.min(0.8, d);
      ws.send(JSON.stringify({ t: 'move', x, y: groundY(x, z), z, yaw: 0, pitch: 0 }));
    }
    if (ev.die.length > 0) killed = ev.die[0];
    await sleep(250);
  }
  assert.ok(ev.hurt.length > 0, '收到 mobHurt，命中 ' + ev.hurt.length + ' 次');
  assert.ok(ev.hurt.every((h) => h.dmg === 3), '1 级剑伤害为 3');
  assert.ok(killed, '怪被击杀（mobDie）');
  assert.ok(ev.selfHurt.length > 0, '史莱姆反击造成 playerHurt');
  // 撤离等待回血（5 秒脱战 + 1 秒/点）
  for (let i = 0; i < 80; i++) {
    const dx = welcome.x - x, dz = welcome.z - z, d = Math.hypot(dx, dz);
    if (d > 1) { x += dx / d * Math.min(0.8, d); z += dz / d * Math.min(0.8, d); ws.send(JSON.stringify({ t: 'move', x, y: groundY(x, z), z, yaw: 0, pitch: 0 })); }
    await sleep(100);
  }
  await sleep(8000);
  assert.ok(ev.hpUp.length > 0, '脱战回血发出 hpUpdate，实收 ' + ev.hpUp.length);
  console.log('combat_probe OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: 跑探针**

dev 在跑的前提下：

Run: `node tests/manual/combat_probe.js`
Expected: 退出码 0（全程 2~4 分钟）

同时重跑 M1 探针防回归：

Run: `node tests/manual/two_clients.js`
Expected: 退出码 0

- [ ] **Step 6: 提交**

```bash
git add server/world_do.js tests/manual/combat_probe.js
git commit -m "feat: WorldDO 战斗结算（近战/弓箭弹道/玩家伤害/死亡复活/脱战回血/hp 持久化）"
```

---

### Task 7: js/combat.js — 客户端战斗（物品表/图标/手持/输入）

**Files:**
- Create: `js/combat.js`

- [ ] **Step 1: 创建 js/combat.js**

```js
// js/combat.js — 客户端战斗：快捷栏物品表、武器图标、手持模型与挥击、攻击/射箭意图
(function (root) {
  'use strict';
  const P = root.MyWorld.Protocol;
  const Physics = root.MyWorld.Physics;

  // 快捷栏 10 格：1 剑、2 弓、3~9/0 方块（数字键 0 对应第 10 格）
  const ITEMS = [
    { kind: 'sword', name: '剑' },
    { kind: 'bow', name: '弓' },
    { kind: 'block', id: 1 }, { kind: 'block', id: 2 }, { kind: 'block', id: 3 }, { kind: 'block', id: 4 },
    { kind: 'block', id: 5 }, { kind: 'block', id: 6 }, { kind: 'block', id: 7 }, { kind: 'block', id: 8 },
  ];

  // 32×32 像素武器图标（程序化绘制，零素材）
  function drawIcon(ctx, kind) {
    ctx.clearRect(0, 0, 32, 32);
    ctx.imageSmoothingEnabled = false;
    if (kind === 'sword') {
      ctx.fillStyle = '#cfd8e3'; // 剑身：斜 45°
      for (let i = 0; i < 16; i++) ctx.fillRect(8 + i, 22 - i, 3, 3);
      ctx.fillStyle = '#8a5a2b'; // 护手与柄
      ctx.fillRect(7, 19, 9, 3);
      ctx.fillRect(5, 24, 5, 5);
    } else {
      ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 3; // 弓臂
      ctx.beginPath(); ctx.arc(12, 16, 10, -Math.PI / 2.6, Math.PI / 2.6); ctx.stroke();
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1; // 弦
      ctx.beginPath(); ctx.moveTo(15, 7); ctx.lineTo(15, 25); ctx.stroke();
      ctx.fillStyle = '#cfd8e3'; ctx.fillRect(15, 15, 12, 2); // 箭
    }
  }

  // —— 手持模型（挂在相机上）——
  let held = null, heldSword = null, heldBow = null;
  let swingT = 0; // 0=收回，>0 挥击中（秒）

  function box(w, h, d, color) {
    return new root.THREE.Mesh(new root.THREE.BoxGeometry(w, h, d), new root.THREE.MeshBasicMaterial({ color }));
  }

  function init(camera) {
    held = new root.THREE.Group();
    heldSword = new root.THREE.Group();
    const blade = box(0.06, 0.5, 0.06, 0xcfd8e3); blade.position.y = 0.32;
    const guard = box(0.18, 0.05, 0.08, 0x8a5a2b); guard.position.y = 0.06;
    const grip = box(0.07, 0.16, 0.07, 0x6b4a2a); grip.position.y = -0.06;
    heldSword.add(blade, guard, grip);
    heldBow = new root.THREE.Group();
    const top = box(0.05, 0.3, 0.05, 0x8a5a2b); top.position.y = 0.18; top.rotation.z = 0.4;
    const mid = box(0.05, 0.2, 0.05, 0x8a5a2b);
    const bot = box(0.05, 0.3, 0.05, 0x8a5a2b); bot.position.y = -0.18; bot.rotation.z = -0.4;
    heldBow.add(top, mid, bot);
    held.add(heldSword, heldBow);
    held.position.set(0.35, -0.32, -0.55);
    held.rotation.set(-0.2, 0.3, 0);
    camera.add(held);
    setHeld(0);
  }

  function setHeld(itemIndex) {
    const kind = ITEMS[itemIndex].kind;
    heldSword.visible = kind === 'sword';
    heldBow.visible = kind === 'bow';
  }

  function swing() { swingT = 0.18; }

  function update(dt) {
    if (!held) return;
    if (swingT > 0) {
      swingT = Math.max(0, swingT - dt);
      const f = swingT / 0.18; // 1→0
      held.rotation.x = -0.2 - Math.sin(f * Math.PI) * 0.9;
    } else {
      held.rotation.x = -0.2;
    }
  }

  // —— 攻击意图 ——
  let meleeReadyAt = 0, bowReadyAt = 0;

  // 视线选怪：对每只怪做线段-AABB 相交，取最近者
  function pickMob(eye, dir, mobList) {
    const ex = eye.x + dir.x * P.MELEE_RANGE, ey = eye.y + dir.y * P.MELEE_RANGE, ez = eye.z + dir.z * P.MELEE_RANGE;
    let best = null, bd = Infinity;
    for (const m of mobList) {
      if (Physics.segmentHitsBox(eye.x, eye.y, eye.z, ex, ey, ez, m)) {
        // 距离按怪物中心算（脚底点在高矮怪混战时会排错最近者）
        const d = Math.hypot(m.x - eye.x, m.y + m.height / 2 - eye.y, m.z - eye.z);
        if (d < bd) { bd = d; best = m; }
      }
    }
    return best;
  }

  // 返回 true 表示本次点击已被战斗消费（main 据此跳过挖放逻辑）
  function onAttackClick(itemIndex, eye, dir, mobList, net) {
    const kind = ITEMS[itemIndex].kind;
    const now = Date.now();
    if (kind === 'sword') {
      if (now >= meleeReadyAt) {
        meleeReadyAt = now + P.MELEE_CD_MS;
        swing();
        const target = pickMob(eye, dir, mobList);
        if (target) net.send({ t: 'attack', id: target.id });
      }
      return true;
    }
    if (kind === 'bow') {
      if (now >= bowReadyAt) {
        bowReadyAt = now + P.BOW_CD_MS;
        swing();
        net.send({ t: 'shoot', dx: dir.x, dy: dir.y, dz: dir.z });
        return 'shoot'; // main 据此做本地箭预表现
      }
      return true;
    }
    return false; // 方块：交回 main 的挖放逻辑
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Combat = { ITEMS, drawIcon, init, setHeld, swing, update, onAttackClick, pickMob };
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 2: 语法检查**

Run: `node --check js/combat.js` → 无输出

- [ ] **Step 3: 提交**

```bash
git add js/combat.js
git commit -m "feat: 客户端战斗模块（物品表/武器图标/手持挥击/攻击射箭意图）"
```

---

### Task 8: js/entities.js 扩展 — 怪物与箭矢渲染

**Files:**
- Modify: `js/entities.js`（整文件替换）

- [ ] **Step 1: 整文件替换 js/entities.js**

保留原有玩家逻辑不变（upsertPlayer/movePlayer/removePlayer 语义一致），新增怪物与箭：

```js
// js/entities.js — 远端实体渲染：玩家/怪物/箭，体素模型 + 名牌 + 插值
(function (root) {
  'use strict';
  const P = root.MyWorld.Protocol;
  const MobsDef = root.MyWorld.MobsDef;

  let scene = null;
  const players = new Map(); // pid -> { group, tx, ty, tz, tyaw }
  const mobs = new Map();    // id -> { group, tx, ty, tz, tyaw, hp, maxHp, half, height, hurtUntil, dieT, hpBar }
  const arrows = new Map();  // id -> { group, x, y, z, vx, vy, vz, local }

  function init(s) { scene = s; }

  function colorOf(pid) {
    const hues = [0x3b6fd4, 0xd43b3b, 0x3bd46f, 0xd4a23b, 0x8f3bd4, 0x3bc8d4];
    return hues[pid % hues.length];
  }

  function box(w, h, d, color) {
    return new root.THREE.Mesh(
      new root.THREE.BoxGeometry(w, h, d),
      new root.THREE.MeshBasicMaterial({ color }));
  }

  // 名牌：canvas 文字贴 Sprite
  function nameTag(name, scale) {
    const cv = root.document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 128, 32);
    const tex = new root.THREE.CanvasTexture(cv);
    const sp = new root.THREE.Sprite(new root.THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sp.scale.set(1.6 * (scale || 1), 0.4 * (scale || 1), 1);
    return sp;
  }

  // 受击血条：双层 Sprite（背景+前景），前景按比例缩放
  function hpBar() {
    const bg = new root.THREE.Sprite(new root.THREE.SpriteMaterial({ color: 0x222222, depthTest: false }));
    bg.scale.set(1.0, 0.09, 1);
    const fg = new root.THREE.Sprite(new root.THREE.SpriteMaterial({ color: 0xd43b3b, depthTest: false }));
    fg.scale.set(0.96, 0.06, 1);
    const g = new root.THREE.Group();
    g.add(bg, fg);
    g.visible = false;
    return { group: g, fg };
  }

  // 体素小人（玩家与人形怪通用）：原点脚底
  function humanoid(color, skin) {
    const g = new root.THREE.Group();
    const pants = 0x4a4a5a;
    const head = box(0.5, 0.5, 0.5, skin); head.position.y = 1.55;
    const body = box(0.5, 0.75, 0.25, color); body.position.y = 1.0;
    const legL = box(0.22, 0.62, 0.25, pants); legL.position.set(-0.13, 0.31, 0);
    const legR = box(0.22, 0.62, 0.25, pants); legR.position.set(0.13, 0.31, 0);
    const armL = box(0.2, 0.7, 0.2, color); armL.position.set(-0.36, 1.02, 0);
    const armR = box(0.2, 0.7, 0.2, color); armR.position.set(0.36, 1.02, 0);
    g.add(head, body, legL, legR, armL, armR);
    return g;
  }

  // 四种怪物模型
  function mobModel(type) {
    const g = new root.THREE.Group();
    if (type === 'slime') {
      const gel = box(0.7, 0.6, 0.7, 0x4fae4f); gel.position.y = 0.3;
      const eyeL = box(0.1, 0.1, 0.05, 0x222222); eyeL.position.set(-0.15, 0.42, 0.36);
      const eyeR = box(0.1, 0.1, 0.05, 0x222222); eyeR.position.set(0.15, 0.42, 0.36);
      g.add(gel, eyeL, eyeR);
    } else if (type === 'zombie') {
      g.add(humanoid(0x3b6e3b, 0x6fae6f));
    } else if (type === 'skeleton') {
      g.add(humanoid(0xbdbdbd, 0xe8e8e8));
      const bow = box(0.05, 0.6, 0.05, 0x8a5a2b); bow.position.set(0.45, 1.0, 0.15); bow.rotation.x = 0.3;
      g.add(bow);
    } else { // wolf
      const body = box(0.9, 0.45, 0.4, 0x777777); body.position.y = 0.55;
      const head = box(0.35, 0.35, 0.35, 0x8a8a8a); head.position.set(0.55, 0.75, 0);
      const tail = box(0.35, 0.1, 0.1, 0x666666); tail.position.set(-0.6, 0.7, 0);
      g.add(body, head, tail);
      for (const [lx, lz] of [[0.3, 0.12], [0.3, -0.12], [-0.3, 0.12], [-0.3, -0.12]]) {
        const leg = box(0.12, 0.35, 0.12, 0x666666); leg.position.set(lx, 0.18, lz);
        g.add(leg);
      }
    }
    return g;
  }

  function disposeGroup(group) {
    group.traverse((o) => {
      // 只销毁 Mesh 的独享几何体；Sprite.geometry 是 three 全局共享单例，销毁会引发 GPU 缓冲区反复重建
      if (o.isMesh && o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }

  // —— 玩家 ——
  function upsertPlayer(m) {
    let p = players.get(m.pid);
    if (!p) {
      const g = humanoid(colorOf(m.pid), 0xe8b88a);
      const tag = nameTag(m.name, 1);
      tag.position.y = 2.15;
      g.add(tag);
      p = { group: g, tx: m.x, ty: m.y, tz: m.z, tyaw: m.yaw || 0 };
      p.group.position.set(m.x, m.y, m.z);
      p.group.rotation.y = p.tyaw;
      scene.add(p.group);
      players.set(m.pid, p);
      return;
    }
    p.tx = m.x; p.ty = m.y; p.tz = m.z;
    if (isFinite(m.yaw)) p.tyaw = m.yaw;
  }

  function movePlayer(m) {
    const p = players.get(m.pid);
    if (!p) return;
    p.tx = m.x; p.ty = m.y; p.tz = m.z;
    if (isFinite(m.yaw)) p.tyaw = m.yaw;
  }

  function removePlayer(pid) {
    const p = players.get(pid);
    if (!p) return;
    scene.remove(p.group);
    disposeGroup(p.group);
    players.delete(pid);
  }

  // —— 怪物 ——
  function upsertMob(m) {
    let e = mobs.get(m.id);
    const t = MobsDef.TYPES[m.type];
    if (!e) {
      const g = mobModel(m.type);
      const tag = nameTag('Lv.' + m.lv + ' ' + t.name, 0.9);
      tag.position.y = t.height + 0.45;
      g.add(tag);
      const bar = hpBar();
      bar.group.position.y = t.height + 0.2;
      g.add(bar.group);
      e = { group: g, tx: m.x, ty: m.y, tz: m.z, tyaw: 0, hp: m.hp, maxHp: m.maxHp,
        half: t.half, height: t.height, hurtUntil: 0, dieT: 0, bar };
      g.position.set(m.x, m.y, m.z);
      scene.add(g);
      mobs.set(m.id, e);
    } else {
      e.tx = m.x; e.ty = m.y; e.tz = m.z;
      e.hp = m.hp; e.maxHp = m.maxHp;
      e.dieT = 0;
      e.group.rotation.z = 0;
      // 重生复用同 id：血条状态一并复位（否则残留死亡前的半血条最多 2 秒）
      e.bar.group.visible = false;
      e.bar.fg.scale.x = 0.96;
    }
  }

  function moveMob(m) {
    const e = mobs.get(m.id);
    if (!e) return;
    e.tx = m.x; e.ty = m.y; e.tz = m.z;
    if (isFinite(m.yaw)) e.tyaw = m.yaw;
  }

  function hurtMob(m) {
    const e = mobs.get(m.id);
    if (!e) return;
    e.hp = m.hp;
    e.hurtUntil = performance.now() + 2000;
    e.flashUntil = performance.now() + 150;
    e.bar.group.visible = true;
    e.bar.fg.scale.x = 0.96 * Math.max(0, e.hp / e.maxHp);
  }

  function dieMob(id) {
    const e = mobs.get(id);
    if (!e) return;
    e.dieT = 2; // 倒地 2 秒后移除
    e.bar.group.visible = false;
  }

  function despawnMob(id) {
    const e = mobs.get(id);
    if (!e) return;
    scene.remove(e.group);
    disposeGroup(e.group);
    mobs.delete(id);
  }

  // combat.pickMob 用：当前可见存活怪的 AABB 列表
  function mobList() {
    const out = [];
    for (const [id, e] of mobs) {
      if (e.dieT > 0) continue;
      out.push({ id, x: e.group.position.x, y: e.group.position.y, z: e.group.position.z, half: e.half, height: e.height });
    }
    return out;
  }

  // —— 箭 ——
  let localArrowN = 0;
  function arrowModel() {
    const g = new root.THREE.Group();
    const shaft = box(0.04, 0.04, 0.5, 0xc8a06a);
    const tip = box(0.07, 0.07, 0.08, 0xcfd8e3); tip.position.z = -0.28;
    g.add(shaft, tip);
    return g;
  }

  function addArrow(id, x, y, z, vx, vy, vz, local) {
    const g = arrowModel();
    g.position.set(x, y, z);
    scene.add(g);
    arrows.set(id, { group: g, x, y, z, vx, vy, vz, local: !!local, born: performance.now() });
  }

  function spawnLocalArrow(x, y, z, dx, dy, dz) {
    const id = 'L' + (++localArrowN);
    addArrow(id, x, y, z, dx * P.ARROW_SPEED, dy * P.ARROW_SPEED, dz * P.ARROW_SPEED, true);
  }

  function remoteArrow(m) { addArrow(m.id, m.x, m.y, m.z, m.vx, m.vy, m.vz, false); }

  function dieArrow(m) {
    const a = arrows.get(m.id);
    if (!a) return;
    scene.remove(a.group);
    disposeGroup(a.group);
    arrows.delete(m.id);
  }

  function clear() {
    for (const pid of Array.from(players.keys())) removePlayer(pid);
    for (const id of Array.from(mobs.keys())) despawnMob(id);
    for (const id of Array.from(arrows.keys())) dieArrow({ id });
  }

  // 每帧：插值 + 箭弹道积分 + 受击闪红/死亡倒地
  function update(dt, world) {
    const a = Math.min(1, dt * 12);
    for (const p of players.values()) {
      p.group.position.x += (p.tx - p.group.position.x) * a;
      p.group.position.y += (p.ty - p.group.position.y) * a;
      p.group.position.z += (p.tz - p.group.position.z) * a;
      let dy = p.tyaw - p.group.rotation.y;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      p.group.rotation.y += dy * a;
    }
    const now = performance.now();
    for (const [id, e] of Array.from(mobs)) {
      if (e.dieT > 0) {
        e.dieT -= dt;
        e.group.rotation.z = Math.min(Math.PI / 2, e.group.rotation.z + dt * 6); // 倒地
        if (e.dieT <= 0) despawnMob(id);
        continue;
      }
      e.group.position.x += (e.tx - e.group.position.x) * a;
      e.group.position.y += (e.ty - e.group.position.y) * a;
      e.group.position.z += (e.tz - e.group.position.z) * a;
      let dy = e.tyaw - e.group.rotation.y;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      e.group.rotation.y += dy * a;
      // 受击闪红：遍历材质临时调色
      const flashing = e.flashUntil && now < e.flashUntil;
      e.group.traverse((o) => {
        if (o.isMesh && o.material && o.material.color) {
          if (flashing && !o.userData.baseColor) { o.userData.baseColor = o.material.color.getHex(); o.material.color.setHex(0xff5555); }
          else if (!flashing && o.userData.baseColor) { o.material.color.setHex(o.userData.baseColor); o.userData.baseColor = null; }
        }
      });
      if (e.hurtUntil && now > e.hurtUntil) e.bar.group.visible = false;
    }
    for (const [id, a2] of Array.from(arrows)) {
      a2.vy -= P.ARROW_GRAVITY * dt;
      a2.x += a2.vx * dt; a2.y += a2.vy * dt; a2.z += a2.vz * dt;
      a2.group.position.set(a2.x, a2.y, a2.z);
      a2.group.lookAt(a2.x + a2.vx, a2.y + a2.vy, a2.z + a2.vz);
      // 本地预表现箭：撞方块或超时即自毁（权威终点由 arrowDie 决定，远端箭也兜底超时）
      const hitBlock = world && root.MyWorld.Blocks.isSolid(world.getBlock(Math.floor(a2.x), Math.floor(a2.y), Math.floor(a2.z)));
      if (hitBlock || now - a2.born > P.ARROW_LIFE_MS || a2.y < -30) dieArrow({ id });
    }
  }

  function count() { return players.size; }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Entities = {
    init, upsertPlayer, movePlayer, removePlayer, clear, update, count,
    upsertMob, moveMob, hurtMob, dieMob, despawnMob, mobList,
    spawnLocalArrow, remoteArrow, dieArrow,
  };
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 2: 语法检查**

Run: `node --check js/entities.js` → 无输出

- [ ] **Step 3: 提交**

```bash
git add js/entities.js
git commit -m "feat: 实体渲染扩展（四种怪物模型/等级名牌/受击血条/死亡倒地/箭矢弹道）"
```

---

### Task 9: js/hud.js + js/ui.js + index.html — 战斗 HUD 与 10 格快捷栏

**Files:**
- Create: `js/hud.js`
- Modify: `js/ui.js`（仅 buildHotbar 函数替换）
- Modify: `index.html`

- [ ] **Step 1: 创建 js/hud.js**

```js
// js/hud.js — 战斗 HUD：血条、受击红闪、死亡黑屏、世界空间伤害飘字
(function (root) {
  'use strict';

  const floaters = []; // { el, x, y, z, t }

  function setHp(hp, max) {
    const fill = root.document.getElementById('hpFill');
    const text = root.document.getElementById('hpText');
    fill.style.width = Math.max(0, Math.round(hp / max * 100)) + '%';
    text.textContent = hp + ' / ' + max;
  }

  function flashRed() {
    const el = root.document.getElementById('redflash');
    el.style.opacity = '0.45';
    root.setTimeout(() => { el.style.opacity = '0'; }, 120);
  }

  function showDeath(show) {
    root.document.getElementById('deathOverlay').style.display = show ? 'flex' : 'none';
  }

  // 世界空间伤害飘字（每帧由 update 投影到屏幕）
  function floatDamage(x, y, z, text, color) {
    const el = root.document.createElement('div');
    el.className = 'floater';
    el.textContent = text;
    el.style.color = color || '#ffd24a';
    root.document.getElementById('floaters').appendChild(el);
    floaters.push({ el, x, y, z, t: 1 });
  }

  const v = { x: 0, y: 0, z: 0 };
  function update(dt, camera) {
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.t -= dt;
      f.y += dt * 1.2; // 上飘
      if (f.t <= 0) { f.el.remove(); floaters.splice(i, 1); continue; }
      const p = new root.THREE.Vector3(f.x, f.y, f.z).project(camera);
      if (p.z > 1) { f.el.style.display = 'none'; continue; }
      f.el.style.display = 'block';
      f.el.style.opacity = String(Math.min(1, f.t * 2));
      f.el.style.left = ((p.x + 1) / 2 * root.innerWidth) + 'px';
      f.el.style.top = ((1 - (p.y + 1) / 2) * root.innerHeight) + 'px';
    }
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Hud = { setHp, flashRed, showDeath, floatDamage, update };
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 2: js/ui.js 的 buildHotbar 整函数替换**

参数化为物品表（武器图标由 Combat.drawIcon 画，方块仍取图集）：

```js
  // items: Combat.ITEMS（10 格：剑/弓/8 种方块）；数字标签 1~9,0
  function buildHotbar(atlasCanvas, items) {
    const bar = root.document.getElementById('hotbar');
    bar.innerHTML = '';
    slots = [];
    items.forEach((item, i) => {
      const slot = root.document.createElement('div');
      slot.className = 'slot';
      const cv = root.document.createElement('canvas');
      cv.width = 32; cv.height = 32;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      if (item.kind === 'block') {
        const t = Blocks.BLOCKS[item.id].tex.side;
        const sx = (t % Blocks.ATLAS_TILES) * Blocks.TILE_PX;
        const sy = Math.floor(t / Blocks.ATLAS_TILES) * Blocks.TILE_PX;
        ctx.drawImage(atlasCanvas, sx, sy, Blocks.TILE_PX, Blocks.TILE_PX, 0, 0, 32, 32);
        slot.title = Blocks.BLOCKS[item.id].name;
      } else {
        root.MyWorld.Combat.drawIcon(ctx, item.kind);
        slot.title = item.name;
      }
      const num = root.document.createElement('span');
      num.textContent = (i + 1) % 10; // 第 10 格显示 0
      slot.appendChild(cv);
      slot.appendChild(num);
      bar.appendChild(slot);
      slots.push(slot);
    });
    selectSlot(0);
  }
```

- [ ] **Step 3: index.html 增补**

`<style>` 内追加（放在 `/* WebGL 不可用提示 */` 之前）：

```css
  /* 战斗 HUD */
  #hud {
    position: fixed; left: 12px; bottom: 12px; z-index: 10; pointer-events: none;
    font-family: sans-serif;
  }
  #hpBar {
    width: 220px; height: 18px; background: rgba(0,0,0,0.5);
    border: 2px solid #888; border-radius: 4px; overflow: hidden; position: relative;
  }
  #hpFill { height: 100%; width: 100%; background: #d43b3b; transition: width 0.15s; }
  #hpText {
    position: absolute; inset: 0; color: #fff; font: bold 12px/18px sans-serif;
    text-align: center; text-shadow: 1px 1px 0 #000;
  }
  #redflash {
    position: fixed; inset: 0; z-index: 15; pointer-events: none; opacity: 0;
    transition: opacity 0.25s; background: radial-gradient(ellipse at center, rgba(255,0,0,0) 55%, rgba(255,0,0,0.55) 100%);
  }
  #floaters { position: fixed; inset: 0; z-index: 12; pointer-events: none; overflow: hidden; }
  .floater {
    position: absolute; transform: translate(-50%, -100%);
    font: bold 16px sans-serif; text-shadow: 1px 1px 0 #000; white-space: nowrap;
  }
  #deathOverlay {
    position: fixed; inset: 0; z-index: 25; display: none;
    align-items: center; justify-content: center; flex-direction: column;
    background: rgba(40,0,0,0.75); color: #ff6b6b;
    font: bold 42px sans-serif; text-shadow: 2px 2px 0 #000;
  }
  #deathOverlay small { font-size: 16px; color: #ddd; margin-top: 12px; }
```

`<div id="online"></div>` 之后追加 DOM：

```html
<div id="hud"><div id="hpBar"><div id="hpFill"></div><div id="hpText">20 / 20</div></div></div>
<div id="redflash"></div>
<div id="floaters"></div>
<div id="deathOverlay">你死了<small>3 秒后在出生点复活…</small></div>
```

`ovStart` 面板的按键说明加一行（放在「左键挖方块　右键放方块」之后）：

```html
      <p><kbd>1</kbd> 剑　<kbd>2</kbd> 弓　对准怪物左键攻击</p>
```

script 标签序整体替换为：

```html
<script src="lib/three.min.js"></script>
<script src="js/noise.js"></script>
<script src="js/blocks.js"></script>
<script src="shared/protocol.js"></script>
<script src="shared/physics.js"></script>
<script src="shared/stats.js"></script>
<script src="shared/mobs_def.js"></script>
<script src="js/world.js"></script>
<script src="js/mesher.js"></script>
<script src="js/player.js"></script>
<script src="js/interact.js"></script>
<script src="js/combat.js"></script>
<script src="js/ui.js"></script>
<script src="js/net.js"></script>
<script src="js/entities.js"></script>
<script src="js/hud.js"></script>
<script src="js/main.js"></script>
```

- [ ] **Step 4: 语法检查**

Run: `node --check js/hud.js` → 无输出
Run: `node --check js/ui.js` → 无输出

- [ ] **Step 5: 提交**

```bash
git add js/hud.js js/ui.js index.html
git commit -m "feat: 战斗 HUD（血条/红闪/死亡/飘字）与 10 格快捷栏"
```

---

### Task 10: js/main.js — 战斗接线（整文件局部修改）

**Files:**
- Modify: `js/main.js`

按以下七处修改（其余保持 M1 原样）：

- [ ] **Step 1: 模块引用与死亡状态**

顶部 `const Net = MW.Net, Entities = MW.Entities, P = MW.Protocol;` 改为：

```js
  const Net = MW.Net, Entities = MW.Entities, P = MW.Protocol;
  const Combat = MW.Combat, Hud = MW.Hud;
```

`let world = null, player = null;` 之后加：

```js
  let selfDead = false; // 死亡期间冻结输入，等服务器复活传送
```

- [ ] **Step 2: 快捷栏 10 格按键**

键盘数字选格的两行：

```js
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 8) { hotbarIndex = n - 1; UI.selectSlot(hotbarIndex); }
```

改为（1~9 与 0；0 是第 10 格；同步手持模型）：

```js
    if (/^[0-9]$/.test(e.key)) {
      hotbarIndex = e.key === '0' ? 9 : parseInt(e.key, 10) - 1;
      UI.selectSlot(hotbarIndex);
      Combat.setHeld(hotbarIndex);
    }
```

滚轮处理：

```js
  window.addEventListener('wheel', (e) => {
    hotbarIndex = (hotbarIndex + (e.deltaY > 0 ? 1 : -1) + 8) % 8;
    UI.selectSlot(hotbarIndex);
  });
```

改为：

```js
  window.addEventListener('wheel', (e) => {
    hotbarIndex = (hotbarIndex + (e.deltaY > 0 ? 1 : -1) + 10) % 10;
    UI.selectSlot(hotbarIndex);
    Combat.setHeld(hotbarIndex);
  });
```

- [ ] **Step 3: mousedown 路由（武器优先，方块沿用）**

`document.addEventListener('mousedown', (e) => {` 函数体开头的

```js
    if (!isLocked() || !world) return;
```

改为：

```js
    if (!isLocked() || !world || selfDead) return;
    if (e.button === 0) {
      const d0 = viewDir();
      const eye = { x: player.x, y: player.y + Player.EYE, z: player.z };
      const consumed = Combat.onAttackClick(hotbarIndex, eye, d0, Entities.mobList(), Net);
      if (consumed === 'shoot') {
        Entities.spawnLocalArrow(eye.x, eye.y, eye.z, d0.x, d0.y, d0.z); // 本地箭预表现
        return;
      }
      if (consumed) return; // 武器格：不挖方块
    } else if (Combat.ITEMS[hotbarIndex].kind !== 'block') {
      return; // 武器格右键无操作
    }
```

并把放置方块取 id 的一行：

```js
      const id = Blocks.HOTBAR[hotbarIndex];
```

改为：

```js
      const id = Combat.ITEMS[hotbarIndex].id;
```

- [ ] **Step 4: HUD/手持初始化**

`UI.buildHotbar(atlas);` 改为：

```js
  UI.buildHotbar(atlas, Combat.ITEMS);
  Combat.init(camera);
```

> 注意：`camera.add(held)` 要求相机在场景树里；在 `Entities.init(scene);` 之后加一行 `scene.add(camera);`（Three.js 相机默认不在场景中，挂子物体必须先 add）。

- [ ] **Step 5: 战斗消息接线**

`Net.on('online', ...)` 之后追加：

```js
  Net.on('mobSpawn', (m) => Entities.upsertMob(m));
  Net.on('mobMove', (m) => Entities.moveMob(m));
  Net.on('mobHurt', (m) => {
    const e = Entities.mobList().find((x) => x.id === m.id);
    Entities.hurtMob(m);
    if (e) Hud.floatDamage(e.x, e.y + e.height + 0.3, e.z, '-' + m.dmg, '#ffd24a');
  });
  Net.on('mobDie', (m) => Entities.dieMob(m.id));
  Net.on('mobDespawn', (m) => Entities.despawnMob(m.id));
  Net.on('arrowSpawn', (m) => Entities.remoteArrow(m));
  Net.on('arrowDie', (m) => Entities.dieArrow(m));
  Net.on('hpUpdate', (m) => {
    maxHpCache = m.max;
    Hud.setHp(m.hp, m.max);
    if (selfDead && m.hp > 0) { selfDead = false; Hud.showDeath(false); }
  });
  Net.on('playerHurt', (m) => { Hud.setHp(m.hp, maxHpCache); Hud.flashRed(); });
  Net.on('playerDie', () => { selfDead = true; Hud.showDeath(true); });
```

`startWorld(msg)` 内 `UI.setOnline(msg.online);` 之前加：

```js
    maxHpCache = msg.maxHp;
    Hud.setHp(msg.hp, msg.maxHp);
    for (const mb of msg.mobs) Entities.upsertMob(mb);
```

`softReset(msg)` 内 `Entities.clear();` 之后同样加：

```js
    maxHpCache = msg.maxHp;
    Hud.setHp(msg.hp, msg.maxHp);
    selfDead = false;
    Hud.showDeath(false);
    for (const mb of msg.mobs) Entities.upsertMob(mb);
```

`let selfDead = false;` 旁再声明缓存：

```js
  let maxHpCache = 20; // playerHurt 只带 hp，max 来自 welcome/hpUpdate
```

- [ ] **Step 6: 主循环接入**

主循环 `if (world && player) {` 里的

```js
      if (isLocked()) Player.update(player, world, dt, input);
```

改为（死亡冻结操作）：

```js
      if (isLocked() && !selfDead) Player.update(player, world, dt, input);
```

`Entities.update(dt);` 改为：

```js
    Entities.update(dt, world);
    Combat.update(dt);
    Hud.update(dt, camera);
```

- [ ] **Step 7: 语法检查 + 回归 + 冒烟**

Run: `node --check js/main.js` → 无输出
Run: `node tests/run_all.js` → `ALL TESTS PASSED`

服务端冒烟（dev 在跑）：
1. `curl.exe -s http://127.0.0.1:8787/js/combat.js | Select-String 'onAttackClick'` 有匹配
2. `node tests/manual/combat_probe.js` → 退出码 0
3. `node tests/manual/two_clients.js` → 退出码 0

- [ ] **Step 8: 提交**

```bash
git add js/main.js
git commit -m "feat: 主程序战斗接线（武器路由/怪物与箭消息/HP与死亡/手持更新）"
```

---

### Task 11: README 更新 + 浏览器综合验收

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 增补**

「玩法」表格在「放方块」行后插入两行：

```markdown
| 攻击（剑/弓） | 选中武器后鼠标左键 |
| 选武器 | 数字键 1（剑）、2（弓） |
```

「选方块」行改为：

```markdown
| 选方块 | 数字键 3~9、0 或滚轮 |
```

「特性」清单追加：

```markdown
- 怪物与战斗：四种等级地带怪物（史莱姆/僵尸/骷髅弓手/恶狼）、确定性营地散布、服务器权威 AI 与战斗结算
- 剑与弓：近战击退、带重力弹道的箭矢；受击红闪、伤害飘字、脱战回血、死亡 3 秒复活
```

「开发」一节探针命令后追加：

```markdown
战斗链路探针（走到营地砍怪，约 3 分钟）：

​```bash
node tests/manual/combat_probe.js
​```
```

（上行围栏为实际三反引号。）

- [ ] **Step 2: 全量测试 + 双探针**

Run: `node tests/run_all.js` → `ALL TESTS PASSED`
Run: `node tests/manual/two_clients.js` → 退出码 0
Run: `node tests/manual/combat_probe.js` → 退出码 0

- [ ] **Step 3: 浏览器双窗口验收（对照 spec 验证标准 3、4、5、6、10）**

dev 在跑，两个不同源窗口（127.0.0.1 与 localhost）各自进入：

1. 走到 60 格外找到史莱姆营地（可用 `MobsDef.campsNear(MyWorld.game.seed, 玩家x, 玩家z, 12)` 在控制台定位最近营地）：看到弹跳的史莱姆、头顶「Lv.N 史莱姆」名牌
2. 按 1 选剑、对准史莱姆左键：伤害飘字「-3」、怪物血条出现并减少、手臂挥击动画；砍死后尸体倒地消失，30 秒后原地重生
3. 史莱姆反击：屏幕边缘红闪、左下血条减少；跑回安全区，5 秒后每秒回 1 血直至满
4. 按 2 选弓、抬高角度射箭：箭有下坠弹道、能射中远处怪物
5. 故意死亡：黑屏「你死了」、3 秒后出生点满血复活；刷新页面 HP 恢复值与离线前一致（持久化）
6. 把僵尸（150 格外）拉离营地 24 格：脱战回巢、途中无敌、回巢满血
7. 双窗口同屏打同一只怪：两边看到的扣血/死亡一致；在线人数正确
8. 两窗口控制台无报错

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: README 补战斗玩法与探针说明"
```

- [ ] **Step 5: （可选，需用户确认）部署**

```bash
npx wrangler deploy
```

部署后用线上 URL 复测验收清单第 1、2、3 项。

---

## 已知取舍（有意设计，不要"顺手修"）

- 怪物运行时状态不持久化：DO 重启/休眠唤醒整体重置（spec 明确接受）
- 营地无人邻近即整体移除、再激活全量重生（玩家无感知差异，比"冻结"实现简单）
- 箭矢不逐 tick 同步：双方按同一常量独立积分，预表现与权威终点（arrowDie）可能有厘米级偏差
- 近战与仇恨无视线遮挡判定；怪物之间无碰撞
- mobMove 仅按当前位置做兴趣过滤，玩家高速移动时可能漏掉个别帧（下帧自愈，客户端未知 id 静默忽略）
- M2 不结算经验/任务（M3 在 hurtMob 死亡分支与 damagePlayer 死亡分支接入）
- 受击无敌只对怪物近战与箭生效，无作弊保护语义（防作弊从简）
