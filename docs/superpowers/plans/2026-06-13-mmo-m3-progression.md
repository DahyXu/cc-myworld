# M3 成长与任务 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M2 战斗之上接通成长与任务——杀怪给经验、经验满则升级（属性提升+回满血+金光）、死亡扣当前等级经验 10%、出生点 NPC「长老」发放 10 环固定任务链与等级日常，配经验条/等级徽章/任务追踪 HUD，全部进度持久化——成为「能练级做任务的联机世界」。

**Architecture:** 经验/等级/任务全部服务器权威结算，接 M2 在 `hurtMob`（击杀给经验+任务计数）与 `damagePlayer`（死亡扣经验）预留的钩子。成长公式集中在 `shared/stats.js`，任务链/日常/奖励纯函数在新建 `shared/quests_def.js`（Node 可单测）。经验值用「当前等级内进度」表示（`xp ∈ [0, xpToNext(level))`，升级即 `xp -= xpToNext; level++`），死亡惩罚即 `xp = xpAfterDeath(xp)`。NPC 是出生点固定坐标（非实体模拟）：服务器只做 3 格邻近校验 + 收发 `questAccept/questTurnIn`，客户端渲染体素长老 + 接/交标记，复用现有 overlay 机制做对话框。`players` 表的 `level/xp/quest_id/quest_progress/chain_index` 列在 M2 已建好，无需迁移。

**Tech Stack:** 与 M1/M2 一致——Three.js UMD、原生 WebSocket、Cloudflare DO（SQLite/Hibernation API）、wrangler（npx）、node:assert 零框架测试。

**范围（spec M3 里程碑）：** 经验/等级/数值成长、死亡经验惩罚、NPC 与 10 环任务链 + 等级日常、任务 HUD、持久化收尾。用户已确认：完全按 spec 实现、死亡扣 10% 当前等级经验、10 环链 + 无限日常都做。

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
| `shared/stats.js` | 修改 | 加经验结算 `applyXp`、死亡惩罚 `xpAfterDeath` |
| `tests/test_stats.js` | 修改 | 追加 applyXp/xpAfterDeath 用例 |
| `shared/quests_def.js` | 新建 | NPC 坐标/范围、10 环任务链、日常生成、奖励公式、quest_id 编解码（纯函数） |
| `tests/test_quests.js` | 新建 | quests_def 单测 |
| `shared/protocol.js` | 修改 | 加 `validQuestMsg`（占位无负载校验，保持对称） |
| `tests/test_protocol.js` | 修改 | 追加 validQuestMsg 用例 |
| `server/world_do.js` | 修改 | 导入 quests_def；会话加 xp/quest 字段；接经验/升级/任务计数/死亡惩罚；questAccept/TurnIn；welcome/persist 扩展 |
| `tests/manual/quest_probe.js` | 新建 | 任务链路探针（接任务→杀够→交付领经验→升级） |
| `js/hud.js` | 修改 | 经验条 `setXp`、等级徽章 `setLevel`、任务追踪 `setQuest`、升级金光 `levelUpFlash` |
| `js/ui.js` | 修改 | overlay 加 `npc` 模式（NPC 对话框） |
| `js/entities.js` | 修改 | NPC 长老渲染 `setNpc` + 标记 `setNpcMarker` |
| `index.html` | 修改 | 经验条/等级徽章/任务面板/升级金光 DOM+CSS、`#ovNpc` 对话框、新 script 标签 |
| `js/main.js` | 修改 | 接 xpGain/levelUp/questState/pLevelUp；E 键 NPC 交互；NPC 标记更新；welcome 成长/任务初始化 |
| `tests/run_all.js` | 修改 | 注册 test_quests |
| `README.md` | 修改 | 补成长与任务玩法 |

**消息协议（M3 新增）：**
- C→S：`questAccept{}`（在 NPC 3 格内接当前应接任务）、`questTurnIn{}`（在 NPC 3 格内交付已完成任务）
- S→C：`xpGain{xp,level,xpNext}`（xpNext=0 表示满级）、`levelUp{level,maxHp,hp}`（仅本人，附属性与回满血）、`pLevelUp{pid,x,y,z}`（附近玩家，金光飘字）、`questState{quest}`（quest = `{type,count,progress}` 或 `null`）
- `welcome` 追加字段：`level`、`xp`、`xpNext`、`quest`（`{type,count,progress}` 或 `null`）

**M3 已知取舍（有意设计，实现时不要"顺手修"）：**
- 经验用「当前等级内进度」而非累计总经验：升级 `xp-=xpToNext`、死亡 `xp=xpAfterDeath(xp)` 都最简；满 20 级 `xp` 恒为 0、经验条显示满格
- 死亡只扣当前等级进度 10%（`floor(xp*0.1)`）、不降级：低等级或刚升级（xp 小）几乎无损，温和惩罚
- `quest_id` 编码 `kind:type:count`（如 `c:slime:5` / `d:zombie:13`），自包含——奖励由 type+count 现算，无需额外列；`chain_index` 仅记下一个该发的链任务序号
- NPC 是固定坐标常量、非实体：不进 mobs/兴趣同步，客户端用 `QuestsDef.NPC_X/Z` + 本地地表高度自行摆放；服务器只做 3 格邻近校验
- 同时仅 1 个任务（spec 明确简化）；击杀计数按最后一击归属，与经验同源
- 升级回满血、金光本人全屏 + 附近玩家一个金色「⬆升级!」飘字（轻量广播，不做粒子）
- 任务计数只在「持有匹配怪种任务且未达标」时 +1；达标后继续杀不超额、不提示
- 日常任务怪种/数量按接取时等级定，编进 quest_id 不随后续升级变化（接时快照）
- NPC 对话用 overlay 的 `npc` 模式：开对话即退出指针锁定、可点按钮；关闭后回 `start` 模式（点击重新锁定）——与 ESC 暂停同套机制
- 经验不跨怪种共享任务计数；箭杀且射手已离线时经验/任务丢弃（`sessionByPid` 查不到即跳过，无离线补偿）

---

### Task 1: shared/stats.js — 经验结算与死亡惩罚（TDD）

**Files:**
- Modify: `shared/stats.js`
- Test: `tests/test_stats.js`

- [ ] **Step 1: 追加失败测试**

`tests/test_stats.js` 在 `console.log('test_stats OK');` 之前插入：

```js
// applyXp：当前等级进度模型（xp ∈ [0, xpToNext(level))）
// 升 1 级：1 级满 25 经验，给 25 → 升到 2 级、余 0
assert.deepStrictEqual(S.applyXp(1, 0, 25), { level: 2, xp: 0, leveled: true });
// 不足升级：给 10 → 仍 1 级、xp=10
assert.deepStrictEqual(S.applyXp(1, 0, 10), { level: 1, xp: 10, leveled: false });
// 携带已有进度：1 级已 20，给 10 → 30≥25 升级、余 5
assert.deepStrictEqual(S.applyXp(1, 20, 10), { level: 2, xp: 5, leveled: true });
// 连升多级：1 级给 25+ floor(25*2^1.5)=25+70=95 恰好升到 3 级余 0
assert.deepStrictEqual(S.applyXp(1, 0, 95), { level: 3, xp: 0, leveled: true });
// 满级吞没：20 级给任意经验 → 仍 20 级、xp 恒 0、不再 leveled
assert.deepStrictEqual(S.applyXp(20, 0, 99999), { level: 20, xp: 0, leveled: false });
// 逼近满级：19 级给巨量 → 封顶 20 级、xp=0
assert.strictEqual(S.applyXp(19, 0, 99999).level, 20);
assert.strictEqual(S.applyXp(19, 0, 99999).xp, 0);

// xpAfterDeath：扣当前等级进度的 10%（向下取整的损失）
assert.strictEqual(S.xpAfterDeath(100), 90, '扣 floor(100*0.1)=10');
assert.strictEqual(S.xpAfterDeath(5), 5, 'floor(5*0.1)=0 不扣');
assert.strictEqual(S.xpAfterDeath(0), 0);
assert.strictEqual(S.xpAfterDeath(19), 18, 'floor(19*0.1)=1');
```

- [ ] **Step 2: 运行确认失败**

Run: `node tests/test_stats.js`
Expected: FAIL，`S.applyXp is not a function`

- [ ] **Step 3: 实现**

`shared/stats.js` 在 `function xpToNext(level) { ... }` 之后插入：

```js
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
```

导出对象改为：

```js
  root.MyWorld.Stats = { LEVEL_CAP, maxHp, swordDamage, bowDamage, xpToNext, applyXp, xpAfterDeath };
```

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `node tests/test_stats.js` → `test_stats OK`
Run: `node tests/run_all.js` → `ALL TESTS PASSED`

- [ ] **Step 5: 提交**

```bash
git add shared/stats.js tests/test_stats.js
git commit -m "feat: 经验结算 applyXp 与死亡惩罚 xpAfterDeath（当前等级进度模型）"
```

---

### Task 2: shared/quests_def.js — 任务链/日常/奖励/编解码（TDD）

**Files:**
- Create: `shared/quests_def.js`
- Test: `tests/test_quests.js`
- Modify: `tests/run_all.js`

- [ ] **Step 1: 写失败测试**

创建 `tests/test_quests.js`：

```js
// tests/test_quests.js — 任务链、日常生成、奖励、quest_id 编解码
'use strict';
const assert = require('node:assert');
require('../shared/mobs_def.js'); // quests_def 依赖 MobsDef.TYPES 的经验/名称
require('../shared/quests_def.js');
const Q = globalThis.MyWorld.QuestsDef;

// NPC 常量存在
assert.strictEqual(typeof Q.NPC_X, 'number');
assert.strictEqual(typeof Q.NPC_Z, 'number');
assert.strictEqual(Q.NPC_RANGE, 3);

// 固定链 10 环，依次引导四地带
assert.strictEqual(Q.CHAIN.length, 10);
assert.deepStrictEqual(Q.CHAIN[0], { type: 'slime', count: 5 });
assert.deepStrictEqual(Q.CHAIN[9], { type: 'wolf', count: 15 });

// 奖励 = floor(count × 怪基准经验 × 1.5)；史莱姆基准经验 8
assert.strictEqual(Q.questReward('slime', 5), Math.floor(5 * 8 * 1.5)); // 60
assert.strictEqual(Q.questReward('wolf', 15), Math.floor(15 * 40 * 1.5)); // 900

// offer：chainIndex < 10 发链任务；==10 起发日常
const q0 = Q.offer(0, 1);
assert.strictEqual(q0.kind, 'c');
assert.strictEqual(q0.type, 'slime');
assert.strictEqual(q0.count, 5);
assert.strictEqual(q0.id, 'c:slime:5');
assert.strictEqual(q0.reward, 60);
const q9 = Q.offer(9, 12);
assert.strictEqual(q9.type, 'wolf');
assert.strictEqual(q9.count, 15);
const daily = Q.offer(10, 5); // 链已走完，等级 5 → 僵尸地带
assert.strictEqual(daily.kind, 'd');
assert.strictEqual(daily.type, 'zombie');
assert.ok(daily.count >= 8, '日常数量随等级');
assert.ok(daily.id.startsWith('d:'));

// 日常怪种随等级映射地带
assert.strictEqual(Q.offer(10, 1).type, 'slime');
assert.strictEqual(Q.offer(10, 8).type, 'skeleton');
assert.strictEqual(Q.offer(10, 15).type, 'wolf');

// parse：id 往返一致 + 奖励现算
const p = Q.parse('c:slime:5');
assert.deepStrictEqual([p.kind, p.type, p.count, p.reward], ['c', 'slime', 5, 60]);
const pd = Q.parse('d:zombie:13');
assert.deepStrictEqual([pd.kind, pd.type, pd.count], ['d', 'zombie', 13]);
assert.strictEqual(pd.reward, Math.floor(13 * 15 * 1.5)); // 僵尸基准经验 15
assert.strictEqual(Q.parse('garbage'), null, '非法 id 返回 null');
assert.strictEqual(Q.parse('c:slime:0'), null, 'count 必须 >0');

console.log('test_quests OK');
```

- [ ] **Step 2: 运行确认失败**

Run: `node tests/test_quests.js`
Expected: FAIL，`Cannot find module '../shared/quests_def.js'`

- [ ] **Step 3: 实现 shared/quests_def.js**

```js
// shared/quests_def.js — 两端共享：NPC 坐标、任务链、日常生成、奖励、quest_id 编解码（纯函数）
(function (root) {
  'use strict';
  const MobsDef = root.MyWorld.MobsDef;

  // NPC「长老」固定在出生点旁（出生点 SPAWN 8.5,8.5，长老在 +z 4 格处，玩家出生即可见）
  const NPC_X = 8.5, NPC_Z = 12.5, NPC_RANGE = 3;

  // 10 环固定任务链：依次引导四个地带（史莱姆→僵尸→骷髅→恶狼）
  const CHAIN = [
    { type: 'slime', count: 5 }, { type: 'slime', count: 10 },
    { type: 'zombie', count: 5 }, { type: 'zombie', count: 10 },
    { type: 'skeleton', count: 5 }, { type: 'skeleton', count: 10 },
    { type: 'wolf', count: 5 }, { type: 'wolf', count: 8 },
    { type: 'wolf', count: 12 }, { type: 'wolf', count: 15 },
  ];

  // 奖励经验 = floor(数量 × 怪基准经验 × 1.5)；交任务是经验大头
  function questReward(type, count) {
    return Math.floor(count * MobsDef.TYPES[type].xp * 1.5);
  }

  // 等级 → 对应地带怪种（日常用）
  function typeForLevel(level) {
    if (level <= 3) return 'slime';
    if (level <= 6) return 'zombie';
    if (level <= 9) return 'skeleton';
    return 'wolf';
  }

  // 接取时应发的任务：链未走完发链任务，否则按等级发日常
  function offer(chainIndex, level) {
    if (chainIndex < CHAIN.length) {
      const c = CHAIN[chainIndex];
      return make('c', c.type, c.count);
    }
    const type = typeForLevel(level);
    const count = 8 + level; // 日常数量随等级
    return make('d', type, count);
  }

  function make(kind, type, count) {
    return { id: kind + ':' + type + ':' + count, kind, type, count, reward: questReward(type, count) };
  }

  // quest_id 解码：kind:type:count → {kind,type,count,reward}；非法返回 null
  function parse(id) {
    if (typeof id !== 'string') return null;
    const m = id.split(':');
    if (m.length !== 3) return null;
    const kind = m[0], type = m[1], count = parseInt(m[2], 10);
    if ((kind !== 'c' && kind !== 'd') || !MobsDef.TYPES[type] || !(count > 0)) return null;
    return { kind, type, count, reward: questReward(type, count) };
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.QuestsDef = { NPC_X, NPC_Z, NPC_RANGE, CHAIN, questReward, typeForLevel, offer, parse };
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: 运行确认通过**

Run: `node tests/test_quests.js`
Expected: `test_quests OK`

- [ ] **Step 5: 注册 run_all 并全量回归**

`tests/run_all.js` 文件数组在 `'test_mobs.js'` 后追加 `'test_quests.js'`。

Run: `node tests/run_all.js`
Expected: `ALL TESTS PASSED`

- [ ] **Step 6: 提交**

```bash
git add shared/quests_def.js tests/test_quests.js tests/run_all.js
git commit -m "feat: 任务定义模块（NPC坐标/10环链/日常/奖励/quest_id编解码）"
```

---

### Task 3: shared/protocol.js — 任务消息占位校验（TDD）

**Files:**
- Modify: `shared/protocol.js`
- Test: `tests/test_protocol.js`

> questAccept/questTurnIn 无负载，校验只判它是对象（与 validAttack/validShoot 对称，便于将来扩展，也防 null 解引用）。

- [ ] **Step 1: 追加失败测试**

`tests/test_protocol.js` 在 `console.log('test_protocol OK');` 之前插入：

```js
// 任务消息占位校验：只要求是对象（无负载）
assert.ok(P.validQuestMsg({}));
assert.ok(P.validQuestMsg({ t: 'questAccept' }));
assert.ok(!P.validQuestMsg(null));
assert.ok(!P.validQuestMsg('x'));
assert.ok(!P.validQuestMsg(5));
```

- [ ] **Step 2: 运行确认失败**

Run: `node tests/test_protocol.js`
Expected: FAIL（validQuestMsg undefined）

- [ ] **Step 3: 实现**

`shared/protocol.js` 在 `function validShoot(msg) { ... }` 之后插入：

```js
  // 任务意图校验：无负载，仅防 null/非对象
  function validQuestMsg(msg) {
    return !!msg && typeof msg === 'object';
  }
```

导出对象在 `validAttack, validShoot,` 后追加 `validQuestMsg,`：

```js
    inInterest, validEdit, clampMove, sanitizeName, backoffMs, validAttack, validShoot, validQuestMsg,
```

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `node tests/test_protocol.js` → `test_protocol OK`
Run: `node tests/run_all.js` → `ALL TESTS PASSED`

- [ ] **Step 5: 提交**

```bash
git add shared/protocol.js tests/test_protocol.js
git commit -m "feat: 协议补 validQuestMsg 占位校验"
```

---

### Task 4: WorldDO — 经验/升级结算 + 死亡惩罚（接 M2 钩子）

**Files:**
- Modify: `server/world_do.js`

- [ ] **Step 1: 导入 quests_def + 会话加成长/任务字段**

顶部导入区在 `import '../shared/mobs_def.js';` 后追加：

```js
import '../shared/quests_def.js';
```

模块常量区把

```js
const Physics = MW.Physics, Stats = MW.Stats, MobsDef = MW.MobsDef;
```

改为：

```js
const Physics = MW.Physics, Stats = MW.Stats, MobsDef = MW.MobsDef, QuestsDef = MW.QuestsDef;
```

`boot()` 里休眠唤醒重建会话的对象字面量（`level: lvl, hp: ..., maxHp: mhp,` 那一行）改为追加成长/任务字段：

```js
        level: lvl, xp: row && isFinite(row.xp) ? row.xp : 0,
        questId: row ? row.quest_id : null,
        questProg: row && isFinite(row.quest_progress) ? row.quest_progress : 0,
        chainIndex: row && isFinite(row.chain_index) ? row.chain_index : 0,
        hp: row && isFinite(row.hp) && row.hp > 0 ? Math.min(row.hp, mhp) : mhp, maxHp: mhp,
```

`onHello()` 里构造会话的那行（`const s = { pid: this.nextPid++, ..., level, hp, maxHp, ... };`）拆开补字段——把

```js
    const level = row && row.level ? row.level : 1;
    const maxHp = Stats.maxHp(level);
    const hp = row && isFinite(row.hp) && row.hp > 0 ? Math.min(row.hp, maxHp) : maxHp;
    const s = { pid: this.nextPid++, token, name, x, y, z, yaw: 0, pitch: 0, lastMoveMs: now, visible: new Set(),
      level, hp, maxHp, dead: false, deadUntil: 0, invulnUntil: 0, lastHurtAt: 0, nextRegenAt: 0, atkReadyAt: 0, bowReadyAt: 0 };
```

改为：

```js
    const level = row && row.level ? row.level : 1;
    const maxHp = Stats.maxHp(level);
    const hp = row && isFinite(row.hp) && row.hp > 0 ? Math.min(row.hp, maxHp) : maxHp;
    const s = { pid: this.nextPid++, token, name, x, y, z, yaw: 0, pitch: 0, lastMoveMs: now, visible: new Set(),
      level, xp: row && isFinite(row.xp) ? row.xp : 0,
      questId: row ? row.quest_id : null,
      questProg: row && isFinite(row.quest_progress) ? row.quest_progress : 0,
      chainIndex: row && isFinite(row.chain_index) ? row.chain_index : 0,
      hp, maxHp, dead: false, deadUntil: 0, invulnUntil: 0, lastHurtAt: 0, nextRegenAt: 0, atkReadyAt: 0, bowReadyAt: 0 };
```

- [ ] **Step 2: 经验/升级/任务计数辅助方法**

在 `hurtMob(mob, dmg, attacker, now) { ... }` 方法之前插入以下整段：

```js
  // xpNext：客户端经验条用；满级返回 0（条显示满格）
  xpNext(level) {
    const n = Stats.xpToNext(level);
    return n === Infinity ? 0 : n;
  }

  // 当前任务状态消息（quest 为 {type,count,progress} 或 null）
  questStateMsg(s) {
    if (!s.questId) return { t: 'questState', quest: null };
    const q = QuestsDef.parse(s.questId);
    if (!q) return { t: 'questState', quest: null };
    return { t: 'questState', quest: { type: q.type, count: q.count, progress: s.questProg } };
  }

  // 给玩家加经验，处理连升级（回满血+金光），下发 xpGain/levelUp
  gainXp(ws, s, amount) {
    const r = Stats.applyXp(s.level, s.xp, amount);
    s.xp = r.xp;
    if (r.leveled) {
      s.level = r.level;
      s.maxHp = Stats.maxHp(s.level);
      s.hp = s.maxHp; // 升级回满血
      this.send(ws, { t: 'levelUp', level: s.level, maxHp: s.maxHp, hp: s.hp });
      for (const [ows, os] of this.sessions) {
        if (os === s) continue;
        if (P.inInterest(s.x, s.z, os.x, os.z)) this.send(ows, { t: 'pLevelUp', pid: s.pid, x: s.x, y: s.y, z: s.z });
      }
    }
    this.send(ws, { t: 'xpGain', xp: s.xp, level: s.level, xpNext: this.xpNext(s.level) });
  }

  // 最后一击击杀结算：给经验 + 匹配怪种任务计数
  grantKill(attacker, mob) {
    const [ws, s] = this.sessionByPid(attacker.pid);
    if (!s || s.dead) return; // 离线/不存在的射手：丢弃（无离线补偿，spec 接受）
    this.gainXp(ws, s, MobsDef.mobStats(mob.type, mob.lv).xp);
    if (s.questId) {
      const q = QuestsDef.parse(s.questId);
      if (q && q.type === mob.type && s.questProg < q.count) {
        s.questProg++;
        this.send(ws, this.questStateMsg(s));
      }
    }
  }
```

- [ ] **Step 3: 接 hurtMob 死亡钩子**

`hurtMob` 的死亡分支——把

```js
    if (mob.hp <= 0) {
      mob.hp = 0; mob.dead = true;
      mob.respawnAt = now + 30000; // 死后 30 秒原地重生
      this.broadcastMob(mob, { t: 'mobDie', id: mob.id });
      // M3 在此结算经验与任务计数（最后一击归属 attacker.pid）
    } else {
```

改为：

```js
    if (mob.hp <= 0) {
      mob.hp = 0; mob.dead = true;
      mob.respawnAt = now + 30000; // 死后 30 秒原地重生
      this.broadcastMob(mob, { t: 'mobDie', id: mob.id });
      this.grantKill(attacker, mob); // 经验 + 任务计数（最后一击归属）
    } else {
```

- [ ] **Step 4: 接 damagePlayer 死亡钩子（扣经验）**

`damagePlayer` 的死亡分支——把

```js
    if (s.hp <= 0) {
      s.hp = 0; s.dead = true; s.deadUntil = now + P.DEATH_RESPAWN_MS;
      if (ws) this.send(ws, { t: 'playerDie' });
      // M3 在此结算死亡经验惩罚
    } else if (ws) {
```

改为：

```js
    if (s.hp <= 0) {
      s.hp = 0; s.dead = true; s.deadUntil = now + P.DEATH_RESPAWN_MS;
      s.xp = Stats.xpAfterDeath(s.xp); // 扣当前等级进度 10%，不降级
      if (ws) { this.send(ws, { t: 'playerDie' }); this.send(ws, { t: 'xpGain', xp: s.xp, level: s.level, xpNext: this.xpNext(s.level) }); }
    } else if (ws) {
```

- [ ] **Step 5: welcome 与 persistSession 扩展**

`onHello` 的 welcome 发送——把

```js
    this.send(ws, { t: 'welcome', pid: s.pid, seed: this.seed, x: s.x, y: s.y, z: s.z, edits, players, online: this.sessions.size, hp: s.hp, maxHp: s.maxHp, mobs });
```

改为（追加 level/xp/xpNext/quest）：

```js
    const qstate = this.questStateMsg(s).quest;
    this.send(ws, { t: 'welcome', pid: s.pid, seed: this.seed, x: s.x, y: s.y, z: s.z, edits, players, online: this.sessions.size,
      hp: s.hp, maxHp: s.maxHp, level: s.level, xp: s.xp, xpNext: this.xpNext(s.level), quest: qstate, mobs });
```

`persistSession(s)` 的 UPDATE——把

```js
    this.sql.exec(`UPDATE players SET x = ?, y = ?, z = ?, hp = ?, last_seen = ? WHERE token = ?`,
      px, py, pz, ph, Date.now(), s.token);
```

改为（补 level/xp/quest 列）：

```js
    this.sql.exec(`UPDATE players SET x = ?, y = ?, z = ?, hp = ?, level = ?, xp = ?, quest_id = ?, quest_progress = ?, chain_index = ?, last_seen = ? WHERE token = ?`,
      px, py, pz, ph, s.level, s.xp, s.questId, s.questProg, s.chainIndex, Date.now(), s.token);
```

- [ ] **Step 6: questAccept/questTurnIn 路由与处理**

`webSocketMessage` 的路由——在 `else if (msg.t === 'respawn') this.onRespawn(ws, s);` 后插入：

```js
    else if (msg.t === 'questAccept') this.onQuestAccept(ws, s);
    else if (msg.t === 'questTurnIn') this.onQuestTurnIn(ws, s);
```

在 `onRespawn(ws, s) { ... }` 方法之后插入：

```js
  // NPC 邻近校验（位置上报有滞后，给 1 格余量）
  nearNpc(s) {
    return Math.hypot(s.x - QuestsDef.NPC_X, s.z - QuestsDef.NPC_Z) <= QuestsDef.NPC_RANGE + 1;
  }

  onQuestAccept(ws, s) {
    if (s.dead || s.questId || !this.nearNpc(s)) return; // 已有任务/不在 NPC 旁：忽略
    const q = QuestsDef.offer(s.chainIndex, s.level);
    s.questId = q.id; s.questProg = 0;
    this.send(ws, this.questStateMsg(s));
  }

  onQuestTurnIn(ws, s) {
    if (s.dead || !s.questId || !this.nearNpc(s)) return;
    const q = QuestsDef.parse(s.questId);
    if (!q || s.questProg < q.count) return; // 未完成不可交付
    this.gainXp(ws, s, q.reward);
    if (q.kind === 'c') s.chainIndex++; // 链任务推进；日常不推进
    s.questId = null; s.questProg = 0;
    this.send(ws, this.questStateMsg(s)); // quest:null → 客户端隐藏追踪、NPC 转「可接」
  }
```

- [ ] **Step 7: 模块可加载冒烟 + 全量回归**

Run: `node -e "require('./js/noise.js');require('./js/blocks.js');require('./js/world.js');require('./shared/protocol.js');require('./shared/physics.js');require('./shared/stats.js');require('./shared/mobs_def.js');require('./shared/quests_def.js');console.log('modules load OK')"`
Expected: `modules load OK`（验证 quests_def 与依赖可被 Node 加载）

Run: `node tests/run_all.js`
Expected: `ALL TESTS PASSED`（服务器逻辑无单测，靠后续探针；此处确认未破坏共享模块）

- [ ] **Step 8: 提交**

```bash
git add server/world_do.js
git commit -m "feat: WorldDO 成长与任务结算（经验/升级/死亡惩罚/任务计数/接交付/持久化）"
```

---

### Task 5: WorldDO 战斗链路探针扩展 — 任务与经验（手动探针）

**Files:**
- Create: `tests/manual/quest_probe.js`

> 复用 combat_probe 的走位手法，串起：接任务 → 杀够史莱姆 → 看 questState 达标 → 交付 → 收 xpGain（奖励）。需 `npx wrangler dev` 在跑。

- [ ] **Step 1: 写探针**

创建 `tests/manual/quest_probe.js`：

```js
// tests/manual/quest_probe.js — 任务链路：接任务→杀够史莱姆→交付领经验
// 先启动: npx wrangler dev --port 8787 --persist-to ../cc-myworld-state
// 运行: node tests/manual/quest_probe.js
'use strict';
const assert = require('node:assert');
require('../../js/noise.js');
require('../../js/world.js');
require('../../shared/mobs_def.js');
require('../../shared/quests_def.js');
const MobsDef = globalThis.MyWorld.MobsDef;
const QuestsDef = globalThis.MyWorld.QuestsDef;
const World = globalThis.MyWorld.World;
const URL_WS = process.argv[2] || 'ws://127.0.0.1:8787/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function tok() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

(async () => {
  const ws = new WebSocket(URL_WS);
  let welcome = null;
  const mobs = new Map();
  const ev = { quest: [], xp: [], die: [] };
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') { welcome = m; for (const mb of m.mobs) mobs.set(mb.id, mb); }
    else if (m.t === 'mobSpawn') mobs.set(m.id, m);
    else if (m.t === 'mobMove') { const mb = mobs.get(m.id); if (mb) { mb.x = m.x; mb.y = m.y; mb.z = m.z; } }
    else if (m.t === 'mobDie') { ev.die.push(m); mobs.delete(m.id); }
    else if (m.t === 'questState') ev.quest.push(m.quest);
    else if (m.t === 'xpGain') ev.xp.push(m);
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('连不上'))); });
  ws.send(JSON.stringify({ t: 'hello', token: tok(), name: '任务探针' }));
  while (!welcome) await sleep(50);

  const lw = World.create(welcome.seed);
  const groundY = (px, pz) => lw.terrainHeight(Math.floor(px), Math.floor(pz)) + 1;
  let x = welcome.x, z = welcome.z;
  const moveTo = async (tx, tz, stopD) => {
    for (let i = 0; i < 5000; i++) {
      const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz);
      if (d < stopD) return;
      const s = Math.min(0.8, d);
      x += dx / d * s; z += dz / d * s;
      ws.send(JSON.stringify({ t: 'move', x, y: groundY(x, z), z, yaw: 0, pitch: 0 }));
      await sleep(100);
    }
  };

  // 1) 走到 NPC 旁接任务
  await moveTo(QuestsDef.NPC_X, QuestsDef.NPC_Z, 2);
  await sleep(200);
  ws.send(JSON.stringify({ t: 'questAccept' }));
  await sleep(300);
  assert.ok(ev.quest.length > 0 && ev.quest[ev.quest.length - 1], '接到任务');
  const q = ev.quest[ev.quest.length - 1];
  assert.strictEqual(q.type, 'slime', '首环是史莱姆');
  assert.strictEqual(q.count, 5);

  // 2) 走到最近史莱姆营地砍够 5 只
  const camp = MobsDef.campsNear(welcome.seed, x, z, 12).filter((c) => c.type === 'slime')
    .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
  assert.ok(camp, '有史莱姆营地');
  await moveTo(camp.x, camp.z, 3);
  await sleep(1500);
  for (let i = 0; i < 400 && ev.die.length < 6; i++) {
    let best = null, bd = 1e9;
    for (const mb of mobs.values()) { const d = Math.hypot(mb.x - x, mb.z - z); if (d < bd) { bd = d; best = mb; } }
    if (best && bd <= 3.2) ws.send(JSON.stringify({ t: 'attack', id: best.id }));
    else if (best) { const dx = best.x - x, dz = best.z - z, d = Math.hypot(dx, dz) || 1; x += dx / d * Math.min(0.8, d); z += dz / d * Math.min(0.8, d); ws.send(JSON.stringify({ t: 'move', x, y: groundY(x, z), z, yaw: 0, pitch: 0 })); }
    await sleep(250);
  }
  const last = ev.quest[ev.quest.length - 1];
  assert.ok(last && last.progress >= 5, '任务计数达标，progress=' + (last && last.progress));

  // 3) 回 NPC 交付，收奖励经验
  const xpBefore = ev.xp.length;
  await moveTo(QuestsDef.NPC_X, QuestsDef.NPC_Z, 2);
  await sleep(200);
  ws.send(JSON.stringify({ t: 'questTurnIn' }));
  await sleep(400);
  assert.ok(ev.xp.length > xpBefore, '交付后收到 xpGain（奖励）');
  const cleared = ev.quest[ev.quest.length - 1];
  assert.strictEqual(cleared, null, '交付后任务清空');

  console.log('quest_probe OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 跑探针（需 dev 在跑）**

先在另一终端：`npx wrangler dev --port 8787 --persist-to ../cc-myworld-state`
Run: `node tests/manual/quest_probe.js`
Expected: `quest_probe OK`（退出码 0）

> 若失败先看是否 dev 未启动或营地太远超时；探针走位与 combat_probe 同口径。

- [ ] **Step 3: 提交**

```bash
git add tests/manual/quest_probe.js
git commit -m "test: 任务链路探针（接任务/杀够/交付领经验）"
```

---

### Task 6: js/hud.js + index.html — 经验条/等级徽章/任务追踪/升级金光

**Files:**
- Modify: `js/hud.js`
- Modify: `index.html`

- [ ] **Step 1: index.html 加 DOM**

`<div id="hud">...</div>`（血条那行）改为在血条下方加经验条与等级徽章：

```html
<div id="hud">
  <div id="lvBadge">Lv.1</div>
  <div id="hpBar"><div id="hpFill"></div><div id="hpText">20 / 20</div></div>
  <div id="xpBar"><div id="xpFill"></div></div>
</div>
```

`<div id="online"></div>` 之后加任务追踪面板与升级金光层：

```html
<div id="questTrack" style="display:none"></div>
<div id="levelFlash"></div>
```

- [ ] **Step 2: index.html 加 CSS**

`<style>` 内 `#hpText { ... }` 规则之后插入：

```css
  #lvBadge {
    display: inline-block; margin-bottom: 4px; padding: 1px 8px;
    background: rgba(0,0,0,0.5); border: 2px solid #ffd24a; border-radius: 4px;
    color: #ffd24a; font: bold 12px sans-serif; text-shadow: 1px 1px 0 #000;
  }
  #xpBar {
    width: 220px; height: 7px; margin-top: 3px; background: rgba(0,0,0,0.5);
    border: 1px solid #6a5a20; border-radius: 3px; overflow: hidden;
  }
  #xpFill { height: 100%; width: 0%; background: #ffd24a; transition: width 0.2s; }
  #questTrack {
    position: fixed; right: 10px; top: 30px; z-index: 10; pointer-events: none;
    max-width: 240px; padding: 6px 10px; background: rgba(0,0,0,0.5);
    border: 1px solid #888; border-left: 3px solid #ffd24a; border-radius: 4px;
    color: #fff; font: 13px sans-serif; text-shadow: 1px 1px 0 #000;
  }
  #questTrack.done { border-left-color: #7ec850; color: #b6f08a; }
  #levelFlash {
    position: fixed; inset: 0; z-index: 16; pointer-events: none; opacity: 0;
    transition: opacity 0.5s; background: radial-gradient(ellipse at center, rgba(255,210,74,0.6) 0%, rgba(255,210,74,0) 70%);
  }
```

- [ ] **Step 3: hud.js 加经验/等级/任务/金光方法**

`js/hud.js` 在 `function showDeath(show) { ... }` 之后插入：

```js
  function setLevel(level) {
    root.document.getElementById('lvBadge').textContent = 'Lv.' + level;
  }

  // xpNext=0 表示满级 → 经验条满格
  function setXp(xp, level, xpNext) {
    setLevel(level);
    const pct = xpNext > 0 ? Math.max(0, Math.min(100, Math.round(xp / xpNext * 100))) : 100;
    root.document.getElementById('xpFill').style.width = pct + '%';
  }

  // quest 为 { type, count, progress }（type 为怪种 key）或 null
  function setQuest(quest) {
    const el = root.document.getElementById('questTrack');
    if (!quest) { el.style.display = 'none'; return; }
    const name = root.MyWorld.MobsDef.TYPES[quest.type].name;
    const done = quest.progress >= quest.count;
    el.textContent = '击杀 ' + name + ' ' + Math.min(quest.progress, quest.count) + '/' + quest.count + (done ? '（回长老交付）' : '');
    el.classList.toggle('done', done);
    el.style.display = 'block';
  }

  function levelUpFlash() {
    const el = root.document.getElementById('levelFlash');
    el.style.opacity = '0.9';
    root.setTimeout(() => { el.style.opacity = '0'; }, 500);
  }
```

导出对象改为：

```js
  root.MyWorld.Hud = { setHp, flashRed, showDeath, floatDamage, update, setLevel, setXp, setQuest, levelUpFlash };
```

- [ ] **Step 4: 提交**

```bash
git add js/hud.js index.html
git commit -m "feat: 成长 HUD（经验条/等级徽章/任务追踪/升级金光）"
```

---

### Task 7: js/entities.js — NPC 长老渲染 + 接/交标记

**Files:**
- Modify: `js/entities.js`

- [ ] **Step 1: 加 NPC 渲染**

`js/entities.js` 在 `// —— 箭 ——` 注释之前插入：

```js
  // —— NPC 长老（固定单体，非同步实体）——
  let npc = null; // { group, marker }
  // 标记纹理：状态 'accept'(黄!)/'turnin'(绿?)/'none'
  function markerSprite(symbol, color) {
    const cv = root.document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = color;
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(symbol, 32, 36);
    const tex = new root.THREE.CanvasTexture(cv);
    const sp = new root.THREE.Sprite(new root.THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sp.scale.set(0.6, 0.6, 1);
    return sp;
  }

  function setNpc(x, y, z) {
    if (npc) return;
    const g = humanoid(0xc8a23b, 0xe8b88a); // 金袍长老
    const tag = nameTag('长老', 1);
    tag.position.y = 2.15;
    g.add(tag);
    const marker = new root.THREE.Group();
    marker.position.y = 2.55;
    g.add(marker);
    g.position.set(x, y, z);
    scene.add(g);
    npc = { group: g, marker };
  }

  function setNpcMarker(state) {
    if (!npc) return;
    const m = npc.marker;
    while (m.children.length) m.remove(m.children[0]);
    if (state === 'accept') m.add(markerSprite('！', '#ffd24a'));
    else if (state === 'turnin') m.add(markerSprite('？', '#7ec850'));
  }
```

`init(s)` 函数改为重置 npc（软重置/重连时 Entities.clear 不动 NPC，但换世界不会发生，这里保持单例）：

```js
  function init(s) { scene = s; npc = null; }
```

> 注：`clear()`（softReset 用）只清玩家/怪/箭，**不清 NPC**——NPC 是固定单体，重连后仍在，main 只需重设标记。

导出对象 `root.MyWorld.Entities = { ... }` 追加 `setNpc, setNpcMarker`：

```js
  root.MyWorld.Entities = {
    init, upsertPlayer, movePlayer, removePlayer, clear, update, count,
    upsertMob, moveMob, hurtMob, dieMob, despawnMob, mobList,
    spawnLocalArrow, remoteArrow, dieArrow, setNpc, setNpcMarker,
  };
```

- [ ] **Step 2: 提交**

```bash
git add js/entities.js
git commit -m "feat: NPC 长老体素渲染与接/交任务标记"
```

---

### Task 8: js/ui.js + index.html — NPC 对话框（overlay npc 模式）

**Files:**
- Modify: `js/ui.js`
- Modify: `index.html`

- [ ] **Step 1: index.html 加 #ovNpc 对话框区**

overlay 面板内 `<div id="ovReplaced" ...>...</div>` 之后插入：

```html
    <div id="ovNpc" style="display:none">
      <p id="npcDesc">…</p>
      <p>
        <button id="npcActBtn">接受</button>
        <button id="npcCloseBtn">关闭</button>
      </p>
    </div>
```

`#ovName button` 的 CSS 规则后追加（复用绿色按钮风格）：

```css
  #ovNpc button {
    font: 15px sans-serif; margin: 0 6px; padding: 7px 16px; border-radius: 4px;
    border: 1px solid #7ec850; background: #2c4a1e; color: #cdf0b0; cursor: pointer;
  }
  #ovNpc button:hover { background: #3a6128; }
  #ovNpc #npcCloseBtn { border-color: #888; background: #333; color: #ddd; }
```

- [ ] **Step 2: ui.js overlay 加 npc 模式**

`js/ui.js` 的 `setOverlayMode` 里 ids 映射——把

```js
    const ids = { connecting: 'ovConnecting', name: 'ovName', start: 'ovStart', file: 'ovFile', replaced: 'ovReplaced' };
```

改为：

```js
    const ids = { connecting: 'ovConnecting', name: 'ovName', start: 'ovStart', file: 'ovFile', replaced: 'ovReplaced', npc: 'ovNpc' };
```

注释 `// 遮罩内容模式：...` 补上 `npc`：

```js
  // 遮罩内容模式：connecting | name | start | file | replaced | npc
```

- [ ] **Step 3: 提交**

```bash
git add js/ui.js index.html
git commit -m "feat: overlay 加 npc 模式（NPC 对话框 DOM）"
```

---

### Task 9: js/main.js — 成长/任务接线（消息、E 交互、NPC 标记）

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: 引用 QuestsDef + 任务/NPC 状态**

`js/main.js` 顶部模块引用区——把

```js
  const Combat = MW.Combat, Hud = MW.Hud;
```

改为：

```js
  const Combat = MW.Combat, Hud = MW.Hud, QuestsDef = MW.QuestsDef;
```

状态声明区（`let world = null, player = null;` 附近）追加：

```js
  let currentQuest = null; // 当前任务 { type, count, progress } 或 null
```

- [ ] **Step 2: startWorld 摆放 NPC + 初始化成长/任务 HUD**

`startWorld(msg)` 末尾（`root.MyWorld.game = {...};` 那行之前）插入：

```js
    // NPC 长老：固定坐标 + 本地地表高度
    Entities.setNpc(QuestsDef.NPC_X, world.terrainHeight(Math.floor(QuestsDef.NPC_X), Math.floor(QuestsDef.NPC_Z)) + 1, QuestsDef.NPC_Z);
    Hud.setXp(msg.xp, msg.level, msg.xpNext);
    currentQuest = msg.quest;
    Hud.setQuest(currentQuest);
    updateNpcMarker();
```

`softReset(msg)` 里（`Hud.setHp(msg.hp, msg.maxHp);` 之后）插入（重连恢复成长/任务）：

```js
    Hud.setXp(msg.xp, msg.level, msg.xpNext);
    currentQuest = msg.quest;
    Hud.setQuest(currentQuest);
    updateNpcMarker();
```

- [ ] **Step 3: NPC 标记规则 + 邻近判定**

在 `Net.onStatus(...)` 之前插入：

```js
  // NPC 标记：无任务→可接「！」；有任务且达标→可交「？」；进行中→无标记
  function updateNpcMarker() {
    if (!currentQuest) Entities.setNpcMarker('accept');
    else if (currentQuest.progress >= currentQuest.count) Entities.setNpcMarker('turnin');
    else Entities.setNpcMarker('none');
  }

  function nearNpc() {
    if (!player) return false;
    return Math.hypot(player.x - QuestsDef.NPC_X, player.z - QuestsDef.NPC_Z) <= QuestsDef.NPC_RANGE;
  }
```

- [ ] **Step 4: 接 xpGain/levelUp/questState/pLevelUp**

`Net.on('playerDie', ...)` 之后插入：

```js
  Net.on('xpGain', (m) => { Hud.setXp(m.xp, m.level, m.xpNext); });
  Net.on('levelUp', (m) => {
    maxHpCache = m.maxHp;
    Hud.setHp(m.hp, m.maxHp);
    Hud.setLevel(m.level);
    Hud.levelUpFlash();
  });
  Net.on('questState', (m) => { currentQuest = m.quest; Hud.setQuest(currentQuest); updateNpcMarker(); });
  Net.on('pLevelUp', (m) => { Hud.floatDamage(m.x, m.y + 2.3, m.z, '⬆ 升级!', '#ffe066'); });
```

- [ ] **Step 5: E 键开 NPC 对话框 + 按钮接线**

键盘 keydown 监听里（数字键分支之后、监听器闭合 `});` 之前）插入 E 键：

```js
    if (e.code === 'KeyE' && world && !selfDead && isLocked() && nearNpc()) {
      openNpcDialog();
    }
```

在主循环 `let last = performance.now();` 之前插入对话框逻辑（含按钮接线，模块加载时执行一次）：

```js
  // —— NPC 对话框：开/关复用 overlay 的 npc 模式 ——
  let pendingNpc = false;
  function openNpcDialog() {
    const desc = root.document.getElementById('npcDesc');
    const act = root.document.getElementById('npcActBtn');
    if (!currentQuest) {
      // 客户端不知 chainIndex（服务器侧推进），接受前用通用提示，具体任务由服务器 questState 回发
      desc.textContent = '长老有任务给你。接受后去讨伐怪物吧。';
      act.textContent = '接受任务';
      act.style.display = '';
      act.onclick = () => { Net.send({ t: 'questAccept' }); closeNpcDialog(); };
    } else if (currentQuest.progress >= currentQuest.count) {
      desc.textContent = '任务完成！交付领取经验奖励。';
      act.textContent = '交付任务';
      act.style.display = '';
      act.onclick = () => { Net.send({ t: 'questTurnIn' }); closeNpcDialog(); };
    } else {
      const name = MW.MobsDef.TYPES[currentQuest.type].name;
      desc.textContent = '任务进行中：击杀 ' + name + ' ' + currentQuest.progress + '/' + currentQuest.count + '，完成后回来交付。';
      act.style.display = 'none';
    }
    pendingNpc = true;
    if (root.document.pointerLockElement) root.document.exitPointerLock(); // 解锁以便点按钮；pointerlockchange 据 pendingNpc 切到 npc 模式
    else { pendingNpc = false; UI.setOverlayMode('npc'); }
  }
  function closeNpcDialog() {
    pendingNpc = false;
    UI.setOverlayMode('start'); // 回到「点击继续」
  }
  root.document.getElementById('npcCloseBtn').addEventListener('click', (e) => { e.stopPropagation(); closeNpcDialog(); });
```

`pointerlockchange` 监听器里（`if (isLocked()) { UI.showOverlay(false); return; }` 之后）插入对 pendingNpc 的处理：

```js
    if (pendingNpc) { pendingNpc = false; UI.setOverlayMode('npc'); return; }
```

> 注意：`#ovNpc` 的按钮在 overlay（cursor:pointer）内，但 overlay 的点击「重新锁定」只在 `getOverlayMode()==='start'` 时触发（main 既有逻辑），npc 模式下点按钮不会误锁定。

- [ ] **Step 6: index.html 加 quests_def 脚本**

`<script src="shared/stats.js"></script>` 之后插入：

```html
<script src="shared/quests_def.js"></script>
```

> 顺序：quests_def 依赖 mobs_def 吗？依赖 `MobsDef.TYPES`。当前 mobs_def 在 stats 之后（line 148）。把 quests_def 放在 `shared/mobs_def.js` 之后更稳妥——实际插在 `<script src="shared/mobs_def.js"></script>` 之后。

- [ ] **Step 7: 浏览器冒烟（dev 在跑）**

启动 dev，浏览器进入：控制台 `MyWorld.QuestsDef` 有定义、出生点 +z 4 格可见「长老」体素小人头顶黄色「！」、左下血条下方有黄色经验条与「Lv.1」徽章、无报错。

- [ ] **Step 8: 提交**

```bash
git add js/main.js index.html
git commit -m "feat: 主程序成长/任务接线（xpGain/levelUp/questState、E键NPC对话、标记更新）"
```

---

### Task 10: README 更新 + 浏览器综合验收

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 增补**

「玩法」表格在「选武器」行后插入：

```markdown
| 与 NPC 交互 | 走近长老按 E（接/交任务） |
```

「特性」清单追加：

```markdown
- 成长：杀怪与交任务得经验，升级提升 HP 上限与攻击、回满血并金光，等级上限 20
- 死亡惩罚：复活扣当前等级经验 10%（不降级）
- 任务：出生点「长老」发放 10 环固定任务链（依次刷四地带）+ 之后按等级无限日常；HUD 右上追踪进度
```

「开发」一节探针命令后追加：

```markdown
任务链路探针（接任务→杀够→交付，需 dev 在跑）：

​```bash
node tests/manual/quest_probe.js
​```
```

（上行围栏为实际三反引号。）

- [ ] **Step 2: 全量测试 + 三探针**

Run: `node tests/run_all.js` → `ALL TESTS PASSED`
Run（dev 在跑）: `node tests/manual/two_clients.js` → 退出码 0
Run: `node tests/manual/combat_probe.js` → 退出码 0
Run: `node tests/manual/quest_probe.js` → 退出码 0

- [ ] **Step 3: 浏览器双窗口验收（对照 spec 验证标准 7、8）**

dev 在跑，两个不同源窗口（127.0.0.1 与 localhost）各自进入：

1. 出生点见「长老」头顶「！」；走近按 E → 对话框「接受任务」→ 接到「击杀 史莱姆 0/5」，右上追踪面板出现
2. 走到史莱姆营地砍怪：每杀 1 只追踪 +1；达标变绿「（回长老交付）」，长老头顶转绿「？」
3. 回长老按 E → 「交付任务」→ 经验条跳涨（奖励）、追踪面板消失、长老转回「！」；再接到下一环「击杀 史莱姆 0/10」
4. 持续杀怪攒经验直到升级：全屏金光、左下「Lv.1」变「Lv.2」、血条上限变长（HP 回满）、经验条回低位
5. 故意送死：黑屏死亡→复活后经验条略降（扣 10%）；刷新页面等级/经验/任务进度不丢（持久化）
6. 双窗口：一窗口升级，另一窗口在其附近看到金色「⬆升级!」飘字；在线人数正确
7. 两窗口控制台无报错

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: README 补成长与任务玩法、任务探针说明"
```

- [ ] **Step 5: （可选，需用户确认）部署**

```bash
npx wrangler deploy
```

部署后用线上 URL 复测验收清单第 1、3、4、5 项。

---

## 已知取舍（有意设计，不要"顺手修"）

- 经验用「当前等级内进度」：升级 `xp-=xpToNext`、死亡 `xp=xpAfterDeath`，满 20 级 xp 恒 0、条满格
- 死亡只扣当前等级进度 10%（`floor(xp*0.1)`）、不降级；低等级/刚升级几乎无损
- `quest_id` 编码 `kind:type:count` 自包含，奖励现算，无需额外列；`chain_index` 仅记下一链序号
- NPC 是固定坐标常量、非同步实体；服务器只做 3 格邻近校验，客户端本地摆放
- 同时仅 1 个任务；击杀计数与经验同走最后一击归属
- 日常怪种/数量按接取时等级快照进 quest_id，后续升级不变
- 升级回满血 + 本人全屏金光 + 附近一个金色飘字（不做粒子）
- NPC 对话复用 overlay 的 npc 模式：开即解锁可点、关回 start 模式（与 ESC 同机制）
- 箭杀且射手已离线 → 经验/任务丢弃（无离线补偿）
- 客户端 `softReset`（重连）不清 NPC（固定单体），仅重设标记与成长/任务 HUD
```
