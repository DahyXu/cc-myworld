// js/blocks.js — 方块注册表 + 程序化像素贴图图集
(function (root) {
  'use strict';

  const AIR = 0;
  // 瓦片索引: 0草顶 1草侧 2泥土 3石头 4原木侧 5原木顶 6木板 7树叶 8沙子 9砖块
  const BLOCKS = {
    1: { name: '草方块', solid: true, tex: { top: 0, side: 1, bottom: 2 } },
    2: { name: '泥土',   solid: true, tex: { top: 2, side: 2, bottom: 2 } },
    3: { name: '石头',   solid: true, tex: { top: 3, side: 3, bottom: 3 } },
    4: { name: '原木',   solid: true, tex: { top: 5, side: 4, bottom: 5 } },
    5: { name: '木板',   solid: true, tex: { top: 6, side: 6, bottom: 6 } },
    6: { name: '树叶',   solid: true, tex: { top: 7, side: 7, bottom: 7 } },
    7: { name: '沙子',   solid: true, tex: { top: 8, side: 8, bottom: 8 } },
    8: { name: '砖块',   solid: true, tex: { top: 9, side: 9, bottom: 9 } },
  };
  const HOTBAR = [1, 2, 3, 4, 5, 6, 7, 8];

  function isSolid(id) { return !!(BLOCKS[id] && BLOCKS[id].solid); }

  const ATLAS_TILES = 4;   // 4×4 瓦片
  const TILE_PX = 16;

  // 简单确定性伪随机（贴图噪点用，与世界种子无关）
  function texRand(seed) {
    let s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // 在 ctx 的 (ox,oy) 处画一个 16×16 瓦片：底色 + 噪点斑驳
  function speckle(ctx, ox, oy, base, spots, rnd, density) {
    ctx.fillStyle = base;
    ctx.fillRect(ox, oy, TILE_PX, TILE_PX);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        if (rnd() < density) {
          ctx.fillStyle = spots[Math.floor(rnd() * spots.length)];
          ctx.fillRect(ox + x, oy + y, 1, 1);
        }
      }
    }
  }

  // 仅浏览器调用：绘制图集 canvas
  function buildAtlas() {
    const size = ATLAS_TILES * TILE_PX;
    const canvas = root.document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const rnd = texRand(424242);
    const T = TILE_PX;
    const at = (i) => [(i % ATLAS_TILES) * T, Math.floor(i / ATLAS_TILES) * T];

    let [ox, oy] = at(0); // 0 草顶
    speckle(ctx, ox, oy, '#5fa841', ['#4e9434', '#6db64c', '#549c3a'], rnd, 0.45);
    [ox, oy] = at(1); // 1 草侧：泥土 + 顶部草边
    speckle(ctx, ox, oy, '#8a6244', ['#7a543a', '#9a7050', '#6e4a32'], rnd, 0.4);
    ctx.fillStyle = '#5fa841'; ctx.fillRect(ox, oy, T, 3);
    for (let x = 0; x < T; x++) if (rnd() < 0.6) { ctx.fillRect(ox + x, oy + 3, 1, 1); }
    [ox, oy] = at(2); // 2 泥土
    speckle(ctx, ox, oy, '#8a6244', ['#7a543a', '#9a7050', '#6e4a32'], rnd, 0.4);
    [ox, oy] = at(3); // 3 石头
    speckle(ctx, ox, oy, '#8e8e8e', ['#7c7c7c', '#9c9c9c', '#868686'], rnd, 0.4);
    [ox, oy] = at(4); // 4 原木侧：竖条树皮
    for (let x = 0; x < T; x++) {
      const shade = ['#6b4a2a', '#5d3f23', '#7a5631'][x % 3];
      ctx.fillStyle = shade; ctx.fillRect(ox + x, oy, 1, T);
      for (let y = 0; y < T; y++) if (rnd() < 0.12) { ctx.fillStyle = '#523619'; ctx.fillRect(ox + x, oy + y, 1, 1); }
    }
    [ox, oy] = at(5); // 5 原木顶：年轮
    ctx.fillStyle = '#6b4a2a'; ctx.fillRect(ox, oy, T, T);
    ctx.fillStyle = '#c8a06a'; ctx.fillRect(ox + 2, oy + 2, T - 4, T - 4);
    ctx.fillStyle = '#a8825a'; ctx.fillRect(ox + 4, oy + 4, T - 8, T - 8);
    ctx.fillStyle = '#c8a06a'; ctx.fillRect(ox + 6, oy + 6, T - 12, T - 12);
    [ox, oy] = at(6); // 6 木板：横板 + 接缝
    ctx.fillStyle = '#b08850'; ctx.fillRect(ox, oy, T, T);
    ctx.fillStyle = '#8f6b3c';
    for (let y = 3; y < T; y += 4) ctx.fillRect(ox, oy + y, T, 1);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (rnd() < 0.08) { ctx.fillStyle = '#9c7844'; ctx.fillRect(ox + x, oy + y, 1, 1); }
    [ox, oy] = at(7); // 7 树叶
    speckle(ctx, ox, oy, '#3a7a2a', ['#2e6620', '#468c34', '#255a1a'], rnd, 0.55);
    [ox, oy] = at(8); // 8 沙子
    speckle(ctx, ox, oy, '#dccfa0', ['#cfc290', '#e8dcb0', '#c4b684'], rnd, 0.4);
    [ox, oy] = at(9); // 9 砖块：红砖 + 灰浆错缝
    ctx.fillStyle = '#9c5a4a'; ctx.fillRect(ox, oy, T, T);
    ctx.fillStyle = '#c9c2b8';
    for (let y = 0; y < T; y += 4) ctx.fillRect(ox, oy + y, T, 1);
    for (let row = 0; row < 4; row++) {
      const off = (row % 2) * 4;
      for (let x = off; x < T; x += 8) ctx.fillRect(ox + x, oy + row * 4, 1, 4);
    }
    return canvas;
  }

  // 瓦片 i 的 UV 范围（THREE 的 v 轴向上，canvas 的 y 轴向下，需翻转）
  function tileUV(i) {
    const col = i % ATLAS_TILES, row = Math.floor(i / ATLAS_TILES);
    const s = 1 / ATLAS_TILES;
    return { u0: col * s, v0: 1 - (row + 1) * s, u1: (col + 1) * s, v1: 1 - row * s };
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Blocks = { AIR, BLOCKS, HOTBAR, isSolid, buildAtlas, tileUV, ATLAS_TILES, TILE_PX };
})(typeof self !== 'undefined' ? self : globalThis);
