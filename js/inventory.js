// js/inventory.js — 背包：状态管理、UI 面板、拖拽（桌面）、点选（移动端）、商店、强化
(function (root) {
  'use strict';
  const ItemsDef = root.MyWorld.ItemsDef;

  const INV_SLOTS = 40; // 0-29 背包, 30-39 快捷栏
  let inv = new Array(INV_SLOTS).fill(null);
  let coins = 0;
  let atlasCanvas = null;
  let netRef = null;
  let panelOpen = false;
  let selectedSlot = -1;
  let dragFrom = -1;

  // ── 公开 API ──

  function getHotbarItem(i) { return inv[30 + i] || null; }
  function getHotbarItems() { return inv.slice(30); }
  function isPanelOpen() { return panelOpen; }

  // ── 消息处理 ──

  function applyInvState(msg) {
    coins = typeof msg.coins === 'number' ? msg.coins : 0;
    inv = new Array(INV_SLOTS).fill(null);
    if (Array.isArray(msg.slots)) {
      msg.slots.forEach((item, i) => { if (i < INV_SLOTS) inv[i] = item || null; });
    }
    refreshHotbar();
    if (panelOpen) { renderAllSlots(); updateCoinsDisplay(); }
  }

  function applyInvDelta(msg) {
    if (typeof msg.coins === 'number') { coins = msg.coins; if (panelOpen) updateCoinsDisplay(); }
    if (Array.isArray(msg.changes)) {
      for (const ch of msg.changes) {
        if (ch.slot >= 0 && ch.slot < INV_SLOTS) {
          inv[ch.slot] = ch.item || null;
          if (panelOpen) renderSlot(ch.slot);
        }
      }
      refreshHotbar();
    }
  }

  // ── 面板开关 ──

  function togglePanel() { panelOpen ? closePanel() : openPanel(); }

  function openPanel() {
    panelOpen = true; selectedSlot = -1;
    root.document.getElementById('invPanel').style.display = 'block';
    renderAllSlots();
    updateCoinsDisplay();
    hideSubPanels();
  }

  function closePanel() {
    panelOpen = false;
    root.document.getElementById('invPanel').style.display = 'none';
    if (dragFrom >= 0) {
      dragFrom = -1;
      root.document.getElementById('invGhost').style.display = 'none';
    }
    hideSubPanels();
    root.dispatchEvent(new CustomEvent('invClosed'));
  }

  function hideSubPanels() {
    root.document.getElementById('shopPanel').style.display = 'none';
    root.document.getElementById('enhPanel').style.display = 'none';
  }

  // ── 渲染 ──

  function updateCoinsDisplay() {
    const el = root.document.getElementById('invCoins');
    if (el) el.textContent = '金币: ' + coins;
  }

  const MAT_COLORS = { slime_gel: '#7ec850', zombie_rags: '#a07850', skeleton_bone: '#e8e8d0', wolf_fang: '#f0a030' };
  const MAT_LABELS = { slime_gel: '粘', zombie_rags: '布', skeleton_bone: '骨', wolf_fang: '牙' };

  function drawItemOnCtx(ctx, item) {
    const Blocks = root.MyWorld.Blocks;
    ctx.clearRect(0, 0, 32, 32);
    if (!item || !atlasCanvas) return;
    ctx.imageSmoothingEnabled = false;
    if (item.type === 'block') {
      const b = Blocks.BLOCKS[item.id];
      if (!b) return;
      const t = b.tex.side;
      ctx.drawImage(atlasCanvas,
        (t % Blocks.ATLAS_TILES) * Blocks.TILE_PX,
        Math.floor(t / Blocks.ATLAS_TILES) * Blocks.TILE_PX,
        Blocks.TILE_PX, Blocks.TILE_PX, 0, 0, 32, 32);
    } else if (item.type === 'material') {
      ctx.fillStyle = MAT_COLORS[item.sub] || '#aaa';
      ctx.beginPath(); ctx.arc(16, 16, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000'; ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(MAT_LABELS[item.sub] || '?', 16, 16);
    } else if (item.type === 'weapon') {
      root.MyWorld.Combat.drawIcon(ctx, item.sub);
    }
  }

  function renderSlot(idx) {
    const el = root.document.querySelector('[data-inv-slot="' + idx + '"]');
    if (!el) return;
    const item = inv[idx];
    let cv = el.querySelector('canvas');
    if (!cv) { cv = root.document.createElement('canvas'); cv.width = 32; cv.height = 32; el.appendChild(cv); }
    drawItemOnCtx(cv.getContext('2d'), item);

    let qtyEl = el.querySelector('.inv-qty');
    if (!qtyEl) { qtyEl = root.document.createElement('span'); qtyEl.className = 'inv-qty'; el.appendChild(qtyEl); }
    qtyEl.textContent = (item && item.qty > 1) ? item.qty : '';

    let tierEl = el.querySelector('.inv-tier');
    if (!tierEl) { tierEl = root.document.createElement('span'); tierEl.className = 'inv-tier'; el.appendChild(tierEl); }
    tierEl.textContent = (item && item.type === 'weapon') ? 'T' + item.tier + (item.enh > 0 ? '+' + item.enh : '') : '';

    el.classList.toggle('selected', idx === selectedSlot);
  }

  function renderAllSlots() { for (let i = 0; i < INV_SLOTS; i++) renderSlot(i); }

  // ── 快捷栏同步 ──

  function refreshHotbar() {
    const UI = root.MyWorld.UI;
    if (UI && atlasCanvas) UI.buildHotbar(atlasCanvas, getHotbarItems());
  }

  // ── 格子移动 ──

  function canStack(a, b) {
    if (!a || !b || a.type !== b.type || a.type === 'weapon') return false;
    return a.type === 'block' ? a.id === b.id : a.sub === b.sub;
  }

  function doMove(from, to) {
    if (from === to) return;
    const a = inv[from], b = inv[to];
    if (a && b && canStack(a, b)) {
      const transfer = Math.min(64 - (b.qty || 1), a.qty || 1);
      if (transfer > 0) {
        b.qty = (b.qty || 1) + transfer;
        a.qty = (a.qty || 1) - transfer;
        if (a.qty <= 0) inv[from] = null;
      } else { inv[from] = b; inv[to] = a; }
    } else { inv[from] = b; inv[to] = a; }
    renderSlot(from); renderSlot(to);
    if (from >= 30 || to >= 30) refreshHotbar();
    netRef.send({ t: 'inv_arrange', slots: inv.map(it => it || null) });
  }

  // ── 桌面拖拽 ──

  function onSlotMouseDown(e, idx) {
    if (e.button !== 0 || !inv[idx]) return;
    e.preventDefault();
    dragFrom = idx;
    const ghost = root.document.getElementById('invGhost');
    ghost.innerHTML = '';
    const cv = root.document.createElement('canvas'); cv.width = 32; cv.height = 32;
    drawItemOnCtx(cv.getContext('2d'), inv[idx]);
    ghost.appendChild(cv);
    ghost.style.display = 'block';
    ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
  }

  // ── 移动端点选 ──

  function onSlotClick(idx) {
    if (root.document.getElementById('enhPanel').style.display !== 'none') {
      selectWeaponForEnh(idx); return;
    }
    if (!root.document.body.classList.contains('mobile')) return;
    if (selectedSlot < 0) {
      if (!inv[idx]) return;
      selectedSlot = idx; renderSlot(idx);
    } else if (selectedSlot === idx) {
      selectedSlot = -1; renderSlot(idx);
    } else {
      const prev = selectedSlot; selectedSlot = -1;
      doMove(prev, idx);
      renderSlot(prev);
    }
  }

  // ── 商店 ──

  function openShop() {
    hideSubPanels();
    root.document.getElementById('shopPanel').style.display = 'block';
    const TIER_NAME = ['初级', '精良', '传说'];
    const SUB_NAME  = { sword: '剑', bow: '弓' };
    const buyEl = root.document.getElementById('shopBuy');
    buyEl.innerHTML = '<strong>购买</strong>';
    for (const entry of ItemsDef.SHOP_BUY) {
      const row = root.document.createElement('div'); row.className = 'shop-item';
      const lbl = root.document.createElement('span');
      lbl.textContent = TIER_NAME[entry.tier - 1] + SUB_NAME[entry.sub] + '  ' + entry.price + ' 金';
      const btn = root.document.createElement('button');
      btn.textContent = '购买'; btn.disabled = coins < entry.price;
      btn.onclick = () => { netRef.send({ t: 'buy', sub: entry.sub, tier: entry.tier }); hideSubPanels(); };
      row.appendChild(lbl); row.appendChild(btn); buyEl.appendChild(row);
    }
    const MAT_NAME = { slime_gel: '粘液凝胶', zombie_rags: '僵尸破布', skeleton_bone: '骷髅骨', wolf_fang: '狼牙' };
    const sellEl = root.document.getElementById('shopSell');
    sellEl.innerHTML = '<strong style="margin-top:8px;display:block">出售</strong>';
    let hasAny = false;
    for (const [sub, price] of Object.entries(ItemsDef.SHOP_SELL)) {
      let total = 0;
      for (const it of inv) if (it && it.type === 'material' && it.sub === sub) total += (it.qty || 1);
      if (!total) continue;
      hasAny = true;
      const row = root.document.createElement('div'); row.className = 'shop-item';
      const lbl = root.document.createElement('span');
      lbl.textContent = MAT_NAME[sub] + ' ×' + total + '  @' + price + ' 金';
      const btn = root.document.createElement('button');
      btn.textContent = '全卖';
      btn.onclick = () => { netRef.send({ t: 'sell', sub, qty: total }); hideSubPanels(); };
      row.appendChild(lbl); row.appendChild(btn); sellEl.appendChild(row);
    }
    if (!hasAny) {
      const p = root.document.createElement('p');
      p.textContent = '暂无可出售材料'; p.style.color = '#888'; p.style.fontSize = '12px';
      sellEl.appendChild(p);
    }
  }

  // ── 强化 ──

  let enhSlot = -1;

  function openEnhance() {
    hideSubPanels();
    root.document.getElementById('enhPanel').style.display = 'block';
    enhSlot = -1;
    root.document.getElementById('enhInfo').textContent = '点击背包或快捷栏中的武器';
    root.document.getElementById('enhReq').textContent = '';
    root.document.getElementById('enhDoBtn').disabled = true;
  }

  function selectWeaponForEnh(idx) {
    const item = inv[idx];
    if (!item || item.type !== 'weapon') return;
    enhSlot = idx;
    const TIER_NAME = ['初级', '精良', '传说'];
    const SUB_NAME  = { sword: '剑', bow: '弓' };
    const MAT_NAME  = { wolf_fang: '狼牙', skeleton_bone: '骷髅骨' };
    const RATE_TEXT = ['', '100%', '80%', '50%'];
    if (item.enh >= 3) {
      root.document.getElementById('enhInfo').textContent =
        TIER_NAME[item.tier - 1] + SUB_NAME[item.sub] + ' 已达 +3 满级';
      root.document.getElementById('enhReq').textContent = '';
      root.document.getElementById('enhDoBtn').disabled = true;
      return;
    }
    const nextEnh = item.enh + 1;
    const matSub  = ItemsDef.ENH_MATERIAL[item.sub];
    const cost    = ItemsDef.ENH_COST[nextEnh];
    let have = 0;
    for (const it of inv) if (it && it.type === 'material' && it.sub === matSub) have += (it.qty || 1);
    root.document.getElementById('enhInfo').textContent =
      TIER_NAME[item.tier - 1] + SUB_NAME[item.sub] + ' (+' + item.enh + ' → +' + nextEnh + ')';
    root.document.getElementById('enhReq').textContent =
      '需要 ' + MAT_NAME[matSub] + ' ×' + cost + '（拥有 ' + have + '）  成功率 ' + RATE_TEXT[nextEnh];
    const btn = root.document.getElementById('enhDoBtn');
    btn.disabled = have < cost;
    btn.onclick = () => { netRef.send({ t: 'enhance', slot: enhSlot }); hideSubPanels(); };
  }

  // ── 初始化 ──

  function init(net, atlas) {
    netRef = net; atlasCanvas = atlas;

    const grid  = root.document.getElementById('invGrid');
    const hbRow = root.document.getElementById('invHbRow');
    for (let i = 0; i < INV_SLOTS; i++) {
      const el = root.document.createElement('div');
      el.className = 'inv-slot'; el.dataset.invSlot = i;
      el.addEventListener('mousedown', (e) => onSlotMouseDown(e, i));
      el.addEventListener('click', () => onSlotClick(i));
      (i < 30 ? grid : hbRow).appendChild(el);
    }

    root.document.addEventListener('mousemove', (e) => {
      if (dragFrom < 0) return;
      const ghost = root.document.getElementById('invGhost');
      ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
    });
    root.document.addEventListener('mouseup', (e) => {
      if (dragFrom < 0) return;
      const fromIdx = dragFrom; dragFrom = -1;
      root.document.getElementById('invGhost').style.display = 'none';
      const el = root.document.elementFromPoint(e.clientX, e.clientY);
      const target = el && el.closest('[data-inv-slot]');
      if (target) doMove(fromIdx, parseInt(target.dataset.invSlot, 10));
    });

    root.document.getElementById('invClose').addEventListener('click',  () => closePanel());
    root.document.getElementById('invBg').addEventListener('click',     () => closePanel());
    root.document.getElementById('invShopBtn').addEventListener('click', () => openShop());
    root.document.getElementById('invEnhBtn').addEventListener('click',  () => openEnhance());
    root.document.getElementById('shopClose').addEventListener('click',  () => hideSubPanels());
    root.document.getElementById('enhClose').addEventListener('click',   () => hideSubPanels());

    const bagBtn = root.document.getElementById('btnBag');
    if (bagBtn) bagBtn.addEventListener('touchstart', (e) => { e.preventDefault(); togglePanel(); }, { passive: false });
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Inventory = {
    init, getHotbarItem, getHotbarItems, isPanelOpen,
    applyInvState, applyInvDelta, togglePanel, openPanel, closePanel,
  };
})(typeof self !== 'undefined' ? self : globalThis);
