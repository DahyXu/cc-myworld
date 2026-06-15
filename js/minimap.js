// js/minimap.js — 小地图（右上角圆形）+ 全屏大地图（M键）
(function (root) {
  'use strict';
  const MobsDef  = root.MyWorld.MobsDef;
  const QuestsDef = root.MyWorld.QuestsDef;

  const MINIMAP_RADIUS = 60;  // 世界单位显示半径
  const CV_HALF = 75;         // canvas 像素半径
  const SCALE = CV_HALF / MINIMAP_RADIUS; // 1.25 px/格

  // 区域色带（x 轴区间）
  const ZONES = [
    { min: -Infinity, max: 60,  color: '#2a2a1a' },
    { min: 60,        max: 150, color: '#1a3a0d' },
    { min: 150,       max: 300, color: '#3a2a0d' },
    { min: 300,       max: 500, color: '#2a1a1a' },
    { min: 500,       max: Infinity, color: '#1a1a2a' },
  ];

  // 全屏地图世界范围
  const WX_MIN = -50, WX_MAX = 820;
  const WZ_MIN = -120, WZ_MAX = 140;
  const WX_RANGE = WX_MAX - WX_MIN;
  const WZ_RANGE = WZ_MAX - WZ_MIN;

  let minimapEl = null, mmCtx = null;
  let mapOverlay = null, mapCanvas = null, fmCtx = null;
  let mapOpen = false;
  let lastEntities = { players: [], mobs: [], bosses: [] };
  let hoverBoss = null;

  // ─── 公开 API ───────────────────────────────────────────

  function init() {
    minimapEl = root.document.getElementById('minimap');
    mmCtx = minimapEl.getContext('2d');
    mapOverlay = root.document.getElementById('mapOverlay');
    mapCanvas  = root.document.getElementById('mapCanvas');
    fmCtx = mapCanvas.getContext('2d');

    mapCanvas.addEventListener('mousemove', _onMapMouseMove);

    root.document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && mapOpen) toggle();
    });
  }

  function show(visible) {
    minimapEl.style.display = visible ? 'block' : 'none';
  }

  function toggle() {
    mapOpen = !mapOpen;
    mapOverlay.style.display = mapOpen ? 'flex' : 'none';
    if (mapOpen) {
      show(false);
      _resizeFM();
      if (root.document.pointerLockElement) root.document.exitPointerLock();
    } else {
      show(true);
      root.dispatchEvent(new CustomEvent('mapClosed'));
    }
  }

  function isOpen() { return mapOpen; }

  function update(player, entities) {
    if (!player) return;
    lastEntities = entities;
    _drawMinimap(player, entities);
    if (mapOpen) _drawFullMap(player, entities);
  }

  // ─── 小地图 ─────────────────────────────────────────────

  function _drawMinimap(player, entities) {
    const ctx = mmCtx;
    ctx.clearRect(0, 0, 150, 150);

    ctx.save();
    // 裁剪为圆形
    ctx.beginPath();
    ctx.arc(CV_HALF, CV_HALF, CV_HALF - 1, 0, Math.PI * 2);
    ctx.clip();

    // 以玩家为中心，旋转使朝向朝上
    ctx.translate(CV_HALF, CV_HALF);
    ctx.rotate(player.yaw); // 正 yaw = 顺时针旋转 = 向左转，使右侧目标出现在上方

    _drawMMZones(ctx, player);
    _drawMMEntities(ctx, player, entities);

    ctx.restore();

    // 玩家圆点（始终在圆心，不随旋转变化）
    ctx.beginPath();
    ctx.arc(CV_HALF, CV_HALF, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#00ff88';
    ctx.fill();

    // 方向三角（始终朝上 = 前方）
    ctx.beginPath();
    ctx.moveTo(CV_HALF,     CV_HALF - 11);
    ctx.lineTo(CV_HALF - 5, CV_HALF - 4);
    ctx.lineTo(CV_HALF + 5, CV_HALF - 4);
    ctx.closePath();
    ctx.fillStyle = '#00ff88';
    ctx.fill();

    // 圆形边框
    ctx.beginPath();
    ctx.arc(CV_HALF, CV_HALF, CV_HALF - 1, 0, Math.PI * 2);
    ctx.strokeStyle = '#445544';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function _drawMMZones(ctx, player) {
    const H = 400; // 远大于小地图直径
    for (const z of ZONES) {
      const wx0 = z.min === -Infinity ? player.x - MINIMAP_RADIUS - 50 : z.min;
      const wx1 = z.max ===  Infinity ? player.x + MINIMAP_RADIUS + 50 : z.max;
      const cx0 = (wx0 - player.x) * SCALE;
      const cx1 = (wx1 - player.x) * SCALE;
      ctx.fillStyle = z.color;
      ctx.fillRect(cx0, -H / 2, cx1 - cx0, H);
    }
  }

  function _drawMMEntities(ctx, player, entities) {
    // 其他玩家
    for (const p of entities.players) {
      const dx = (p.x - player.x) * SCALE;
      const dz = (p.z - player.z) * SCALE;
      if (Math.hypot(dx, dz) > CV_HALF) continue;
      ctx.beginPath();
      ctx.arc(dx, dz, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#44aaff';
      ctx.fill();
    }

    // 怪物
    for (const m of entities.mobs) {
      const dx = (m.x - player.x) * SCALE;
      const dz = (m.z - player.z) * SCALE;
      if (Math.hypot(dx, dz) > CV_HALF) continue;
      ctx.beginPath();
      ctx.arc(dx, dz, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ff4444';
      ctx.fill();
    }

    // NPC
    const ndx = (QuestsDef.NPC_X - player.x) * SCALE;
    const ndz = (QuestsDef.NPC_Z - player.z) * SCALE;
    if (Math.hypot(ndx, ndz) <= CV_HALF) {
      ctx.fillStyle = '#ffdd00';
      ctx.fillRect(ndx - 3, ndz - 3, 6, 6);
    }

    // 出生点
    const sdx = (MobsDef.SPAWN_X - player.x) * SCALE;
    const sdz = (MobsDef.SPAWN_Z - player.z) * SCALE;
    if (Math.hypot(sdx, sdz) <= CV_HALF) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sdx - 5, sdz); ctx.lineTo(sdx + 5, sdz); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sdx, sdz - 5); ctx.lineTo(sdx, sdz + 5); ctx.stroke();
    }

    // Boss（始终显示，超出范围时夹到边缘）
    for (const b of entities.bosses) {
      let dx = (b.x - player.x) * SCALE;
      let dz = (b.z - player.z) * SCALE;
      const dist = Math.hypot(dx, dz);
      if (dist > CV_HALF - 7) {
        const s = (CV_HALF - 7) / dist;
        dx *= s; dz *= s;
      }
      ctx.beginPath();
      ctx.arc(dx, dz, b.dead ? 3 : 5, 0, Math.PI * 2);
      if (!b.dead) {
        ctx.shadowColor = '#ff8800';
        ctx.shadowBlur = 6;
      }
      ctx.fillStyle = b.dead ? '#555555' : '#ff8800';
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // ─── 全屏大地图 ──────────────────────────────────────────

  function _resizeFM() {
    mapCanvas.width  = Math.min(root.innerWidth  * 0.9, 1200);
    mapCanvas.height = Math.min(root.innerHeight * 0.8, 600);
  }

  function _wc(wx, wz) { // world → canvas
    return {
      x: (wx - WX_MIN) / WX_RANGE * mapCanvas.width,
      y: (wz - WZ_MIN) / WZ_RANGE * mapCanvas.height,
    };
  }

  function _drawFullMap(player, entities) {
    const ctx = fmCtx;
    const W = mapCanvas.width, H = mapCanvas.height;
    ctx.clearRect(0, 0, W, H);

    // 区域色带
    for (const z of ZONES) {
      const wx0 = Math.max(z.min === -Infinity ? WX_MIN : z.min, WX_MIN);
      const wx1 = Math.min(z.max ===  Infinity ? WX_MAX : z.max, WX_MAX);
      const p0 = _wc(wx0, WZ_MIN); const p1 = _wc(wx1, WZ_MAX);
      ctx.fillStyle = z.color;
      ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    }

    // 区域名称
    const ZONE_LABELS = [
      { cx: 105,  label: '史莱姆区', color: '#5a8a5a' },
      { cx: 225,  label: '僵尸区',   color: '#8a7a5a' },
      { cx: 400,  label: '骷髅区',   color: '#8a5a5a' },
      { cx: 650,  label: '狼区',     color: '#6a6a9a' },
    ];
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    for (const z of ZONE_LABELS) {
      const p = _wc(z.cx, WZ_MIN + 16);
      ctx.fillStyle = z.color;
      ctx.fillText(z.label, p.x, p.y);
    }

    // 出生点
    const sp = _wc(MobsDef.SPAWN_X, MobsDef.SPAWN_Z);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sp.x - 7, sp.y); ctx.lineTo(sp.x + 7, sp.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sp.x, sp.y - 7); ctx.lineTo(sp.x, sp.y + 7); ctx.stroke();
    ctx.fillStyle = '#dddddd'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('出生点', sp.x, sp.y - 10);

    // NPC
    const np = _wc(QuestsDef.NPC_X, QuestsDef.NPC_Z);
    ctx.fillStyle = '#ffdd00';
    ctx.fillRect(np.x - 5, np.y - 5, 10, 10);
    ctx.fillStyle = '#ffdd00'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('长老', np.x, np.y - 10);

    // Boss
    for (const b of entities.bosses) {
      const bp = _wc(b.x, b.z);
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, 7, 0, Math.PI * 2);
      if (!b.dead) { ctx.shadowColor = '#ff8800'; ctx.shadowBlur = 10; }
      ctx.fillStyle = b.dead ? '#444' : '#ff8800';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = b.dead ? '#888' : '#ffcc88';
      ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(b.name, bp.x, bp.y - 13);
      if (b.dead) {
        ctx.fillStyle = '#666'; ctx.font = '10px sans-serif';
        ctx.fillText('已死亡', bp.x, bp.y + 18);
      }
    }

    // 其他玩家
    for (const p of entities.players) {
      const pp = _wc(p.x, p.z);
      ctx.beginPath(); ctx.arc(pp.x, pp.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#44aaff'; ctx.fill();
      ctx.fillStyle = '#88ccff'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(p.name || '?', pp.x, pp.y - 9);
    }

    // 玩家自身
    const selfP = _wc(player.x, player.z);
    ctx.beginPath(); ctx.arc(selfP.x, selfP.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#00ff88'; ctx.fill();
    // 朝向线（viewDir: x=-sin(yaw), z=-cos(yaw)）
    const dirLen = 14;
    const dvx = -Math.sin(player.yaw) * dirLen;
    const dvz = -Math.cos(player.yaw) * dirLen;
    // 朝向在地图上：dx → canvas x，dz → canvas y（z+ = 下）
    ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(selfP.x, selfP.y);
    ctx.lineTo(selfP.x + dvx * W / WX_RANGE, selfP.y + dvz * H / WZ_RANGE);
    ctx.stroke();

    // Tooltip
    if (hoverBoss) {
      const bp = _wc(hoverBoss.x, hoverBoss.z);
      const txt = hoverBoss.dead
        ? hoverBoss.name + ' 已死亡'
        : hoverBoss.name + '  HP ' + hoverBoss.hp + '/' + hoverBoss.maxHp;
      ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
      const tw = ctx.measureText(txt).width;
      const tx = Math.min(bp.x + 10, W - tw - 12);
      const ty = Math.max(bp.y - 24, 20);
      ctx.fillStyle = 'rgba(0,0,0,0.82)';
      ctx.fillRect(tx - 4, ty - 14, tw + 8, 20);
      ctx.fillStyle = '#fff';
      ctx.fillText(txt, tx, ty);
    }
  }

  function _onMapMouseMove(e) {
    if (!mapOpen) return;
    const rect = mapCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    hoverBoss = null;
    for (const b of lastEntities.bosses) {
      const bp = _wc(b.x, b.z);
      if (Math.hypot(mx - bp.x, my - bp.y) <= 10) { hoverBoss = b; break; }
    }
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Minimap = { init, show, toggle, isOpen, update };
})(typeof self !== 'undefined' ? self : globalThis);
