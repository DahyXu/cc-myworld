// js/ui.js — 快捷栏、遮罩模式与在线人数
(function (root) {
  'use strict';
  const Blocks = root.MyWorld.Blocks;
  let slots = [];
  let mobileMode = false;
  function setMobileMode(on) { mobileMode = on; }

  // items: 10 格数组，每格可为 null / {type:'block',id,qty} / {type:'weapon',sub,tier,enh} / {type:'material',...}
  function buildHotbar(atlasCanvas, items) {
    const bar = root.document.getElementById('hotbar');
    bar.innerHTML = '';
    slots = [];
    items.forEach((item, i) => {
      const slot = root.document.createElement('div');
      slot.className = 'slot';
      slot.dataset.slot = i;
      const cv = root.document.createElement('canvas');
      cv.width = 32; cv.height = 32;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      if (item && item.type === 'block') {
        const b = Blocks.BLOCKS[item.id];
        if (b) {
          const t = b.tex.side;
          ctx.drawImage(atlasCanvas,
            (t % Blocks.ATLAS_TILES) * Blocks.TILE_PX,
            Math.floor(t / Blocks.ATLAS_TILES) * Blocks.TILE_PX,
            Blocks.TILE_PX, Blocks.TILE_PX, 0, 0, 32, 32);
          slot.title = b.name;
        }
      } else if (item && item.type === 'weapon') {
        root.MyWorld.Combat.drawIcon(ctx, item.sub);
        const TIER = ['初', '精', '传'];
        slot.title = (item.sub === 'sword' ? '剑' : '弓') + TIER[item.tier - 1] + (item.enh ? '+' + item.enh : '');
      }
      const num = root.document.createElement('span');
      num.textContent = (i + 1) % 10;
      slot.appendChild(cv);
      slot.appendChild(num);
      bar.appendChild(slot);
      slots.push(slot);
    });
    selectSlot(0);
  }

  function selectSlot(i) {
    slots.forEach((s, j) => s.classList.toggle('selected', j === i));
    if (!mobileMode) return;
    // 移动端：显示以 i 为中心的 5 格窗口（windowStart ∈ [0,5]）
    const start = Math.min(Math.max(0, i - 2), 5);
    slots.forEach((s, j) => { s.style.display = (j >= start && j < start + 5) ? '' : 'none'; });
  }

  function showOverlay(show) {
    root.document.getElementById('overlay').style.display = show ? 'flex' : 'none';
  }

  // 遮罩内容模式：connecting | name | start | file | replaced | npc
  let overlayMode = 'connecting';
  function setOverlayMode(mode) {
    overlayMode = mode;
    const ids = { connecting: 'ovConnecting', name: 'ovName', start: 'ovStart', file: 'ovFile', replaced: 'ovReplaced', npc: 'ovNpc' };
    for (const k in ids) {
      root.document.getElementById(ids[k]).style.display = (k === mode ? 'block' : 'none');
    }
    showOverlay(true);
  }
  function getOverlayMode() { return overlayMode; }

  function setOnline(n) {
    root.document.getElementById('online').textContent = '在线 ' + n;
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.UI = { buildHotbar, selectSlot, showOverlay, setOverlayMode, getOverlayMode, setOnline, setMobileMode };
})(typeof self !== 'undefined' ? self : globalThis);
