# 任务面板（Quest Panel）设计文档

日期：2026-06-15
状态：已确认

---

## 目标

将现有右上角单行任务追踪器（`#questTrack`）替换为可折叠的任务面板，展示：
- 任务描述文字
- 实时进度条 + 数字
- 奖励预览（XP、金币、物品）

---

## 架构

纯客户端，零服务器改动。

```
questState 消息（服务器推送）
  → main.js: currentQuest = m.quest
  → Hud.setQuest(currentQuest)
  → 渲染 #questPanel
```

`currentQuest` 数据结构不变：
```js
{
  type: string,       // 怪种 key / 材料 sub / boss id / 'dist'
  count: number,      // 目标数量
  progress: number,   // 当前进度
  questKind: string,  // 'kill' | 'collect' | 'boss' | 'explore'
  kind: string,       // 'm'(主线) | 'd'(日常)
  xpReward: number,
  coins: number,
  item: { type, sub, tier, enh } | null,
}
```

---

## 文件改动

| 操作 | 路径 | 职责 |
|------|------|------|
| 修改 | `index.html` | 替换 `#questTrack`，新增 `#questPanel` DOM + CSS |
| 修改 | `js/hud.js` | 扩展 `setQuest()`，加折叠逻辑 |

---

## DOM 结构（`index.html`）

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

删除原有 `<div id="questTrack">` 元素。

---

## CSS（`index.html`）

删除原有 `#questTrack` / `#questTrack.done` 规则，替换为：

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
#questPanelReward { font-size: 12px; color: #aaa; }
#questPanel.collapsed #questPanelBody { display: none; }
```

---

## 渲染逻辑（`js/hud.js`）

### 新增模块状态

```js
let questCollapsed = false; // 折叠状态，每次进游戏默认展开
```

### `initQuestPanel()`（在 `init()` 中调用）

注册标题栏点击事件：

```js
function initQuestPanel() {
  const title = root.document.getElementById('questPanelTitle');
  title.addEventListener('click', () => {
    questCollapsed = !questCollapsed;
    const panel = root.document.getElementById('questPanel');
    panel.classList.toggle('collapsed', questCollapsed);
    root.document.getElementById('questPanelArrow').textContent = questCollapsed ? '▸' : '▾';
  });
}
```

### 任务描述文字

```js
function questDesc(quest) {
  const MobsDef = root.MyWorld.MobsDef;
  switch (quest.questKind) {
    case 'kill':
      return '前往野外击杀 ' + quest.count + ' 只' + (MobsDef.TYPES[quest.type]?.name || quest.type);
    case 'collect': {
      const MATS = { slime_gel: '史莱姆凝胶', zombie_rags: '僵尸破布', skeleton_bone: '骷髅骨头', wolf_fang: '狼牙' };
      return '收集 ' + quest.count + ' 个' + (MATS[quest.type] || quest.type);
    }
    case 'boss':
      return '讨伐 ' + (MobsDef.TYPES[quest.type]?.name || quest.type);
    case 'explore':
      return '从出生点向外探索 ' + quest.count + ' 格';
    default:
      return '';
  }
}
```

### 奖励文字

```js
function questRewardText(quest) {
  const TIER = ['', '一', '二', '三'];
  const SUB  = { sword: '剑', bow: '弓' };
  let s = quest.xpReward + ' XP';
  if (quest.coins > 0) s += ' · ' + quest.coins + ' 金';
  if (quest.item) s += '\n+' + (TIER[quest.item.tier] || '') + '阶' + (SUB[quest.item.sub] || quest.item.sub);
  return s;
}
```

### `setQuest(quest)` 替换

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

### `init()` 中加入 `initQuestPanel()`

hud.js 的 `init()` 函数末尾加一行 `initQuestPanel();`。

---

## 状态说明

| 状态 | 表现 |
|------|------|
| 无任务 | 面板隐藏（`display:none`） |
| 进行中 | 黄色左边框，进度条黄色 |
| 已完成 | 绿色左边框，进度条绿色，描述改为「回长老交付任务」 |
| 折叠 | `.collapsed` class，body 隐藏，箭头变 ▸ |

---

## 不在本次范围内

- 多条并行任务
- 任务历史记录
- 任务分类标签（主线/日常）
- 移动端触摸适配折叠
