// js/ui.js — 快捷栏、遮罩模式与在线人数
(function (root) {
  'use strict';
  const Blocks = root.MyWorld.Blocks;
  let slots = [];

  // items: Combat.ITEMS（10 格：剑/弓/8 种方块）；数字标签 1~9,0
  function buildHotbar(atlasCanvas, items) {
    const bar = root.document.getElementById('hotbar');
    bar.innerHTML = '';
    slots = [];
    items.forEach((item, i) => {
      const slot = root.document.createElement('div');
      slot.className = 'slot';
      const cv = root.document.createElement('canvas');
      cv.width = 32; cv.height = 32;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      if (item.kind === 'block') {
        const t = Blocks.BLOCKS[item.id].tex.side;
        const sx = (t % Blocks.ATLAS_TILES) * Blocks.TILE_PX;
        const sy = Math.floor(t / Blocks.ATLAS_TILES) * Blocks.TILE_PX;
        ctx.drawImage(atlasCanvas, sx, sy, Blocks.TILE_PX, Blocks.TILE_PX, 0, 0, 32, 32);
        slot.title = Blocks.BLOCKS[item.id].name;
      } else {
        root.MyWorld.Combat.drawIcon(ctx, item.kind);
        slot.title = item.name;
      }
      const num = root.document.createElement('span');
      num.textContent = (i + 1) % 10; // 第 10 格显示 0
      slot.appendChild(cv);
      slot.appendChild(num);
      bar.appendChild(slot);
      slots.push(slot);
    });
    selectSlot(0);
  }

  function selectSlot(i) {
    slots.forEach((s, j) => s.classList.toggle('selected', j === i));
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
  root.MyWorld.UI = { buildHotbar, selectSlot, showOverlay, setOverlayMode, getOverlayMode, setOnline };
})(typeof self !== 'undefined' ? self : globalThis);
