# 我的世界 · 联机版

用 Three.js + Cloudflare Durable Objects 构建的浏览器多人体素游戏。所有玩家共享同一个持久世界，方块修改实时同步、永久保存。

## 运行

本地开发（需要 Node ≥ 22）：

```bash
npx wrangler dev --persist-to ../cc-myworld-state
```

然后访问提示的本地地址（默认 http://localhost:8787）。

> `--persist-to` 必须指向**项目目录之外**：本项目把仓库根目录作为静态资产目录，而 wrangler 的文件监听不理会 `.assetsignore`——本地世界数据（SQLite）若写在项目内的 `.wrangler/` 下，会自我触发无限热重载。

部署到 Cloudflare：

```bash
npx wrangler deploy
```

## 玩法

| 操作 | 按键 |
|------|------|
| 移动 | W / A / S / D |
| 跳跃 | 空格 |
| 视角 | 鼠标 |
| 挖方块 | 鼠标左键 |
| 放方块 | 鼠标右键 |
| 选方块 | 数字键 1~8 或滚轮 |
| 暂停 | ESC |

首次进入输入昵称即可游玩，进度与浏览器绑定（localStorage 凭证），无需注册。

## 特性

- 真联机：同一个持久共享世界，互见移动、同步建造，断线自动重连
- 无限世界：柏林噪声地形，固定种子确定性生成，服务器只存修改 diff
- 8 种方块：草、泥土、石头、原木、木板、树叶、沙子、砖块
- 程序化像素贴图：零图片素材，全部 canvas 代码绘制
- 区块化渲染：面剔除 + 顶点 AO

## 开发

纯逻辑模块（噪声/世界/网格/物理/射线/协议）有 Node 单元测试：

```bash
node tests/run_all.js
```

联机协议探针（需先启动 wrangler dev）：

```bash
node tests/manual/two_clients.js
```

架构：`server/world_do.js` 是权威服务器（一个 Durable Object 即一个世界，SQLite 持久化）；客户端用世界种子本地生成地形，与服务器只同步方块 diff 和实体状态。
