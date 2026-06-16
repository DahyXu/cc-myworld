// js/hud.js — 战斗 HUD：血条、受击红闪、死亡黑屏、世界空间伤害飘字
(function (root) {
  'use strict';

  const floaters = []; // { el, x, y, z, t }
  let questCollapsed = false;
  let skillBookOpen = false;
  let toastTimer = null;
  let selectedSkillId = null;

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

  function updateSkillBar(skillsState) {
    for (const key of ['Q', 'G', 'R', 'F']) {
      const el = root.document.getElementById('skillSlot' + key);
      if (!el) continue;
      const id = skillsState.getBoundSkill(key);
      const nameEl = el.querySelector('.skillName');
      if (!id) {
        el.classList.add('locked');
        if (nameEl) nameEl.textContent = '—';
        const cd = el.querySelector('.skillCdOverlay');
        if (cd) cd.style.display = 'none';
        continue;
      }
      const sk = skillsState.SKILL_TABLE.find(s => s.id === id);
      if (nameEl && sk) nameEl.textContent = sk.name.slice(0, 2);
      const has = skillsState.hasSkill(id);
      el.classList.toggle('locked', !has);
      const cd = el.querySelector('.skillCdOverlay');
      if (cd) {
        const left = skillsState.cooldownLeft(id);
        if (has && left > 0) { cd.style.display = 'flex'; cd.textContent = Math.ceil(left) + 's'; }
        else cd.style.display = 'none';
      }
    }
  }

  function updateFlightBar(timeLeft, maxTime) {
    const bar = root.document.getElementById('flightBar');
    const fill = root.document.getElementById('flightBarFill');
    if (!bar || !fill) return;
    if (timeLeft <= 0) { bar.style.display = 'none'; return; }
    bar.style.display = 'block';
    fill.style.width = Math.min(100, timeLeft / maxTime * 100) + '%';
    fill.style.background = timeLeft <= 5 ? '#f44' : '#4af';
  }

  function showSkillUnlock(name) {
    const el = root.document.getElementById('skillUnlockToast');
    if (!el) return;
    el.textContent = '新技能解锁：' + name + '！';
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = root.setTimeout(() => { el.style.display = 'none'; }, 3000);
  }

  function getSelectedSkill() { return selectedSkillId; }

  function openSkillBook(level, skillTable, skillsState) {
    const grid = root.document.getElementById('skillGrid');
    if (!grid) return;
    grid.innerHTML = '';
    selectedSkillId = null;
    for (const sk of skillTable) {
      const isUnlocked = level >= sk.unlockLevel;
      const card = root.document.createElement('div');
      card.className = 'skillCard' + (isUnlocked ? ' unlocked' : '');
      const boundKey = (sk.kind === 'active' && skillsState) ? (skillsState.getBoundKey(sk.id) || '—') : null;
      let inner = '<div class="scName">' + sk.name + '</div>' +
        '<div class="scLv">Lv.' + sk.unlockLevel + ' 解锁</div>' +
        '<div class="scDesc">' + sk.description + '</div>';
      if (sk.kind === 'active') inner += '<span class="scKey">' + (boundKey || '—') + '</span>';
      card.innerHTML = inner;
      if (sk.kind === 'active' && isUnlocked) {
        card.addEventListener('click', () => {
          grid.querySelectorAll('.skillCard.selected').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          selectedSkillId = sk.id;
        });
      }
      grid.appendChild(card);
    }
    root.document.getElementById('skillBook').style.display = 'flex';
    skillBookOpen = true;
  }

  function closeSkillBook() {
    const el = root.document.getElementById('skillBook');
    if (el) el.style.display = 'none';
    skillBookOpen = false;
    root.dispatchEvent(new CustomEvent('skillBookClosed'));
  }

  function toggleSkillBook(level, skillTable, skillsState) {
    if (skillBookOpen) closeSkillBook();
    else openSkillBook(level, skillTable, skillsState);
  }

  function isSkillBookOpen() { return skillBookOpen; }

  function initQuestPanel() {
    root.document.getElementById('questPanelTitle').addEventListener('click', toggleQuestPanel);
  }

  function initSkillBook() {
    const closeBtn = root.document.getElementById('skillBookClose');
    if (closeBtn) closeBtn.addEventListener('click', closeSkillBook);
    const panel = root.document.getElementById('skillBook');
    if (panel) panel.addEventListener('click', (e) => {
      if (e.target === panel) closeSkillBook();
    });
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
  initSkillBook();

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Hud = { setHp, flashRed, showDeath, floatDamage, update, setLevel, setXp, setQuest, levelUpFlash, toggleQuestPanel,
    updateSkillBar, updateFlightBar, showSkillUnlock, openSkillBook, closeSkillBook, toggleSkillBook, isSkillBookOpen, getSelectedSkill };
})(typeof self !== 'undefined' ? self : globalThis);
