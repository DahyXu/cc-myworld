# 技能系统设计文档

**目标：** 玩家随等级提升解锁 14 个技能（被动+主动混合），配套技能书面板（K）和技能热键栏（Q/G/R/F）。

**架构：** 移动类技能（飞行、冲刺、二段跳）客户端执行；战斗类被动（战魂、坚韧、猎手、不死之身）服务器端在伤害/死亡处理时应用；主动技能冷却客户端本地计时。

---

## 技能列表

| 等级 | ID | 技能名 | 类型 | 效果 | 快捷键 |
|------|----|--------|------|------|--------|
| 2  | vitality      | 体力强化 | 被动 | 最大 HP +25               | —  |
| 3  | swiftness     | 疾步     | 被动 | 移速 +15%                 | —  |
| 4  | chargedStrike | 蓄力一击 | 主动 | 下次攻击 ×2.5，CD 15s     | Q  |
| 5  | doubleJump    | 二段跳   | 被动 | 空中可再跳一次             | —  |
| 6  | regen         | 自愈     | 被动 | 每 6 秒回 3 HP            | —  |
| 7  | sprint        | 冲刺     | 主动 | 1.5s 移速 ×3，CD 10s     | G  |
| 8  | resilience    | 坚韧     | 被动 | 受到伤害 -10%             | —  |
| 9  | rapidShot     | 连射     | 被动 | 弓箭攻速 +30%（CD -30%）  | —  |
| 10 | lifesurge     | 生命涌现 | 被动 | 最大 HP +50               | —  |
| 12 | shockwave     | 冲击波   | 主动 | 4 格内敌人受 15 伤，CD 25s| R  |
| 15 | flight        | 飞行     | 主动 | 飞行模式 30s，CD 60s      | F  |
| 17 | warSoul       | 战魂     | 被动 | 攻击伤害 +20%             | —  |
| 19 | hunter        | 猎手     | 被动 | 获取 XP +25%              | —  |
| 20 | undying       | 不死之身 | 被动 | 致命伤时保留 1 HP（60s 内一次）| — |

---

## 文件分工

### 新增文件

**`js/skills.js`**
- `SKILL_TABLE`: 技能定义数组（id, name, unlockLevel, kind, key, duration, cooldown, description）
- `SkillState` 对象：
  - `update(level)` — 根据当前等级重新计算 `unlocked` Set
  - `hasSkill(id)` — 是否已解锁
  - `activate(id)` — 开始冷却，返回是否成功
  - `isOnCooldown(id)` — 是否冷却中
  - `cooldownLeft(id)` — 剩余冷却秒数
  - `tick(dt)` — 每帧减少冷却计时器
  - `flightTimeLeft` — 飞行剩余秒数
  - `chargedReady` — 蓄力一击是否待命

### 修改文件

**`shared/physics.js`**
- `step(b, world, dt)`：若 `b.flying` 为 true，跳过 `b.vy -= GRAVITY * dt`；飞行状态仍处理水平移动和碰撞

**`js/player.js`**
- `update(p, world, dt, input)`：
  - 速度：`const spd = p.sprintActive ? SPEED * 3 : (hasSkill('swiftness') ? SPEED * 1.15 : SPEED)`
  - 飞行时：Space → `p.vy = 5`，Shift → `p.vy = -5`，落地自动关闭飞行
  - 二段跳：`tryJump` 改为允许 `p.airJumps > 0` 时空中跳跃
- `tryJump(b, v)`：`if (b.onGround || b.airJumps > 0) { b.vy = v; if (!b.onGround) b.airJumps--; }`

**`js/main.js`**
- 按键 F：`SkillState.activate('flight')` → `player.flying = true`
- 按键 G：`SkillState.activate('sprint')` → `player.sprintActive = true`
- 按键 Q：`SkillState.activate('chargedStrike')` → `SkillState.chargedReady = true`
- 按键 R：`SkillState.activate('shockwave')` → `Net.send({ t: 'aoeAttack' })`
- 按键 K：`Hud.toggleSkillBook()`
- 等级更新时：`SkillState.update(newLevel)`，若解锁新技能，显示"新技能解锁：xxx！"提示
- 游戏循环：`SkillState.tick(dt)`；检查飞行计时器，到期 `player.flying = false`；冲刺计时器到期 `player.sprintActive = false`
- 自愈：客户端计时每 6 秒发 `{ t: 'regenTick' }`（服务器回 HP）
- `doAttack()`：若 `SkillState.chargedReady`，攻击消息附 `charged: true`，之后清除 `chargedReady`

**`shared/stats.js`**
- `maxHp(level)` 增加技能加成：`+ (level >= 2 ? 25 : 0) + (level >= 10 ? 50 : 0)`
- 客户端和服务器都引用此函数，改一处即全局生效

**`server/world_do.js`**
- Session 增加 `undyingUsedAt: 0`
- `onPvpAttack`：
  ```js
  let dmg = base;
  if (attacker.level >= 17) dmg = Math.round(dmg * 1.2);   // warSoul
  if (target.level >= 8)   dmg = Math.round(dmg * 0.9);    // resilience
  ```
- 死亡判断（HP ≤ 0）：
  ```js
  if (target.level >= 20 && Date.now() > target.undyingUsedAt + 60000) {
    target.hp = 1; target.undyingUsedAt = Date.now(); return;
  }
  ```
- `grantKill`：`xp = base * (killer.level >= 19 ? 1.25 : 1)`
- `onAoeAttack(s)`：遍历同格场景所有 mob/boss/player，距离 ≤4 受 15 伤
- `onRegenTick(s)`：若 `s.level >= 6`，`s.hp = Math.min(s.hp + 3, maxHp(s.level))`，回送 hpUpdate
- 弓箭 CD：`onShoot` 检查 `s.level >= 9`，CD 从 1000ms 降为 700ms

**`js/hud.js`**
- `openSkillBook(level)` / `closeSkillBook()` / `toggleSkillBook()`
- `updateSkillBar(cooldowns)` — 更新 Q/G/R/F 四个槽的冷却显示
- `showSkillUnlock(name)` — 右上角短暂提示
- `updateFlightBar(timeLeft, maxTime)` — 顶部蓝色飞行进度条，剩余 5s 变红闪烁

**`index.html`**
- `#skillBook`：居中半透明弹出面板，卡片网格（4 列），已解锁/锁定状态样式
- `#skillBar`：热键栏正上方，4 个主动技能槽（Q/G/R/F）带冷却遮罩
- `#flightBar`：屏幕顶部中央，细条进度条，默认隐藏
- `#skillUnlockToast`：右侧短暂滑入提示

---

## 数据流

```
等级提升 → server → 客户端 levelUp 消息
→ SkillState.update(newLevel) → 计算新解锁技能
→ Hud.showSkillUnlock(name) + Hud.updateSkillBar()

技能激活（如 F）→ SkillState.activate('flight') → player.flying = true
→ physics.js 跳过重力 → 飞行中每帧消耗 flightTimeLeft
→ 到期 → player.flying = false → 进入 CD

PvP 攻击 → server → warSoul/resilience 系数 → 伤害结算
```

---

## 边界条件

- 飞行中死亡：立即 `flying = false`，正常落地处理
- 冲刺中被击中：不中断冲刺（符合玩家预期）
- 未解锁技能按快捷键：无响应（`hasSkill` 返回 false 则忽略）
- 不死之身与团队 XP 分配：不死之身触发后仍正常参与后续战斗，XP 分配逻辑不变
