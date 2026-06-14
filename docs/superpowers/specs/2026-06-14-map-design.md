# 地图功能 设计文档

日期：2026-06-14
状态：已确认
前置：Boss系统 + 主线任务（已完成，线上运行于 https://cc-myworld.xudahy.workers.dev）

---

## 目标

为现有联机体素游戏新增地图功能：
1. **右上角圆形小地图**：常驻显示，随玩家视角旋转
2. **全屏大地图**：按 M 键打开/关闭，展示完整世界

---

## 架构

纯客户端实现，不修改服务器。所有数据在客户端已有：
- 玩家位置/朝向：`player.x, player.z, player.yaw`（main.js 局部变量）
- 其他玩家：新增 `Entities.playerList()`
- 怪物：现有 `Entities.mobList()`
- Boss：新增 `Entities.bossList()`
- NPC 坐标：`QuestsDef.NPC_X, QuestsDef.NPC_Z`
- 出生点：`MobsDef.SPAWN_X, MobsDef.SPAWN_Z`
- 区域定义：`MobsDef.ZONES`（含 min/max/type）

---

## 文件改动

| 操作 | 路径 | 职责 |
|------|------|------|
| 新建 | `js/minimap.js` | 小地图 + 全屏地图全部渲染逻辑，IIFE 挂 `MyWorld.Minimap` |
| 修改 | `js/entities.js` | 新增 `playerList()` 和 `bossList()` 两个 getter |
| 修改 | `js/main.js` | M 键绑定、`Minimap.init()` 调用、每帧 `Minimap.update()` |
| 修改 | `public/index.html` | 加小地图 canvas + 全屏地图 overlay div |

---

## 小地图

### 外观

- 固定位置：右上角，`position:fixed; top:12px; right:12px`
- 尺寸：150×150px canvas，CSS `border-radius:50%` 裁成圆形
- 边框：1px 深绿色描边（`#445544`）
- z-index：50（高于游戏画面，低于 overlay）

### 渲染逻辑

每帧由 `Minimap.update(player, entities)` 调用，步骤：

1. `ctx.clearRect`
2. `ctx.save(); ctx.translate(75, 75); ctx.rotate(-player.yaw)`（让玩家朝向朝上）
3. 绘制区域色带（以玩家为原点，按世界坐标偏移）
4. 绘制各实体点
5. `ctx.restore()`
6. 绘制玩家方向三角（始终在圆心，不随旋转变化）
7. 绘制圆形边框

### 比例尺

显示半径 60 格，映射到 75px，即 **1.25 px/格**。

### 区域色带

```
x < 60:     出生区，色 #2a2a1a（深灰棕）
60 ~ 150:   史莱姆区，色 #1a3a0d（深绿）
150 ~ 300:  僵尸区，色 #3a2a0d（深棕）
300 ~ 500:  骷髅区，色 #2a1a1a（深红棕）
500+:       狼区，色 #1a1a2a（深蓝黑）
```

色带宽度 = 区域宽度 × 1.25，相对玩家 x 坐标偏移后绘制。

### 图例（实体点）

| 元素 | 颜色 | 半径 | 备注 |
|------|------|------|------|
| 玩家自身 | `#00ff88` | 4px + 方向三角 | 始终在圆心 |
| 其他玩家 | `#44aaff` | 3px | `playerList()` |
| 怪物 | `#ff4444` | 2px | `mobList()`，超出 60 格不绘 |
| Boss（存活） | `#ff8800` | 4px + glow | `bossList()`，始终绘制（不裁剪） |
| Boss（死亡） | `#555555` | 3px | 灰色 |
| NPC | `#ffdd00` | 3px 方块 | 固定坐标 |
| 出生点 | `#ffffff` | 十字（3px） | 固定坐标 |

Boss 不受 60 格限制裁剪（重要信息，超出范围也在边缘显示箭头）。

### 隐藏条件

- 游戏未连接（`!world`）时 canvas `display:none`
- 全屏地图打开时隐藏小地图

---

## 全屏大地图

### 触发

- 键盘 `M` 键切换；`Escape` 关闭
- 背包面板（`invPanel`）打开时 `M` 不响应
- 打开时解除指针锁定（同背包逻辑）
- 关闭时恢复 `start` overlay（若已连接）

### 布局

```
#mapOverlay  position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:60; display:none
  #mapCanvas  width:min(90vw, 1200px); height:min(80vh, 600px); display:block; margin:auto
  #mapClose   右上角关闭按钮 [×] 或提示文字 [M] 关闭
```

### 坐标系

世界坐标 → Canvas 坐标：
- x 轴：世界 x ∈ [-50, 820]，映射到 canvas 宽度（比例固定）
- z 轴：世界 z ∈ [-120, 140]，映射到 canvas 高度
- 固定朝向：x 正方向→右，z 正方向→下（屏幕向下 = 世界南方）

### 绘制内容

**背景层（静态，每次打开时绘制一次）：**
1. 区域色带（同小地图配色，x 轴分布）
2. 区域名称标签（史莱姆区 / 僵尸区 / 骷髅区 / 狼区）
3. 出生点标记（白色十字 + 「出生点」文字）
4. NPC 标记（黄色方块 + 「长老」文字）
5. 4 个 Boss 固定位置图标

**动态层（打开时每帧更新）：**
1. Boss 存活/死亡状态（橙色/灰色，死亡时显示剩余复活秒数）
2. 其他玩家（蓝色圆点 + 昵称）
3. 玩家自身（绿色圆点 + 方向线段）

**不在全屏地图显示：**
- 普通怪物（太多，意义不大）

### Tooltip

鼠标悬停在 Boss 图标上时，显示 Boss 名称及状态（存活 HP% / 死亡剩余时间）。用 `mousemove` 事件实现，不需要额外 DOM。

---

## `js/minimap.js` 接口

```js
// IIFE 挂 root.MyWorld.Minimap
{
  init()                        // 创建 canvas，绑 M/Escape 键，挂 DOM
  update(player, entities)      // 每帧调用（仅在 world 存在时）
  toggle()                      // 切换全屏地图
  isOpen()                      // 全屏地图是否打开
  show(visible)                 // 控制小地图显示/隐藏
}
```

`update` 参数 `entities` = `{ players: Entities.playerList(), mobs: Entities.mobList(), bosses: Entities.bossList() }`，由 `main.js` 在每帧组装传入。

---

## `js/entities.js` 新增接口

```js
playerList()  // 返回 [{ pid, x, y, z, name }]（从 players Map 读取）
bossList()    // 返回 [{ id, x, z, hp, maxHp, dead, name }]（从 bosses Map 读取）
```

---

## 不在本次范围内

- 地图缩放（zoom in/out）
- 标记/路标系统
- 移动端地图入口（目前移动端无 M 键）
- 历史探索记录（fog of war）
