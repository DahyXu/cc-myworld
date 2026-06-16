// js/hud.js — 战斗 HUD：血条、受击红闪、死亡黑屏、世界空间伤害飘字
(function (root) {
  'use strict';

  const floaters = []; // { el, x, y, z, t }
  let questCollapsed = false;

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

  const MATS = { slime_gel: '史莱姆凝胶', zombie_rags: '僵尸破布', skeleton_bone: '骷髅骨头', wolf_fang: '狼牙' };

  function questDesc(quest) {
    const MobsDef = root.MyWorld.MobsDef;
    switch (quest.questKind) {
      case 'kill':
        return '前往野外击杀 ' + quest.count + ' 只' + (MobsDef.TYPES[quest.type]?.name || quest.type);
      case 'collect':
        return '收集 ' + quest.count + ' 个' + (MATS[quest.type] || quest.type);
      case 'boss':
        return '讨伐 ' + (MobsDef.TYPES[quest.type]?.name || quest.type);
      case 'explore':
        return '从出生点向外探索 ' + quest.count + ' 格';
      default:
        return '';
    }
  }

  function questRewardText(quest) {
    const TIER = ['', '一', '二', '三'];
    const SUB  = { sword: '剑', bow: '弓' };
    let s = (quest.xpReward || 0) + ' XP';
    if (quest.coins > 0) s += ' · ' + quest.coins + ' 金';
    if (quest.item) s += '\n+' + (TIER[quest.item.tier] || '') + '阶' + (SUB[quest.item.sub] || quest.item.sub);
    return s;
  }

  function setQuest(quest) {
    const panel = root.document.getElementById('questPanel');
    if (!quest) { panel.style.display = 'none'; return; }

    const done = quest.progress >= quest.count;
    panel.style.display = 'block';
    panel.classList.toggle('done', done);

    root.document.getElementById('questPanelDesc').textContent =
      done ? '回长老交付任务' : questDesc(quest);

    const pct = Math.min(quest.progress / quest.count, 1) * 100;
    root.document.getElementById('questPanelBar').style.width = pct + '%';
    root.document.getElementById('questPanelCount').textContent =
      Math.min(quest.progress, quest.count) + ' / ' + quest.count;

    root.document.getElementById('questPanelReward').textContent =
      '奖励：' + questRewardText(quest);
  }

  function levelUpFlash() {
    const el = root.document.getElementById('levelFlash');
    el.style.opacity = '0.9';
    root.setTimeout(() => { el.style.opacity = '0'; }, 500);
  }

  function toggleQuestPanel() {
    questCollapsed = !questCollapsed;
    root.document.getElementById('questPanel').classList.toggle('collapsed', questCollapsed);
    root.document.getElementById('questPanelArrow').textContent = questCollapsed ? '▸' : '▾';
  }

  function initQuestPanel() {
    root.document.getElementById('questPanelTitle').addEventListener('click', toggleQuestPanel);
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

  initQuestPanel();

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Hud = { setHp, flashRed, showDeath, floatDamage, update, setLevel, setXp, setQuest, levelUpFlash, toggleQuestPanel };
})(typeof self !== 'undefined' ? self : globalThis);
