// js/main.js — 游戏主程序（联机版）
(function (root) {
  'use strict';
  const MW = root.MyWorld;
  const Blocks = MW.Blocks, World = MW.World, Mesher = MW.Mesher;
  const Player = MW.Player, Raycast = MW.Raycast, UI = MW.UI;
  const Net = MW.Net, Entities = MW.Entities, P = MW.Protocol;

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
  camera.position.set(0, 45, 0);

  // --- 材质（光照烘焙进顶点色，Basic 材质即可）---
  const atlas = Blocks.buildAtlas();
  const tex = new THREE.CanvasTexture(atlas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  const material = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true });

  Entities.init(scene);

  // --- 世界与玩家：收到 welcome 后才创建 ---
  let world = null, player = null;
  let respawnPending = false;

  // --- 区块网格管理 ---
  const meshes = new Map();
  function buildMesh(cx, cz) {
    const k = world.key(cx, cz);
    const old = meshes.get(k);
    if (old) { scene.remove(old); old.geometry.dispose(); meshes.delete(k); }
    const d = Mesher.buildChunkGeometryData(world, cx, cz);
    // 空几何不入 meshes 表：依赖「地形生成保证每区块必有实心方块」（terrainHeight 下限 2）。
    // 若未来生成器可能产出全空区块，需改用空网格占位，否则该区块会每帧重进生成队列且后续编辑不触发重建
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

  function updateChunks() {
    const pcx = Math.floor(player.x / World.CHUNK_X), pcz = Math.floor(player.z / World.CHUNK_Z);
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
    let remesh = MAX_REMESH_PER_FRAME;
    for (const c of world.chunks.values()) {
      if (remesh <= 0) break;
      if (c.dirty && meshes.has(world.key(c.cx, c.cz))) {
        buildMesh(c.cx, c.cz);
        c.dirty = false;
        remesh--;
      }
    }
    for (const [k, m] of meshes) {
      const c = world.chunks.get(k);
      // 区块缺失（理论上不发生）按孤儿网格卸载，避免渲染循环抛错
      if (!c || Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) > UNLOAD_RADIUS) {
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

  // --- 指针锁定（仅 start 模式下点击遮罩才锁定）---
  function isLocked() { return document.pointerLockElement === renderer.domElement; }
  document.getElementById('overlay').addEventListener('click', () => {
    if (!world || UI.getOverlayMode() !== 'start') return;
    renderer.domElement.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    if (isLocked()) { UI.showOverlay(false); return; }
    if (!world) return;
    if (UI.getOverlayMode() === 'replaced') { UI.showOverlay(true); return; } // 被顶替：提示不被覆盖
    UI.setOverlayMode(Net.connected() ? 'start' : 'connecting'); // 断线触发的解锁：保持「连接中」遮罩
  });
  document.addEventListener('mousemove', (e) => {
    if (!isLocked() || !player) return;
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

  // --- 挖 / 放：本地预表现 + 上发服务器仲裁 ---
  document.addEventListener('mousedown', (e) => {
    if (!isLocked() || !world) return;
    const d = viewDir();
    const r = Raycast.cast(world, player.x, player.y + Player.EYE, player.z, d.x, d.y, d.z, REACH);
    if (!r.hit) return;
    if (e.button === 0) {
      world.setBlock(r.x, r.y, r.z, 0);
      Net.send({ t: 'edit', x: r.x, y: r.y, z: r.z, id: 0 });
    } else if (e.button === 2) {
      const tx = r.x + r.nx, ty = r.y + r.ny, tz = r.z + r.nz;
      if (ty < 0 || ty >= World.CHUNK_Y) return;
      // 不允许把方块放进玩家碰撞箱
      const overlap = !(tx + 1 <= player.x - Player.HALF || tx >= player.x + Player.HALF ||
                        ty + 1 <= player.y || ty >= player.y + Player.HEIGHT ||
                        tz + 1 <= player.z - Player.HALF || tz >= player.z + Player.HALF);
      if (overlap) return;
      const id = Blocks.HOTBAR[hotbarIndex];
      world.setBlock(tx, ty, tz, id);
      Net.send({ t: 'edit', x: tx, y: ty, z: tz, id });
    }
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- HUD ---
  UI.buildHotbar(atlas);

  // --- 联机接线 ---
  function applyEdits(list) {
    for (const ed of list) world.applyRemoteEdit(ed[0], ed[1], ed[2], ed[3]);
  }

  function startWorld(msg) {
    world = World.create(msg.seed);
    applyEdits(msg.edits);
    player = Player.create(msg.x, msg.y, msg.z);
    // 同步生成脚下 3×3 区块，避免出生跌落
    const pcx = Math.floor(player.x / World.CHUNK_X), pcz = Math.floor(player.z / World.CHUNK_Z);
    for (let cx = pcx - 1; cx <= pcx + 1; cx++) {
      for (let cz = pcz - 1; cz <= pcz + 1; cz++) {
        world.ensureChunk(cx, cz);
        buildMesh(cx, cz);
        world.getChunk(cx, cz).dirty = false;
      }
    }
    for (const pm of msg.players) Entities.upsertPlayer(pm);
    UI.setOnline(msg.online);
    UI.setOverlayMode('start');
    root.MyWorld.game = { world, player, meshes, seed: msg.seed }; // 调试句柄
  }

  // 重连/休眠唤醒后的软重置：同一世界，补齐 diff、校正位置、重建远端玩家
  function softReset(msg) {
    applyEdits(msg.edits);
    player.x = msg.x; player.y = msg.y; player.z = msg.z;
    player.vx = player.vy = player.vz = 0;
    respawnPending = false;
    Entities.clear();
    for (const pm of msg.players) Entities.upsertPlayer(pm);
    UI.setOnline(msg.online);
    UI.setOverlayMode('start');
  }

  Net.onStatus((st) => {
    if (st === 'file') {
      UI.setOverlayMode('file');
    } else if (st === 'replaced') {
      UI.setOverlayMode('replaced'); // 被其他窗口顶替：net.js 已停止自动重连
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (st === 'connecting' || st === 'closed') {
      UI.setOverlayMode('connecting');
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (st === 'open' && !Net.getName()) {
      UI.setOverlayMode('name');
    }
    // open 且已有昵称：net.js 已自动发 hello，等 welcome 即可
  });
  Net.on('welcome', (m) => { if (!world) startWorld(m); else softReset(m); });
  Net.on('penter', (m) => Entities.upsertPlayer(m));
  Net.on('pmove', (m) => Entities.movePlayer(m));
  Net.on('pexit', (m) => Entities.removePlayer(m.pid));
  Net.on('edit', (m) => { if (world) world.applyRemoteEdit(m.x, m.y, m.z, m.id); });
  Net.on('editReject', (m) => { if (world) world.applyRemoteEdit(m.x, m.y, m.z, m.id); });
  Net.on('teleport', (m) => {
    if (!player) return;
    player.x = m.x; player.y = m.y; player.z = m.z;
    player.vx = player.vy = player.vz = 0;
    respawnPending = false;
  });
  Net.on('online', (m) => UI.setOnline(m.n));

  // 起名表单
  function submitName() {
    const v = document.getElementById('nameInput').value.trim();
    if (!v) return;
    Net.setName(v);
    UI.setOverlayMode('connecting');
    Net.hello();
  }
  document.getElementById('nameBtn').addEventListener('click', (e) => { e.stopPropagation(); submitName(); });
  document.getElementById('nameInput').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') submitName();
  });

  Net.connect();

  // --- 位置上报（10Hz，有变化才发）---
  let moveAcc = 0;
  let lastSent = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, init: false };
  function sendMove() {
    if (!Net.connected() || !player) return;
    const dp = Math.abs(player.x - lastSent.x) + Math.abs(player.y - lastSent.y) + Math.abs(player.z - lastSent.z);
    const dr = Math.abs(player.yaw - lastSent.yaw) + Math.abs(player.pitch - lastSent.pitch);
    if (lastSent.init && dp + dr < 0.002) return;
    lastSent = { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, init: true };
    Net.send({ t: 'move', x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch });
  }

  // --- 主循环 ---
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;

    if (world && player) {
      if (isLocked()) Player.update(player, world, dt, input);
      // 掉出世界：请求服务器传送（等待期间悬停，避免反复触发）
      if (player.y < -10) {
        if (!respawnPending && Net.connected()) {
          respawnPending = true;
          Net.send({ t: 'respawn' });
        }
        if (player.y < -30) { player.y = -30; player.vy = 0; }
      }
      updateChunks();
      camera.position.set(player.x, player.y + Player.EYE, player.z);
      camera.rotation.set(player.pitch, player.yaw, 0);
      const d = viewDir();
      const r = Raycast.cast(world, player.x, player.y + Player.EYE, player.z, d.x, d.y, d.z, REACH);
      if (r.hit) { hl.visible = true; hl.position.set(r.x + 0.5, r.y + 0.5, r.z + 0.5); }
      else hl.visible = false;
      moveAcc += dt * 1000;
      if (moveAcc >= P.MOVE_INTERVAL_MS) { moveAcc = 0; sendMove(); }
    }
    Entities.update(dt);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
})(typeof self !== 'undefined' ? self : globalThis);
