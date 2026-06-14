// js/entities.js — 远端实体渲染：玩家/怪物/箭，体素模型 + 名牌 + 插值
(function (root) {
  'use strict';
  const P = root.MyWorld.Protocol;
  const MobsDef = root.MyWorld.MobsDef;

  let scene = null;
  const players = new Map(); // pid -> { group, tx, ty, tz, tyaw }
  const mobs = new Map();    // id -> { group, tx, ty, tz, tyaw, hp, maxHp, half, height, hurtUntil, dieT, hpBar }
  const arrows = new Map();  // id -> { group, x, y, z, vx, vy, vz, local }
  const bosses = new Map();    // id -> { group, tx, ty, tz, tyaw, hp, maxHp, half, height, hurtUntil, flashUntil, dieT, bar, name }
  const bossTimers = new Map(); // id -> { group, intervalId }

  function init(s) { scene = s; npc = null; }

  function colorOf(pid) {
    const hues = [0x3b6fd4, 0xd43b3b, 0x3bd46f, 0xd4a23b, 0x8f3bd4, 0x3bc8d4];
    return hues[pid % hues.length];
  }

  function box(w, h, d, color) {
    return new root.THREE.Mesh(
      new root.THREE.BoxGeometry(w, h, d),
      new root.THREE.MeshBasicMaterial({ color }));
  }

  // 名牌：canvas 文字贴 Sprite
  function nameTag(name, scale) {
    const cv = root.document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 128, 32);
    const tex = new root.THREE.CanvasTexture(cv);
    const sp = new root.THREE.Sprite(new root.THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sp.scale.set(1.6 * (scale || 1), 0.4 * (scale || 1), 1);
    return sp;
  }

  // 受击血条：双层 Sprite（背景+前景），前景按比例缩放
  function hpBar() {
    const bg = new root.THREE.Sprite(new root.THREE.SpriteMaterial({ color: 0x222222, depthTest: false }));
    bg.scale.set(1.0, 0.09, 1);
    const fg = new root.THREE.Sprite(new root.THREE.SpriteMaterial({ color: 0xd43b3b, depthTest: false }));
    fg.scale.set(0.96, 0.06, 1);
    const g = new root.THREE.Group();
    g.add(bg, fg);
    g.visible = false;
    return { group: g, fg };
  }

  // 体素小人（玩家与人形怪通用）：原点脚底
  function humanoid(color, skin) {
    const g = new root.THREE.Group();
    const pants = 0x4a4a5a;
    const head = box(0.5, 0.5, 0.5, skin); head.position.y = 1.55;
    const body = box(0.5, 0.75, 0.25, color); body.position.y = 1.0;
    const legL = box(0.22, 0.62, 0.25, pants); legL.position.set(-0.13, 0.31, 0);
    const legR = box(0.22, 0.62, 0.25, pants); legR.position.set(0.13, 0.31, 0);
    const armL = box(0.2, 0.7, 0.2, color); armL.position.set(-0.36, 1.02, 0);
    const armR = box(0.2, 0.7, 0.2, color); armR.position.set(0.36, 1.02, 0);
    g.add(head, body, legL, legR, armL, armR);
    return g;
  }

  // 四种怪物模型
  function mobModel(type) {
    const g = new root.THREE.Group();
    if (type === 'slime') {
      const gel = box(0.7, 0.6, 0.7, 0x4fae4f); gel.position.y = 0.3;
      const eyeL = box(0.1, 0.1, 0.05, 0x222222); eyeL.position.set(-0.15, 0.42, 0.36);
      const eyeR = box(0.1, 0.1, 0.05, 0x222222); eyeR.position.set(0.15, 0.42, 0.36);
      g.add(gel, eyeL, eyeR);
    } else if (type === 'zombie') {
      g.add(humanoid(0x3b6e3b, 0x6fae6f));
    } else if (type === 'skeleton') {
      g.add(humanoid(0xbdbdbd, 0xe8e8e8));
      const bow = box(0.05, 0.6, 0.05, 0x8a5a2b); bow.position.set(0.45, 1.0, 0.15); bow.rotation.x = 0.3;
      g.add(bow);
    } else { // wolf
      const body = box(0.9, 0.45, 0.4, 0x777777); body.position.y = 0.55;
      const head = box(0.35, 0.35, 0.35, 0x8a8a8a); head.position.set(0.55, 0.75, 0);
      const tail = box(0.35, 0.1, 0.1, 0x666666); tail.position.set(-0.6, 0.7, 0);
      g.add(body, head, tail);
      for (const [lx, lz] of [[0.3, 0.12], [0.3, -0.12], [-0.3, 0.12], [-0.3, -0.12]]) {
        const leg = box(0.12, 0.35, 0.12, 0x666666); leg.position.set(lx, 0.18, lz);
        g.add(leg);
      }
    }
    return g;
  }

  function disposeGroup(group) {
    group.traverse((o) => {
      // 只销毁 Mesh 的独享几何体；Sprite.geometry 是 three 全局共享单例，销毁会引发 GPU 缓冲区反复重建
      if (o.isMesh && o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }

  // —— 玩家 ——
  function upsertPlayer(m) {
    let p = players.get(m.pid);
    if (!p) {
      const g = humanoid(colorOf(m.pid), 0xe8b88a);
      const tag = nameTag(m.name, 1);
      tag.position.y = 2.15;
      g.add(tag);
      p = { group: g, tx: m.x, ty: m.y, tz: m.z, tyaw: m.yaw || 0 };
      p.group.position.set(m.x, m.y, m.z);
      p.group.rotation.y = p.tyaw;
      scene.add(p.group);
      players.set(m.pid, p);
      return;
    }
    p.tx = m.x; p.ty = m.y; p.tz = m.z;
    if (isFinite(m.yaw)) p.tyaw = m.yaw;
  }

  function movePlayer(m) {
    const p = players.get(m.pid);
    if (!p) return;
    p.tx = m.x; p.ty = m.y; p.tz = m.z;
    if (isFinite(m.yaw)) p.tyaw = m.yaw;
  }

  function removePlayer(pid) {
    const p = players.get(pid);
    if (!p) return;
    scene.remove(p.group);
    disposeGroup(p.group);
    players.delete(pid);
  }

  // —— 怪物 ——
  function upsertMob(m) {
    let e = mobs.get(m.id);
    const t = MobsDef.TYPES[m.type];
    if (!e) {
      const g = mobModel(m.type);
      const tag = nameTag('Lv.' + m.lv + ' ' + t.name, 0.9);
      tag.position.y = t.height + 0.45;
      g.add(tag);
      const bar = hpBar();
      bar.group.position.y = t.height + 0.2;
      g.add(bar.group);
      e = { group: g, tx: m.x, ty: m.y, tz: m.z, tyaw: 0, hp: m.hp, maxHp: m.maxHp,
        half: t.half, height: t.height, hurtUntil: 0, dieT: 0, bar };
      g.position.set(m.x, m.y, m.z);
      scene.add(g);
      mobs.set(m.id, e);
    } else {
      e.tx = m.x; e.ty = m.y; e.tz = m.z;
      e.hp = m.hp; e.maxHp = m.maxHp;
      e.dieT = 0;
      e.group.rotation.z = 0;
      // 重生复用同 id：血条状态一并复位（否则残留死亡前的半血条最多 2 秒）
      e.bar.group.visible = false;
      e.bar.fg.scale.x = 0.96;
    }
  }

  function moveMob(m) {
    const e = mobs.get(m.id);
    if (!e) return;
    e.tx = m.x; e.ty = m.y; e.tz = m.z;
    if (isFinite(m.yaw)) e.tyaw = m.yaw;
  }

  function hurtMob(m) {
    const e = mobs.get(m.id);
    if (!e) return;
    e.hp = m.hp;
    e.hurtUntil = performance.now() + 2000;
    e.flashUntil = performance.now() + 150;
    e.bar.group.visible = true;
    e.bar.fg.scale.x = 0.96 * Math.max(0, e.hp / e.maxHp);
  }

  function dieMob(id) {
    const e = mobs.get(id);
    if (!e) return;
    e.dieT = 2; // 倒地 2 秒后移除
    e.bar.group.visible = false;
  }

  function despawnMob(id) {
    const e = mobs.get(id);
    if (!e) return;
    scene.remove(e.group);
    disposeGroup(e.group);
    mobs.delete(id);
  }

  // combat.pickMob 用：当前可见存活怪的 AABB 列表
  function mobList() {
    const out = [];
    for (const [id, e] of mobs) {
      if (e.dieT > 0) continue;
      out.push({ id, x: e.group.position.x, y: e.group.position.y, z: e.group.position.z, half: e.half, height: e.height });
    }
    return out;
  }

  // —— NPC 长老（固定单体，非同步实体）——
  let npc = null; // { group, marker }
  // 标记纹理：状态 'accept'(黄!)/'turnin'(绿?)/'none'
  function markerSprite(symbol, color) {
    const cv = root.document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = color;
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(symbol, 32, 36);
    const tex = new root.THREE.CanvasTexture(cv);
    const sp = new root.THREE.Sprite(new root.THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sp.scale.set(0.6, 0.6, 1);
    return sp;
  }

  function setNpc(x, y, z) {
    if (npc) return;
    const g = humanoid(0xc8a23b, 0xe8b88a); // 金袍长老
    const tag = nameTag('长老', 1);
    tag.position.y = 2.15;
    g.add(tag);
    const marker = new root.THREE.Group();
    marker.position.y = 2.55;
    g.add(marker);
    g.position.set(x, y, z);
    scene.add(g);
    npc = { group: g, marker };
  }

  function setNpcMarker(state) {
    if (!npc) return;
    const m = npc.marker;
    while (m.children.length) m.remove(m.children[0]);
    if (state === 'accept') m.add(markerSprite('！', '#ffd24a'));
    else if (state === 'turnin') m.add(markerSprite('？', '#7ec850'));
  }

  // —— 箭 ——
  let localArrowN = 0;
  function arrowModel() {
    const g = new root.THREE.Group();
    const shaft = box(0.04, 0.04, 0.5, 0xc8a06a);
    const tip = box(0.07, 0.07, 0.08, 0xcfd8e3); tip.position.z = -0.28;
    g.add(shaft, tip);
    return g;
  }

  function addArrow(id, x, y, z, vx, vy, vz, local) {
    const g = arrowModel();
    g.position.set(x, y, z);
    scene.add(g);
    arrows.set(id, { group: g, x, y, z, vx, vy, vz, local: !!local, born: performance.now() });
  }

  function spawnLocalArrow(x, y, z, dx, dy, dz) {
    const id = 'L' + (++localArrowN);
    addArrow(id, x, y, z, dx * P.ARROW_SPEED, dy * P.ARROW_SPEED, dz * P.ARROW_SPEED, true);
  }

  function remoteArrow(m) { addArrow(m.id, m.x, m.y, m.z, m.vx, m.vy, m.vz, false); }

  function dieArrow(m) {
    const a = arrows.get(m.id);
    if (!a) return;
    scene.remove(a.group);
    disposeGroup(a.group);
    arrows.delete(m.id);
  }

  // —— Boss ——
  function upsertBoss(m) {
    clearBossTimer(m.id);
    let e = bosses.get(m.id);
    const t = MobsDef.TYPES[m.type];
    if (!e) {
      const g = mobModel(m.type);
      g.scale.set(2, 2, 2);
      g.traverse((o) => {
        if (o.isMesh && o.material && o.material.color) {
          o.material = o.material.clone();
          o.material.color.multiplyScalar(0.6);
        }
      });
      const tag = nameTag('【Boss】' + m.name, 1.2);
      tag.position.y = t.height * 2 + 0.6;
      g.add(tag);
      const bar = hpBar();
      bar.group.position.y = t.height * 2 + 0.35;
      g.add(bar.group);
      e = { group: g, tx: m.x, ty: m.y, tz: m.z, tyaw: 0,
        hp: m.hp, maxHp: m.maxHp, half: t.half * 2, height: t.height * 2,
        hurtUntil: 0, flashUntil: 0, dieT: 0, bar, name: m.name };
      g.position.set(m.x, m.y, m.z);
      scene.add(g);
      bosses.set(m.id, e);
    } else {
      e.tx = m.x; e.ty = m.y; e.tz = m.z;
      e.hp = m.hp; e.maxHp = m.maxHp; e.dieT = 0;
      e.group.rotation.z = 0;
      e.bar.group.visible = false;
      e.bar.fg.scale.x = 0.96;
    }
  }

  function moveBoss(m) {
    const e = bosses.get(m.id);
    if (!e) return;
    e.tx = m.x; e.ty = m.y; e.tz = m.z;
    if (isFinite(m.yaw)) e.tyaw = m.yaw;
  }

  function hurtBossEntity(m) {
    const e = bosses.get(m.id);
    if (!e) return;
    e.hp = m.hp;
    e.hurtUntil = performance.now() + 2000;
    e.flashUntil = performance.now() + 150;
    e.bar.group.visible = true;
    e.bar.fg.scale.x = 0.96 * Math.max(0, e.hp / e.maxHp);
  }

  function dieBossEntity(id, respawnIn) {
    const e = bosses.get(id);
    if (!e) return;
    const bossName = e.name;
    const bx = e.group.position.x, bz = e.group.position.z, by = e.group.position.y;
    scene.remove(e.group);
    disposeGroup(e.group);
    bosses.delete(id);
    showBossCountdown(id, bossName, bx, bz, respawnIn, by);
  }

  function showBossCountdown(id, name, bx, bz, respawnIn, by) {
    clearBossTimer(id);
    let remaining = respawnIn;
    function makeLabel(sec) {
      const cv = root.document.createElement('canvas');
      cv.width = 256; cv.height = 64;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = '#ff9944';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const m2 = Math.floor(sec / 60), s2 = sec % 60;
      ctx.fillText((name || id) + ' ' + String(m2).padStart(2, '0') + ':' + String(s2).padStart(2, '0') + '后复活', 128, 32);
      const tex = new root.THREE.CanvasTexture(cv);
      const sp = new root.THREE.Sprite(new root.THREE.SpriteMaterial({ map: tex, depthTest: false }));
      sp.scale.set(4, 1, 1);
      return { sp, tex };
    }
    const g = new root.THREE.Group();
    g.position.set(bx, (by || 2) + 2, bz);
    let { sp, tex } = makeLabel(remaining);
    g.add(sp);
    scene.add(g);
    const intervalId = setInterval(() => {
      remaining--;
      if (remaining <= 0) { clearBossTimer(id); return; }
      const next = makeLabel(remaining);
      g.remove(sp);
      tex.dispose(); sp.material.dispose();
      sp = next.sp; tex = next.tex;
      g.add(sp);
    }, 1000);
    bossTimers.set(id, { group: g, intervalId });
  }

  function clearBossTimer(id) {
    const t = bossTimers.get(id);
    if (!t) return;
    clearInterval(t.intervalId);
    scene.remove(t.group);
    disposeGroup(t.group);
    bossTimers.delete(id);
  }

  function removeBossTimer(id) { clearBossTimer(id); }

  function clear() {
    for (const pid of Array.from(players.keys())) removePlayer(pid);
    for (const id of Array.from(mobs.keys())) despawnMob(id);
    for (const id of Array.from(arrows.keys())) dieArrow({ id });
    for (const id of Array.from(bosses.keys())) { const e2 = bosses.get(id); scene.remove(e2.group); disposeGroup(e2.group); bosses.delete(id); }
    for (const id of Array.from(bossTimers.keys())) clearBossTimer(id);
  }

  // 每帧：插值 + 箭弹道积分 + 受击闪红/死亡倒地
  function update(dt, world) {
    const a = Math.min(1, dt * 12);
    for (const p of players.values()) {
      p.group.position.x += (p.tx - p.group.position.x) * a;
      p.group.position.y += (p.ty - p.group.position.y) * a;
      p.group.position.z += (p.tz - p.group.position.z) * a;
      let dy = p.tyaw - p.group.rotation.y;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      p.group.rotation.y += dy * a;
    }
    const now = performance.now();
    for (const [id, e] of Array.from(mobs)) {
      if (e.dieT > 0) {
        e.dieT -= dt;
        e.group.rotation.z = Math.min(Math.PI / 2, e.group.rotation.z + dt * 6); // 倒地
        if (e.dieT <= 0) despawnMob(id);
        continue;
      }
      e.group.position.x += (e.tx - e.group.position.x) * a;
      e.group.position.y += (e.ty - e.group.position.y) * a;
      e.group.position.z += (e.tz - e.group.position.z) * a;
      let dy = e.tyaw - e.group.rotation.y;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      e.group.rotation.y += dy * a;
      // 受击闪红：遍历材质临时调色
      const flashing = e.flashUntil && now < e.flashUntil;
      e.group.traverse((o) => {
        if (o.isMesh && o.material && o.material.color) {
          if (flashing && !o.userData.baseColor) { o.userData.baseColor = o.material.color.getHex(); o.material.color.setHex(0xff5555); }
          else if (!flashing && o.userData.baseColor) { o.material.color.setHex(o.userData.baseColor); o.userData.baseColor = null; }
        }
      });
      if (e.hurtUntil && now > e.hurtUntil) e.bar.group.visible = false;
    }
    for (const [, e] of bosses) {
      e.group.position.x += (e.tx - e.group.position.x) * a;
      e.group.position.y += (e.ty - e.group.position.y) * a;
      e.group.position.z += (e.tz - e.group.position.z) * a;
      let dy2 = (e.tyaw || 0) - e.group.rotation.y;
      while (dy2 > Math.PI) dy2 -= 2 * Math.PI;
      while (dy2 < -Math.PI) dy2 += 2 * Math.PI;
      e.group.rotation.y += dy2 * a;
      const flashing2 = e.flashUntil && now < e.flashUntil;
      e.group.traverse((o) => {
        if (o.isMesh && o.material && o.material.color) {
          if (flashing2 && !o.userData.baseColor) { o.userData.baseColor = o.material.color.getHex(); o.material.color.setHex(0xff5555); }
          else if (!flashing2 && o.userData.baseColor) { o.material.color.setHex(o.userData.baseColor); o.userData.baseColor = null; }
        }
      });
      if (e.hurtUntil && now > e.hurtUntil) e.bar.group.visible = false;
    }
    for (const [id, a2] of Array.from(arrows)) {
      a2.vy -= P.ARROW_GRAVITY * dt;
      a2.x += a2.vx * dt; a2.y += a2.vy * dt; a2.z += a2.vz * dt;
      a2.group.position.set(a2.x, a2.y, a2.z);
      a2.group.lookAt(a2.x + a2.vx, a2.y + a2.vy, a2.z + a2.vz);
      // 本地预表现箭：撞方块或超时即自毁（权威终点由 arrowDie 决定，远端箭也兜底超时）
      const hitBlock = world && root.MyWorld.Blocks.isSolid(world.getBlock(Math.floor(a2.x), Math.floor(a2.y), Math.floor(a2.z)));
      if (hitBlock || now - a2.born > P.ARROW_LIFE_MS || a2.y < -30) dieArrow({ id });
    }
  }

  function count() { return players.size; }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Entities = {
    init, upsertPlayer, movePlayer, removePlayer, clear, update, count,
    upsertMob, moveMob, hurtMob, dieMob, despawnMob, mobList,
    spawnLocalArrow, remoteArrow, dieArrow, setNpc, setNpcMarker,
    upsertBoss, moveBoss, hurtBossEntity, dieBossEntity, showBossCountdown, removeBossTimer,
    bossPos: (id) => { const e = bosses.get(id); return e ? { x: e.group.position.x, y: e.group.position.y, z: e.group.position.z } : null; },
  };
})(typeof self !== 'undefined' ? self : globalThis);
