// tests/manual/mobs_probe.js — 走到最近史莱姆营地，观察 mobSpawn/mobMove
// 先启动: npx wrangler dev --port 8787 --persist-to ../cc-myworld-state
// 运行: node tests/manual/mobs_probe.js
'use strict';
const assert = require('node:assert');
require('../../shared/mobs_def.js');
const MobsDef = globalThis.MyWorld.MobsDef;
const URL_WS = process.argv[2] || 'ws://127.0.0.1:8787/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tok() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

(async () => {
  const ws = new WebSocket(URL_WS);
  const seen = { spawn: [], move: 0 };
  let welcome = null;
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') welcome = m;
    else if (m.t === 'mobSpawn') seen.spawn.push(m);
    else if (m.t === 'mobMove') seen.move++;
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('连不上，dev 在跑吗'))); });
  ws.send(JSON.stringify({ t: 'hello', token: tok(), name: '探针' }));
  while (!welcome) await sleep(50);

  // 用种子推算最近的史莱姆营地（与服务器同一纯函数）
  const camps = MobsDef.campsNear(welcome.seed, welcome.x, welcome.z, 12)
    .filter((c) => c.type === 'slime')
    .sort((a, b) => Math.hypot(a.x - welcome.x, a.z - welcome.z) - Math.hypot(b.x - welcome.x, b.z - welcome.z));
  assert.ok(camps.length > 0, '12 区块内有史莱姆营地');
  const camp = camps[0];
  console.log('目标营地', camp.x.toFixed(1), camp.z.toFixed(1), '怪数', camp.count);

  // 以 0.8 格/100ms 走过去（服务器限速 0.9/100ms）
  let x = welcome.x, z = welcome.z;
  const y = welcome.y + 0.5;
  for (let i = 0; i < 3000; i++) {
    const dx = camp.x - x, dz = camp.z - z;
    const d = Math.hypot(dx, dz);
    if (d < 30) break; // 进入兴趣半径（4 区块=64 格）内一段后即可
    x += dx / d * 0.8; z += dz / d * 0.8;
    ws.send(JSON.stringify({ t: 'move', x, y, z, yaw: 0, pitch: 0 }));
    await sleep(100);
  }
  await sleep(4000); // 等激活扫描（1Hz）与游走启动

  assert.ok(seen.spawn.length >= camp.count, '收到整营 mobSpawn，实收 ' + seen.spawn.length);
  assert.ok(seen.spawn.every((m) => m.type === 'slime' && m.hp > 0 && m.maxHp >= 12), 'mobSpawn 字段合法');
  assert.ok(seen.move > 0, '收到 mobMove（游走中），实收 ' + seen.move);
  console.log('mobs_probe OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
