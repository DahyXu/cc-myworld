// shared/physics.js — 两端共享：参数化盒子物理（玩家/怪物通用）
// 身体 = { x,y,z, vx,vy,vz, onGround, half, height }，原点在脚底中心
(function (root) {
  'use strict';
  const Blocks = root.MyWorld.Blocks;

  const GRAVITY = 30, MAX_FALL = 40;
  const EPS = 0.001;

  function createBody(x, y, z, half, height) {
    return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, half, height };
  }

  function boxIntersectsSolid(world, minx, miny, minz, maxx, maxy, maxz) {
    const x0 = Math.floor(minx), x1 = Math.floor(maxx - 1e-9);
    const y0 = Math.floor(miny), y1 = Math.floor(maxy - 1e-9);
    const z0 = Math.floor(minz), z1 = Math.floor(maxz - 1e-9);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
          if (Blocks.isSolid(world.getBlock(x, y, z))) return true;
    return false;
  }

  function intersects(world, b) {
    return boxIntersectsSolid(world, b.x - b.half, b.y, b.z - b.half, b.x + b.half, b.y + b.height, b.z + b.half);
  }

  function moveAxis(b, world, axis, delta) {
    if (delta === 0) return;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.5));
    const step = delta / steps;
    for (let i = 0; i < steps; i++) {
      b[axis] += step;
      if (!intersects(world, b)) continue;
      // 撞上：贴面 + 清零该轴速度
      if (axis === 'y') {
        if (step < 0) { b.y = Math.floor(b.y) + 1 + EPS; b.vy = 0; b.onGround = true; }
        else { b.y = Math.ceil(b.y + b.height) - 1 - b.height - EPS; b.vy = 0; }
      } else if (axis === 'x') {
        if (step < 0) b.x = Math.floor(b.x - b.half) + 1 + b.half + EPS;
        else b.x = Math.ceil(b.x + b.half) - 1 - b.half - EPS;
        b.vx = 0;
      } else {
        if (step < 0) b.z = Math.floor(b.z - b.half) + 1 + b.half + EPS;
        else b.z = Math.ceil(b.z + b.half) - 1 - b.half - EPS;
        b.vz = 0;
      }
      break;
    }
  }

  // 一步物理：重力 + 三轴扫掠位移（水平速度由调用方在 step 前设置）
  function step(b, world, dt) {
    b.vy -= GRAVITY * dt;
    if (b.vy < -MAX_FALL) b.vy = -MAX_FALL;
    b.onGround = false;
    moveAxis(b, world, 'y', b.vy * dt);
    moveAxis(b, world, 'x', b.vx * dt);
    moveAxis(b, world, 'z', b.vz * dt);
  }

  // 仅在地面时起跳；返回是否跳了
  function tryJump(b, v) {
    if (!b.onGround) return false;
    b.vy = v;
    b.onGround = false;
    return true;
  }

  // 前方脚边是否有实心方块挡路（怪物自动跳台阶用）：取移动方向上身体边缘外 1 格、脚踝高度处的方块
  function blockedAhead(b, world, dirx, dirz) {
    const len = Math.hypot(dirx, dirz);
    if (len === 0) return false;
    const px = b.x + (dirx / len) * (b.half + 1);
    const pz = b.z + (dirz / len) * (b.half + 1);
    return Blocks.isSolid(world.getBlock(Math.floor(px), Math.floor(b.y + 0.1), Math.floor(pz)));
  }

  // 线段与实体盒相交（slab 法）；box = { x,y,z(脚底中心), half, height }
  function segmentHitsBox(x0, y0, z0, x1, y1, z1, box) {
    const minx = box.x - box.half, maxx = box.x + box.half;
    const miny = box.y, maxy = box.y + box.height;
    const minz = box.z - box.half, maxz = box.z + box.half;
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    let t0 = 0, t1 = 1;
    const axes = [[x0, dx, minx, maxx], [y0, dy, miny, maxy], [z0, dz, minz, maxz]];
    for (const [o, d, lo, hi] of axes) {
      if (d === 0) { if (o < lo || o > hi) return false; continue; }
      let a = (lo - o) / d, b2 = (hi - o) / d;
      if (a > b2) { const t = a; a = b2; b2 = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b2);
      if (t0 > t1) return false;
    }
    return true;
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Physics = { GRAVITY, MAX_FALL, createBody, step, tryJump, blockedAhead, segmentHitsBox, intersects };
})(typeof self !== 'undefined' ? self : globalThis);
