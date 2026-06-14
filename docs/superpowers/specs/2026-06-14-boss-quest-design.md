# Boss 系统 + 1~10级主线任务 设计文档

日期：2026-06-14
状态：已确认
前置：背包系统（已完成，线上运行于 https://cc-myworld.xudahy.workers.dev）

---

## 目标

为现有联机体素游戏新增：
1. **世界Boss系统**：4个地带Boss定时刷新，各有独特技能，击杀给高额奖励
2. **1~10级主线任务**：替换现有10环任务链，按等级锁定，目标类型多样，里程碑关卡奖励稀有装备

---

## Boss 系统

### 4个Boss定义

| Boss | 地带 | 固定坐标 (x,z) | HP | 伤害 | 刷新冷却 |
|------|------|----------------|-----|------|----------|
| 史莱姆王 | slime | (120, 8.5) | 120 | 3 | 15分钟 |
| 僵尸领主 | zombie | (225, 8.5) | 250 | 6 | 15分钟 |
| 骷髅法师 | skeleton | (400, 8.5) | 200 | 9 | 15分钟 |
| 狼王 | wolf | (650, 8.5) | 350 | 15 | 15分钟 |

速度与对应地带普通怪相同，视野范围扩大至20格。

### 独特技能

每个Boss有一个服务端触发的特殊技能：

- **史莱姆王 — 分裂**：血量首次降至50%时，在周围4格内生成2只等级相当的普通史莱姆（每场仅触发一次；生成的小怪不属于任何营地，Boss死亡时不自动消失）
- **僵尸领主 — 腐化之气**：每10秒对3格内所有玩家造成一次AOE伤害（dmg=4），服务端在 tick 中判断触发
- **骷髅法师 — 召唤骷髅**：每30秒召唤2只骷髅弓手（lv8）；法师死亡时召唤物同步消失
- **狼王 — 冲刺**：当目标距离 > 5格时，以3倍速度冲刺1秒（`speed × 3`，单次 tick 生效）

### 击杀奖励（首击者独享）

击杀Boss的最后一击归属玩家获得全部奖励；其他参与者仅得普通经验分成（与现有 `grantKill` 逻辑一致）。

| Boss | XP | 金币 | 保底物品 |
|------|-----|------|---------|
| 史莱姆王 | 500 | 100 | 精良剑 T2 enh:0 |
| 僵尸领主 | 800 | 200 | 精良弓 T2 enh:0 |
| 骷髅法师 | 1200 | 300 | 传说剑 T3 enh:0 |
| 狼王 | 2000 | 500 | 传说弓 T3 enh:0 |

### 刷新机制

- Boss死亡后进入15分钟冷却，冷却结束原地满血复活
- 刷新状态保存在 DO 内存（`this.bosses` Map），不持久化——DO重启后Boss立即复活
- 登录时服务端下发 `bossState` 消息（含各Boss存活状态和剩余复活秒数）
- Boss死亡时广播 `bossDie`（含 `id` 和 `respawnIn` 秒数），客户端在Boss位置显示复活倒计时浮字

### 客户端表现

- 复用现有怪物体素渲染，Boss体型 scale ×2，颜色加深（`color × 0.6`）
- Boss血量显示：受击时在体素上方显示血条（与普通怪相同机制）
- 死亡后在原坐标显示倒计时浮字（如"史莱姆王 13:42后复活"），每秒更新

---

## 1~10级主线任务

### 任务列表

替换现有 `CHAIN` 数组，改为按等级锁定：玩家达到对应等级且上一条主线已完成，才能向NPC接取。

| 等级 | 描述 | 类型 | 目标 | 奖励XP | 奖励金币 | 特殊物品 |
|------|------|------|------|--------|---------|---------|
| 1 | 击杀5只史莱姆 | kill | slime×5 | 90 | 30 | — |
| 2 | 收集5个粘液凝胶 | collect | slime_gel×5 | 120 | 50 | — |
| 3 | 击杀史莱姆王 | boss | slime_king×1 | 500 | 100 | 精良剑 T2 |
| 4 | 探索：抵达僵尸地带（距出生点150格） | explore | dist≥150 | 150 | 80 | — |
| 5 | 击杀10只僵尸 | kill | zombie×10 | 225 | 100 | — |
| 6 | 击杀僵尸领主 | boss | zombie_lord×1 | 800 | 200 | 精良弓 T2 |
| 7 | 收集8个骷髅骨 | collect | skeleton_bone×8 | 375 | 150 | — |
| 8 | 击杀10只骷髅弓手 | kill | skeleton×10 | 500 | 180 | — |
| 9 | 击杀骷髅法师 | boss | skeleton_mage×1 | 1200 | 300 | 传说剑 T3 |
| 10 | 击杀狼王 | boss | wolf_king×1 | 2000 | 500 | 传说弓 T3 |

### 任务类型机制

**kill**（击杀怪物）
- 与现有系统相同，`grantKill` 中检查 questId 并递增 questProg
- 完成后需回NPC交任务

**collect**（收集材料）
- 取任务时NPC告知所需材料名称和数量
- 交任务时服务端校验 `s.inv` 中对应材料总量 ≥ 所需量
- 交任务成功则从背包扣除材料，给予奖励

**explore**（探索地点）
- 取任务后，服务端在 `onMove` 中检测玩家水平距离是否 ≥ 目标距离
- 条件满足时自动将 questProg 置为1（无需回NPC），HUD发送提示
- 交任务仍需回NPC（一问一答确认）

**boss**（击杀Boss）
- Boss死亡时，`grantBossKill` 检查最后一击归属玩家是否持有对应主线任务
- 满足则自动完成进度（progress=1），再回NPC交任务领奖励

### 与日常任务的关系

- 完成第10条主线后，`mainIndex`（原 `chainIndex`）= 10，切换为现有日常任务逻辑（不变）
- 日常任务奖励只有XP，不含特殊物品

### quest_id 编码扩展

现有格式：`kind:type:count`（kind = `c`/`d`）

新增主线格式：`m:目标类型:目标量`（kind = `m`）

示例：
- `m:slime:5` — 主线第1条（击杀5史莱姆）
- `m:slime_gel:5` — 主线第2条（收集5粘液凝胶）
- `m:slime_king:1` — 主线第3条（击杀史莱姆王）
- `m:dist:150` — 主线第4条（探索150格）

---

## 架构与文件改动

### 新增文件

**`shared/bosses_def.js`**
- `BOSSES` 数组：4个Boss的完整定义（id/name/x/z/hp/dmg/speed/xp/skill/loot/respawnMs）
- `bossById(id)` 查找函数
- IIFE 模块格式，挂载到 `root.MyWorld.BossesDef`

**`tests/test_bosses.js`**
- 覆盖：技能触发条件（分裂仅触发一次）、主线任务进度匹配、collect任务背包校验

### 修改文件

**`shared/quests_def.js`**
- `MAIN_QUESTS` 替换 `CHAIN`（10条，含 kind/bossId/material/dist/itemReward 字段）
- `offer(mainIndex, level)` 按 mainIndex 发主线，mainIndex≥10后发日常
- `parse()` 支持 `kind='m'`
- 新增 `mainQuestAt(mainIndex)` 返回对应主线定义

**`server/world_do.js`**
- `boot()` 初始化 `this.bosses` Map（4个Boss，全部存活，respawnAt=0）
- 新增 `tickBoss(boss, now)` 处理Boss AI + 技能触发
- `tickLoop` 同时遍历 `this.mobs` 和 `this.bosses`
- `onMove` 新增探索任务检测
- `questTurnIn` 新增收集任务材料校验与扣除
- `grantBossKill(ws, s, boss)` 处理Boss击杀经验/任务/物品奖励
- 登录时下发 `bossState` 消息

**`js/entities.js`**
- `bossState` / `bossDie` / `bossHurt` / `bossSpawn` 消息处理
- Boss渲染：scale ×2，颜色加深
- 倒计时浮字逻辑

**`shared/protocol.js`**
- 新增 `validBossAttack(msg)` 校验

**`tests/run_all.js`**
- 加入 `test_bosses.js`

---

## 不在本次范围内

- Boss多阶段（狂暴模式）
- 多人伤害分成排行
- Boss专属掉落材料（用于合成）
- 地图/小地图
