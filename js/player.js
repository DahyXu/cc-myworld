// js/player.js — 玩家物理：AABB 碰撞、重力、行走跳跃
(function (root) {
  'use strict';
  const Blocks = root.MyWorld.Blocks;

  const HALF = 0.3, HEIGHT = 1.8, EYE = 1.62;
  const SPEED = 4.5, GRAVITY = 30, JUMP_V = 9, MAX_FALL = 40;
  const EPS = 0.001;

  function create(x, y, z) {
    return { x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: false };
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

  function intersects(world, p) {
    return boxIntersectsSolid(world, p.x - HALF, p.y, p.z - HALF, p.x + HALF, p.y + HEIGHT, p.z + HALF);
  }

  function moveAxis(p, world, axis, delta) {
    if (delta === 0) return;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.5));
    const step = delta / steps;
    for (let i = 0; i < steps; i++) {
      p[axis] += step;
      if (!intersects(world, p)) continue;
      // 撞上：贴面 + 清零该轴速度
      if (axis === 'y') {
        if (step < 0) { p.y = Math.floor(p.y) + 1 + EPS; p.vy = 0; p.onGround = true; }
        else { p.y = Math.ceil(p.y + HEIGHT) - 1 - HEIGHT - EPS; p.vy = 0; }
      } else if (axis === 'x') {
        if (step < 0) p.x = Math.floor(p.x - HALF) + 1 + HALF + EPS;
        else p.x = Math.ceil(p.x + HALF) - 1 - HALF - EPS;
        p.vx = 0;
      } else {
        if (step < 0) p.z = Math.floor(p.z - HALF) + 1 + HALF + EPS;
        else p.z = Math.ceil(p.z + HALF) - 1 - HALF - EPS;
        p.vz = 0;
      }
      break;
    }
  }

  function update(p, world, dt, input) {
    // 水平意图速度（yaw=0 面向 -z）
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    let mx = 0, mz = 0;
    if (input.forward) { mx += fx; mz += fz; }
    if (input.back) { mx -= fx; mz -= fz; }
    if (input.right) { mx += rx; mz += rz; }
    if (input.left) { mx -= rx; mz -= rz; }
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx = mx / len * SPEED; mz = mz / len * SPEED; }
    p.vx = mx; p.vz = mz;

    if (input.jump && p.onGround) { p.vy = JUMP_V; p.onGround = false; }
    p.vy -= GRAVITY * dt;
    if (p.vy < -MAX_FALL) p.vy = -MAX_FALL;

    p.onGround = false;
    moveAxis(p, world, 'y', p.vy * dt);
    moveAxis(p, world, 'x', p.vx * dt);
    moveAxis(p, world, 'z', p.vz * dt);
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Player = { create, update, HALF, HEIGHT, EYE };
})(typeof self !== 'undefined' ? self : globalThis);
