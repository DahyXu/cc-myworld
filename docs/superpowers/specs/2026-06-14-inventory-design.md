# 背包系统设计文档

日期：2026-06-14
状态：已确认
前置：M3 成长与任务、移动端适配（已完成，线上运行于 https://cc-myworld.xudahy.workers.dev）

---

## 目标

为现有联机体素游戏添加完整的物品背包系统，包含：采集驱动的物品循环、怪物掉落、分档武器、材料强化、NPC 商店经济。在不破坏现有桌面/移动端功能的前提下实现。

---

## 物品模型

### 四类物品

| 类型 | JSON 结构 | 可叠加上限 |
|------|-----------|-----------|
| `block` | `{type:'block', id:1-8, qty:N}` | 64 |
| `material` | `{type:'material', sub:'wolf_fang'\|'skeleton_bone'\|'zombie_rags'\|'slime_gel', qty:N}` | 64 |
| `weapon` | `{type:'weapon', sub:'sword'\|'bow', tier:1\|2\|3, enh:0\|1\|2\|3}` | 不叠加 |
| 金币 | 不占背包格，存为 `player.coins INTEGER` | — |

### 武器档次

| 档次 | 名称 | 剑伤害倍率 | 弓伤害倍率 | 获取途径 |
|------|------|-----------|-----------|---------|
| tier 1 | 初级 | ×1.0（现有基础） | ×1.0 | 默认拥有 / NPC 购买 |
| tier 2 | 精良 | ×1.5 | ×1.5 | NPC 购买 500 金 / zombie/skeleton 低概率掉落 |
| tier 3 | 传说 | ×2.5 | ×2.5 | NPC 购买 2000 金 / wolf 低概率掉落 |

### 强化等级

| 强化 | 额外伤害加成 | 所需材料（对应怪种） | 成功率 | 失败结果 |
|------|------------|-------------------|--------|---------|
| +1 | +20% | 5 个 | 100% | — |
| +2 | +40% | 10 个 | 80% | 保持 +1 |
| +3 | +60% | 20 个 | 50% | 降回 +1 |

强化所需材料类型与武器使用场景对应：剑用 wolf_fang / skeleton_bone，弓用 skeleton_bone / slime_gel（具体配方在 `items_def.js` 定义）。

最终伤害 = `基础伤害(level) × tier倍率 × (1 + enh×0.2)`

---

## 服务端架构

### 数据持久化（Durable Object SQLite）

```sql
-- players 表新增列
ALTER TABLE players ADD COLUMN coins INTEGER DEFAULT 0;

-- 新增背包表
CREATE TABLE IF NOT EXISTS inventory (
  pid   TEXT NOT NULL,
  slot  INTEGER NOT NULL,   -- 0-29 背包，30-39 快捷栏
  item  TEXT NOT NULL,      -- JSON 字符串
  PRIMARY KEY (pid, slot)
);
```

slot 编号约定：0-29 为背包 30 格，30-39 为快捷栏 10 格。

### 协议消息（`shared/protocol.js` 新增）

| 方向 | 类型 | 内容 |
|------|------|------|
| S→C | `inv_state` | `{coins:N, slots:[{slot,item}\|null, ...]}`：登录时发完整背包 |
| S→C | `inv_delta` | `{coins?:N, gain?:[items], lose?:[{slot,qty}]}`：增减物品 |
| C→S | `inv_arrange` | `{slots:[{slot,item}\|null]}`：拖拽结束后发完整顺序（仅落盘） |
| C→S | `buy` | `{sub:'sword'\|'bow', tier:1\|2\|3}` |
| C→S | `sell` | `{sub:material_sub, qty:N}` |
| C→S | `enhance` | `{slot:N}`：快捷栏或背包内武器所在格子 |

### 物品增减触发时机

**挖方块（现有 `edit` 消息处理后追加）：**
- 服务端确认 block id=0 编辑后，向操作者发 `inv_delta {gain:[{type:'block',id:X,qty:1}]}`

**击杀怪物（现有 mob 死亡逻辑追加）：**
- 按掉落表（`shared/items_def.js`）随机决定掉落，向击杀者发 `inv_delta`

**购买 / 出售 / 强化：**
- 服务端校验后操作 SQLite，发 `inv_delta` 确认（或 `err` 拒绝）

### 掉落表

| 怪物 | 材料 | 数量范围 | 掉落率 | 附加金币 |
|------|------|---------|--------|---------|
| slime | slime_gel | 1-2 | 80% | 1-3 金（40%，随等级） |
| zombie | zombie_rags | 1-2 | 80% | 2-6 金（40%，随等级） |
| skeleton | skeleton_bone | 1-3 | 80% | 3-9 金（40%，随等级） |
| wolf | wolf_fang | 1-2 | 80% | 5-15 金（40%，随等级） |
| zombie/skeleton | tier2 武器 | — | 2% | — |
| wolf | tier3 武器 | — | 1% | — |

### 商店价格

| 物品 | 买入价 | 卖出价 |
|------|-------|-------|
| tier1 剑/弓 | 50 金 | — |
| tier2 剑/弓 | 500 金 | — |
| tier3 剑/弓 | 2000 金 | — |
| slime_gel | — | 5 金/个 |
| zombie_rags | — | 10 金/个 |
| skeleton_bone | — | 20 金/个 |
| wolf_fang | — | 35 金/个 |

---

## 客户端架构

### 布局

```
┌─────────────────────────────────┐
│  背包              [金币: 128] [X]│
│  ┌──┬──┬──┬──┬──┬──┐            │
│  │  │  │  │  │  │  │  ← 5行    │
│  │  │  │  │  │  │  │    6列    │
│  │  │  │  │  │  │  │    共30格  │
│  │  │  │  │  │  │  │            │
│  │  │  │  │  │  │  │            │
│  └──┴──┴──┴──┴──┴──┘            │
│  快捷栏                          │
│  ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐│
│  │  │  │  │  │  │  │  │  │  │  ││
│  └──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘│
│  [强化]  [商店]                   │
└─────────────────────────────────┘
```

### 打开/关闭

- **桌面**：`B` 键切换；打开时退出 Pointer Lock，关闭时重新锁定
- **移动端**：右上角固定 `🎒` 按钮；打开时游戏输入暂停

### 拖拽规则（桌面）

- 鼠标按下抬起物品 → 跟手显示半透明图标
- 放到目标格：
  - 目标格为空 → 直接移动
  - 目标格同类可叠加物品 → 合并 qty（超出上限则剩余留在源格）
  - 目标格其他物品 → 互换位置
- 背包格 ↔ 快捷栏格双向拖拽均支持
- 拖拽结束后发 `inv_arrange` 消息落盘

### 点选规则（移动端）

移动端背包为覆盖层，touch 拖拽与现有触控系统冲突，改用点选模式：
- 点击格子 → 高亮选中（显示蓝色边框）
- 再点另一格 → 执行移动/合并/互换，同时发 `inv_arrange`
- 再次点同一格 / 点空白区域 → 取消选中

### 新玩家初始背包

服务端为首次登录玩家（inventory 表无记录）初始化：
- slot 30（快捷栏第 1 格）= `{type:'weapon', sub:'sword', tier:1, enh:0}`
- slot 31（快捷栏第 2 格）= `{type:'weapon', sub:'bow', tier:1, enh:0}`
- 其余格为空；coins = 0

### 快捷栏动态化

- 快捷栏 10 格（slot 30-39）内容从背包状态读取，不再硬编码
- `Combat.ITEMS` 改为读 `Inventory.getHotbarItem(index)` 动态获取
- `ui.js` 的 `buildHotbar` 接受物品数组参数渲染图标

### 商店面板

靠近 NPC（`nearNpc()` 返回 true）时 `[商店]` 按钮可点击，弹出面板：
- 左列：购买（tier1/2/3 剑弓，标价，金币不足则灰显）
- 右列：出售（背包内材料列表，单价，输入数量）

### 强化面板

点击 `[强化]` 打开，选择背包/快捷栏中一把武器：
- 显示当前 enh 等级、下一级所需材料与数量、成功率
- 点击 `强化` 发 `enhance` 消息；服务端回 `inv_delta` 或错误消息
- 成功/失败均有简短提示

---

## 文件改动范围

| 文件 | 操作 | 主要内容 |
|------|------|---------|
| `shared/items_def.js` | 新建 | 物品类型常量、掉落表、商店价格、强化配方 |
| `shared/protocol.js` | 修改 | 新增消息类型常量与校验函数（validInvArrange / validBuy / validSell / validEnhance） |
| `js/inventory.js` | 新建 | Inventory 类：状态管理、UI 面板、拖拽逻辑、商店/强化子面板 |
| `server/world_do.js` | 修改 | inventory 表、掉落逻辑、buy/sell/enhance handler、inv_state 登录推送 |
| `js/combat.js` | 修改 | ITEMS 改为读 Inventory.getHotbarItem()；伤害计算加入 tier/enh 倍率 |
| `js/main.js` | 修改 | Inventory 初始化、B 键、inv_state/inv_delta 消息处理、快捷栏同步 |
| `index.html` | 修改 | 背包面板 DOM、移动端 🎒 按钮、相关 CSS |
| `js/ui.js` | 修改 | buildHotbar 接受动态物品数组 |

---

## 不在本期范围内

- 护甲槽（头盔/胸甲/护腿）
- 自由配方合成（crafting table）
- 物品掉落实体（地面上的掉落物）——本期击杀后直接入包
- 背包格子数量自定义扩展
- 物品交易（玩家间）
