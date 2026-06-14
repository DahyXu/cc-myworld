# 移动端适配设计文档

日期：2026-06-14
状态：已确认
前置：M3 成长与任务（已完成，线上运行于 https://cc-myworld.xudahy.workers.dev）

## 目标

在不破坏桌面版任何功能的前提下，为现有联机体素游戏增加手机浏览器支持。玩家用手机横屏打开游戏 URL 即可进入同一个多人世界，完整体验移动、战斗、成长、任务。

## 用户确认的关键决策

1. **控制方案**：左侧浮动虚拟摇杆（移动）+ 右半屏单指滑动（转视角）
2. **操作按钮**：分离式——「攻击/挖」「放块」「跳跃」三个独立按钮，放置于右下角
3. **快捷栏**：5 格可见 + 左右滑动/箭头切换另外 5 格，格子 44px 足够点击

## 明确不做（本期范围外）

- 竖屏适配（强制横屏）
- 自定义按钮位置/大小
- 手柄支持
- 摇杆灵敏度设置

---

## 架构

### 检测与模式切换

入口：`js/main.js` 启动时执行一次检测：

```js
const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 1;
```

移动端下：
- 不请求 Pointer Lock（`document.body.requestPointerLock` 整段跳过）
- 显示 `#mobileControls` 层（虚拟摇杆 + 操作按钮）
- 隐藏桌面十字准星 `#crosshair`
- yaw/pitch 由 `touch.js` 直接累加到 `player.yaw / player.pitch`，不经过 mousemove

桌面端路径不变，两套输入在 `main.js` 内通过 `isMobile` 分支隔离。

### 新模块：`js/touch.js`

职责：封装所有触控逻辑，对外暴露 `globalThis.MyWorld.Touch`。

#### 虚拟摇杆（浮动式）

- 监听左半屏（`x < window.innerWidth / 2`）的 `touchstart`
- 落点为摇杆圆心，半径 60px
- `touchmove` 计算偏移向量，归一化后输出 `{ forward, strafe }` ∈ [-1, 1]
- `touchend` 归零
- 圆心坐标跟随落点更新（下次触摸即重置），无需固定位置

#### 视角滑动

- 监听右半屏的 `touchstart/touchmove`
- 每帧 delta 乘灵敏度系数（0.003 rad/px，与桌面 mousemove 一致）累加到 yaw/pitch
- pitch 限幅 [-π/2+0.05, π/2-0.05]（与桌面版相同）

#### 按钮事件

- `#btnAttack` → `touchstart`：触发与左键点击等价的攻击/挖方块逻辑
- `#btnPlace` → `touchstart`：触发与右键点击等价的放块逻辑
- `#btnJump` → `touchstart/touchend`：设置 jump flag，与 Space 键等价
- `#btnE` → `touchstart`：调用 `openNpcDialog()`，仅当 `nearNpc()` 时显示

#### 快捷栏触控

- `#hotbar` 区域左右滑动（swipe）：累计位移 > 30px 触发切换一格
- `#hotbarPrev` / `#hotbarNext` 箭头按钮：点击切换一格
- 格子直接点击：选中对应槽位（与数字键等价）

### UI 层

#### `index.html` 新增元素

```
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<meta name="screen-orientation" content="landscape">（iOS 用 CSS orientation lock）

<div id="mobileControls" style="display:none">
  <!-- 左侧摇杆 -->
  <div id="joystickBase"><div id="joystickKnob"></div></div>
  <!-- 右下按钮 -->
  <div id="btnJump">跳</div>
  <div id="btnAttack">攻击</div>
  <div id="btnPlace">放块</div>
  <!-- NPC 按钮（靠近时显示） -->
  <div id="btnE" style="display:none">对话[E]</div>
</div>
```

#### 快捷栏改造

桌面版：`#hotbar` 里生成 10 个 `.slot` DOM，数字键 / 滚轮控制选中。

移动版叠加：在 `#hotbar` 外包一层 `#hotbarWrap`，加左右箭头按钮，只渲染可见窗口（当前选中格居中，前后各 2 格，共 5 格）。当前选中格高亮，窗口随选中格滑动。

桌面版 `#hotbar` 样式不变，移动端通过 `.mobile` body class 应用 `@media` 或直接 class 覆盖。

#### CSS 关键规则（移动端）

```css
body.mobile #crosshair { display: none; }
body.mobile #mobileControls { display: block; }
#joystickBase {
  position: fixed; border-radius: 50%;
  width: 120px; height: 120px;
  background: rgba(255,255,255,0.08); border: 2px solid rgba(255,255,255,0.3);
  pointer-events: none; /* 位置由 JS 动态设置 */
}
#joystickKnob {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
  width: 48px; height: 48px; border-radius: 50%;
  background: rgba(255,255,255,0.5);
}
#btnAttack, #btnPlace, #btnJump, #btnE {
  position: fixed; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font: bold 13px sans-serif; color: #fff;
  user-select: none; -webkit-user-select: none;
  touch-action: none;
}
#btnAttack  { width:56px; height:56px; background:rgba(200,50,50,0.85);  right:70px;  bottom:28px; }
#btnPlace   { width:46px; height:46px; background:rgba(60,100,200,0.8);  right:16px;  bottom:28px; border-radius:10px; }
#btnJump    { width:46px; height:46px; background:rgba(220,180,40,0.85); right:16px;  bottom:84px; }
#btnE       { width:46px; height:46px; background:rgba(60,180,60,0.85);  right:130px; bottom:50px; border-radius:10px; font-size:11px; }
```

### `js/main.js` 改动

1. 顶部加 `const Touch = isMobile ? MW.Touch : null;`
2. 游戏循环里，移动端用 `Touch.getMove()` 替代键盘 WASD 输入；yaw/pitch 累加由 `Touch.getViewDelta()` 提供
3. Pointer Lock 相关的 `requestPointerLock` / `pointerlockchange` 监听整段用 `if (!isMobile)` 包裹
4. `updateNpcMarker()` 之后同步调用 `Touch && Touch.setNpcVisible(nearNpc())` 控制 `#btnE` 显隐
5. overlay 流程：移动端进入游戏后无需点击锁定，`welcome` 收到后直接 `UI.showOverlay(false)` 进入游戏

### 持久化 / 服务器

**零改动**。所有游戏逻辑在服务器，移动端只是另一种客户端输入方式。

---

## 文件改动范围

| 文件 | 操作 | 内容 |
|------|------|------|
| `js/touch.js` | 新建 | 摇杆、视角滑动、按钮事件、快捷栏滑动 |
| `js/main.js` | 修改 | isMobile 检测、Touch 接入、Pointer Lock 分支、overlay 流程、btnE 显隐 |
| `index.html` | 修改 | viewport meta、`#mobileControls` DOM、快捷栏包裹层、移动端 CSS |

---

## 测试策略

- 桌面版：改动后跑现有全量测试 `node tests/run_all.js`，确认零回归
- 移动端：Chrome DevTools 设备模拟（横屏 iPhone/Android）冒烟；真机验收以 iOS Safari + Android Chrome 为准
- 验收项：
  1. 摇杆移动流畅，视角滑动无抖动
  2. 攻击按钮可正常砍怪，放块按钮可正常放置方块
  3. 跳跃正常，不会触发页面滚动
  4. 快捷栏左右滑动可切换武器/方块
  5. 靠近 NPC 后「对话」按钮出现，点击打开对话框，接/交任务正常
  6. 桌面版完整功能不受影响

## 已知取舍

- 不做竖屏：强制横屏，竖屏下显示「请旋转设备」提示
- 浮动摇杆无固定位置：每次放手重置，适应不同握姿但初次不直觉
- 攻击/放块仍需看准十字准星（移动端十字准星保留）：移动端瞄准依赖视角滑动，与桌面版一致
- iOS Safari 的 `screen.orientation.lock` 受限，仅靠 CSS `@media (orientation: portrait)` 提示旋转
