// tests/manual/quest_probe.js — 任务链路：接任务→杀够史莱姆→交付领经验
// 先启动: npx wrangler dev --port 8787 --persist-to ../cc-myworld-state
// 运行: node tests/manual/quest_probe.js
'use strict';
const assert = require('node:assert');
require('../../js/noise.js');
require('../../js/world.js');
require('../../shared/mobs_def.js');
require('../../shared/quests_def.js');
const MobsDef = globalThis.MyWorld.MobsDef;
const QuestsDef = globalThis.MyWorld.QuestsDef;
const World = globalThis.MyWorld.World;
const URL_WS = process.argv[2] || 'ws://127.0.0.1:8787/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function tok() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

(async () => {
  const ws = new WebSocket(URL_WS);
  let welcome = null;
  const mobs = new Map();
  const ev = { quest: [], xp: [], die: [] };
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') { welcome = m; for (const mb of m.mobs) mobs.set(mb.id, mb); }
    else if (m.t === 'mobSpawn') mobs.set(m.id, m);
    else if (m.t === 'mobMove') { const mb = mobs.get(m.id); if (mb) { mb.x = m.x; mb.y = m.y; mb.z = m.z; } }
    else if (m.t === 'mobDie') { ev.die.push(m); mobs.delete(m.id); }
    else if (m.t === 'questState') ev.quest.push(m.quest);
    else if (m.t === 'xpGain') ev.xp.push(m);
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('连不上'))); });
  ws.send(JSON.stringify({ t: 'hello', token: tok(), name: '任务探针' }));
  while (!welcome) await sleep(50);

  const lw = World.create(welcome.seed);
  const groundY = (px, pz) => lw.terrainHeight(Math.floor(px), Math.floor(pz)) + 1;
  let x = welcome.x, z = welcome.z;
  const moveTo = async (tx, tz, stopD) => {
    for (let i = 0; i < 5000; i++) {
      const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz);
      if (d < stopD) return;
      const s = Math.min(0.8, d);
      x += dx / d * s; z += dz / d * s;
      ws.send(JSON.stringify({ t: 'move', x, y: groundY(x, z), z, yaw: 0, pitch: 0 }));
      await sleep(100);
    }
  };

  // 1) 走到 NPC 旁接任务
  await moveTo(QuestsDef.NPC_X, QuestsDef.NPC_Z, 2);
  await sleep(200);
  ws.send(JSON.stringify({ t: 'questAccept' }));
  await sleep(300);
  assert.ok(ev.quest.length > 0 && ev.quest[ev.quest.length - 1], '接到任务');
  const q = ev.quest[ev.quest.length - 1];
  assert.strictEqual(q.type, 'slime', '首环是史莱姆');
  assert.strictEqual(q.count, 5);

  // 2) 走到最近史莱姆营地砍够 5 只
  const camp = MobsDef.campsNear(welcome.seed, x, z, 12).filter((c) => c.type === 'slime')
    .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
  assert.ok(camp, '有史莱姆营地');
  await moveTo(camp.x, camp.z, 3);
  await sleep(1500);
  for (let i = 0; i < 400 && ev.die.length < 6; i++) {
    let best = null, bd = 1e9;
    for (const mb of mobs.values()) { const d = Math.hypot(mb.x - x, mb.z - z); if (d < bd) { bd = d; best = mb; } }
    if (best && bd <= 3.2) ws.send(JSON.stringify({ t: 'attack', id: best.id }));
    else if (best) { const dx = best.x - x, dz = best.z - z, d = Math.hypot(dx, dz) || 1; x += dx / d * Math.min(0.8, d); z += dz / d * Math.min(0.8, d); ws.send(JSON.stringify({ t: 'move', x, y: groundY(x, z), z, yaw: 0, pitch: 0 })); }
    await sleep(250);
  }
  const last = ev.quest[ev.quest.length - 1];
  assert.ok(last && last.progress >= 5, '任务计数达标，progress=' + (last && last.progress));

  // 3) 回 NPC 交付，收奖励经验
  const xpBefore = ev.xp.length;
  await moveTo(QuestsDef.NPC_X, QuestsDef.NPC_Z, 2);
  await sleep(200);
  ws.send(JSON.stringify({ t: 'questTurnIn' }));
  await sleep(400);
  assert.ok(ev.xp.length > xpBefore, '交付后收到 xpGain（奖励）');
  const cleared = ev.quest[ev.quest.length - 1];
  assert.strictEqual(cleared, null, '交付后任务清空');

  console.log('quest_probe OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
