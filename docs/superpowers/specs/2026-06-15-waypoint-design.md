# 地图标注（Waypoint）设计文档

日期：2026-06-15
状态：已确认
前置：地图功能（小地图 + 全屏大地图，已完成）

---

## 目标

在现有大地图基础上新增单点标注功能：
1. 大地图点击任意位置 → 设置/覆盖标注点
2. 标注点旁显示 ✕ 按钮（悬停变红，点击取消标注）
3. 游戏内屏幕底部居中显示 HUD 方向箭头（旋转指向标注点 + 距离）
4. 小地图上显示黄色标注点
5. `localStorage` 持久化，刷新后不丢失

---

## 架构

纯客户端，零服务器改动。

```
localStorage['waypoint'] = { wx, wz } | null
      ↓
js/minimap.js  ←→  #mapCanvas (click/mousemove)
                ←→  #waypointHud (每帧绘制方向箭头)
                ←→  #minimap (每帧绘制小地图标注点)
```

---

## 文件改动

| 操作 | 路径 | 职责 |
|------|------|------|
| 修改 | `index.html` | 新增 `#waypointHud` canvas（CSS + DOM） |
| 修改 | `js/minimap.js` | 标注逻辑、大地图渲染、小地图渲染、HUD 箭头 |

---

## 数据模型

```js
let waypoint = null;   // { wx: number, wz: number } 或 null
let waypointXBtn = null; // { x, y, r } ✕ 按钮的圆心和命中半径（每帧更新）
let hoverX = false;      // 鼠标是否悬停在 ✕ 按钮上
```

**初始化（`init()` 内）：** 从 localStorage 恢复：
```js
const saved = localStorage.getItem('waypoint');
if (saved) waypoint = JSON.parse(saved);
```

**写入：**
```js
function _setWaypoint(wx, wz) {
  waypoint = { wx, wz };
  localStorage.setItem('waypoint', JSON.stringify(waypoint));
}
function _clearWaypoint() {
  waypoint = null;
  localStorage.removeItem('waypoint');
}
```

---

## 大地图交互

### 设置标注（click）

`mapCanvas` 新增 `click` 事件监听（在 `init()` 中注册）：

```js
mapCanvas.addEventListener('click', _onMapClick);
```

```js
function _onMapClick(e) {
  if (!mapOpen) return;
  const rect = mapCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  // 优先检测 ✕ 按钮命中
  if (waypointXBtn && Math.hypot(mx - waypointXBtn.x, my - waypointXBtn.y) <= waypointXBtn.r) {
    _clearWaypoint();
    return;
  }

  // 画布坐标 → 世界坐标（_wc 的逆变换）
  const W = mapCanvas.width, H = mapCanvas.height;
  const wx = mx / W * WX_RANGE + WX_MIN;
  const wz = my / H * WZ_RANGE + WZ_MIN;
  _setWaypoint(wx, wz);
}
```

### 悬停高亮（mousemove 扩展）

在现有 `_onMapMouseMove` 末尾增加：
```js
hoverX = waypointXBtn != null &&
  Math.hypot(mx - waypointXBtn.x, my - waypointXBtn.y) <= waypointXBtn.r;
```

### 渲染标注点（`_drawFullMap` 末尾）

```js
if (waypoint) {
  const p = _wc(waypoint.wx, waypoint.wz);

  // 绘制黄色五角星
  _drawStar(ctx, p.x, p.y, 10, 4, '#ffe033');

  // 绘制 ✕ 按钮（标注点右上角）
  const bx = p.x + 16, by = p.y - 14;
  waypointXBtn = { x: bx, y: by, r: 10 };
  ctx.beginPath();
  ctx.arc(bx, by, 8, 0, Math.PI * 2);
  ctx.fillStyle = hoverX ? '#cc2222' : 'rgba(80,80,80,0.85)';
  ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(bx-4,by-4); ctx.lineTo(bx+4,by+4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx+4,by-4); ctx.lineTo(bx-4,by+4); ctx.stroke();
}
```

五角星辅助函数（模块内私有）：
```js
function _drawStar(ctx, cx, cy, outerR, innerR, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    i === 0 ? ctx.moveTo(cx + r*Math.cos(a), cy + r*Math.sin(a))
             : ctx.lineTo(cx + r*Math.cos(a), cy + r*Math.sin(a));
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
```

大地图关闭时，`waypointXBtn = null`（避免旧位置误触）：
```js
// toggle() 关闭时
waypointXBtn = null; hoverX = false;
```

---

## 小地图上的标注点

在 `_drawMMEntities` 末尾，`ctx.save()` 已执行（坐标已旋转到玩家朝向）：

```js
if (waypoint) {
  let dx = (waypoint.wx - player.x) * SCALE;
  let dz = (waypoint.wz - player.z) * SCALE;
  const dist = Math.hypot(dx, dz);
  const CLAMP = CV_HALF - 5;
  if (dist > CLAMP) { const s = CLAMP / dist; dx *= s; dz *= s; }
  _drawStar(ctx, dx, dz, 6, 2.5, '#ffe033');
}
```

---

## 游戏内方向箭头 HUD

### DOM（`index.html`）

CSS（在 `</style>` 前）：
```css
#waypointHud {
  position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%);
  z-index: 12; display: none; pointer-events: none;
}
```

HTML（在 `#mapOverlay` 之后）：
```html
<canvas id="waypointHud" width="120" height="44"></canvas>
```

### 每帧绘制（`update()` 内，`_drawMinimap` 之후）

```js
function _drawWaypointHud(player) {
  const canvas = waypointHudEl;
  if (!waypoint || !player) {
    canvas.style.display = 'none';
    return;
  }
  canvas.style.display = 'block';

  const ctx = wpCtx;
  ctx.clearRect(0, 0, 120, 44);

  // 背景
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  _roundRect(ctx, 0, 0, 120, 44, 8);
  ctx.fill();

  // 相对方位角
  const dx = waypoint.wx - player.x;
  const dz = waypoint.wz - player.z;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw); // 前向
  const rx = -Math.cos(player.yaw), rz =  Math.sin(player.yaw); // 右向
  const dotF = dx * fx + dz * fz;
  const dotR = dx * rx + dz * rz;
  const rel = Math.atan2(dotR, dotF); // 0=正前 正=偏右 负=偏左

  // 绘制旋转箭头（左侧 44×44 区域）
  ctx.save();
  ctx.translate(22, 22);
  ctx.rotate(rel);
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(7,  8);
  ctx.lineTo(0,  4);
  ctx.lineTo(-7, 8);
  ctx.closePath();
  ctx.fillStyle = '#ffe033';
  ctx.fill();
  ctx.restore();

  // 距离文字（右侧）
  const dist = Math.hypot(dx, dz);
  ctx.fillStyle = '#ffe033';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(dist) + ' 格', 48, 22);
}
```

辅助：圆角矩形
```js
function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x+w, y, x+w, y+r, r);
  ctx.lineTo(x+w, y+h-r);
  ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
  ctx.lineTo(x+r, y+h);
  ctx.arcTo(x, y+h, x, y+h-r, r);
  ctx.lineTo(x, y+r);
  ctx.arcTo(x, y, x+r, y, r);
  ctx.closePath();
}
```

### `update()` 修改

```js
function update(player, entities) {
  if (!player) return;
  lastEntities = entities || { players: [], mobs: [], bosses: [] };
  _drawMinimap(player, lastEntities);
  _drawWaypointHud(player);          // ← 新增
  if (mapOpen) _drawFullMap(player, lastEntities);
}
```

### `init()` 修改

```js
waypointHudEl = root.document.getElementById('waypointHud');
wpCtx = waypointHudEl.getContext('2d');
```

---

## 不在本次范围内

- 多标注点
- 标注点命名/备注
- 标注点分享给其他玩家
- 移动端触摸支持（大地图）
