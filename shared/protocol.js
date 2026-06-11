// shared/protocol.js — 两端共享：协议常量与纯校验函数
(function (root) {
  'use strict';

  const INTEREST_CHUNKS = 4;         // 实体兴趣半径（区块，Chebyshev）
  const REACH = 6;                   // 挖放射程（与客户端一致）
  const REACH_SLACK = 2;             // 服务器校验余量（位置上报有滞后）
  const MAX_HSPEED = 9;              // 水平限速 m/s（步行 4.5 的 2 倍余量）
  const MAX_VSPEED = 45;             // 垂直限速 m/s（最大坠落 40 + 余量）
  const MOVE_INTERVAL_MS = 100;      // 客户端位置上报周期
  const PERSIST_INTERVAL_MS = 30000; // 在线进度周期落盘
  const RECONNECT_BASE_MS = 1000, RECONNECT_MAX_MS = 15000;
  const VALID_BLOCK_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

  // 区块尺寸 16 与 World.CHUNK_X 一致（protocol 不依赖 world，避免加载顺序耦合）
  function chunkOf(v) { return Math.floor(v / 16); }

  // 两个世界坐标是否在彼此兴趣半径内
  function inInterest(ax, az, bx, bz) {
    return Math.max(Math.abs(chunkOf(ax) - chunkOf(bx)),
                    Math.abs(chunkOf(az) - chunkOf(bz))) <= INTEREST_CHUNKS;
  }

  // 编辑消息校验：结构、方块 id、y 范围、与玩家视点距离
  function validEdit(msg, px, py, pz, chunkY) {
    if (!msg || !Number.isInteger(msg.x) || !Number.isInteger(msg.y) || !Number.isInteger(msg.z)) return false;
    if (!Number.isInteger(msg.id) || VALID_BLOCK_IDS.indexOf(msg.id) === -1) return false;
    if (msg.y < 0 || msg.y >= chunkY) return false;
    const dx = msg.x + 0.5 - px, dy = msg.y + 0.5 - py, dz = msg.z + 0.5 - pz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) <= REACH + REACH_SLACK;
  }

  // 移动限速：返回服务器采纳的位置；超速/非法则 ok=false 并保留原位（拉回）
  function clampMove(prev, msg, dtMs) {
    if (!msg || !isFinite(msg.x) || !isFinite(msg.y) || !isFinite(msg.z)) {
      return { ok: false, x: prev.x, y: prev.y, z: prev.z };
    }
    const dt = Math.max(dtMs, 30) / 1000;
    const dh = Math.hypot(msg.x - prev.x, msg.z - prev.z);
    const dv = Math.abs(msg.y - prev.y);
    if (dh > MAX_HSPEED * dt || dv > MAX_VSPEED * dt) {
      return { ok: false, x: prev.x, y: prev.y, z: prev.z };
    }
    return { ok: true, x: msg.x, y: msg.y, z: msg.z };
  }

  // 昵称清洗：去控制字符、trim、裁到 12 字；空则用 fallback
  function sanitizeName(name, fallback) {
    const s = String(name == null ? '' : name)
      .replace(/[\x20-]/g, '').trim().slice(0, 12);
    return s.length > 0 ? s : fallback;
  }

  // 重连退避：第 attempt 次（从 0 起）的等待毫秒
  function backoffMs(attempt) {
    return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, attempt));
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Protocol = {
    INTEREST_CHUNKS, REACH, REACH_SLACK, MAX_HSPEED, MAX_VSPEED,
    MOVE_INTERVAL_MS, PERSIST_INTERVAL_MS, VALID_BLOCK_IDS,
    inInterest, validEdit, clampMove, sanitizeName, backoffMs,
  };
})(typeof self !== 'undefined' ? self : globalThis);
