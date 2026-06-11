// js/net.js — WebSocket 客户端：连接、凭证/昵称、指数退避重连、消息分发
(function (root) {
  'use strict';
  const P = root.MyWorld.Protocol;

  let ws = null, attempt = 0, statusCb = null;
  const handlers = {};

  // localStorage 不可用（隐私模式等）时退化为内存存储：凭证仅本次会话有效
  const mem = {};
  function lsGet(k) {
    let v = null;
    try { v = root.localStorage.getItem(k); } catch {}
    return v != null ? v : (mem[k] != null ? mem[k] : null);
  }
  function lsSet(k, v) { mem[k] = v; try { root.localStorage.setItem(k, v); } catch {} }
  function lsDel(k) { delete mem[k]; try { root.localStorage.removeItem(k); } catch {} }

  // 首次生成随机凭证，进度与之绑定
  function token() {
    let t = lsGet('mw_token');
    if (!t) {
      const buf = new Uint8Array(16);
      root.crypto.getRandomValues(buf);
      t = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
      lsSet('mw_token', t);
    }
    return t;
  }
  function getName() { return lsGet('mw_name') || ''; }
  function setName(n) { lsSet('mw_name', n); }

  function connect() {
    if (root.location.protocol === 'file:') { if (statusCb) statusCb('file'); return; }
    if (statusCb) statusCb('connecting');
    ws = new root.WebSocket(
      (root.location.protocol === 'https:' ? 'wss://' : 'ws://') + root.location.host + '/ws');
    ws.onopen = () => {
      if (statusCb) statusCb('open');
      if (getName()) hello(); // 已有昵称直接握手；否则等 UI 收集后调 hello()
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'welcome') attempt = 0; // 握手成功才清退避计数（open 即清会让握手后被拒变成 1 秒热循环）
      if (msg.t === 'rehello') { hello(); return; } // DO 休眠唤醒：重新握手
      const h = handlers[msg.t];
      if (h) h(msg);
    };
    ws.onclose = (e) => {
      ws = null;
      // 被新连接顶替：不自动重连，否则同浏览器双标签页（共享凭证）会无限互踢
      if (e.code === 4000) { if (statusCb) statusCb('replaced'); return; }
      if (e.code === 4001) lsDel('mw_token'); // 凭证非法：丢弃后重连自愈（下次 hello 生成新凭证）
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
