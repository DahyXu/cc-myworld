// js/main.js — 游戏主程序（联机版）
(function (root) {
  'use strict';
  const isMobile = 'ontouchstart' in root || root.navigator.maxTouchPoints >= 1;
  if (isMobile) root.document.body.classList.add('mobile');
  const MW = root.MyWorld;
  const Blocks = MW.Blocks, World = MW.World, Mesher = MW.Mesher;
  const Player = MW.Player, Raycast = MW.Raycast, UI = MW.UI;
  const Net = MW.Net, Entities = MW.Entities, P = MW.Protocol;
  const Combat = MW.Combat, Hud = MW.Hud, QuestsDef = MW.QuestsDef, Skills = MW.Skills;
  const Inventory = MW.Inventory;
  const Minimap = MW.Minimap;
  const Touch = isMobile ? MW.Touch : null;

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
  Minimap.init();
  scene.add(camera);

  // --- 世界与玩家：收到 welcome 后才创建 ---
  let world = null, player = null;
  let selfDead = false;
  let maxHpCache = 20;
  let respawnPending = false;
  let currentQuest = null;
  let currentLevel = 1;
  let pendingInviteFrom = null;
  let bannerTimer = null;

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
  const input = { forward: false, back: false, left: false, right: false, jump: false, down: false };
  const KEYMAP = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', Space: 'jump', ShiftLeft: 'down', ShiftRight: 'down' };
  let hotbarIndex = 0;
  window.addEventListener('keydown', (e) => {
    if (KEYMAP[e.code]) { input[KEYMAP[e.code]] = true; if (e.code === 'Space') e.preventDefault(); }
    if (/^[0-9]$/.test(e.key)) {
      hotbarIndex = e.key === '0' ? 9 : parseInt(e.key, 10) - 1;
      UI.selectSlot(hotbarIndex);
      Combat.setHeld(hotbarIndex);
    }
    if (e.code === 'KeyM' && world && !selfDead && !Inventory.isPanelOpen()) {
      Minimap.toggle();
      return;
    }
    if (e.code === 'KeyJ' && world) {
      Hud.toggleQuestPanel();
      return;
    }
    if (e.code === 'KeyF' && world && !selfDead && isLocked()) {
      if (Skills.activate('flight')) { player.flying = true; }
      return;
    }
    if (e.code === 'KeyG' && world && !selfDead && isLocked()) {
      Skills.activate('sprint');
      return;
    }
    if (e.code === 'KeyQ' && world && !selfDead && isLocked()) {
      Skills.activate('chargedStrike');
      return;
    }
    if (e.code === 'KeyR' && world && !selfDead && isLocked()) {
      if (Skills.activate('shockwave') && Net.connected()) Net.send({ t: 'aoeAttack' });
      return;
    }
    if (e.code === 'KeyT' && world && !selfDead && isLocked() && Net.connected()) {
      Net.send({ t: 'recall' });
      return;
    }
    if (e.code === 'KeyK' && world) {
      Hud.toggleSkillBook(currentLevel, Skills.SKILL_TABLE);
      if (Hud.isSkillBookOpen() && isLocked()) root.document.exitPointerLock();
      return;
    }
    if (e.code === 'KeyE' && world && !selfDead && isLocked()) {
      const fwdX = -Math.sin(player.yaw), fwdZ = -Math.cos(player.yaw);
      const plist = Entities.playerAABBList();
      let nearestPlayer = null, nearestDist = Infinity;
      for (const p of plist) {
        const dx = p.x - player.x, dz = p.z - player.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= 5 && dist > 0) {
          const dot = (dx * fwdX + dz * fwdZ) / dist;
          if (dot > 0.7 && dist < nearestDist) { nearestPlayer = p; nearestDist = dist; }
        }
      }
      if (nearestPlayer) {
        Net.send({ t: 'teamInvite', pid: nearestPlayer.pid });
        showTeamMsg('邀请已发出');
      } else if (nearNpc()) {
        openNpcDialog();
      }
    }
    if (e.code === 'KeyY' && pendingInviteFrom !== null) {
      Net.send({ t: 'teamAccept', pid: pendingInviteFrom });
      hideTeamBanner();
    }
    if (e.code === 'KeyN' && pendingInviteFrom !== null) {
      Net.send({ t: 'teamDecline', pid: pendingInviteFrom });
      hideTeamBanner();
    }
    if (e.code === 'KeyB' && world && !selfDead) {
      Inventory.togglePanel();
      if (Inventory.isPanelOpen() && isLocked()) root.document.exitPointerLock();
    }
  });
  window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) input[KEYMAP[e.code]] = false; });
  window.addEventListener('wheel', (e) => {
    hotbarIndex = (hotbarIndex + (e.deltaY > 0 ? 1 : -1) + 10) % 10;
    UI.selectSlot(hotbarIndex);
    Combat.setHeld(hotbarIndex);
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- 指针锁定（仅 start 模式下点击遮罩才锁定）---
  function isLocked() { return document.pointerLockElement === renderer.domElement; }
  // 移动端无 Pointer Lock；world 存在即视为激活
  function isActive() { return isLocked() || (isMobile && !!world); }
  document.getElementById('overlay').addEventListener('click', () => {
    if (!world || UI.getOverlayMode() !== 'start') return;
    renderer.domElement.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    if (isLocked()) { UI.showOverlay(false); return; }
    if (pendingNpc) { pendingNpc = false; UI.setOverlayMode('npc'); return; }
    if (Inventory && Inventory.isPanelOpen()) return;
    if (Minimap && Minimap.isOpen()) return;
    if (Hud.isSkillBookOpen()) return;
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
  function doAttack() {
    if (!world || selfDead) return;
    const d0 = viewDir();
    const eye = { x: player.x, y: player.y + Player.EYE, z: player.z };
    const charged = Skills.consumeCharged();
    const consumed = Combat.onAttackClick(hotbarIndex, eye, d0, [...Entities.mobList(), ...Entities.bossAABBList()], Entities.playerAABBList(), Net, charged);
    if (consumed === 'shoot') { Entities.spawnLocalArrow(eye.x, eye.y, eye.z, d0.x, d0.y, d0.z); return; }
    if (consumed) return;
    const r = Raycast.cast(world, player.x, player.y + Player.EYE, player.z, d0.x, d0.y, d0.z, REACH);
    if (!r.hit) return;
    world.setBlock(r.x, r.y, r.z, 0);
    Net.send({ t: 'edit', x: r.x, y: r.y, z: r.z, id: 0 });
  }

  function doPlace() {
    if (!world || selfDead) return;
    const item = Inventory.getHotbarItem(hotbarIndex);
    if (!item || item.type !== 'block') return;
    const d = viewDir();
    const r = Raycast.cast(world, player.x, player.y + Player.EYE, player.z, d.x, d.y, d.z, REACH);
    if (!r.hit) return;
    const tx = r.x + r.nx, ty = r.y + r.ny, tz = r.z + r.nz;
    if (ty < 0 || ty >= World.CHUNK_Y) return;
    const overlap = !(tx + 1 <= player.x - Player.HALF || tx >= player.x + Player.HALF ||
                      ty + 1 <= player.y || ty >= player.y + Player.HEIGHT ||
                      tz + 1 <= player.z - Player.HALF || tz >= player.z + Player.HALF);
    if (overlap) return;
    const id = item.id;
    world.setBlock(tx, ty, tz, id);
    Net.send({ t: 'edit', x: tx, y: ty, z: tz, id });
  }

  document.addEventListener('mousedown', (e) => {
    if (isMobile || !isLocked() || !world || selfDead) return;
    if (e.button === 0) doAttack();
    else if (e.button === 2) doPlace();
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- HUD ---
  UI.buildHotbar(atlas, new Array(10).fill(null));
  Combat.init(camera);
  Inventory.init(Net, atlas);
  if (isMobile && Touch) {
    UI.setMobileMode(true);
    UI.selectSlot(0); // 触发窗口初始渲染（只显示前 5 格）
    Touch.init();
    Touch.registerAttack(doAttack);
    Touch.registerPlace(doPlace);
    Touch.registerE(() => { if (world && !selfDead && nearNpc()) openNpcDialog(); });
    Touch.registerHotbar((dirOrSelect, idx) => {
      if (dirOrSelect === 'select') {
        hotbarIndex = idx;
      } else {
        hotbarIndex = (hotbarIndex + dirOrSelect + 10) % 10;
      }
      UI.selectSlot(hotbarIndex);
      Combat.setHeld(hotbarIndex);
    });
  }

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
    maxHpCache = msg.maxHp;
    Hud.setHp(msg.hp, msg.maxHp);
    for (const mb of msg.mobs) Entities.upsertMob(mb);
    UI.setOnline(msg.online);
    if (isMobile) UI.showOverlay(false); else UI.setOverlayMode('start');
    // NPC 长老：固定坐标 + 本地地表高度
    Entities.setNpc(QuestsDef.NPC_X, world.terrainHeight(Math.floor(QuestsDef.NPC_X), Math.floor(QuestsDef.NPC_Z)) + 1, QuestsDef.NPC_Z);
    Hud.setXp(msg.xp, msg.level, msg.xpNext);
    currentLevel = msg.level;
    Skills.update(msg.level);
    Hud.updateSkillBar(Skills);
    currentQuest = msg.quest;
    Hud.setQuest(currentQuest);
    updateNpcMarker();
    Minimap.show(true);
    root.MyWorld.game = { world, player, meshes, seed: msg.seed }; // 调试句柄
  }

  // 重连/休眠唤醒后的软重置：同一世界，补齐 diff、校正位置、重建远端玩家
  function softReset(msg) {
    applyEdits(msg.edits);
    player.x = msg.x; player.y = msg.y; player.z = msg.z;
    player.vx = player.vy = player.vz = 0;
    respawnPending = false;
    Entities.clear();
    maxHpCache = msg.maxHp;
    Hud.setHp(msg.hp, msg.maxHp);
    Hud.setXp(msg.xp, msg.level, msg.xpNext);
    currentLevel = msg.level;
    Skills.update(msg.level);
    Hud.updateSkillBar(Skills);
    currentQuest = msg.quest;
    Hud.setQuest(currentQuest);
    updateNpcMarker();
    selfDead = false;
    Minimap.show(true);
    Hud.showDeath(false);
    for (const mb of msg.mobs) Entities.upsertMob(mb);
    for (const pm of msg.players) Entities.upsertPlayer(pm);
    UI.setOnline(msg.online);
    if (isMobile) UI.showOverlay(false); else UI.setOverlayMode('start');
  }

  // NPC 标记：无任务→可接「！」；有任务且达标→可交「？」；进行中→无标记
  function updateNpcMarker() {
    if (!currentQuest) Entities.setNpcMarker('accept');
    else if (currentQuest.progress >= currentQuest.count) Entities.setNpcMarker('turnin');
    else Entities.setNpcMarker('none');
  }

  function nearNpc() {
    if (!player) return false;
    return Math.hypot(player.x - QuestsDef.NPC_X, player.z - QuestsDef.NPC_Z) <= QuestsDef.NPC_RANGE;
  }

  function showTeamBanner(name) {
    const el = root.document.getElementById('teamInviteBanner');
    el.textContent = name + ' 邀请你加队  Y 接受  N 拒绝';
    el.style.display = 'block';
  }
  function hideTeamBanner() {
    root.document.getElementById('teamInviteBanner').style.display = 'none';
    pendingInviteFrom = null;
    clearTimeout(bannerTimer);
  }
  function showTeamMsg(text) {
    const el = root.document.getElementById('teamInviteBanner');
    el.textContent = text;
    el.style.display = 'block';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
  }
  function updateTeamRoster(members, leaderPid) {
    const el = root.document.getElementById('teamRoster');
    if (!members || members.length === 0) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML = members.map(m =>
      '<div>' + (m.pid === leaderPid ? '♛ ' : '  ') + m.name + '</div>'
    ).join('');
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
  Net.on('mobSpawn', (m) => Entities.upsertMob(m));
  Net.on('mobMove', (m) => Entities.moveMob(m));
  Net.on('mobHurt', (m) => {
    const e = Entities.mobList().find((x) => x.id === m.id);
    Entities.hurtMob(m);
    if (e) Hud.floatDamage(e.x, e.y + e.height + 0.3, e.z, '-' + m.dmg, '#ffd24a');
  });
  Net.on('mobDie', (m) => {
    if (m.dmg) {
      const e = Entities.mobList().find((x) => x.id === m.id);
      if (e) Hud.floatDamage(e.x, e.y + e.height + 0.3, e.z, '-' + m.dmg, '#ffd24a');
    }
    Entities.dieMob(m.id);
  });
  Net.on('mobDespawn', (m) => Entities.despawnMob(m.id));
  Net.on('bossState', (m) => {
    for (const b of m.bosses) {
      if (b.alive) {
        Entities.upsertBoss(b);
      } else {
        Entities.showBossCountdown(b.id, b.name, b.x, b.z, b.respawnIn, b.y);
      }
    }
  });
  Net.on('bossSpawn', (m) => Entities.upsertBoss(m));
  Net.on('bossMove', (m) => Entities.moveBoss(m));
  Net.on('bossHurt', (m) => {
    Entities.hurtBossEntity(m);
    const bp = Entities.bossPos(m.id);
    if (bp) Hud.floatDamage(bp.x, bp.y + 1, bp.z, '-' + m.dmg, '#ff6644');
  });
  Net.on('bossDie', (m) => {
    if (m.dmg) {
      const bp = Entities.bossPos(m.id);
      if (bp) Hud.floatDamage(bp.x, bp.y + 1, bp.z, '-' + m.dmg, '#ff6644');
    }
    Entities.dieBossEntity(m.id, m.respawnIn);
  });
  Net.on('bossDied', () => {});
  Net.on('bossRespawn', (m) => Entities.removeBossTimer(m.id));
  Net.on('arrowSpawn', (m) => Entities.remoteArrow(m));
  Net.on('arrowDie', (m) => Entities.dieArrow(m));
  Net.on('hpUpdate', (m) => {
    maxHpCache = m.max;
    Hud.setHp(m.hp, m.max);
    if (selfDead && m.hp > 0) { selfDead = false; Hud.showDeath(false); }
  });
  Net.on('playerHurt', (m) => { Hud.setHp(m.hp, maxHpCache); Hud.flashRed(); });
  Net.on('playerDie', () => {
    selfDead = true; Hud.showDeath(true);
    if (player) { player.flying = false; player.vy = 0; }
    Skills.forceEndFlight();
  });
  Net.on('xpGain', (m) => { Hud.setXp(m.xp, m.level, m.xpNext); });
  Net.on('levelUp', (m) => {
    maxHpCache = m.maxHp;
    currentLevel = m.level;
    Hud.setHp(m.hp, m.maxHp);
    Hud.setLevel(m.level);
    Hud.levelUpFlash();
    const newSkills = Skills.update(m.level);
    for (const name of newSkills) Hud.showSkillUnlock(name);
    Hud.updateSkillBar(Skills);
  });
  Net.on('questState', (m) => { currentQuest = m.quest; Hud.setQuest(currentQuest); updateNpcMarker(); if (UI.getOverlayMode() === 'npc') openNpcDialog(); });
  Net.on('pLevelUp', (m) => { Hud.floatDamage(m.x, m.y + 2.3, m.z, '⬆ 升级!', '#ffe066'); });
  Net.on('inv_state', (m) => { Inventory.applyInvState(m); Combat.setHeld(hotbarIndex); });
  Net.on('inv_delta', (m) => { Inventory.applyInvDelta(m); Combat.setHeld(hotbarIndex); });
  Net.on('teamInviteFrom', (m) => {
    pendingInviteFrom = m.pid;
    showTeamBanner(m.name);
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { hideTeamBanner(); }, 30000);
  });
  Net.on('teamUpdate', (m) => {
    const pids = (m.members || []).map(p => p.pid);
    Entities.setTeamPids(pids);
    updateTeamRoster(m.members, m.leaderPid);
  });
  Net.on('teamErr', (m) => {
    if (m.reason === 'full') showTeamMsg('对方队伍已满');
    else if (m.reason === 'no_invite') showTeamMsg('邀请已过期');
  });

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

  root.addEventListener('invClosed', () => {
    if (world && !isLocked() && !selfDead) UI.setOverlayMode('start');
  });
  root.addEventListener('skillBookClosed', () => {
    if (world && !isLocked() && !selfDead) UI.setOverlayMode('start');
  });
  root.addEventListener('mapClosed', () => {
    if (world && !selfDead && !Inventory.isPanelOpen()) UI.setOverlayMode('start');
  });

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

  // —— NPC 对话框：开/关复用 overlay 的 npc 模式 ——
  let pendingNpc = false;
  function openNpcDialog() {
    const desc = root.document.getElementById('npcDesc');
    const act = root.document.getElementById('npcActBtn');
    if (!currentQuest) {
      // 客户端不知 chainIndex（服务器侧推进），接受前用通用提示，具体任务由服务器 questState 回发
      desc.textContent = '长老有任务给你。接受后去讨伐怪物吧。';
      act.textContent = '接受任务';
      act.style.display = '';
      act.onclick = (e) => { e.stopPropagation(); Net.send({ t: 'questAccept' }); closeNpcDialog(); };
    } else if (currentQuest.progress >= currentQuest.count) {
      desc.textContent = '任务完成！交付领取经验奖励。';
      act.textContent = '交付任务';
      act.style.display = '';
      act.onclick = (e) => { e.stopPropagation(); Net.send({ t: 'questTurnIn' }); closeNpcDialog(); };
    } else {
      const name = MW.MobsDef.TYPES[currentQuest.type].name;
      desc.textContent = '任务进行中：击杀 ' + name + ' ' + currentQuest.progress + '/' + currentQuest.count + '，完成后回来交付。';
      act.style.display = 'none';
    }
    if (isMobile) { UI.setOverlayMode('npc'); return; }
    pendingNpc = true;
    if (root.document.pointerLockElement) root.document.exitPointerLock(); // 解锁以便点按钮；pointerlockchange 据 pendingNpc 切到 npc 模式
    else { pendingNpc = false; UI.setOverlayMode('npc'); }
  }
  function closeNpcDialog() {
    pendingNpc = false;
    if (isMobile) UI.showOverlay(false); else UI.setOverlayMode('start'); // 回到「点击继续」
  }
  root.document.getElementById('npcCloseBtn').addEventListener('click', (e) => { e.stopPropagation(); closeNpcDialog(); });

  // --- 主循环 ---
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;

    if (world && player) {
      if (isMobile && Touch) {
        const mv = Touch.getMove();
        input.forward = mv.forward >  0.15;
        input.back    = mv.forward < -0.15;
        input.left    = mv.strafe  < -0.15;
        input.right   = mv.strafe  >  0.15;
        input.jump    = Touch.getJump();
        if (player) {
          const vd = Touch.consumeViewDelta();
          player.yaw   -= vd.dyaw;
          player.pitch -= vd.dpitch;
          const lim = Math.PI / 2 - 0.01;
          if (player.pitch >  lim) player.pitch =  lim;
          if (player.pitch < -lim) player.pitch = -lim;
        }
        Touch.setNpcVisible(nearNpc());
      }
      if (isActive() && !selfDead) Player.update(player, world, dt, input, Skills);
      // 掉出世界：请求服务器传送（等待期间悬停，避免反复触发）
      if (player.y < -10) {
        if (!respawnPending && Net.connected()) {
          respawnPending = true;
          Net.send({ t: 'respawn' });
        }
        if (player.y < -30) { player.y = -30; player.vy = 0; }
      }
      Skills.tick(dt);
      player.sprintActive = Skills.isSprintActive();
      const ftl = Skills.getFlightTimeLeft();
      if (player.flying && ftl <= 0) { player.flying = false; player.vy = 0; }
      Hud.updateFlightBar(ftl, 30);
      if (player.onGround) player.airJumps = Skills.hasSkill('doubleJump') ? 1 : 0;
      Hud.updateSkillBar(Skills);
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
    Entities.update(dt, world);
    Combat.update(dt);
    Hud.update(dt, camera);
    if (world && player) {
      Minimap.update(player, {
        players: Entities.playerList(),
        mobs: Entities.mobList(),
        bosses: Entities.bossList(),
      });
    }
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
})(typeof self !== 'undefined' ? self : globalThis);
