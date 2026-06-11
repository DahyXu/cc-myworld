// tests/manual/two_clients.js — 双客户端联机协议探针
// 先启动: npx wrangler dev --port 8787
// 再运行: node tests/manual/two_clients.js [ws://127.0.0.1:8787/ws]
'use strict';
const assert = require('node:assert');
const URL_WS = process.argv[2] || 'ws://127.0.0.1:8787/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client() {
  const ws = new WebSocket(URL_WS);
  const queue = [];
  let waiter = null;
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (waiter) { const w = waiter; waiter = null; w(m); } else queue.push(m);
  });
  return {
    ws,
    open: () => new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', () => rej(new Error('连接失败，wrangler dev 在跑吗？')));
    }),
    send: (o) => ws.send(JSON.stringify(o)),
    next: () => new Promise((res) => { if (queue.length) res(queue.shift()); else waiter = res; }),
    async nextOf(type) { // 丢弃其他类型直到拿到 type（最多 50 条）
      for (let i = 0; i < 50; i++) { const m = await this.next(); if (m.t === type) return m; }
      throw new Error('等不到消息: ' + type);
    },
    closed: () => new Promise((res) => ws.addEventListener('close', (e) => res(e.code))),
  };
}

function tok() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

(async () => {
  const A = client(), B = client();
  await A.open(); await B.open();
  const tA = tok(), tB = tok();

  // 握手：种子一致、互见
  A.send({ t: 'hello', token: tA, name: '甲' });
  const wA = await A.nextOf('welcome');
  B.send({ t: 'hello', token: tB, name: '乙' });
  const wB = await B.nextOf('welcome');
  const enterB = await A.nextOf('penter');
  assert.strictEqual(wA.seed, wB.seed, '两端种子一致');
  assert.strictEqual(enterB.name, '乙', 'A 收到 B 进入');
  assert.ok(wB.players.some((p) => p.name === '甲'), 'B 的 welcome 含 A');

  // 移动转发（先等 150ms 让限速窗口放行）
  await sleep(150);
  A.send({ t: 'move', x: wA.x + 0.5, y: wA.y, z: wA.z, yaw: 1, pitch: 0 });
  const mv = await B.nextOf('pmove');
  assert.ok(Math.abs(mv.x - (wA.x + 0.5)) < 1e-6, 'B 收到 A 的移动');

  // 合法编辑全员广播（含发起者权威回声）
  const ex = Math.floor(wA.x) + 1, ey = Math.floor(wA.y), ez = Math.floor(wA.z);
  A.send({ t: 'edit', x: ex, y: ey, z: ez, id: 8 });
  const edB = await B.nextOf('edit');
  assert.deepStrictEqual([edB.x, edB.y, edB.z, edB.id], [ex, ey, ez, 8], 'B 收到编辑');
  const edA = await A.nextOf('edit');
  assert.strictEqual(edA.id, 8, 'A 收到权威回声');

  // 非法编辑（超远）→ editReject
  A.send({ t: 'edit', x: ex + 500, y: ey, z: ez, id: 8 });
  const rej = await A.nextOf('editReject');
  assert.strictEqual(rej.x, ex + 500, '超远编辑被拒并回发真实值');

  // 超速移动 → teleport 拉回
  A.send({ t: 'move', x: wA.x + 100, y: wA.y, z: wA.z, yaw: 0, pitch: 0 });
  const tp = await A.nextOf('teleport');
  assert.ok(Math.abs(tp.x - (wA.x + 0.5)) < 1e-6, '瞬移被拉回上一合法位置');

  // 同凭证顶替：旧连接收 4000
  const A2 = client();
  await A2.open();
  const kicked = A.closed();
  A2.send({ t: 'hello', token: tA, name: '甲' });
  await A2.nextOf('welcome');
  assert.strictEqual(await kicked, 4000, '旧连接被 4000 顶替');

  // 断线位置持久化：A2 移动→断开→重连，welcome 位置保持
  await sleep(150);
  A2.send({ t: 'move', x: wA.x + 1, y: wA.y, z: wA.z, yaw: 0, pitch: 0 });
  await sleep(100);
  A2.ws.close();
  await sleep(200);
  const A3 = client();
  await A3.open();
  A3.send({ t: 'hello', token: tA, name: '甲' });
  const wA3 = await A3.nextOf('welcome');
  assert.ok(Math.abs(wA3.x - (wA.x + 1)) < 1e-6, '断线位置已持久化，重连恢复');

  // 编辑持久化：A3 的 welcome 应包含此前的编辑
  assert.ok(wA3.edits.some((e) => e[0] === ex && e[1] === ey && e[2] === ez && e[3] === 8), '编辑已持久化进 welcome');

  console.log('two_clients PROBE OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
