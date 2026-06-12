// js/player.js — 玩家：输入→速度/跳跃，物理委托 shared/physics.js
(function (root) {
  'use strict';
  const Physics = root.MyWorld.Physics;

  const HALF = 0.3, HEIGHT = 1.8, EYE = 1.62;
  const SPEED = 4.5, JUMP_V = 9;

  function create(x, y, z) {
    const b = Physics.createBody(x, y, z, HALF, HEIGHT);
    b.yaw = 0; b.pitch = 0;
    return b;
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

    if (input.jump) Physics.tryJump(p, JUMP_V);
    Physics.step(p, world, dt);
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Player = { create, update, HALF, HEIGHT, EYE, SPEED };
})(typeof self !== 'undefined' ? self : globalThis);
