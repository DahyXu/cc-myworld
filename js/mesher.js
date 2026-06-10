// js/mesher.js — 区块网格数据构建：面剔除 + 方向明暗 + 顶点 AO
(function (root) {
  'use strict';
  const Blocks = root.MyWorld.Blocks;
  const W = root.MyWorld.World;
  const CX = W.CHUNK_X, CY = W.CHUNK_Y, CZ = W.CHUNK_Z;

  // 面定义（corner 顺序与索引 [0,1,2, 2,1,3] 配合，保证从外侧看逆时针）
  const FACES = [
    { dir: [-1, 0, 0], bright: 0.7, tex: 'side', corners: [
      { pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] },
      { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] } ] },
    { dir: [1, 0, 0], bright: 0.7, tex: 'side', corners: [
      { pos: [1, 1, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [0, 0] },
      { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] } ] },
    { dir: [0, -1, 0], bright: 0.5, tex: 'bottom', corners: [
      { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 0, 1], uv: [0, 0] },
      { pos: [1, 0, 0], uv: [1, 1] }, { pos: [0, 0, 0], uv: [0, 1] } ] },
    { dir: [0, 1, 0], bright: 1.0, tex: 'top', corners: [
      { pos: [0, 1, 1], uv: [1, 1] }, { pos: [1, 1, 1], uv: [0, 1] },
      { pos: [0, 1, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 0] } ] },
    { dir: [0, 0, -1], bright: 0.82, tex: 'side', corners: [
      { pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] },
      { pos: [1, 1, 0], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 1] } ] },
    { dir: [0, 0, 1], bright: 0.82, tex: 'side', corners: [
      { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] },
      { pos: [0, 1, 1], uv: [0, 1] }, { pos: [1, 1, 1], uv: [1, 1] } ] },
  ];
  const AO_FACTOR = [1.0, 0.82, 0.66, 0.52];

  // 顶点 AO：corner 在面平面内两个切向的邻居 + 对角
  function vertexAO(solidAt, bx, by, bz, dir, cpos) {
    const axis = dir[0] !== 0 ? 0 : (dir[1] !== 0 ? 1 : 2);
    const t1 = (axis + 1) % 3, t2 = (axis + 2) % 3;
    const base = [bx + dir[0], by + dir[1], bz + dir[2]]; // 面外一层
    const s1 = cpos[t1] === 1 ? 1 : -1;
    const s2 = cpos[t2] === 1 ? 1 : -1;
    const o1 = [0, 0, 0], o2 = [0, 0, 0];
    o1[t1] = s1; o2[t2] = s2;
    const side1 = solidAt(base[0] + o1[0], base[1] + o1[1], base[2] + o1[2]) ? 1 : 0;
    const side2 = solidAt(base[0] + o2[0], base[1] + o2[1], base[2] + o2[2]) ? 1 : 0;
    const corner = solidAt(base[0] + o1[0] + o2[0], base[1] + o1[1] + o2[1], base[2] + o1[2] + o2[2]) ? 1 : 0;
    const occ = (side1 && side2) ? 3 : side1 + side2 + corner;
    return AO_FACTOR[occ];
  }

  // worldLike 只需提供 getBlock(x,y,z)
  function buildChunkGeometryData(worldLike, cx, cz) {
    const get = (x, y, z) => worldLike.getBlock(x, y, z);
    const solidAt = (x, y, z) => Blocks.isSolid(get(x, y, z));
    const positions = [], normals = [], uvs = [], colors = [], indices = [];
    const x0 = cx * CX, z0 = cz * CZ;

    for (let ly = 0; ly < CY; ly++) {
      for (let lz = 0; lz < CZ; lz++) {
        for (let lx = 0; lx < CX; lx++) {
          const wx = x0 + lx, wy = ly, wz = z0 + lz;
          const id = get(wx, wy, wz);
          if (!Blocks.isSolid(id)) continue;
          const def = Blocks.BLOCKS[id];
          for (const face of FACES) {
            const nx = wx + face.dir[0], ny = wy + face.dir[1], nz = wz + face.dir[2];
            if (solidAt(nx, ny, nz)) continue; // 被遮挡，剔除
            const tile = def.tex[face.tex];
            const { u0, v0, u1, v1 } = Blocks.tileUV(tile);
            const ndx = positions.length / 3;
            for (const c of face.corners) {
              positions.push(wx + c.pos[0], wy + c.pos[1], wz + c.pos[2]);
              normals.push(face.dir[0], face.dir[1], face.dir[2]);
              uvs.push(u0 + c.uv[0] * (u1 - u0), v0 + c.uv[1] * (v1 - v0));
              const ao = vertexAO(solidAt, wx, wy, wz, face.dir, c.pos);
              const b = face.bright * ao;
              colors.push(b, b, b);
            }
            indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
          }
        }
      }
    }
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      colors: new Float32Array(colors),
      // 顶点数超过 65535 时索引必须用 Uint32（满方块区块会超）
      indices: positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
    };
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Mesher = { buildChunkGeometryData };
})(typeof self !== 'undefined' ? self : globalThis);
