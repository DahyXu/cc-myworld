# 任务面板（Quest Panel）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将右上角单行任务追踪器替换为可折叠任务面板，展示任务描述、进度条、奖励预览。

**Architecture:** 服务器 `questStateMsg` 补充 `kind/xpReward/coins/item` 字段；客户端 `index.html` 替换 `#questTrack` 为 `#questPanel` DOM + CSS；`js/hud.js` 扩展 `setQuest()` 渲染完整面板并加折叠逻辑。`main.js` 无需改动（`Hud.setQuest` 接口不变）。

**Tech Stack:** Cloudflare Durable Object（WorldDO），HTML5 DOM、CSS、现有 IIFE 模块模式

**Spec:** `docs/superpowers/specs/2026-06-15-quest-panel-design.md`

---

## File Map

| 操作 | 路径 | 职责 |
|------|------|------|
| 修改 | `server/world_do.js` | `questStateMsg` 补充 `kind/xpReward/coins/item` |
| 修改 | `index.html` | 替换 `#questTrack` CSS + DOM → `#questPanel` |
| 修改 | `js/hud.js` | 扩展 `setQuest()`，加 `questDesc`、`questRewardText`、`initQuestPanel` |

---

## Task 1: server/world_do.js — questStateMsg 补充奖励字段

**Files:**
- Modify: `server/world_do.js`

- [ ] **Step 1: 扩展 `questStateMsg` 返回值**

找到（约第 944-948 行）：
```js
  questStateMsg(s) {
    if (!s.questId) return { t: 'questState', quest: null };
    const q = QuestsDef.parse(s.questId);
    if (!q) return { t: 'questState', quest: null };
    return { t: 'questState', quest: { type: q.type, count: q.count, progress: s.questProg, questKind: q.questKind } };
  }
```
改为：
```js
  questStateMsg(s) {
    if (!s.questId) return { t: 'questState', quest: null };
    const q = QuestsDef.parse(s.questId);
    if (!q) return { t: 'questState', quest: null };
    return { t: 'questState', quest: {
      type: q.type, count: q.count, progress: s.questProg,
      questKind: q.questKind, kind: q.kind,
      xpReward: q.xpReward, coins: q.coins, item: q.item || null,
    }};
  }
```

- [ ] **Step 2: 全量测试**

```
node tests/run_all.js
```

期望：`ALL TESTS PASSED`

- [ ] **Step 3: Commit**

```
git add server/world_do.js
git commit -m "feat: questStateMsg 补充 kind/xpReward/coins/item 字段"
```

---

## Task 2: index.html — CSS + DOM 替换

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 替换 CSS**

找到（约第 101-107 行）：
```css
  #questTrack {
    position: fixed; right: 10px; top: 30px; z-index: 10; pointer-events: none;
    max-width: 240px; padding: 6px 10px; background: rgba(0,0,0,0.5);
    border: 1px solid #888; border-left: 3px solid #ffd24a; border-radius: 4px;
    color: #fff; font: 13px sans-serif; text-shadow: 1px 1px 0 #000;
  }
  #questTrack.done { border-left-color: #7ec850; color: #b6f08a; }
```
替换为：
```css
  #questPanel {
    position: fixed; right: 10px; top: 30px; z-index: 10;
    width: 220px; background: rgba(0,0,0,0.6);
    border: 1px solid #888; border-left: 3px solid #ffd24a; border-radius: 4px;
    color: #fff; font: 13px sans-serif; text-shadow: 1px 1px 0 #000;
    pointer-events: auto;
  }
  #questPanel.done { border-left-color: #7ec850; }
  #questPanelTitle {
    padding: 5px 10px; cursor: pointer; user-select: none;
    display: flex; justify-content: space-between; align-items: center;
    font-weight: bold;
  }
  #questPanelBody { padding: 6px 10px 8px; }
  #questPanelDesc { margin-bottom: 6px; line-height: 1.4; color: #ddd; }
  #questPanelProgressRow { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  #questPanelBarWrap { flex: 1; height: 6px; background: rgba(255,255,255,0.15); border-radius: 3px; overflow: hidden; }
  #questPanelBar { height: 100%; background: #ffd24a; border-radius: 3px; transition: width 0.3s; }
  #questPanel.done #questPanelBar { background: #7ec850; }
  #questPanelCount { white-space: nowrap; font-size: 12px; color: #ccc; }
  #questPanelReward { font-size: 12px; color: #aaa; white-space: pre-line; }
  #questPanel.collapsed #questPanelBody { display: none; }
```

- [ ] **Step 2: 替换 DOM**

找到（约第 259 行）：
```html
<div id="questTrack" style="display:none"></div>
```
替换为：
```html
<div id="questPanel" style="display:none">
  <div id="questPanelTitle">📋 当前任务 <span id="questPanelArrow">▾</span></div>
  <div id="questPanelBody">
    <div id="questPanelDesc"></div>
    <div id="questPanelProgressRow">
      <div id="questPanelBarWrap"><div id="questPanelBar"></div></div>
      <span id="questPanelCount"></span>
    </div>
    <div id="questPanelReward"></div>
  </div>
</div>
```

- [ ] **Step 3: 验证 DOM 元素存在**

```
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');['questPanel','questPanelTitle','questPanelArrow','questPanelBody','questPanelDesc','questPanelBar','questPanelCount','questPanelReward'].forEach(id=>console.log(id, h.includes('id=\"'+id+'\"')?'OK':'MISSING'))"
```

期望：8 行均输出 `OK`

- [ ] **Step 4: 全量测试**

```
node tests/run_all.js
```

期望：`ALL TESTS PASSED`

- [ ] **Step 5: Commit**

```
git add index.html
git commit -m "feat: index.html 替换 questTrack → questPanel DOM+CSS"
```

---

## Task 3: js/hud.js — 完整任务面板逻辑

**Files:**
- Modify: `js/hud.js`

- [ ] **Step 1: 在 `floaters` 数组声明之后加 `questCollapsed` 状态**

找到（第 5 行）：
```js
  const floaters = []; // { el, x, y, z, t }
```
改为：
```js
  const floaters = []; // { el, x, y, z, t }
  let questCollapsed = false;
```

- [ ] **Step 2: 在 `setQuest` 之前加两个辅助函数**

找到（约第 35 行）：
```js
  // quest 为 { type, count, progress }（type 为怪种 key）或 null
  function setQuest(quest) {
```
在其之前插入：
```js
  const MATS = { slime_gel: '史莱姆凝胶', zombie_rags: '僵尸破布', skeleton_bone: '骷髅骨头', wolf_fang: '狼牙' };

  function questDesc(quest) {
    const MobsDef = root.MyWorld.MobsDef;
    switch (quest.questKind) {
      case 'kill':
        return '前往野外击杀 ' + quest.count + ' 只' + (MobsDef.TYPES[quest.type]?.name || quest.type);
      case 'collect':
        return '收集 ' + quest.count + ' 个' + (MATS[quest.type] || quest.type);
      case 'boss':
        return '讨伐 ' + (MobsDef.TYPES[quest.type]?.name || quest.type);
      case 'explore':
        return '从出生点向外探索 ' + quest.count + ' 格';
      default:
        return '';
    }
  }

  function questRewardText(quest) {
    const TIER = ['', '一', '二', '三'];
    const SUB  = { sword: '剑', bow: '弓' };
    let s = (quest.xpReward || 0) + ' XP';
    if (quest.coins > 0) s += ' · ' + quest.coins + ' 金';
    if (quest.item) s += '\n+' + (TIER[quest.item.tier] || '') + '阶' + (SUB[quest.item.sub] || quest.item.sub);
    return s;
  }

```

- [ ] **Step 3: 完整替换 `setQuest` 函数**

找到（约第 35-44 行，在刚才插入的辅助函数之后）：
```js
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
```
替换为：
```js
  function setQuest(quest) {
    const panel = root.document.getElementById('questPanel');
    if (!quest) { panel.style.display = 'none'; return; }

    const done = quest.progress >= quest.count;
    panel.style.display = 'block';
    panel.classList.toggle('done', done);

    root.document.getElementById('questPanelDesc').textContent =
      done ? '回长老交付任务' : questDesc(quest);

    const pct = Math.min(quest.progress / quest.count, 1) * 100;
    root.document.getElementById('questPanelBar').style.width = pct + '%';
    root.document.getElementById('questPanelCount').textContent =
      Math.min(quest.progress, quest.count) + ' / ' + quest.count;

    root.document.getElementById('questPanelReward').textContent =
      '奖励：' + questRewardText(quest);
  }
```

- [ ] **Step 4: 在 `levelUpFlash` 之后加 `initQuestPanel`**

找到（约第 46-50 行）：
```js
  function levelUpFlash() {
    const el = root.document.getElementById('levelFlash');
    el.style.opacity = '0.9';
    root.setTimeout(() => { el.style.opacity = '0'; }, 500);
  }
```
在其之后插入：
```js
  function initQuestPanel() {
    const title = root.document.getElementById('questPanelTitle');
    title.addEventListener('click', () => {
      questCollapsed = !questCollapsed;
      root.document.getElementById('questPanel').classList.toggle('collapsed', questCollapsed);
      root.document.getElementById('questPanelArrow').textContent = questCollapsed ? '▸' : '▾';
    });
  }

```

- [ ] **Step 5: 在 export 之前调用 `initQuestPanel()`**

找到（约第 77-78 行）：
```js
  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Hud = { setHp, flashRed, showDeath, floatDamage, update, setLevel, setXp, setQuest, levelUpFlash };
```
改为：
```js
  initQuestPanel();

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Hud = { setHp, flashRed, showDeath, floatDamage, update, setLevel, setXp, setQuest, levelUpFlash };
```

- [ ] **Step 6: 全量测试**

```
node tests/run_all.js
```

期望：`ALL TESTS PASSED`

- [ ] **Step 7: Commit**

```
git add js/hud.js
git commit -m "feat: hud.js 任务面板（描述/进度条/奖励/折叠）"
```

---

## Task 4: 验证 + 部署

**Files:** (无代码改动)

- [ ] **Step 1: 全量测试**

```
node tests/run_all.js
```

期望：`ALL TESTS PASSED`

- [ ] **Step 2: 启动 wrangler dev**

```
npx wrangler dev --port 8787 --persist-to /tmp/wrangler-state
```

期望：`Ready on http://127.0.0.1:8787`

- [ ] **Step 3: 浏览器验证**

打开 `http://localhost:8787`，进入游戏后走到长老（NPC）处按 E：

1. 接任务 → 右上角出现任务面板，显示任务描述、进度 `0/N`、奖励 XP/金币（有物品任务还显示武器）
2. 击杀怪物 → 进度条实时更新
3. 完成任务 → 面板绿边框、描述「回长老交付任务」、进度条满格绿色
4. 点击「📋 当前任务」标题 → 面板折叠（只剩标题行），箭头变 ▸；再次点击 → 展开，箭头变 ▾
5. 交付任务后无任务 → 面板隐藏
6. 控制台无报错

- [ ] **Step 4: 部署**

```
npx wrangler deploy
```

期望：`Deployed cc-myworld triggers` + URL

---

## 自查清单

**Spec coverage:**
- [x] 可折叠面板（Task 3 `initQuestPanel` + `.collapsed` CSS）
- [x] 任务描述文字按 questKind（Task 3 `questDesc`）
- [x] collect 任务材料名映射（Task 3 `MATS`）
- [x] 进度条 + 数字（Task 3 `setQuest` 进度部分）
- [x] 奖励预览 XP/金/物品（Task 1 服务器扩展 + Task 3 `questRewardText`）
- [x] 完成状态绿色（Task 2 `.done` CSS + Task 3 `classList.toggle`）
- [x] 无任务时隐藏（Task 3 `panel.style.display = 'none'`）
- [x] DOM 结构（Task 2）
