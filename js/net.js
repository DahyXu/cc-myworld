// js/net.js — WebSocket 客户端：连接、凭证/昵称、指数退避重连、消息分发
(function (root) {
  'use strict';
  const P = root.MyWorld.Protocol;

  let ws = null, attempt = 0, statusCb = null;
  const handlers = {};

  // 首次生成随机凭证存 localStorage，进度与之绑定
  function token() {
    let t = root.localStorage.getItem('mw_token');
    if (!t) {
      const buf = new Uint8Array(16);
      root.crypto.getRandomValues(buf);
      t = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
      root.localStorage.setItem('mw_token', t);
    }
    return t;
  }
  function getName() { return root.localStorage.getItem('mw_name') || ''; }
  function setName(n) { root.localStorage.setItem('mw_name', n); }

  function connect() {
    if (root.location.protocol === 'file:') { if (statusCb) statusCb('file'); return; }
    if (statusCb) statusCb('connecting');
    ws = new root.WebSocket(
      (root.location.protocol === 'https:' ? 'wss://' : 'ws://') + root.location.host + '/ws');
    ws.onopen = () => {
      attempt = 0;
      if (statusCb) statusCb('open');
      if (getName()) hello(); // 已有昵称直接握手；否则等 UI 收集后调 hello()
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'rehello') { hello(); return; } // DO 休眠唤醒：重新握手
      const h = handlers[msg.t];
      if (h) h(msg);
    };
    ws.onclose = () => {
      ws = null;
      if (statusCb) statusCb('closed');
      root.setTimeout(connect, P.backoffMs(attempt++));
    };
  }

  function hello() { send({ t: 'hello', token: token(), name: getName() }); }
  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  function on(type, fn) { handlers[type] = fn; }
  function onStatus(fn) { statusCb = fn; }
  function connected() { return !!ws && ws.readyState === 1; }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Net = { connect, hello, send, on, onStatus, connected, getName, setName };
})(typeof self !== 'undefined' ? self : globalThis);
