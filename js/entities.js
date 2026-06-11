// js/entities.js — 远端实体渲染：其他玩家（体素小人 + 名牌），位置插值
(function (root) {
  'use strict';

  let scene = null;
  const players = new Map(); // pid -> { group, tx, ty, tz, tyaw }

  function init(s) { scene = s; }

  // 按 pid 取稳定衣服色，区分不同玩家
  function colorOf(pid) {
    const hues = [0x3b6fd4, 0xd43b3b, 0x3bd46f, 0xd4a23b, 0x8f3bd4, 0x3bc8d4];
    return hues[pid % hues.length];
  }

  function box(w, h, d, color) {
    return new root.THREE.Mesh(
      new root.THREE.BoxGeometry(w, h, d),
      new root.THREE.MeshBasicMaterial({ color }));
  }

  // 名牌：canvas 文字贴 Sprite，始终面向相机
  function nameTag(name) {
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
    sp.scale.set(1.6, 0.4, 1);
    sp.position.y = 2.15;
    return sp;
  }

  // 体素小人：原点在脚底，身高约 1.8
  function humanoid(name, color) {
    const g = new root.THREE.Group();
    const skin = 0xe8b88a, pants = 0x4a4a5a;
    const head = box(0.5, 0.5, 0.5, skin); head.position.y = 1.55;
    const body = box(0.5, 0.75, 0.25, color); body.position.y = 1.0;
    const legL = box(0.22, 0.62, 0.25, pants); legL.position.set(-0.13, 0.31, 0);
    const legR = box(0.22, 0.62, 0.25, pants); legR.position.set(0.13, 0.31, 0);
    const armL = box(0.2, 0.7, 0.2, color); armL.position.set(-0.36, 1.02, 0);
    const armR = box(0.2, 0.7, 0.2, color); armR.position.set(0.36, 1.02, 0);
    g.add(head, body, legL, legR, armL, armR, nameTag(name));
    return g;
  }

  // penter / welcome.players：建模或刷新目标位
  function upsertPlayer(m) {
    let p = players.get(m.pid);
    if (!p) {
      p = { group: humanoid(m.name, colorOf(m.pid)), tx: m.x, ty: m.y, tz: m.z, tyaw: m.yaw || 0 };
      p.group.position.set(m.x, m.y, m.z);
      p.group.rotation.y = p.tyaw;
      scene.add(p.group);
      players.set(m.pid, p);
      return;
    }
    p.tx = m.x; p.ty = m.y; p.tz = m.z;
    if (isFinite(m.yaw)) p.tyaw = m.yaw;
  }

  // pmove：只更新目标位（不存在则忽略，等 penter）
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
    p.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    players.delete(pid);
  }

  function clear() {
    for (const pid of Array.from(players.keys())) removePlayer(pid);
  }

  // 每帧：指数趋近插值，平滑 10Hz 网络位置
  function update(dt) {
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
  }

  function count() { return players.size; }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Entities = { init, upsertPlayer, movePlayer, removePlayer, clear, update, count };
})(typeof self !== 'undefined' ? self : globalThis);
