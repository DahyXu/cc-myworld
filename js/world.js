// js/world.js — 区块存储 + 无限地形生成
(function (root) {
  'use strict';
  const Noise = root.MyWorld.Noise;

  const CHUNK_X = 16, CHUNK_Y = 64, CHUNK_Z = 16;
  const SAND_LEVEL = 22;       // 地表低于等于此高度 → 沙地
  const TREE_THRESHOLD = 0.97; // 成树的哈希门槛（配合 5×5 局部最大值保证间距）

  function idx(x, y, z) { return x + z * CHUNK_X + y * CHUNK_X * CHUNK_Z; }
  function key(cx, cz) { return cx + ',' + cz; }

  // 与生成顺序无关的列哈希（决定树的位置与形态）
  function hash2(seed, x, z) {
    let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function create(seed) {
    const noise = Noise.create(seed);
    const chunks = new Map(); // 方块数据永不淘汰（有意设计：保留玩家修改，仅卸载远处网格）
    const pending = new Map(); // key -> [{lx,ly,lz,id,onlyAir}]

    function terrainHeight(x, z) {
      const big = noise.fbm2(x * 0.012, z * 0.012, 4, 2, 0.5);
      const detail = noise.fbm2(x * 0.06 + 100, z * 0.06 + 100, 2, 2, 0.5);
      let h = Math.floor(26 + big * 18 + detail * 4);
      if (h < 2) h = 2;
      if (h > CHUNK_Y - 10) h = CHUNK_Y - 10;
      return h;
    }

    function getChunk(cx, cz) { return chunks.get(key(cx, cz)) || null; }

    function getBlock(x, y, z) {
      if (y < 0 || y >= CHUNK_Y) return 0;
      const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
      const c = chunks.get(key(cx, cz));
      if (!c) return 0;
      return c.data[idx(x - cx * CHUNK_X, y, z - cz * CHUNK_Z)];
    }

    // 玩家编辑：保证区块存在、写入、标脏（含边界相邻区块）
    function setBlock(x, y, z, id) {
      if (y < 0 || y >= CHUNK_Y) return;
      const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
      const c = ensureChunk(cx, cz);
      const lx = x - cx * CHUNK_X, lz = z - cz * CHUNK_Z;
      c.data[idx(lx, y, lz)] = id;
      c.dirty = true;
      markNeighborDirty(cx, cz, lx, lz);
    }

    function markNeighborDirty(cx, cz, lx, lz) {
      const touch = (ncx, ncz) => { const n = getChunk(ncx, ncz); if (n) n.dirty = true; };
      if (lx === 0) touch(cx - 1, cz);
      if (lx === CHUNK_X - 1) touch(cx + 1, cz);
      if (lz === 0) touch(cx, cz - 1);
      if (lz === CHUNK_Z - 1) touch(cx, cz + 1);
    }

    // 地形生成期写入：本区块直写；他区块已存在→直写+标脏；不存在→pending
    function genWrite(curChunk, curCx, curCz, x, y, z, id, onlyAir) {
      if (y < 0 || y >= CHUNK_Y) return;
      const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
      const lx = x - cx * CHUNK_X, lz = z - cz * CHUNK_Z;
      if (cx === curCx && cz === curCz) {
        const i = idx(lx, y, lz);
        if (!onlyAir || curChunk.data[i] === 0) curChunk.data[i] = id;
        return;
      }
      const other = getChunk(cx, cz);
      if (other) {
        const i = idx(lx, y, lz);
        if (!onlyAir || other.data[i] === 0) { other.data[i] = id; other.dirty = true; }
      } else {
        const k = key(cx, cz);
        if (!pending.has(k)) pending.set(k, []);
        pending.get(k).push({ lx, ly: y, lz, id, onlyAir });
      }
    }

    // 该列是否成树：哈希超门槛且为 5×5 邻域严格最大值（保证树间距 ≥2）
    function hasTree(x, z) {
      const r = hash2(seed, x, z);
      if (r < TREE_THRESHOLD) return false;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        if (dx === 0 && dz === 0) continue;
        if (hash2(seed, x + dx, z + dz) >= r) return false;
      }
      return true;
    }

    function ensureChunk(cx, cz) {
      const k = key(cx, cz);
      let c = chunks.get(k);
      if (c) return c;
      c = { cx, cz, data: new Uint8Array(CHUNK_X * CHUNK_Y * CHUNK_Z), dirty: true };
      chunks.set(k, c);

      // 1) 地形柱
      for (let lz = 0; lz < CHUNK_Z; lz++) {
        for (let lx = 0; lx < CHUNK_X; lx++) {
          const wx = cx * CHUNK_X + lx, wz = cz * CHUNK_Z + lz;
          const h = terrainHeight(wx, wz);
          const sandy = h <= SAND_LEVEL;
          for (let y = 0; y <= h; y++) {
            let id;
            if (y === h) id = sandy ? 7 : 1;
            else if (y >= h - 3) id = sandy ? 7 : 2;
            else id = 3;
            c.data[idx(lx, y, lz)] = id;
          }
        }
      }

      // 2) 树（树干一定在本列所属区块内；树叶可跨界走 genWrite）
      for (let lz = 0; lz < CHUNK_Z; lz++) {
        for (let lx = 0; lx < CHUNK_X; lx++) {
          const wx = cx * CHUNK_X + lx, wz = cz * CHUNK_Z + lz;
          const h = terrainHeight(wx, wz);
          if (h <= SAND_LEVEL) continue;          // 沙地不长树
          if (!hasTree(wx, wz)) continue;
          const r2 = hash2(seed, wx + 7919, wz + 104729);
          const th = 4 + Math.floor(r2 * 3);       // 树干高 4~6
          const topY = h + th;
          if (topY + 2 >= CHUNK_Y) continue;       // 太高放不下就不长
          for (let y = h + 1; y <= topY; y++) genWrite(c, cx, cz, wx, y, wz, 4, false);
          // 树叶：下两层 5×5（最上一层去四角）、再上一层 3×3 + 中心、顶上十字
          for (let dy = -1; dy <= 0; dy++) {
            for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
              if (dx === 0 && dz === 0) continue; // 树干位置
              if (dy === 0 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue; // 去角
              genWrite(c, cx, cz, wx + dx, topY + dy, wz + dz, 6, true);
            }
          }
          for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
            if (!(dx === 0 && dz === 0)) genWrite(c, cx, cz, wx + dx, topY + 1, wz + dz, 6, true);
          }
          genWrite(c, cx, cz, wx, topY + 1, wz, 6, true);
          genWrite(c, cx, cz, wx + 1, topY + 2, wz, 6, true);
          genWrite(c, cx, cz, wx - 1, topY + 2, wz, 6, true);
          genWrite(c, cx, cz, wx, topY + 2, wz + 1, 6, true);
          genWrite(c, cx, cz, wx, topY + 2, wz - 1, 6, true);
          genWrite(c, cx, cz, wx, topY + 2, wz, 6, true);
        }
      }

      // 3) 套用其他区块生成时寄存到本区块的 pending 写入
      const pend = pending.get(k);
      if (pend) {
        for (const p of pend) {
          const i = idx(p.lx, p.ly, p.lz);
          if (!p.onlyAir || c.data[i] === 0) c.data[i] = p.id;
        }
        pending.delete(k);
      }

      // 4) 新区块出现，已存在的四邻需要重构网格（边界面剔除会变化）
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const n = getChunk(cx + dx, cz + dz);
        if (n) n.dirty = true;
      }
      return c;
    }

    // 远端编辑：区块已存在→直写+标脏（走 setBlock）；未生成→寄存 pending
    // （生成流程末尾会套用 pending，onlyAir:false 保证覆盖地形与树）
    function applyRemoteEdit(x, y, z, id) {
      if (y < 0 || y >= CHUNK_Y) return;
      const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
      if (chunks.has(key(cx, cz))) { setBlock(x, y, z, id); return; }
      const k = key(cx, cz);
      if (!pending.has(k)) pending.set(k, []);
      pending.get(k).push({ lx: x - cx * CHUNK_X, ly: y, lz: z - cz * CHUNK_Z, id, onlyAir: false });
    }

    return { seed, chunks, getChunk, ensureChunk, getBlock, setBlock, applyRemoteEdit, terrainHeight, key };
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.World = { create, CHUNK_X, CHUNK_Y, CHUNK_Z };
})(typeof self !== 'undefined' ? self : globalThis);
