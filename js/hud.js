// js/hud.js — 战斗 HUD：血条、受击红闪、死亡黑屏、世界空间伤害飘字
(function (root) {
  'use strict';

  const floaters = []; // { el, x, y, z, t }

  function setHp(hp, max) {
    const fill = root.document.getElementById('hpFill');
    const text = root.document.getElementById('hpText');
    fill.style.width = Math.max(0, Math.round(hp / max * 100)) + '%';
    text.textContent = hp + ' / ' + max;
  }

  function flashRed() {
    const el = root.document.getElementById('redflash');
    el.style.opacity = '0.45';
    root.setTimeout(() => { el.style.opacity = '0'; }, 120);
  }

  function showDeath(show) {
    root.document.getElementById('deathOverlay').style.display = show ? 'flex' : 'none';
  }

  function setLevel(level) {
    root.document.getElementById('lvBadge').textContent = 'Lv.' + level;
  }

  // xpNext=0 表示满级 → 经验条满格
  function setXp(xp, level, xpNext) {
    setLevel(level);
    const pct = xpNext > 0 ? Math.max(0, Math.min(100, Math.round(xp / xpNext * 100))) : 100;
    root.document.getElementById('xpFill').style.width = pct + '%';
  }

  // quest 为 { type, count, progress }（type 为怪种 key）或 null
  function setQuest(quest) {
    const el = root.document.getElementById('questTrack');
    if (!quest) { el.style.display = 'none'; return; }
    const name = root.MyWorld.MobsDef.TYPES[quest.type].name;
    const done = quest.progress >= quest.count;
    el.textContent = '击杀 ' + name + ' ' + Math.min(quest.progress, quest.count) + '/' + quest.count + (done ? '（回长老交付）' : '');
    el.classList.toggle('done', done);
    el.style.display = 'block';
  }

  function levelUpFlash() {
    const el = root.document.getElementById('levelFlash');
    el.style.opacity = '0.9';
    root.setTimeout(() => { el.style.opacity = '0'; }, 500);
  }

  // 世界空间伤害飘字（每帧由 update 投影到屏幕）
  function floatDamage(x, y, z, text, color) {
    const el = root.document.createElement('div');
    el.className = 'floater';
    el.textContent = text;
    el.style.color = color || '#ffd24a';
    root.document.getElementById('floaters').appendChild(el);
    floaters.push({ el, x, y, z, t: 1 });
  }

  function update(dt, camera) {
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.t -= dt;
      f.y += dt * 1.2; // 上飘
      if (f.t <= 0) { f.el.remove(); floaters.splice(i, 1); continue; }
      const p = new root.THREE.Vector3(f.x, f.y, f.z).project(camera);
      if (p.z > 1) { f.el.style.display = 'none'; continue; }
      f.el.style.display = 'block';
      f.el.style.opacity = String(Math.min(1, f.t * 2));
      f.el.style.left = ((p.x + 1) / 2 * root.innerWidth) + 'px';
      f.el.style.top = ((1 - (p.y + 1) / 2) * root.innerHeight) + 'px';
    }
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Hud = { setHp, flashRed, showDeath, floatDamage, update, setLevel, setXp, setQuest, levelUpFlash };
})(typeof self !== 'undefined' ? self : globalThis);
