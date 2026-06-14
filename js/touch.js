// js/touch.js — 移动端触控输入（浮动摇杆 / 视角滑动 / 按钮 / 快捷栏）
(function (root) {
  'use strict';

  const JOYSTICK_RADIUS = 60; // px，摇杆最大偏移半径
  const LOOK_SENS = 0.003;    // rad/px，与桌面 mousemove 系数一致

  // 摇杆状态（浮动：落指位置为圆心）
  const joy = { active: false, id: -1, cx: 0, cy: 0, dx: 0, dy: 0 };
  // 视角滑动状态
  const look = { active: false, id: -1, lx: 0, ly: 0 };
  // 视角增量缓存，由 consumeViewDelta() 每帧取走
  let dyaw = 0, dpitch = 0;
  // 跳跃键状态
  let jumpActive = false;

  // 回调（由 main.js 调用 register* 注册）
  let cbAttack = null, cbPlace = null, cbE = null, cbHotbar = null;

  function isLeftHalf(x) { return x < root.innerWidth / 2; }

  // ── 摇杆视觉更新 ──
  function syncJoystickDOM() {
    const base = root.document.getElementById('joystickBase');
    const knob = root.document.getElementById('joystickKnob');
    if (!joy.active) { base.style.display = 'none'; return; }
    base.style.display = 'block';
    base.style.left = (joy.cx - JOYSTICK_RADIUS) + 'px';
    base.style.top  = (joy.cy - JOYSTICK_RADIUS) + 'px';
    knob.style.transform = 'translate(calc(-50% + ' + joy.dx + 'px), calc(-50% + ' + joy.dy + 'px))';
  }

  // ── Canvas 触控（摇杆 + 视角） ──
  function onTouchStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (isLeftHalf(t.clientX) && !joy.active) {
        joy.active = true; joy.id = t.identifier;
        joy.cx = t.clientX; joy.cy = t.clientY; joy.dx = 0; joy.dy = 0;
        syncJoystickDOM();
      } else if (!isLeftHalf(t.clientX) && !look.active) {
        look.active = true; look.id = t.identifier;
        look.lx = t.clientX; look.ly = t.clientY;
      }
    }
  }

  function onTouchMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) {
        let dx = t.clientX - joy.cx, dy = t.clientY - joy.cy;
        const d = Math.hypot(dx, dy);
        if (d > JOYSTICK_RADIUS) { dx = dx / d * JOYSTICK_RADIUS; dy = dy / d * JOYSTICK_RADIUS; }
        joy.dx = dx; joy.dy = dy;
        syncJoystickDOM();
      } else if (t.identifier === look.id) {
        dyaw   += (t.clientX - look.lx) * LOOK_SENS;
        dpitch += (t.clientY - look.ly) * LOOK_SENS;
        look.lx = t.clientX; look.ly = t.clientY;
      }
    }
  }

  function onTouchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) { joy.active = false; joy.dx = 0; joy.dy = 0; syncJoystickDOM(); }
      else if (t.identifier === look.id) { look.active = false; }
    }
  }

  // ── 公开 API ──

  // 前进/横移归一化向量（均在 [-1,1]）；摇杆向上 → forward 正
  function getMove() {
    if (!joy.active) return { forward: 0, strafe: 0 };
    return { forward: -joy.dy / JOYSTICK_RADIUS, strafe: joy.dx / JOYSTICK_RADIUS };
  }

  // 取走本帧视角增量（消费后清零）
  function consumeViewDelta() {
    const r = { dyaw, dpitch }; dyaw = 0; dpitch = 0; return r;
  }

  function getJump() { return jumpActive; }

  // NPC 对话按钮显隐
  function setNpcVisible(visible) {
    root.document.getElementById('btnE').style.display = visible ? 'flex' : 'none';
  }

  // 回调注册
  function registerAttack(fn) { cbAttack = fn; }
  function registerPlace(fn)  { cbPlace  = fn; }
  function registerE(fn)      { cbE      = fn; }
  function registerHotbar(fn) { cbHotbar = fn; }

  // ── 初始化（isMobile 确认后调用）──
  function init() {
    const canvas = root.document.querySelector('canvas');
    canvas.style.touchAction = 'none'; // 禁止浏览器默认手势（滚动/缩放）抢占触摸事件
    canvas.addEventListener('touchstart',  onTouchStart, { passive: false });
    canvas.addEventListener('touchmove',   onTouchMove,  { passive: false });
    canvas.addEventListener('touchend',    onTouchEnd,   { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd,   { passive: false });

    // 操作按钮
    root.document.getElementById('btnAttack').addEventListener('touchstart', (e) => {
      e.preventDefault(); if (cbAttack) cbAttack();
    }, { passive: false });

    root.document.getElementById('btnPlace').addEventListener('touchstart', (e) => {
      e.preventDefault(); if (cbPlace) cbPlace();
    }, { passive: false });

    root.document.getElementById('btnJump').addEventListener('touchstart', (e) => {
      e.preventDefault(); jumpActive = true;
    }, { passive: false });
    root.document.getElementById('btnJump').addEventListener('touchend',   () => { jumpActive = false; });
    root.document.getElementById('btnJump').addEventListener('touchcancel',() => { jumpActive = false; });

    root.document.getElementById('btnE').addEventListener('touchstart', (e) => {
      e.preventDefault(); if (cbE) cbE();
    }, { passive: false });

    // 快捷栏箭头
    root.document.getElementById('hotbarPrev').addEventListener('touchstart', (e) => {
      e.preventDefault(); if (cbHotbar) cbHotbar(-1);
    }, { passive: false });
    root.document.getElementById('hotbarNext').addEventListener('touchstart', (e) => {
      e.preventDefault(); if (cbHotbar) cbHotbar(1);
    }, { passive: false });

    // 快捷栏：统一在 hotbarWrap 处理（tap=选格，swipe>40px=切格）
    let hbId = -1, hbStartX = 0, hbLastX = 0, hbStartTarget = null;
    const hw = root.document.getElementById('hotbarWrap');
    hw.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      const t = e.changedTouches[0];
      hbId = t.identifier; hbStartX = hbLastX = t.clientX;
      hbStartTarget = t.target.closest('[data-slot]');
    }, { passive: false });
    hw.addEventListener('touchmove', (e) => {
      e.preventDefault(); e.stopPropagation();
      for (const t of e.changedTouches) {
        if (t.identifier !== hbId) continue;
        const dx = t.clientX - hbLastX;
        if (Math.abs(t.clientX - hbStartX) > 40) {
          if (cbHotbar) cbHotbar(dx < 0 ? 1 : -1);
          hbStartX = hbLastX = t.clientX; // 重置防连发
        } else { hbLastX = t.clientX; }
      }
    }, { passive: false });
    hw.addEventListener('touchend', (e) => {
      e.preventDefault(); e.stopPropagation();
      for (const t of e.changedTouches) {
        if (t.identifier !== hbId) continue;
        // 总位移 < 10px 视为点击某格
        if (Math.abs(t.clientX - hbStartX) < 10 && hbStartTarget) {
          if (cbHotbar) cbHotbar('select', parseInt(hbStartTarget.dataset.slot));
        }
        hbId = -1;
      }
    }, { passive: false });
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Touch = { init, getMove, consumeViewDelta, getJump, setNpcVisible,
    registerAttack, registerPlace, registerE, registerHotbar };
})(typeof self !== 'undefined' ? self : globalThis);
