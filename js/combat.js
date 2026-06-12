// js/combat.js — 客户端战斗：快捷栏物品表、武器图标、手持模型与挥击、攻击/射箭意图
(function (root) {
  'use strict';
  const P = root.MyWorld.Protocol;
  const Physics = root.MyWorld.Physics;

  // 快捷栏 10 格：1 剑、2 弓、3~9/0 方块（数字键 0 对应第 10 格）
  const ITEMS = [
    { kind: 'sword', name: '剑' },
    { kind: 'bow', name: '弓' },
    { kind: 'block', id: 1 }, { kind: 'block', id: 2 }, { kind: 'block', id: 3 }, { kind: 'block', id: 4 },
    { kind: 'block', id: 5 }, { kind: 'block', id: 6 }, { kind: 'block', id: 7 }, { kind: 'block', id: 8 },
  ];

  // 32×32 像素武器图标（程序化绘制，零素材）
  function drawIcon(ctx, kind) {
    ctx.clearRect(0, 0, 32, 32);
    ctx.imageSmoothingEnabled = false;
    if (kind === 'sword') {
      ctx.fillStyle = '#cfd8e3'; // 剑身：斜 45°
      for (let i = 0; i < 16; i++) ctx.fillRect(8 + i, 22 - i, 3, 3);
      ctx.fillStyle = '#8a5a2b'; // 护手与柄
      ctx.fillRect(7, 19, 9, 3);
      ctx.fillRect(5, 24, 5, 5);
    } else {
      ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 3; // 弓臂
      ctx.beginPath(); ctx.arc(12, 16, 10, -Math.PI / 2.6, Math.PI / 2.6); ctx.stroke();
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1; // 弦
      ctx.beginPath(); ctx.moveTo(15, 7); ctx.lineTo(15, 25); ctx.stroke();
      ctx.fillStyle = '#cfd8e3'; ctx.fillRect(15, 15, 12, 2); // 箭
    }
  }

  // —— 手持模型（挂在相机上）——
  let held = null, heldSword = null, heldBow = null;
  let swingT = 0; // 0=收回，>0 挥击中（秒）

  function box(w, h, d, color) {
    return new root.THREE.Mesh(new root.THREE.BoxGeometry(w, h, d), new root.THREE.MeshBasicMaterial({ color }));
  }

  function init(camera) {
    held = new root.THREE.Group();
    heldSword = new root.THREE.Group();
    const blade = box(0.06, 0.5, 0.06, 0xcfd8e3); blade.position.y = 0.32;
    const guard = box(0.18, 0.05, 0.08, 0x8a5a2b); guard.position.y = 0.06;
    const grip = box(0.07, 0.16, 0.07, 0x6b4a2a); grip.position.y = -0.06;
    heldSword.add(blade, guard, grip);
    heldBow = new root.THREE.Group();
    const top = box(0.05, 0.3, 0.05, 0x8a5a2b); top.position.y = 0.18; top.rotation.z = 0.4;
    const mid = box(0.05, 0.2, 0.05, 0x8a5a2b);
    const bot = box(0.05, 0.3, 0.05, 0x8a5a2b); bot.position.y = -0.18; bot.rotation.z = -0.4;
    heldBow.add(top, mid, bot);
    held.add(heldSword, heldBow);
    held.scale.set(0.45, 0.45, 0.45); // 近距视角下整体缩小，避免手持物占据过多视野
    held.position.set(0.38, -0.3, -0.6);
    held.rotation.set(-0.2, 0.3, 0);
    camera.add(held);
    setHeld(0);
  }

  function setHeld(itemIndex) {
    const kind = ITEMS[itemIndex].kind;
    heldSword.visible = kind === 'sword';
    heldBow.visible = kind === 'bow';
  }

  function swing() { swingT = 0.18; }

  function update(dt) {
    if (!held) return;
    if (swingT > 0) {
      swingT = Math.max(0, swingT - dt);
      const f = swingT / 0.18; // 1→0
      held.rotation.x = -0.2 - Math.sin(f * Math.PI) * 0.9;
    } else {
      held.rotation.x = -0.2;
    }
  }

  // —— 攻击意图 ——
  let meleeReadyAt = 0, bowReadyAt = 0;

  // 视线选怪：对每只怪做线段-AABB 相交，取最近者
  function pickMob(eye, dir, mobList) {
    const ex = eye.x + dir.x * P.MELEE_RANGE, ey = eye.y + dir.y * P.MELEE_RANGE, ez = eye.z + dir.z * P.MELEE_RANGE;
    let best = null, bd = Infinity;
    for (const m of mobList) {
      if (Physics.segmentHitsBox(eye.x, eye.y, eye.z, ex, ey, ez, m)) {
        // 距离按怪物中心算（脚底点在高矮怪混战时会排错最近者）
        const d = Math.hypot(m.x - eye.x, m.y + m.height / 2 - eye.y, m.z - eye.z);
        if (d < bd) { bd = d; best = m; }
      }
    }
    return best;
  }

  // 返回 true 表示本次点击已被战斗消费（main 据此跳过挖放逻辑）
  function onAttackClick(itemIndex, eye, dir, mobList, net) {
    const kind = ITEMS[itemIndex].kind;
    const now = Date.now();
    if (kind === 'sword') {
      if (now >= meleeReadyAt) {
        meleeReadyAt = now + P.MELEE_CD_MS;
        swing();
        const target = pickMob(eye, dir, mobList);
        if (target) net.send({ t: 'attack', id: target.id });
      }
      return true;
    }
    if (kind === 'bow') {
      if (now >= bowReadyAt) {
        bowReadyAt = now + P.BOW_CD_MS;
        swing();
        net.send({ t: 'shoot', dx: dir.x, dy: dir.y, dz: dir.z });
        return 'shoot'; // main 据此做本地箭预表现
      }
      return true;
    }
    return false; // 方块：交回 main 的挖放逻辑
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Combat = { ITEMS, drawIcon, init, setHeld, swing, update, onAttackClick, pickMob };
})(typeof self !== 'undefined' ? self : globalThis);
