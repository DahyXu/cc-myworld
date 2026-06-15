# PvP + 组队系统 设计文档

日期：2026-06-15
状态：已确认

---

## 目标

1. **PvP**：玩家可用剑/弓互相攻击，伤害结算复用现有 `damagePlayer`
2. **组队**：最多 4 人，邀请/接受制，组队后友伤豁免、打怪经验平分

---

## 架构

纯客户端 + Durable Object 服务器扩展，零新文件。

### 服务器新增状态（`world_do.js` 构造器）

```js
this.teams = new Map();          // teamId -> { id, leaderPid, members: Set<pid> }
this.nextTeamId = 1;
this.pendingInvites = new Map(); // inviteePid -> { fromPid, teamId|null, expiresAt }
```

每个 session 新增字段：`s.teamId = null`

---

## 协议消息

| 方向 | 消息 | 字段 | 含义 |
|------|------|------|------|
| C→S | `pvpAttack` | `{ pid }` | 近战攻击玩家 |
| C→S | `teamInvite` | `{ pid }` | 邀请玩家 |
| C→S | `teamAccept` | `{ pid }` | 接受来自 pid 的邀请 |
| C→S | `teamDecline` | `{ pid }` | 拒绝邀请 |
| C→S | `teamLeave` | — | 主动退队 |
| S→C | `teamInviteFrom` | `{ pid, name }` | 收到邀请通知 |
| S→C | `teamUpdate` | `{ members:[{pid,name}], leaderPid }` | 队伍状态变化 |
| S→C | `teamErr` | `{ reason }` | 操作失败（'full' / 'no_invite'） |

---

## 文件改动

| 路径 | 职责 |
|------|------|
| `server/world_do.js` | 队伍状态、PvP 伤害、XP 平分、消息处理 |
| `shared/protocol.js` | 新增消息类型校验函数 |
| `js/combat.js` | `pickPlayer`、`onAttackClick` 扩展（玩家目标） |
| `js/entities.js` | 队友名牌金色渲染，暴露 `playerAABBList()` |
| `js/main.js` | E 键上下文感知、Y/N 键响应、`teamUpdate`/`teamInviteFrom` 消息处理 |
| `index.html` | 新增邀请横幅 `#teamInviteBanner` DOM + CSS、队伍列表 `#teamRoster` |

---

## PvP 战斗

### 客户端（`combat.js`）

新增 `pickPlayer(eye, dir, playerList)`：与现有 `pickMob` 相同的射线-AABB 逻辑，AABB 为 (0.5 × 1.75 × 0.5)，原点在玩家脚底。返回最近命中玩家对象 `{ pid, x, y, z }`，未命中返回 `null`。

`onAttackClick` 扩展：

```js
// 剑：先检测怪，找不到再检测玩家
const mobTarget = pickMob(eye, dir, mobList);
if (mobTarget) {
  net.send({ t: 'attack', id: mobTarget.id, slot: itemIndex });
} else {
  const playerTarget = pickPlayer(eye, dir, playerList);
  if (playerTarget) net.send({ t: 'pvpAttack', pid: playerTarget.pid });
}
```

弓箭：现有 `shoot` 消息不变，服务器箭矢 tick 新增玩家碰撞检测。

### 服务器（`world_do.js`）

新增 `onPvpAttack(ws, s, msg)`：
1. `s.dead` 或 `msg.pid` 非法 → return
2. `sessionByPid(msg.pid)` 找目标；未找到 → return
3. 双方 `teamId` 相同且非 null → return（友伤豁免）
4. 距离校验 ≤ `MELEE_RANGE + 1`，检查 `s.atkReadyAt`
5. `s.atkReadyAt = now + MELEE_CD_MS`
6. 伤害 = `Math.floor(Stats.swordDamage(s.level) * swordMul)`
7. `damagePlayer(targetSession, dmg, now)`

箭矢 `tickArrows` 扩展：现有怪物碰撞检测后，遍历所有 sessions，同一队伍跳过，命中（射线-AABB）则 `damagePlayer`，箭矢标记死亡。

死亡惩罚：复用现有 `xpAfterDeath`（扣当前等级进度 10%），无额外 PvP 特殊处理。

---

## 组队系统

### 组建流程

```
A 按 E 面向 B（5 格内，前向点积 > 0.7）
  → 客户端发 teamInvite { pid: B }
服务器 → 存入 pendingInvites[B.pid] = { fromPid: A, expiresAt: now+30000 }
         向 B 发 teamInviteFrom { pid: A, name: "A" }
B 按 Y → 发 teamAccept { pid: A }
服务器 → 创建/加入队伍，广播 teamUpdate
B 按 N → 发 teamDecline { pid: A }，删除 pendingInvite
```

邀请约束：
- 目标已在 4 人满队 → 服务器回 `teamErr { reason: 'full' }`，客户端显示「对方队伍已满」
- 邀请 30 秒过期；清理策略为惰性清理（`onTeamAccept` / `onTeamInvite` 时检查 `expiresAt`）
- 同一 inviteePid 只存最后一条邀请（后邀覆盖前邀，旧邀作废）

### E 键上下文感知（`main.js`）

按下 E 时按优先级检测：
1. 5 格内、前向点积 > 0.7 有玩家 → 发 `teamInvite { pid }`，显示「邀请已发出」提示
2. 否则检测 NPC 距离 → 打开任务对话框（现有逻辑不变）
3. 两者都无 → 无响应

### 队伍生命周期

| 事件 | 行为 |
|------|------|
| 成员离线 | `removeFromTeam(pid)`，广播 `teamUpdate` |
| 队长离线 | 转让给 members 中 pid 最小的在线成员，广播 `teamUpdate` |
| 主动退队（`teamLeave`） | 同离线处理 |
| 队伍仅剩 1 人 | 自动解散，该成员 `teamId = null` |
| 离线玩家重连 | `teamId` 不恢复，需重新发起邀请 |

### 服务器辅助函数

- `removeFromTeam(pid)` — 统一处理离队/离线，含队长转让与单人解散
- `broadcastTeamUpdate(teamId)` — 向队伍所有在线成员发 `teamUpdate`

---

## XP 共享

扩展 `grantKill(attacker, mob)`：

```
1. 获取 killer 的 teamId
2. teamId 为 null → 单人全额 XP（现有逻辑不变）
3. 有队伍 → 找出队内所有在线成员（含 killer）中距 mob ≤ 64 格的成员
4. count = 符合条件成员数（≥ 1）
5. share = Math.floor(baseXp / count)
6. 对每个符合条件成员各调一次 gainXp(ws, s, share)
```

任务计数（`questProg`）仅给最后一击玩家，不共享到队友。

---

## UI

### 邀请横幅（`index.html` + `main.js`）

CSS：`#teamInviteBanner` — `position:fixed; top:60px; left:50%; transform:translateX(-50%); z-index:20; display:none`

收到 `teamInviteFrom` → 显示「[名字] 邀请你加队　**Y** 接受　**N** 拒绝」，30 秒后自动隐藏。
按 Y → 发 `teamAccept`，横幅消失；按 N → 发 `teamDecline`，横幅消失。

### 队伍成员列表（`index.html` + `main.js`）

CSS：`#teamRoster` — `position:fixed; left:12px; top:80px; z-index:15; display:none`

收到 `teamUpdate` → 显示成员名字列表（纯文字，无血条）；`teamId = null` 时隐藏。

### 盟友视觉区分（`entities.js`）

客户端维护 `myTeamPids = Set<pid>`，收到 `teamUpdate` 时更新。
渲染远端玩家名牌时：队友名牌改为金色（`#ffd700`），非队友保持白色。

---

## 不在本次范围内

- 跨 DO 实例的跨服组队
- 队伍语音/文字聊天
- 队友血条 HUD
- 组队任务共享（questProg 扩散）
- 移动端触摸 PvP
