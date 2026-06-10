// js/noise.js — 种子化柏林噪声 + fBm
(function (root) {
  'use strict';

  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const GRAD = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function create(seed) {
    const rand = mulberry32(seed);
    const perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

    function grad(hash, x, y) {
      const g = GRAD[hash & 7];
      return g[0] * x + g[1] * y;
    }

    function perlin2(x, y) {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
      const xf = x - Math.floor(x), yf = y - Math.floor(y);
      const u = fade(xf), v = fade(yf);
      const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
      const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
      // 混合梯度表（对角模√2、轴向模1）理论极值 ±1（四角对角梯度同时指向中心时取得），无需缩放
      return lerp(
        lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
        lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
        v
      );
    }

    function fbm2(x, y, octaves, lacunarity, gain) {
      let sum = 0, amp = 1, freq = 1, norm = 0;
      for (let i = 0; i < octaves; i++) {
        sum += amp * perlin2(x * freq, y * freq);
        norm += amp;
        amp *= gain; freq *= lacunarity;
      }
      return sum / norm;
    }

    return { perlin2, fbm2 };
  }

  root.MyWorld = root.MyWorld || {};
  root.MyWorld.Noise = { create };
})(typeof self !== 'undefined' ? self : globalThis);
