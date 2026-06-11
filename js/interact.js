// js/interact.js — DDA 体素射线（Amanatides & Woo）
(function (root) {
  'use strict';
  const Blocks = root.MyWorld.Blocks;

  function cast(world, ox, oy, oz, dx, dy, dz, maxDist) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? x + 1 - ox : ox - x) / Math.abs(dx)) : Infinity;
    let tMaxY = dy !== 0 ? ((dy > 0 ? y + 1 - oy : oy - y) / Math.abs(dy)) : Infinity;
    let tMaxZ = dz !== 0 ? ((dz > 0 ? z + 1 - oz : oz - z) / Math.abs(dz)) : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;

    while (t <= maxDist) {
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
      }
      if (t > maxDist) break;
      if (Blocks.isSolid(world.getBlock(x, y, z))) {
        return { hit: true, x, y, z, nx, ny, nz };
      }
    }
    return { hit: false, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Raycast = { cast };
})(typeof self !== 'undefined' ? self : globalThis);
