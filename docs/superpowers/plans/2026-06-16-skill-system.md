# 技能系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 14 个按等级解锁的技能（被动+主动混合），含飞行、冲刺、二段跳、冲击波、蓄力一击等，配套技能书面板（K）和技能热键栏（Q/G/R/F）。

**Architecture:** 移动类技能（飞行/冲刺/二段跳）客户端执行，IIFE 模块新增 `js/skills.js` 管理解锁与冷却；战斗被动（战魂/坚韧/猎手/不死之身）在 `server/world_do.js` 的伤害/升级结算处应用；UI 新增技能热键栏+技能书+飞行进度条+解锁提示。

**Tech Stack:** Vanilla JS IIFE 模块, Three.js (已有), Cloudflare Durable Object WebSocket

---

## 文件结构

| 文件 | 操作 | 内容 |
|------|------|------|
| `js/skills.js` | 新建 | SKILL_TABLE + SkillState（解锁/冷却/飞行/冲刺状态） |
| `shared/stats.js` | 修改 | maxHp() 加入技能 HP 加成 |
| `shared/physics.js` | 修改 | step() 飞行跳过重力；tryJump() 支持 airJumps |
| `js/player.js` | 修改 | update() 接收 skills 参数，处理飞行/冲刺/疾步 |
| `js/combat.js` | 修改 | onAttackClick() 接收 charged 参数并附在消息中 |
| `index.html` | 修改 | 加载 skills.js；CSS+DOM：#skillBar #skillBook #flightBar #skillUnlockToast |
| `js/hud.js` | 修改 | 技能 UI 函数：updateSkillBar/updateFlightBar/showSkillUnlock/toggleSkillBook |
| `js/main.js` | 修改 | F/G/Q/R/K 快捷键；Skills 接入游戏循环；levelUp 解锁通知 |
| `server/world_do.js` | 修改 | warSoul/resilience/hunter/undying/chargedStrike/AOE/rapidShot/skill regen |

---

## Task 1: 新建 js/skills.js

**Files:**
- Create: `js/skills.js`

- [ ] **Step 1: 创建文件**

写入 `js/skills.js`（完整内容）：

```js
// js/skills.js — 技能定义 + 客户端技能状态管理
(function (root) {
  'use strict';

  const SKILL_TABLE = [
    { id: 'vitality',      name: '体力强化', unlockLevel: 2,  kind: 'passive', description: '最大 HP +25' },
    { id: 'swiftness',     name: '疾步',     unlockLevel: 3,  kind: 'passive', description: '移速 +15%' },
    { id: 'chargedStrike', name: '蓄力一击', unlockLevel: 4,  kind: 'active',  key: 'Q', cooldown: 15, description: '下次攻击伤害 ×2.5，CD 15s' },
    { id: 'doubleJump',    name: '二段跳',   unlockLevel: 5,  kind: 'passive', description: '空中可再跳一次' },
    { id: 'regen',         name: '自愈',     unlockLevel: 6,  kind: 'passive', description: '每 6 秒回 3 HP' },
    { id: 'sprint',        name: '冲刺',     unlockLevel: 7,  kind: 'active',  key: 'G', cooldown: 10, duration: 1.5, description: '1.5s 内移速 ×3，CD 10s' },
    { id: 'resilience',    name: '坚韧',     unlockLevel: 8,  kind: 'passive', description: '受到伤害 -10%' },
    { id: 'rapidShot',     name: '连射',     unlockLevel: 9,  kind: 'passive', description: '弓箭攻速 +30%' },
    { id: 'lifesurge',     name: '生命涌现', unlockLevel: 10, kind: 'passive', description: '最大 HP +50' },
    { id: 'shockwave',     name: '冲击波',   unlockLevel: 12, kind: 'active',  key: 'R', cooldown: 25, description: '4 格内敌人受 15 伤害，CD 25s' },
    { id: 'flight',        name: '飞行',     unlockLevel: 15, kind: 'active',  key: 'F', cooldown: 60, duration: 30, description: '飞行模式持续 30s，CD 60s' },
    { id: 'warSoul',       name: '战魂',     unlockLevel: 17, kind: 'passive', description: '攻击伤害 +20%' },
    { id: 'hunter',        name: '猎手',     unlockLevel: 19, kind: 'passive', description: '获取 XP +25%' },
    { id: 'undying',       name: '不死之身', unlockLevel: 20, kind: 'passive', description: '致命伤时保留 1 HP（60s 内一次）' },
  ];

  const cooldowns = {};   // id -> remaining seconds
  const unlocked = new Set();
  let chargedReady = false;
  let sprintTimeLeft = 0;
  let flightTimeLeft = 0;

  // 根据等级重新计算解锁集合；返回本次新解锁技能名称列表
  function update(level) {
    const prev = new Set(unlocked);
    unlocked.clear();
    for (const sk of SKILL_TABLE) {
      if (level >= sk.unlockLevel) unlocked.add(sk.id);
    }
    const newlyUnlocked = [];
    for (const id of unlocked) {
      if (!prev.has(id)) {
        const sk = SKILL_TABLE.find(s => s.id === id);
        if (sk) newlyUnlocked.push(sk.name);
      }
    }
    return newlyUnlocked;
  }

  function hasSkill(id) { return unlocked.has(id); }

  // 激活主动技能；返回是否成功（未解锁或冷却中则 false）
  function activate(id) {
    if (!hasSkill(id)) return false;
    if ((cooldowns[id] || 0) > 0) return false;
    const sk = SKILL_TABLE.find(s => s.id === id);
    if (!sk || sk.kind !== 'active') return false;
    cooldowns[id] = sk.cooldown;
    if (id === 'chargedStrike') chargedReady = true;
    if (id === 'sprint') sprintTimeLeft = sk.duration;
    if (id === 'flight') flightTimeLeft = sk.duration;
    return true;
  }

  // 消费蓄力一击状态（攻击时调用，消费后清除）
  function consumeCharged() {
    if (!chargedReady) return false;
    chargedReady = false;
    return true;
  }

  function isOnCooldown(id) { return (cooldowns[id] || 0) > 0; }
  function cooldownLeft(id) { return cooldowns[id] || 0; }

  // 每帧减少冷却与持续计时
  function tick(dt) {
    for (const id in cooldowns) {
      if (cooldowns[id] > 0) cooldowns[id] = Math.max(0, cooldowns[id] - dt);
    }
    if (sprintTimeLeft > 0) sprintTimeLeft = Math.max(0, sprintTimeLeft - dt);
    if (flightTimeLeft > 0) flightTimeLeft = Math.max(0, flightTimeLeft - dt);
  }

  function getFlightTimeLeft() { return flightTimeLeft; }
  function forceEndFlight() { flightTimeLeft = 0; }
  function isSprintActive() { return sprintTimeLeft > 0; }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Skills = {
    SKILL_TABLE, update, hasSkill, activate, consumeCharged,
    isOnCooldown, cooldownLeft, tick,
    getFlightTimeLeft, forceEndFlight, isSprintActive,
  };
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 2: 提交**

```bash
git add js/skills.js
git commit -m "feat: js/skills.js — 技能定义与客户端状态管理模块"
```

---

## Task 2: 修改 shared/stats.js — maxHp 技能加成

**Files:**
- Modify: `shared/stats.js:8`

- [ ] **Step 1: 修改 maxHp 函数**

将 `shared/stats.js` 第 8 行从：
```js
  function maxHp(level) { return 20 + 5 * (level - 1); }
```
改为：
```js
  function maxHp(level) {
    return 20 + 5 * (level - 1) + (level >= 2 ? 25 : 0) + (level >= 10 ? 50 : 0);
  }
```

- [ ] **Step 2: 验证**

在浏览器控制台执行（游戏加载后）：
```js
MyWorld.Stats.maxHp(1)  // 期望: 20
MyWorld.Stats.maxHp(2)  // 期望: 50  (20+5+25)
MyWorld.Stats.maxHp(10) // 期望: 115 (20+45+25+50) 不对，重算: 20+5*9+25+50=120
// 正确：20 + 5*(10-1) + 25 + 50 = 20+45+25+50 = 140
MyWorld.Stats.maxHp(10) // 期望: 140
MyWorld.Stats.maxHp(20) // 期望: 190 (20+95+25+50)
```

- [ ] **Step 3: 提交**

```bash
git add shared/stats.js
git commit -m "feat: maxHp() 加入 vitality(+25 lv2) 和 lifesurge(+50 lv10) 技能加成"
```

---

## Task 3: 修改 shared/physics.js — 飞行跳过重力 + 二段跳

**Files:**
- Modify: `shared/physics.js:54-68`

- [ ] **Step 1: 修改 step() — 飞行时跳过重力**

将 `shared/physics.js` 的 `step` 函数（第 54-61 行）从：
```js
  function step(b, world, dt) {
    b.vy -= GRAVITY * dt;
    if (b.vy < -MAX_FALL) b.vy = -MAX_FALL;
    b.onGround = false;
    moveAxis(b, world, 'y', b.vy * dt);
    moveAxis(b, world, 'x', b.vx * dt);
    moveAxis(b, world, 'z', b.vz * dt);
  }
```
改为：
```js
  function step(b, world, dt) {
    if (!b.flying) {
      b.vy -= GRAVITY * dt;
      if (b.vy < -MAX_FALL) b.vy = -MAX_FALL;
    }
    b.onGround = false;
    moveAxis(b, world, 'y', b.vy * dt);
    moveAxis(b, world, 'x', b.vx * dt);
    moveAxis(b, world, 'z', b.vz * dt);
    if (b.flying && b.onGround) { b.flying = false; b.vy = 0; }
  }
```

- [ ] **Step 2: 修改 tryJump() — 支持 airJumps 二段跳**

将 `shared/physics.js` 的 `tryJump` 函数（第 64-69 行）从：
```js
  function tryJump(b, v) {
    if (!b.onGround) return false;
    b.vy = v;
    b.onGround = false;
    return true;
  }
```
改为：
```js
  function tryJump(b, v) {
    if (b.onGround) { b.vy = v; b.onGround = false; return true; }
    if (b.airJumps > 0) { b.vy = v; b.airJumps--; return true; }
    return false;
  }
```

- [ ] **Step 3: 提交**

```bash
git add shared/physics.js
git commit -m "feat: physics.js — 飞行跳过重力，tryJump 支持 airJumps 二段跳"
```

---

## Task 4: 修改 js/player.js — 飞行/冲刺/疾步速度

**Files:**
- Modify: `js/player.js:9-30`

- [ ] **Step 1: 修改 create() 初始化 airJumps + flying**

将 `js/player.js` 的 `create` 函数（第 9-12 行）从：
```js
  function create(x, y, z) {
    const b = Physics.createBody(x, y, z, HALF, HEIGHT);
    b.yaw = 0; b.pitch = 0;
    return b;
  }
```
改为：
```js
  function create(x, y, z) {
    const b = Physics.createBody(x, y, z, HALF, HEIGHT);
    b.yaw = 0; b.pitch = 0;
    b.flying = false; b.airJumps = 0; b.sprintActive = false;
    return b;
  }
```

- [ ] **Step 2: 修改 update() — 接入 skills，处理飞行/冲刺/疾步**

将 `js/player.js` 的 `update` 函数（第 15-30 行）从：
```js
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
```
改为：
```js
  function update(p, world, dt, input, skills) {
    // 水平意图速度（yaw=0 面向 -z）
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    let mx = 0, mz = 0;
    if (input.forward) { mx += fx; mz += fz; }
    if (input.back)    { mx -= fx; mz -= fz; }
    if (input.right)   { mx += rx; mz += rz; }
    if (input.left)    { mx -= rx; mz -= rz; }
    const len = Math.hypot(mx, mz);
    const spd = p.sprintActive ? SPEED * 3
      : (skills && skills.hasSkill('swiftness') ? SPEED * 1.15 : SPEED);
    if (len > 0) { mx = mx / len * spd; mz = mz / len * spd; }
    p.vx = mx; p.vz = mz;

    if (p.flying) {
      if (input.jump) p.vy = 5;
      else if (input.down) p.vy = -5;
      else p.vy = 0;
    } else {
      if (input.jump) Physics.tryJump(p, JUMP_V);
    }
    Physics.step(p, world, dt);
  }
```

- [ ] **Step 3: 提交**

```bash
git add js/player.js
git commit -m "feat: player.js — 飞行控制(Space上/Shift下)、冲刺x3速、疾步+15%"
```

---

## Task 5: 修改 js/combat.js — 蓄力一击附加在攻击消息

**Files:**
- Modify: `js/combat.js:110-137`

- [ ] **Step 1: 修改 onAttackClick() — 接受 charged 参数**

将 `js/combat.js` 第 110 行：
```js
  function onAttackClick(itemIndex, eye, dir, mobList, playerList, net) {
```
改为：
```js
  function onAttackClick(itemIndex, eye, dir, mobList, playerList, net, charged) {
```

将第 120 行（发送 attack 消息）从：
```js
          net.send({ t: 'attack', id: mobTarget.id, slot: itemIndex });
```
改为：
```js
          net.send({ t: 'attack', id: mobTarget.id, slot: itemIndex, charged: !!charged });
```

将第 123 行（发送 pvpAttack 消息）从：
```js
          if (playerTarget) net.send({ t: 'pvpAttack', pid: playerTarget.pid, slot: itemIndex });
```
改为：
```js
          if (playerTarget) net.send({ t: 'pvpAttack', pid: playerTarget.pid, slot: itemIndex, charged: !!charged });
```

- [ ] **Step 2: 提交**

```bash
git add js/combat.js
git commit -m "feat: combat.js — onAttackClick 接受 charged 参数并附在攻击消息"
```

---

## Task 6: 修改 index.html — 技能 UI DOM + CSS + script 标签

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 在 `</style>` 前添加技能 UI CSS**

在 `index.html` 现有 `</style>` 标签之前，插入：

```css
  /* 技能热键栏 */
  #skillBar {
    position: fixed; left: 50%; bottom: 72px; transform: translateX(-50%);
    display: flex; gap: 6px; z-index: 10; pointer-events: none;
  }
  .skillSlot {
    width: 48px; height: 48px; position: relative;
    background: rgba(0,0,0,0.55); border: 2px solid #666; border-radius: 6px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: #fff; font: 10px/1.3 sans-serif; text-align: center; gap: 2px;
  }
  .skillSlot.locked { opacity: 0.35; }
  .skillSlot .skillKey {
    position: absolute; top: 2px; right: 4px;
    font-size: 9px; color: #aaa;
  }
  .skillSlot .skillCdOverlay {
    position: absolute; inset: 0; background: rgba(0,0,0,0.65);
    display: none; align-items: center; justify-content: center;
    font-size: 14px; font-weight: bold; color: #fff; border-radius: 4px;
  }
  /* 飞行进度条 */
  #flightBar {
    position: fixed; left: 50%; top: 4px; transform: translateX(-50%);
    width: 200px; height: 6px; background: rgba(0,0,0,0.4);
    border-radius: 3px; display: none; z-index: 10; overflow: hidden; pointer-events: none;
  }
  #flightBarFill { height: 100%; width: 100%; background: #4af; border-radius: 3px; transition: background 0.3s; }
  /* 技能书面板 */
  #skillBook {
    position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.55); z-index: 25;
  }
  #skillBookPanel {
    background: rgba(20,20,30,0.97); border: 1px solid #555; border-radius: 8px;
    padding: 16px; width: min(620px, 92vw); max-height: 80vh; overflow-y: auto;
    color: #fff; font-family: sans-serif;
  }
  #skillBookPanel h2 { margin: 0 0 12px; font-size: 18px; color: #ffd700; display: inline-block; }
  #skillBookClose {
    float: right; cursor: pointer; font-size: 20px; color: #aaa; background: none;
    border: none; padding: 0; line-height: 1; margin-top: 2px;
  }
  #skillGrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 4px; }
  .skillCard {
    background: rgba(255,255,255,0.05); border: 1px solid #444; border-radius: 6px;
    padding: 8px; font-size: 11px;
  }
  .skillCard.unlocked { border-color: #5a5; background: rgba(80,160,80,0.13); }
  .skillCard .scName { font-size: 13px; font-weight: bold; margin-bottom: 3px; }
  .skillCard.locked .scName { color: #888; }
  .skillCard .scLv { color: #aaa; margin-bottom: 3px; font-size: 10px; }
  .skillCard .scDesc { color: #ccc; line-height: 1.3; }
  .skillCard .scKey {
    display: inline-block; margin-top: 5px; background: #333;
    border-radius: 3px; padding: 1px 5px; font-size: 10px; color: #ffd700;
  }
  /* 技能解锁提示 */
  #skillUnlockToast {
    position: fixed; right: 16px; bottom: 130px; z-index: 15;
    background: rgba(20,20,30,0.92); border: 1px solid #ffd700;
    border-radius: 6px; padding: 8px 14px; color: #ffd700;
    font: 14px sans-serif; display: none; pointer-events: none;
  }
```

- [ ] **Step 2: 在 `</body>` 前的 DOM 区域添加技能 UI 元素**

在 `index.html` 的 `</body>` 结束标签之前（紧接在其他 HUD 元素如 `#questPanel`、`#minimap` 之后），插入：

```html
<!-- 技能热键栏 -->
<div id="skillBar">
  <div class="skillSlot locked" id="skillSlotQ">
    <span class="skillKey">Q</span>
    <span>蓄力</span>
    <div class="skillCdOverlay"></div>
  </div>
  <div class="skillSlot locked" id="skillSlotG">
    <span class="skillKey">G</span>
    <span>冲刺</span>
    <div class="skillCdOverlay"></div>
  </div>
  <div class="skillSlot locked" id="skillSlotR">
    <span class="skillKey">R</span>
    <span>冲击</span>
    <div class="skillCdOverlay"></div>
  </div>
  <div class="skillSlot locked" id="skillSlotF">
    <span class="skillKey">F</span>
    <span>飞行</span>
    <div class="skillCdOverlay"></div>
  </div>
</div>

<!-- 飞行进度条 -->
<div id="flightBar"><div id="flightBarFill"></div></div>

<!-- 技能书面板 -->
<div id="skillBook">
  <div id="skillBookPanel">
    <button id="skillBookClose">×</button>
    <h2>技能书</h2>
    <div id="skillGrid"></div>
  </div>
</div>

<!-- 技能解锁提示 -->
<div id="skillUnlockToast"></div>
```

- [ ] **Step 3: 在 `</body>` 之前的 script 标签列表中添加 skills.js**

找到加载 `js/player.js` 的 `<script>` 标签，在它**之前**插入：
```html
<script src="js/skills.js"></script>
```

（skills.js 不依赖 player.js，但 player.js 会使用 skills，所以 skills 要先加载）

- [ ] **Step 4: 在浏览器中验证 CSS 不报错**

打开游戏页面（本地 HTTP 服务器），按 F12 → Console，确认无 CSS 相关错误。技能栏应出现在热键栏正上方（虽然都是灰暗锁定状态）。

- [ ] **Step 5: 提交**

```bash
git add index.html
git commit -m "feat: index.html — 技能热键栏/技能书/飞行条/解锁提示 CSS+DOM+脚本加载"
```

---

## Task 7: 修改 js/hud.js — 技能 UI 函数

**Files:**
- Modify: `js/hud.js`

- [ ] **Step 1: 在文件顶部 `let questCollapsed = false;` 后添加技能 UI 状态变量**

在 `js/hud.js` 第 6 行 `let questCollapsed = false;` 之后插入：
```js
  let skillBookOpen = false;
  let toastTimer = null;
```

- [ ] **Step 2: 在 `toggleQuestPanel` 函数之后添加所有技能 UI 函数**

在 `js/hud.js` 的 `function toggleQuestPanel() {` 块结束后、`function initQuestPanel() {` 之前插入以下所有函数：

```js
  function updateSkillBar(skillsState) {
    const defs = [
      { id: 'chargedStrike', slot: 'skillSlotQ' },
      { id: 'sprint',        slot: 'skillSlotG' },
      { id: 'shockwave',     slot: 'skillSlotR' },
      { id: 'flight',        slot: 'skillSlotF' },
    ];
    for (const { id, slot } of defs) {
      const el = root.document.getElementById(slot);
      if (!el) continue;
      const has = skillsState.hasSkill(id);
      el.classList.toggle('locked', !has);
      const cd = el.querySelector('.skillCdOverlay');
      if (cd) {
        const left = skillsState.cooldownLeft(id);
        if (has && left > 0) {
          cd.style.display = 'flex';
          cd.textContent = Math.ceil(left) + 's';
        } else {
          cd.style.display = 'none';
        }
      }
    }
  }

  function updateFlightBar(timeLeft, maxTime) {
    const bar = root.document.getElementById('flightBar');
    const fill = root.document.getElementById('flightBarFill');
    if (!bar || !fill) return;
    if (timeLeft <= 0) { bar.style.display = 'none'; return; }
    bar.style.display = 'block';
    fill.style.width = Math.min(100, timeLeft / maxTime * 100) + '%';
    fill.style.background = timeLeft <= 5 ? '#f44' : '#4af';
  }

  function showSkillUnlock(name) {
    const el = root.document.getElementById('skillUnlockToast');
    if (!el) return;
    el.textContent = '新技能解锁：' + name + '！';
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = root.setTimeout(() => { el.style.display = 'none'; }, 3000);
  }

  function openSkillBook(level, skillTable) {
    const grid = root.document.getElementById('skillGrid');
    if (!grid) return;
    grid.innerHTML = '';
    for (const sk of skillTable) {
      const card = root.document.createElement('div');
      card.className = 'skillCard' + (level >= sk.unlockLevel ? ' unlocked' : ' locked');
      let inner = '<div class="scName">' + sk.name + '</div>' +
        '<div class="scLv">Lv.' + sk.unlockLevel + ' 解锁</div>' +
        '<div class="scDesc">' + sk.description + '</div>';
      if (sk.key) inner += '<span class="scKey">' + sk.key + '</span>';
      card.innerHTML = inner;
      grid.appendChild(card);
    }
    root.document.getElementById('skillBook').style.display = 'flex';
    skillBookOpen = true;
  }

  function closeSkillBook() {
    const el = root.document.getElementById('skillBook');
    if (el) el.style.display = 'none';
    skillBookOpen = false;
    root.dispatchEvent(new CustomEvent('skillBookClosed'));
  }

  function toggleSkillBook(level, skillTable) {
    if (skillBookOpen) closeSkillBook();
    else openSkillBook(level, skillTable);
  }

  function isSkillBookOpen() { return skillBookOpen; }
```

- [ ] **Step 3: 在 `initQuestPanel` 函数之后添加 `initSkillBook`，并在 IIFE 末尾调用**

在 `js/hud.js` 的 `function initQuestPanel() { ... }` 块之后插入：
```js
  function initSkillBook() {
    const closeBtn = root.document.getElementById('skillBookClose');
    if (closeBtn) closeBtn.addEventListener('click', closeSkillBook);
    const panel = root.document.getElementById('skillBook');
    if (panel) panel.addEventListener('click', (e) => {
      if (e.target === panel) closeSkillBook();
    });
  }
```

在 IIFE 末尾（紧接在 `initQuestPanel();` 之后）插入：
```js
  initSkillBook();
```

- [ ] **Step 4: 更新 export 行，加入新函数**

将 `js/hud.js` 末尾的 export 行从：
```js
  root.MyWorld.Hud = { setHp, flashRed, showDeath, floatDamage, update, setLevel, setXp, setQuest, levelUpFlash, toggleQuestPanel };
```
改为：
```js
  root.MyWorld.Hud = { setHp, flashRed, showDeath, floatDamage, update, setLevel, setXp, setQuest, levelUpFlash, toggleQuestPanel,
    updateSkillBar, updateFlightBar, showSkillUnlock, openSkillBook, closeSkillBook, toggleSkillBook, isSkillBookOpen };
```

- [ ] **Step 5: 提交**

```bash
git add js/hud.js
git commit -m "feat: hud.js — 技能热键栏/技能书/飞行条/解锁提示 UI 函数"
```

---

## Task 8: 修改 js/main.js — 快捷键 + 游戏循环接入

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: 在顶部常量声明区加入 Skills**

将 `js/main.js` 第 10 行：
```js
  const Combat = MW.Combat, Hud = MW.Hud, QuestsDef = MW.QuestsDef;
```
改为：
```js
  const Combat = MW.Combat, Hud = MW.Hud, QuestsDef = MW.QuestsDef, Skills = MW.Skills;
```

- [ ] **Step 2: 在状态变量区添加 currentLevel**

在 `js/main.js` 第 58 行 `let currentQuest = null;` 之后插入：
```js
  let currentLevel = 1;
```

- [ ] **Step 3: 为 input 对象添加 down 字段，KEYMAP 添加 Shift**

将第 127 行：
```js
  const input = { forward: false, back: false, left: false, right: false, jump: false };
  const KEYMAP = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', Space: 'jump' };
```
改为：
```js
  const input = { forward: false, back: false, left: false, right: false, jump: false, down: false };
  const KEYMAP = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', Space: 'jump', ShiftLeft: 'down', ShiftRight: 'down' };
```

- [ ] **Step 4: 在 keydown 监听器中添加 F/G/Q/R/K 键处理**

在 `js/main.js` 的 keydown 监听器内，找到：
```js
    if (e.code === 'KeyJ' && world) {
      Hud.toggleQuestPanel();
      return;
    }
```
在其**之后**插入：
```js
    if (e.code === 'KeyF' && world && !selfDead && isLocked()) {
      if (Skills.activate('flight')) { player.flying = true; }
      return;
    }
    if (e.code === 'KeyG' && world && !selfDead && isLocked()) {
      Skills.activate('sprint');
      return;
    }
    if (e.code === 'KeyQ' && world && !selfDead && isLocked()) {
      Skills.activate('chargedStrike');
      return;
    }
    if (e.code === 'KeyR' && world && !selfDead && isLocked()) {
      if (Skills.activate('shockwave') && Net.connected()) Net.send({ t: 'aoeAttack' });
      return;
    }
    if (e.code === 'KeyK' && world) {
      Hud.toggleSkillBook(currentLevel, Skills.SKILL_TABLE);
      if (Hud.isSkillBookOpen() && isLocked()) root.document.exitPointerLock();
      return;
    }
```

- [ ] **Step 5: 修改 doAttack() 传入 charged**

将 `doAttack` 函数内（第 226 行）：
```js
    const consumed = Combat.onAttackClick(hotbarIndex, eye, d0, [...Entities.mobList(), ...Entities.bossAABBList()], Entities.playerAABBList(), Net);
```
改为：
```js
    const charged = Skills.consumeCharged();
    const consumed = Combat.onAttackClick(hotbarIndex, eye, d0, [...Entities.mobList(), ...Entities.bossAABBList()], Entities.playerAABBList(), Net, charged);
```

- [ ] **Step 6: 修改 startWorld() — 初始化 Skills**

在 `startWorld` 函数内，找到：
```js
    Hud.setXp(msg.xp, msg.level, msg.xpNext);
```
在其**之后**插入：
```js
    currentLevel = msg.level;
    Skills.update(msg.level);
    Hud.updateSkillBar(Skills);
```

- [ ] **Step 7: 修改 softReset() — 重连时同步 Skills**

在 `softReset` 函数内，找到：
```js
    Hud.setXp(msg.xp, msg.level, msg.xpNext);
```
在其**之后**插入：
```js
    currentLevel = msg.level;
    Skills.update(msg.level);
    Hud.updateSkillBar(Skills);
```

- [ ] **Step 8: 修改 levelUp 消息处理 — 解锁新技能并提示**

将：
```js
  Net.on('levelUp', (m) => {
    maxHpCache = m.maxHp;
    Hud.setHp(m.hp, m.maxHp);
    Hud.setLevel(m.level);
    Hud.levelUpFlash();
  });
```
改为：
```js
  Net.on('levelUp', (m) => {
    maxHpCache = m.maxHp;
    currentLevel = m.level;
    Hud.setHp(m.hp, m.maxHp);
    Hud.setLevel(m.level);
    Hud.levelUpFlash();
    const newSkills = Skills.update(m.level);
    for (const name of newSkills) Hud.showSkillUnlock(name);
    Hud.updateSkillBar(Skills);
  });
```

- [ ] **Step 9: 修改 playerDie 消息处理 — 死亡时停止飞行**

将：
```js
  Net.on('playerDie', () => { selfDead = true; Hud.showDeath(true); });
```
改为：
```js
  Net.on('playerDie', () => {
    selfDead = true; Hud.showDeath(true);
    if (player) { player.flying = false; player.vy = 0; }
    Skills.forceEndFlight();
  });
```

- [ ] **Step 10: 添加 skillBookClosed 事件监听**

在 `js/main.js` 现有 `root.addEventListener('invClosed', ...)` 和 `root.addEventListener('mapClosed', ...)` 之后添加：
```js
  root.addEventListener('skillBookClosed', () => {
    if (world && !isLocked() && !selfDead) UI.setOverlayMode('start');
  });
```

- [ ] **Step 11: 修改 pointerlockchange 处理 — 技能书打开时跳过**

在 `document.addEventListener('pointerlockchange', ...)` 内，找到：
```js
  if (Minimap && Minimap.isOpen()) return;
```
在其**之后**插入：
```js
  if (Hud.isSkillBookOpen()) return;
```

- [ ] **Step 12: 修改游戏主循环 — 接入 Skills**

在 `frame` 函数内，找到：
```js
      if (isActive() && !selfDead) Player.update(player, world, dt, input);
```
改为：
```js
      if (isActive() && !selfDead) Player.update(player, world, dt, input, Skills);
```

在 `if (world && player) {` 块内，找到：
```js
      updateChunks();
```
在其**之前**插入：
```js
      // 技能每帧 tick
      Skills.tick(dt);
      player.sprintActive = Skills.isSprintActive();
      // 飞行计时器到期强制落地
      const ftl = Skills.getFlightTimeLeft();
      if (player.flying && ftl <= 0) { player.flying = false; player.vy = 0; }
      Hud.updateFlightBar(ftl, 30);
      // 二段跳：落地时重置 airJumps
      if (player.onGround) player.airJumps = Skills.hasSkill('doubleJump') ? 1 : 0;
      Hud.updateSkillBar(Skills);
```

- [ ] **Step 13: 在浏览器中验证**

用本地 HTTP 服务器打开游戏（`python -m http.server 8080` 或等效命令）。
1. 进入游戏，确认底部热键栏上方出现 4 个灰色技能槽 Q/G/R/F
2. 按 K 键，确认技能书面板弹出
3. 按 K 或 × 关闭，确认重新进入游戏（指针锁定恢复）

- [ ] **Step 14: 提交**

```bash
git add js/main.js
git commit -m "feat: main.js — F/G/Q/R/K技能快捷键、飞行/冲刺/蓄力接入游戏循环"
```

---

## Task 9: 修改 server/world_do.js — 服务端技能效果

**Files:**
- Modify: `server/world_do.js`

- [ ] **Step 1: session 初始化增加 undyingUsedAt 和 nextSkillRegenAt**

在 `onHello` 函数中，找到 session 对象定义（第 205-212 行），将：
```js
      hp, maxHp, dead: false, deadUntil: 0, invulnUntil: 0, lastHurtAt: 0, nextRegenAt: 0, atkReadyAt: 0, bowReadyAt: 0,
      teamId: null };
```
改为：
```js
      hp, maxHp, dead: false, deadUntil: 0, invulnUntil: 0, lastHurtAt: 0, nextRegenAt: 0, atkReadyAt: 0, bowReadyAt: 0,
      teamId: null, undyingUsedAt: 0, nextSkillRegenAt: 0 };
```

同样在 `boot()` 的 DO 唤醒恢复代码中（第 94 行），将：
```js
        dead: false, deadUntil: 0, invulnUntil: 0, lastHurtAt: 0, nextRegenAt: 0, atkReadyAt: 0, bowReadyAt: 0,
```
改为：
```js
        dead: false, deadUntil: 0, invulnUntil: 0, lastHurtAt: 0, nextRegenAt: 0, atkReadyAt: 0, bowReadyAt: 0,
        undyingUsedAt: 0, nextSkillRegenAt: 0,
```

- [ ] **Step 2: webSocketMessage 添加 aoeAttack 路由**

在 `webSocketMessage` 方法内，找到：
```js
    else if (msg.t === 'teamLeave')   this.onTeamLeave(ws, s);
```
在其**之后**插入：
```js
    else if (msg.t === 'aoeAttack')   this.onAoeAttack(ws, s);
```

- [ ] **Step 3: 修改 onAttack() — 蓄力一击 ×2.5 + 战魂 ×1.2**

找到 `onAttack` 函数，将（第 900-901 行）：
```js
    const sw = (s.inv && Number.isInteger(msg.slot)) ? s.inv[30 + msg.slot] : null;
    const swordMul = (sw && sw.type === 'weapon' && sw.sub === 'sword') ? ItemsDef.weaponMul(sw.tier, sw.enh) : 1;
    const dmg = Math.floor(Stats.swordDamage(s.level) * swordMul);
```
改为：
```js
    const sw = (s.inv && Number.isInteger(msg.slot)) ? s.inv[30 + msg.slot] : null;
    const swordMul = (sw && sw.type === 'weapon' && sw.sub === 'sword') ? ItemsDef.weaponMul(sw.tier, sw.enh) : 1;
    const chargedMul = (msg.charged === true && s.level >= 4) ? 2.5 : 1;
    const warSoulMul = s.level >= 17 ? 1.2 : 1;
    const dmg = Math.floor(Stats.swordDamage(s.level) * swordMul * chargedMul * warSoulMul);
```

- [ ] **Step 4: 修改 onPvpAttack() — 蓄力/战魂攻击，坚韧防御**

找到 `onPvpAttack` 函数，将（第 930-933 行）：
```js
    const sw = (s.inv && Number.isInteger(msg.slot)) ? s.inv[30 + msg.slot] : null;
    const swordMul = (sw && sw.type === 'weapon' && sw.sub === 'sword') ? ItemsDef.weaponMul(sw.tier, sw.enh) : 1;
    const dmg = Math.floor(Stats.swordDamage(s.level) * swordMul);
    this.damagePlayer(ts, dmg, now);
```
改为：
```js
    const sw = (s.inv && Number.isInteger(msg.slot)) ? s.inv[30 + msg.slot] : null;
    const swordMul = (sw && sw.type === 'weapon' && sw.sub === 'sword') ? ItemsDef.weaponMul(sw.tier, sw.enh) : 1;
    const chargedMul = (msg.charged === true && s.level >= 4) ? 2.5 : 1;
    const warSoulMul = s.level >= 17 ? 1.2 : 1;
    const dmg = Math.floor(Stats.swordDamage(s.level) * swordMul * chargedMul * warSoulMul);
    this.damagePlayer(ts, dmg, now);
```

- [ ] **Step 5: 修改 onShoot() — rapidShot 弓箭 CD 减 30%**

找到 `onShoot` 函数，将（第 911-912 行）：
```js
    if (now < s.bowReadyAt) return;
    s.bowReadyAt = now + P.BOW_CD_MS;
```
改为：
```js
    if (now < s.bowReadyAt) return;
    const bowCdMs = s.level >= 9 ? Math.floor(P.BOW_CD_MS * 0.7) : P.BOW_CD_MS;
    s.bowReadyAt = now + bowCdMs;
```

- [ ] **Step 6: 修改 damagePlayer() — resilience -10% + undying 不死之身**

找到 `damagePlayer` 函数（第 1177-1190 行），将整个函数替换为：
```js
  damagePlayer(s, dmg, now) {
    if (s.dead || now < s.invulnUntil) return;
    // 坚韧：受到伤害 -10%（level >= 8）
    const finalDmg = s.level >= 8 ? Math.round(dmg * 0.9) : dmg;
    s.hp -= finalDmg;
    s.invulnUntil = now + P.INVULN_MS;
    s.lastHurtAt = now;
    const [ws] = this.sessionByPid(s.pid);
    if (s.hp <= 0) {
      // 不死之身：level >= 20，60s 冷却
      if (s.level >= 20 && now > (s.undyingUsedAt || 0) + 60000) {
        s.hp = 1;
        s.undyingUsedAt = now;
        if (ws) this.send(ws, { t: 'playerHurt', hp: s.hp, dmg: finalDmg });
        return;
      }
      s.hp = 0; s.dead = true; s.deadUntil = now + P.DEATH_RESPAWN_MS;
      s.xp = Stats.xpAfterDeath(s.xp);
      if (ws) { this.send(ws, { t: 'playerDie' }); this.send(ws, { t: 'xpGain', xp: s.xp, level: s.level, xpNext: this.xpNext(s.level) }); }
    } else if (ws) {
      this.send(ws, { t: 'playerHurt', hp: s.hp, dmg: finalDmg });
    }
  }
```

- [ ] **Step 7: 修改 gainXp() — hunter +25% XP**

找到 `gainXp` 函数（第 956-970 行），将：
```js
  gainXp(ws, s, amount) {
    const r = Stats.applyXp(s.level, s.xp, amount);
```
改为：
```js
  gainXp(ws, s, amount) {
    const finalAmount = s.level >= 19 ? Math.round(amount * 1.25) : amount;
    const r = Stats.applyXp(s.level, s.xp, finalAmount);
```

- [ ] **Step 8: 修改 tickPlayers() — 技能自愈每 6s +3 HP**

找到 `tickPlayers` 函数内的脱战回血代码（第 1210-1217 行）：
```js
      if (s.hp < s.maxHp) {
        busy = true;
        if (now - s.lastHurtAt >= P.REGEN_DELAY_MS && now >= s.nextRegenAt) {
          s.hp = Math.min(s.maxHp, s.hp + 1);
          s.nextRegenAt = now + 1000;
          this.send(ws, { t: 'hpUpdate', hp: s.hp, max: s.maxHp });
        }
      }
```
改为：
```js
      if (s.hp < s.maxHp) {
        busy = true;
        if (now - s.lastHurtAt >= P.REGEN_DELAY_MS && now >= s.nextRegenAt) {
          s.hp = Math.min(s.maxHp, s.hp + 1);
          s.nextRegenAt = now + 1000;
          this.send(ws, { t: 'hpUpdate', hp: s.hp, max: s.maxHp });
        }
        // 技能自愈（regen）：level >= 6，每 6s 额外回 3 HP
        if (s.level >= 6 && now >= (s.nextSkillRegenAt || 0)) {
          s.hp = Math.min(s.maxHp, s.hp + 3);
          s.nextSkillRegenAt = now + 6000;
          this.send(ws, { t: 'hpUpdate', hp: s.hp, max: s.maxHp });
        }
      }
```

- [ ] **Step 9: 在 onTeamLeave 之后添加 onAoeAttack 函数**

在 `server/world_do.js` 中，找到 `onTeamLeave(ws, s) {` 函数块结束后，插入：

```js
  onAoeAttack(ws, s) {
    if (s.dead || s.level < 12) return;
    const now = Date.now();
    const { x: ex, y: ey, z: ez } = s;
    for (const mob of this.mobs.values()) {
      if (mob.dead) continue;
      if (Math.hypot(mob.x - ex, mob.y - ey, mob.z - ez) <= 4) {
        this.hurtMob(mob, 15, s, now);
      }
    }
    for (const boss of this.bosses.values()) {
      if (boss.dead) continue;
      if (Math.hypot(boss.x - ex, boss.y - ey, boss.z - ez) <= 4) {
        this.hurtBoss(boss, 15, ws, s, now);
      }
    }
    for (const [, ts] of this.sessions) {
      if (ts.pid === s.pid || ts.dead) continue;
      if (s.teamId !== null && s.teamId === ts.teamId) continue;
      if (Math.hypot(ts.x - ex, ts.y - ey, ts.z - ez) <= 4) {
        this.damagePlayer(ts, 15, now);
      }
    }
    this.ensureTick();
  }
```

- [ ] **Step 10: 部署并在浏览器中验证技能系统**

```bash
npx wrangler deploy --persist-to /tmp/wrangler-state
```

验证流程：
1. 进入游戏，按 K 查看技能书（低等级时大多为锁定灰色卡片）
2. 在 Console 执行 `MyWorld.Stats.maxHp(2)` 确认返回 50
3. 升至 Lv.4 后测试按 Q 蓄力一击（下次攻击应有提升伤害）
4. 升至 Lv.7 后测试按 G 冲刺（热键栏 G 槽显示 10s 冷却）
5. 升至 Lv.15 后测试按 F 飞行（顶部蓝色进度条出现，Space 上升，Shift 下降）
6. 升至 Lv.5 后二段跳（空中再按 Space 应能跳起）

- [ ] **Step 11: 提交**

```bash
git add server/world_do.js
git commit -m "feat: world_do.js — warSoul/resilience/hunter/undying/chargedStrike/AOE/rapidShot/skillRegen"
```

---

## Task 10: 推送并验证

- [ ] **Step 1: 推送到 GitHub**

```bash
git push
```

- [ ] **Step 2: 全功能验证清单**

| 技能 | 验证方式 |
|------|---------|
| 体力强化(Lv2) | Lv1 maxHp=20，Lv2 maxHp=50（+25+5） |
| 疾步(Lv3) | 移动明显加速 |
| 蓄力一击(Lv4) | Q 键 → 下次攻击伤害 ×2.5，热键栏 Q 槽显示 15s CD |
| 二段跳(Lv5) | 空中二次 Space 可再跳 |
| 自愈(Lv6) | 不回城，HP 每 6s 回 3 |
| 冲刺(Lv7) | G 键 → 1.5s 冲刺，热键栏 G 槽 10s CD |
| 坚韧(Lv8) | 受怪/PvP 伤害约减少 10% |
| 连射(Lv9) | 弓箭射速变快（CD 700ms） |
| 生命涌现(Lv10) | maxHp +50 → 预期 140 |
| 冲击波(Lv12) | R 键 → 4 格内怪物/玩家受 15 伤，CD 25s |
| 飞行(Lv15) | F 键 → 飞行 30s，顶部进度条，Shift 下降，到期自动落地，CD 60s |
| 战魂(Lv17) | 攻击伤害 +20% |
| 猎手(Lv19) | 击杀 XP 显示增加约 25% |
| 不死之身(Lv20) | 致命伤时 HP 降至 1 而非死亡（60s 内限一次） |
| 技能书(K) | 面板弹出，已解锁绿色，锁定灰色 |
| 解锁提示 | 升级时右下角弹出"新技能解锁：xxx！" |
