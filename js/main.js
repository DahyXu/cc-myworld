// js/main.js — 游戏主程序
(function (root) {
  'use strict';
  const MW = root.MyWorld;
  const Blocks = MW.Blocks, World = MW.World, Mesher = MW.Mesher;
  const Player = MW.Player, Raycast = MW.Raycast, UI = MW.UI;

  const RENDER_RADIUS = 4, UNLOAD_RADIUS = 6;
  const MAX_GEN_PER_FRAME = 2, MAX_REMESH_PER_FRAME = 4, REACH = 6;

  // --- 渲染器（WebGL 检查）---
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false });
  } catch (e) {
    document.getElementById('nogl').style.display = 'flex';
    document.getElementById('overlay').style.display = 'none';
    return;
  }
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const SKY = 0x87ceeb;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 40, 90);
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.rotation.order = 'YXZ';

  // --- 材质（光照全部烘焙进顶点色，用 Basic 材质即可）---
  const atlas = Blocks.buildAtlas();
  const tex = new THREE.CanvasTexture(atlas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  const material = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true });

  // --- 世界与玩家 ---
  const seed = (Math.random() * 0x7fffffff) | 0;
  const world = World.create(seed);
  const spawnX = 8.5, spawnZ = 8.5;
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) world.ensureChunk(cx, cz);
  const player = Player.create(spawnX, world.terrainHeight(8, 8) + 1, spawnZ);

  // --- 区块网格管理 ---
  const meshes = new Map();
  function buildMesh(cx, cz) {
    const k = world.key(cx, cz);
    const old = meshes.get(k);
    if (old) { scene.remove(old); old.geometry.dispose(); meshes.delete(k); }
    const d = Mesher.buildChunkGeometryData(world, cx, cz);
    if (d.positions.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2));
    g.setAttribute('color', new THREE.BufferAttribute(d.colors, 3));
    g.setIndex(new THREE.BufferAttribute(d.indices, 1));
    const m = new THREE.Mesh(g, material);
    scene.add(m);
    meshes.set(k, m);
  }
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    buildMesh(cx, cz);
    world.getChunk(cx, cz).dirty = false;
  }

  function updateChunks() {
    const pcx = Math.floor(player.x / World.CHUNK_X), pcz = Math.floor(player.z / World.CHUNK_Z);
    // 1) 缺失区块按距离排序补齐（限额）
    const wanted = [];
    for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
      for (let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz++) {
        const cx = pcx + dx, cz = pcz + dz;
        if (!meshes.has(world.key(cx, cz))) wanted.push([cx, cz, dx * dx + dz * dz]);
      }
    }
    wanted.sort((a, b) => a[2] - b[2]);
    let budget = MAX_GEN_PER_FRAME;
    for (const [cx, cz] of wanted) {
      if (budget-- <= 0) break;
      world.ensureChunk(cx, cz);
      buildMesh(cx, cz);
      world.getChunk(cx, cz).dirty = false;
    }
    // 2) 脏区块重构（挖放方块、邻块生成都会标脏）
    let remesh = MAX_REMESH_PER_FRAME;
    for (const c of world.chunks.values()) {
      if (remesh <= 0) break;
      if (c.dirty && meshes.has(world.key(c.cx, c.cz))) {
        buildMesh(c.cx, c.cz);
        c.dirty = false;
        remesh--;
      }
    }
    // 3) 卸载远处网格（保留方块数据）
    for (const [k, m] of meshes) {
      const c = world.chunks.get(k);
      if (Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) > UNLOAD_RADIUS) {
        scene.remove(m);
        m.geometry.dispose();
        meshes.delete(k);
      }
    }
  }

  // --- 选中方块高亮 ---
  const hl = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
    new THREE.LineBasicMaterial({ color: 0x000000 })
  );
  hl.visible = false;
  scene.add(hl);

  // --- 输入 ---
  const input = { forward: false, back: false, left: false, right: false, jump: false };
  const KEYMAP = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', Space: 'jump' };
  let hotbarIndex = 0;
  window.addEventListener('keydown', (e) => {
    if (KEYMAP[e.code]) { input[KEYMAP[e.code]] = true; if (e.code === 'Space') e.preventDefault(); }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 8) { hotbarIndex = n - 1; UI.selectSlot(hotbarIndex); }
  });
  window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) input[KEYMAP[e.code]] = false; });
  window.addEventListener('wheel', (e) => {
    hotbarIndex = (hotbarIndex + (e.deltaY > 0 ? 1 : -1) + 8) % 8;
    UI.selectSlot(hotbarIndex);
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- 指针锁定 ---
  function isLocked() { return document.pointerLockElement === renderer.domElement; }
  document.getElementById('overlay').addEventListener('click', () => renderer.domElement.requestPointerLock());
  document.addEventListener('pointerlockchange', () => UI.showOverlay(!isLocked()));
  document.addEventListener('mousemove', (e) => {
    if (!isLocked()) return;
    player.yaw -= e.movementX * 0.0024;
    player.pitch -= e.movementY * 0.0024;
    const lim = Math.PI / 2 - 0.01;
    if (player.pitch > lim) player.pitch = lim;
    if (player.pitch < -lim) player.pitch = -lim;
  });

  // --- 视线方向（yaw=0 朝 -z）---
  function viewDir() {
    const cp = Math.cos(player.pitch);
    return { x: -Math.sin(player.yaw) * cp, y: Math.sin(player.pitch), z: -Math.cos(player.yaw) * cp };
  }

  // --- 挖 / 放 ---
  document.addEventListener('mousedown', (e) => {
    if (!isLocked()) return;
    const d = viewDir();
    const r = Raycast.cast(world, player.x, player.y + Player.EYE, player.z, d.x, d.y, d.z, REACH);
    if (!r.hit) return;
    if (e.button === 0) {
      world.setBlock(r.x, r.y, r.z, 0);
    } else if (e.button === 2) {
      const tx = r.x + r.nx, ty = r.y + r.ny, tz = r.z + r.nz;
      if (ty < 0 || ty >= World.CHUNK_Y) return;
      // 不允许把方块放进玩家碰撞箱
      const overlap = !(tx + 1 <= player.x - Player.HALF || tx >= player.x + Player.HALF ||
                        ty + 1 <= player.y || ty >= player.y + Player.HEIGHT ||
                        tz + 1 <= player.z - Player.HALF || tz >= player.z + Player.HALF);
      if (overlap) return;
      world.setBlock(tx, ty, tz, Blocks.HOTBAR[hotbarIndex]);
    }
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- HUD ---
  UI.buildHotbar(atlas);

  // --- 主循环 ---
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;

    if (isLocked()) Player.update(player, world, dt, input);
    if (player.y < -10) { // 掉出世界兜底
      player.x = spawnX; player.z = spawnZ;
      player.y = world.terrainHeight(8, 8) + 2;
      player.vy = 0;
    }

    updateChunks();

    camera.position.set(player.x, player.y + Player.EYE, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);

    const d = viewDir();
    const r = Raycast.cast(world, player.x, player.y + Player.EYE, player.z, d.x, d.y, d.z, REACH);
    if (r.hit) { hl.visible = true; hl.position.set(r.x + 0.5, r.y + 0.5, r.z + 0.5); }
    else hl.visible = false;

    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  // 调试句柄（浏览器自动化验证用）
  root.MyWorld.game = { world, player, meshes, seed };
})(typeof self !== 'undefined' ? self : globalThis);
