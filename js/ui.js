// js/ui.js — 快捷栏与遮罩
(function (root) {
  'use strict';
  const Blocks = root.MyWorld.Blocks;
  let slots = [];

  function buildHotbar(atlasCanvas) {
    const bar = root.document.getElementById('hotbar');
    bar.innerHTML = '';
    slots = [];
    Blocks.HOTBAR.forEach((id, i) => {
      const slot = root.document.createElement('div');
      slot.className = 'slot';
      const cv = root.document.createElement('canvas');
      cv.width = 32; cv.height = 32;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      const t = Blocks.BLOCKS[id].tex.side;
      const sx = (t % Blocks.ATLAS_TILES) * Blocks.TILE_PX;
      const sy = Math.floor(t / Blocks.ATLAS_TILES) * Blocks.TILE_PX;
      ctx.drawImage(atlasCanvas, sx, sy, Blocks.TILE_PX, Blocks.TILE_PX, 0, 0, 32, 32);
      const num = root.document.createElement('span');
      num.textContent = i + 1;
      slot.appendChild(cv);
      slot.appendChild(num);
      slot.title = Blocks.BLOCKS[id].name;
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

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.UI = { buildHotbar, selectSlot, showOverlay };
})(typeof self !== 'undefined' ? self : globalThis);
