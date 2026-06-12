// tests/manual/combat_probe.js — 战斗链路：走到史莱姆营地→砍死一只→挨打→验证回血开始
// 先启动: npx wrangler dev --port 8787 --persist-to ../cc-myworld-state
// 运行: node tests/manual/combat_probe.js
'use strict';
const assert = require('node:assert');
require('../../js/noise.js');
require('../../js/world.js');
require('../../shared/mobs_def.js');
const MobsDef = globalThis.MyWorld.MobsDef;
const World = globalThis.MyWorld.World;
const URL_WS = process.argv[2] || 'ws://127.0.0.1:8787/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tok() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

(async () => {
  const ws = new WebSocket(URL_WS);
  let welcome = null;
  const mobs = new Map(); // id -> {hp,maxHp,x,y,z,type}
  const ev = { hurt: [], die: [], selfHurt: [], hpUp: [] };
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') { welcome = m; for (const mb of m.mobs) mobs.set(mb.id, mb); }
    else if (m.t === 'mobSpawn') mobs.set(m.id, m);
    else if (m.t === 'mobMove') { const mb = mobs.get(m.id); if (mb) { mb.x = m.x; mb.y = m.y; mb.z = m.z; } }
    else if (m.t === 'mobHurt') { ev.hurt.push(m); const mb = mobs.get(m.id); if (mb) mb.hp = m.hp; }
    else if (m.t === 'mobDie') { ev.die.push(m); mobs.delete(m.id); }
    else if (m.t === 'playerHurt') ev.selfHurt.push(m);
    else if (m.t === 'hpUpdate') ev.hpUp.push(m);
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('连不上'))); });
  ws.send(JSON.stringify({ t: 'hello', token: tok(), name: '战斗探针' }));
  while (!welcome) await sleep(50);

  const camp = MobsDef.campsNear(welcome.seed, welcome.x, welcome.z, 12)
    .filter((c) => c.type === 'slime')
    .sort((a, b) => Math.hypot(a.x - welcome.x, a.z - welcome.z) - Math.hypot(b.x - welcome.x, b.z - welcome.z))[0];
  assert.ok(camp, '附近有史莱姆营地');

  // 走到营地边 3 格：用同种子的本地世界贴地走（服务器近战校验用 3D 距离，必须跟随地形高度）
  const lw = World.create(welcome.seed);
  const groundY = (px, pz) => lw.terrainHeight(Math.floor(px), Math.floor(pz)) + 1;
  let x = welcome.x, z = welcome.z;
  for (let i = 0; i < 5000; i++) {
    const dx = camp.x - x, dz = camp.z - z;
    const d = Math.hypot(dx, dz);
    if (d < 3) break;
    const step = Math.min(0.8, d);
    x += dx / d * step; z += dz / d * step;
    ws.send(JSON.stringify({ t: 'move', x, y: groundY(x, z), z, yaw: 0, pitch: 0 }));
    await sleep(100);
  }
  await sleep(2000);
  assert.ok(mobs.size > 0, '看到怪了');

  // 持续砍最近的怪直到死（冷却 500ms；怪会被击退/移动，循环重选最近）
  let killed = null;
  for (let i = 0; i < 120 && !killed; i++) {
    let best = null, bd = 1e9;
    for (const mb of mobs.values()) {
      const d = Math.hypot(mb.x - x, mb.z - z);
      if (d < bd) { bd = d; best = mb; }
    }
    if (best && bd <= 3.2) {
      ws.send(JSON.stringify({ t: 'attack', id: best.id }));
    } else if (best) {
      // 追上去（贴地）
      const dx = best.x - x, dz = best.z - z, d = Math.hypot(dx, dz);
      x += dx / d * Math.min(0.8, d); z += dz / d * Math.min(0.8, d);
      ws.send(JSON.stringify({ t: 'move', x, y: groundY(x, z), z, yaw: 0, pitch: 0 }));
    }
    if (ev.die.length > 0) killed = ev.die[0];
    await sleep(250);
  }
  assert.ok(ev.hurt.length > 0, '收到 mobHurt，命中 ' + ev.hurt.length + ' 次');
  assert.ok(ev.hurt.every((h) => h.dmg === 3), '1 级剑伤害为 3');
  assert.ok(killed, '怪被击杀（mobDie）');
  assert.ok(ev.selfHurt.length > 0, '史莱姆反击造成 playerHurt');
  // 撤离等待回血（5 秒脱战 + 1 秒/点）
  for (let i = 0; i < 80; i++) {
    const dx = welcome.x - x, dz = welcome.z - z, d = Math.hypot(dx, dz);
    if (d > 1) { x += dx / d * Math.min(0.8, d); z += dz / d * Math.min(0.8, d); ws.send(JSON.stringify({ t: 'move', x, y: groundY(x, z), z, yaw: 0, pitch: 0 })); }
    await sleep(100);
  }
  await sleep(8000);
  assert.ok(ev.hpUp.length > 0, '脱战回血发出 hpUpdate，实收 ' + ev.hpUp.length);
  console.log('combat_probe OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
