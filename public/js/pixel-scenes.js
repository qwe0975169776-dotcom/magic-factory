/* =========================================================
   深海大亂潛 — 像素風動畫（16-bit 風格，Canvas 逐格繪製）
   PixelScenes.intro(app, ms)   開場：船邊背滾下水 → 水花 → 鏡頭往下潛
   畫布解析度只有 90 像素寬，再用「不模糊」的方式放大，看起來就是像素遊戲
   ========================================================= */
(() => {
  'use strict';

  const W = 72;          // 像素畫布寬度（越小像素越大顆）
  const FPS = 15;        // 刻意用低格數，更有復古遊戲感

  // ---------- 調色盤 ----------
  const C = {
    K: '#0f172a', B: '#1e3a5f', b: '#2b4f7e', S: '#f1c27d', s: '#d9a066', M: '#7dd3fc', m: '#bae6fd',
    Y: '#facc15', y: '#ca8a04', O: '#ff8a00', o: '#c2410c', W: '#f8fafc', G: '#94a3b8', g: '#64748b', R: '#ef4444',
    P: '#fb7185',
  };

  // ---------- 像素圖（每個字元一格，. 是透明） ----------
  const DIVER = [
    '....YYYY....',
    '...KKKKKK...',
    '..KKKKKKKK..',
    '..KMmMMmMK..',
    '..KMKMMKMK..',
    '..KMMMMMMK..',
    '...SSKKSS...',
    '....SSSS....',
    '..BBBBBBBB..',
    '.BBBOBBOBBB.',
    'SBBBOBBOBBBS',
    'SBbBBBBBBbBS',
    '.BBBBBBBBBB.',
    '..BBBBBBBB..',
    '..BBB..BBB..',
    '..BBB..BBB..',
  ];
  const FINS = [
    ['.OOOO..OOOO.', '.OOOO..OOOO.'],
    ['..OOO..OOOO.', '.OOOO..OOO..'],
    ['.OOOO..OOO..', '..OOO..OOOO.'],
  ];
  const FISH = ['.OOO.O', 'OOYOOO', '.OOO.O'];
  const FISH2 = ['.YYY.Y', 'YYKYYY', '.YYY.Y'];

  // 喘氣版：面鏡推到額頭、沒咬二級頭、臉紅、張嘴
  const DIVER_PANT_HEAD = [
    '....YYYY....',
    '...KMMMMK...',
    '..KKMmMmKK..',
    '..KSSSSSSK..',
    '..KSKSSKSK..',
    '..KPSSSSPK..',
  ];
  const MOUTH_OPEN = ['...SSKKSS...', '....SKKS....'];
  const MOUTH_SMALL = ['...SSSKSS...', '....SSSS....'];
  // pass out 版：眼睛變 ✕、二級頭掉了、吐舌頭
  const DIVER_KO_HEAD = [
    '....YYYY....',
    '...KKKKKK...',
    '..KKKKKKKK..',
    '..KKMKKMKK..',
    '..KMKMMKMK..',
    '..KKMKKMKK..',
    '...SSSPSS...',
    '....SSSS....',
  ];
  const OK_HAND = ['.SS.', 'S.SS', '.SSS', '..S.', '..B.', '..B.'];
  const GHOST = [
    '..WWWW..',
    '.WWWWWW.',
    'WWKWWKWW',
    'WWKWWKWW',
    'WWWWWWWW',
    'WWWPPWWW',
    'WWWWWWWW',
    'WW.WW.WW',
    'W...W..W',
  ];
  const REG = ['.KK.', 'KKKK', '.KK.', '..K.', '...K'];
  const BANG = ['RR', 'RR', 'RR', 'RR', '..', 'RR'];

  // outline：在角色外圍加一圈深色描邊，小小的也看得清楚
  function sprite(rows, extra, outline = '#04121f') {
    const all = extra ? rows.concat(extra) : rows;
    const w = all[0].length, h = all.length;
    const cv = document.createElement('canvas');
    cv.width = w + 2;
    cv.height = h + 2;
    const x = cv.getContext('2d');
    const solid = (i, j) => j >= 0 && j < h && i >= 0 && i < w && all[j][i] !== '.';
    if (outline) {
      x.fillStyle = outline;
      for (let j = -1; j <= h; j++) for (let i = -1; i <= w; i++) {
        if (!solid(i, j) && (solid(i - 1, j) || solid(i + 1, j) || solid(i, j - 1) || solid(i, j + 1))) x.fillRect(i + 1, j + 1, 1, 1);
      }
    }
    all.forEach((row, j) => [...row].forEach((ch, i) => {
      if (ch !== '.' && C[ch]) { x.fillStyle = C[ch]; x.fillRect(i + 1, j + 1, 1, 1); }
    }));
    return cv;
  }

  // 3×5 像素數字（深度表用）
  const DIGITS = {
    0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
    5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
    m: '000000111111101',
  };
  function drawText(x, str, px, py, color) {
    x.fillStyle = color;
    [...str].forEach((ch, k) => {
      const map = DIGITS[ch];
      if (!map) return;
      [...map].forEach((bit, i) => { if (bit === '1') x.fillRect(px + k * 4 + (i % 3), py + Math.floor(i / 3), 1, 1); });
    });
  }

  // 簡單的可重現亂數（每次播放畫面一樣）
  function rng(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const clamp01 = (t) => Math.max(0, Math.min(1, t));

  // ---------- 場景物件 ----------
  function makeWorld(H) {
    const r = rng(7);
    const surface = Math.round(H * 0.34);
    const depthEnd = Math.round(H * 1.7);
    return {
      H,
      surface,
      camEnd: depthEnd,
      diver: sprite(DIVER, FINS[0]),
      diverK: [sprite(DIVER, FINS[1]), sprite(DIVER, FINS[2])],
      fish: [sprite(FISH), sprite(FISH2)],
      pant: [sprite(DIVER_PANT_HEAD.concat(MOUTH_OPEN, DIVER.slice(8)), FINS[0]), sprite(DIVER_PANT_HEAD.concat(MOUTH_SMALL, DIVER.slice(8)), FINS[1])],
      ko: sprite(DIVER_KO_HEAD.concat(DIVER.slice(8)), FINS[0]),
      okHand: sprite(OK_HAND),
      ghost: sprite(GHOST),
      reg: sprite(REG),
      bang: sprite(BANG),
      clouds: [{ x: 4, y: 9, w: 14 }, { x: 40, y: 17, w: 11 }, { x: 58, y: 6, w: 8 }],
      fishes: Array.from({ length: 6 }, (_, i) => ({ x: r() * W, y: surface + 30 + r() * (depthEnd + H * 0.5 - surface), v: (r() < 0.5 ? -1 : 1) * (6 + r() * 10), k: i % 2 })),
      rays: Array.from({ length: 5 }, () => ({ x: r() * W, w: 3 + Math.floor(r() * 4) })),
      corals: Array.from({ length: 14 }, () => ({ x: Math.floor(r() * W), h: 6 + Math.floor(r() * 12), c: ['#f472b6', '#c084fc', '#fb923c', '#facc15', '#34d399'][Math.floor(r() * 5)] })),
      bubbles: [],
      drops: [],
      rand: r,
    };
  }

  function seaColorAt(wy, w) {
    // 依深度分 6 段，交界用棋盤格混色（像素風漸層）
    const bands = ['#38bdf8', '#0ea5e9', '#0284c7', '#0369a1', '#075985', '#0c4a6e', '#082f49'];
    const d = (wy - w.surface) / (w.H * 0.33);
    const i = Math.max(0, Math.min(bands.length - 1, Math.floor(d)));
    return { base: bands[i], next: bands[Math.min(bands.length - 1, i + 1)], frac: d - Math.floor(d) };
  }

  function drawBackground(x, w, camY) {
    const H = w.H;
    for (let sy = 0; sy < H; sy++) {
      const wy = sy + camY;
      if (wy < w.surface) {
        const t = wy / w.surface;
        x.fillStyle = t < 0.35 ? '#7dd3fc' : t < 0.7 ? '#a5e1fd' : '#e0f2fe';
        x.fillRect(0, sy, W, 1);
      } else {
        const c = seaColorAt(wy, w);
        x.fillStyle = c.base;
        x.fillRect(0, sy, W, 1);
        if (c.frac > 0.8) { // 交界棋盤格
          x.fillStyle = c.next;
          for (let px = (sy % 2); px < W; px += 2) x.fillRect(px, sy, 1, 1);
        }
      }
    }
  }

  function drawSkyStuff(x, w, camY, t) {
    const sy = (y) => Math.round(y - camY);
    // 太陽
    x.fillStyle = '#fde047';
    const sx = W - 16, syy = sy(14);
    [[2, 0, 4], [1, 1, 6], [0, 2, 8], [0, 3, 8], [0, 4, 8], [0, 5, 8], [1, 6, 6], [2, 7, 4]].forEach(([dx, dy, len]) => x.fillRect(sx + dx, syy + dy, len, 1));
    // 雲
    x.fillStyle = '#ffffff';
    w.clouds.forEach((c, i) => {
      const cx = Math.round((c.x + t * (2 + i)) % (W + 20)) - 10;
      const cy = sy(c.y);
      x.fillRect(cx, cy + 2, c.w, 3);
      x.fillRect(cx + 2, cy, c.w - 5, 3);
    });
  }

  function drawBoat(x, w, camY, t) {
    const bx = 4, by = Math.round(w.surface - camY) - 9 + (Math.floor(t * 2) % 2);
    // 桅杆與旗子（兩格動畫）
    x.fillStyle = C.g; x.fillRect(bx + 26, by - 12, 1, 12);
    x.fillStyle = C.R;
    if (Math.floor(t * 4) % 2) { x.fillRect(bx + 27, by - 12, 5, 2); x.fillRect(bx + 27, by - 10, 3, 1); }
    else { x.fillRect(bx + 27, by - 12, 4, 1); x.fillRect(bx + 27, by - 11, 5, 2); }
    // 船艙
    x.fillStyle = C.W; x.fillRect(bx + 8, by - 6, 16, 6);
    x.fillStyle = C.G; x.fillRect(bx + 8, by - 7, 16, 1);
    x.fillStyle = C.M; x.fillRect(bx + 10, by - 4, 4, 2); x.fillRect(bx + 17, by - 4, 4, 2);
    // 船身（梯形）
    for (let j = 0; j < 8; j++) {
      x.fillStyle = j === 2 || j === 3 ? C.R : j > 5 ? '#cbd5e1' : C.W;
      x.fillRect(bx + j, by + j, 40 - j * 2, 1);
    }
  }

  function drawSurface(x, w, camY, t) {
    const y = Math.round(w.surface - camY);
    if (y < -3 || y > w.H + 3) return;
    const off = Math.floor(t * 8) % 6;
    for (let px = -6; px < W + 6; px += 6) {
      x.fillStyle = '#e0f2fe';
      x.fillRect(px + off, y, 3, 1);
      x.fillStyle = '#7dd3fc';
      x.fillRect(px + off + 3, y + 1, 3, 1);
    }
  }

  function drawRays(x, w, camY, t) {
    x.save();
    x.globalAlpha = 0.12;
    x.fillStyle = '#e0f2fe';
    const top = Math.max(0, Math.round(w.surface - camY));
    w.rays.forEach((r, i) => {
      const sway = Math.round(Math.sin(t * 1.2 + i) * 3);
      for (let sy = top; sy < Math.min(w.H, top + 70); sy++) {
        const k = sy - top;
        x.fillRect(Math.round(r.x + sway + k * 0.35), sy, r.w, 1);
      }
    });
    x.restore();
  }

  function drawFishAndCoral(x, w, camY, t) {
    w.fishes.forEach((f) => {
      const fx = Math.round(((f.x + f.v * t) % (W + 12) + W + 12) % (W + 12)) - 6;
      const fy = Math.round(f.y - camY + Math.sin(t * 3 + f.x) * 1.5);
      if (fy < -4 || fy > w.H) return;
      const img = w.fish[f.k];
      x.save();
      if (f.v < 0) { x.translate(fx + img.width, fy); x.scale(-1, 1); x.drawImage(img, 0, 0); }
      else x.drawImage(img, fx, fy);
      x.restore();
    });
    // 海底：沙地＋珊瑚
    const floor = Math.round(w.camEnd + w.H * 0.92 - camY);
    if (floor < w.H + 20) {
      x.fillStyle = '#e7d3a1'; x.fillRect(0, floor, W, w.H);
      x.fillStyle = '#d6bc80';
      for (let px = 0; px < W; px += 4) x.fillRect(px + ((px / 4) % 2), floor + 2, 2, 1);
      w.corals.forEach((c) => {
        x.fillStyle = c.c;
        x.fillRect(c.x, floor - c.h, 2, c.h);
        x.fillRect(c.x - 2, floor - Math.round(c.h * 0.6), 2, 2);
        x.fillRect(c.x + 2, floor - Math.round(c.h * 0.8), 2, 2);
      });
    }
  }

  function drawDiver(x, w, img, sx, sy, angle) {
    x.save();
    x.translate(Math.round(sx), Math.round(sy));
    if (angle) x.rotate(Math.round(angle / (Math.PI / 8)) * (Math.PI / 8)); // 每 22.5° 一格，像素感
    x.drawImage(img, -Math.floor(img.width / 2), -Math.floor(img.height / 2));
    x.restore();
  }

  function stepParticles(x, w, camY, dt) {
    // 氣泡
    w.bubbles = w.bubbles.filter((b) => b.y > w.surface + 1);
    w.bubbles.forEach((b) => {
      b.y -= b.v * dt;
      b.x += Math.sin(b.y * 0.3) * 0.15;
      const sy = Math.round(b.y - camY);
      x.fillStyle = '#e0f2fe';
      if (b.s > 1) { x.fillRect(Math.round(b.x), sy, 2, 2); x.fillStyle = '#7dd3fc'; x.fillRect(Math.round(b.x) + 1, sy + 1, 1, 1); }
      else x.fillRect(Math.round(b.x), sy, 1, 1);
    });
    // 水花
    w.drops = w.drops.filter((d) => d.life > 0);
    w.drops.forEach((d) => {
      d.vy += 60 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.life -= dt;
      x.fillStyle = d.life > 0.3 ? '#ffffff' : '#bae6fd';
      x.fillRect(Math.round(d.x), Math.round(d.y - camY), 1, 1);
    });
  }

  // ---------- 開場時間軸 ----------
  function introFrame(x, w, t, total, dtFrame) {
    const p = t / total;
    // 鏡頭：前 40% 停在水面，之後往下潛
    const camY = Math.round(lerp(0, w.camEnd, ease(clamp01((p - 0.38) / 0.62))));
    drawBackground(x, w, camY);
    drawSkyStuff(x, w, camY, t);
    drawRays(x, w, camY, t);
    drawFishAndCoral(x, w, camY, t);
    drawBoat(x, w, camY, t);

    // 潛水員：坐在船邊 → 背滾 → 下潛
    const edgeX = 42, edgeY = w.surface - 16;
    let dx, dy, ang = 0;
    if (p < 0.16) { dx = edgeX; dy = edgeY - (Math.floor(t * 4) % 2); }
    else if (p < 0.34) {
      const k = (p - 0.16) / 0.18;
      dx = lerp(edgeX, 56, k);
      dy = lerp(edgeY, w.surface + 6, k * k) - Math.sin(k * Math.PI) * 6;
      ang = -k * Math.PI * 1.1;
      if (!w.splashed && k > 0.85) {
        w.splashed = true;
        for (let i = 0; i < 22; i++) w.drops.push({ x: 56 + (w.rand() - 0.5) * 6, y: w.surface, vx: (w.rand() - 0.5) * 40, vy: -30 - w.rand() * 40, life: 0.6 + w.rand() * 0.4 });
      }
    } else {
      const k = clamp01((p - 0.34) / 0.66);
      dx = lerp(56, W / 2, ease(k));
      dy = lerp(w.surface + 8, w.camEnd + w.H * 0.55, ease(k));
      ang = lerp(-Math.PI * 1.1, -Math.PI * 2, clamp01(k * 2.5));
      if (w.rand() < 0.35) w.bubbles.push({ x: dx + (w.rand() - 0.5) * 3, y: dy - 6, v: 14 + w.rand() * 10, s: w.rand() < 0.4 ? 2 : 1 });
    }
    const kick = p > 0.34 ? w.diverK[Math.floor(t * 6) % 2] : w.diver;
    drawDiver(x, w, kick, dx, dy - camY, ang);
    drawSurface(x, w, camY, t);
    stepParticles(x, w, camY, dtFrame);

    // 深度表
    if (p > 0.38) {
      const depth = Math.round(clamp01((p - 0.38) / 0.62) * 18);
      x.fillStyle = 'rgba(4,18,31,.7)';
      x.fillRect(W - 19, 3, 17, 7);
      drawText(x, `${depth}m`, W - 17, 4, '#67e8f9');
    }
    return p;
  }

  function drawDepth(x, depth) {
    x.fillStyle = 'rgba(4,18,31,.7)';
    x.fillRect(W - 19, 3, 17, 7);
    drawText(x, `${Math.max(0, Math.round(depth))}m`, W - 17, 4, '#67e8f9');
  }

  function drawWorld(x, w, camY, t) {
    drawBackground(x, w, camY);
    drawSkyStuff(x, w, camY, t);
    drawRays(x, w, camY, t);
    drawFishAndCoral(x, w, camY, t);
    drawBoat(x, w, camY, t);
  }

  const depthAt = (w, wy) => clamp01((wy - w.surface) / (w.camEnd + w.H * 0.55 - w.surface)) * 18;
  function bubble(w, dx, dy, rate) {
    if (w.rand() < rate) w.bubbles.push({ x: dx + (w.rand() - 0.5) * 3, y: dy - 6, v: 14 + w.rand() * 10, s: w.rand() < 0.4 ? 2 : 1 });
  }
  function splash(w, cx, n, power) {
    for (let i = 0; i < n; i++) w.drops.push({ x: cx + (w.rand() - 0.5) * 6, y: w.surface, vx: (w.rand() - 0.5) * 44, vy: -power - w.rand() * power, life: 0.6 + w.rand() * 0.4 });
  }

  // ---------- 結局 1：安全上升 ----------
  function safeFrame(x, w, t, total, dt) {
    const p = t / total;
    const deep = w.camEnd + w.H * 0.55;          // 潛水員起點（18 米）
    const stopY = w.surface + (deep - w.surface) * (5 / 18); // 5 米安全停留
    const atSurface = w.surface + 7;
    let dy;
    if (p < 0.3) dy = lerp(deep, stopY, ease(p / 0.3));
    else if (p < 0.55) dy = stopY + Math.round(Math.sin(t * 3) * 1);
    else if (p < 0.78) dy = lerp(stopY, atSurface, ease((p - 0.55) / 0.23));
    else dy = atSurface + (Math.floor(t * 2) % 2);
    const dx = W / 2 + 8;
    const camY = Math.round(Math.max(0, Math.min(w.camEnd, dy - w.H * 0.55)));
    drawWorld(x, w, camY, t);
    if (p < 0.78) bubble(w, dx, dy, 0.3);
    const img = p < 0.78 ? w.diverK[Math.floor(t * (p > 0.3 && p < 0.55 ? 3 : 6)) % 2] : w.diver;
    drawDiver(x, w, img, dx, dy - camY, 0);
    if (p >= 0.8) {
      // 比 OK＋閃亮亮
      x.drawImage(w.okHand, Math.round(dx + 5), Math.round(dy - camY - 14));
      const tw = Math.floor(t * 6) % 2;
      x.fillStyle = '#fde047';
      [[dx - 14, dy - 18], [dx + 14, dy - 22], [dx - 4, dy - 26]].forEach(([sx, sy], i) => {
        const yy = Math.round(sy - camY);
        if ((i + tw) % 2) { x.fillRect(Math.round(sx), yy - 1, 1, 3); x.fillRect(Math.round(sx) - 1, yy, 3, 1); }
        else x.fillRect(Math.round(sx), yy, 1, 1);
      });
    }
    if (!w.splashed && p >= 0.77) { w.splashed = true; splash(w, dx, 14, 22); }
    drawSurface(x, w, camY, t);
    stepParticles(x, w, camY, dt);
    if (p < 0.8) drawDepth(x, depthAt(w, dy));
    return p;
  }

  // ---------- 結局 2：衝上水面、喘氣 ----------
  function pantFrame(x, w, t, total, dt) {
    const p = t / total;
    const start = w.surface + (w.camEnd + w.H * 0.55 - w.surface) * 0.6;
    const atSurface = w.surface + 7;
    const dx = W / 2 + 10;
    let dy;
    if (p < 0.28) dy = lerp(start, atSurface - 4, (p / 0.28) * (p / 0.28));
    else dy = atSurface + (Math.floor(t * 5) % 2 ? -1 : 1); // 喘到上下抖
    const camY = Math.round(Math.max(0, Math.min(w.camEnd, dy - w.H * 0.5)));
    drawWorld(x, w, camY, t);
    if (p < 0.28) { bubble(w, dx, dy, 0.9); bubble(w, dx, dy + 4, 0.6); }
    if (!w.splashed && p >= 0.27) { w.splashed = true; splash(w, dx, 30, 40); }
    let img;
    if (p < 0.3) img = w.diverK[Math.floor(t * 10) % 2];
    else img = w.pant[Math.floor(t * 5) % 2];
    drawDiver(x, w, img, dx, dy - camY, 0);
    if (p >= 0.3) {
      // 汗滴往兩邊噴
      if (Math.floor(t * FPS) % 4 === 0) {
        w.drops.push({ x: dx - 5, y: dy - 9, vx: -18, vy: -20, life: 0.5 });
        w.drops.push({ x: dx + 5, y: dy - 9, vx: 18, vy: -20, life: 0.5 });
      }
      // 嘴巴吐出的喘氣白霧
      const puff = (t * 2.2) % 1;
      const side = Math.floor(t * 2.2) % 2 ? 1 : -1;
      x.save();
      x.globalAlpha = 1 - puff * 0.8;
      x.fillStyle = '#ffffff';
      const px = Math.round(dx + side * (8 + puff * 10)), py = Math.round(dy - camY - 5 - puff * 12);
      x.fillRect(px - 2, py, 5, 3); x.fillRect(px - 3, py + 1, 7, 1); x.fillRect(px - 1, py - 1, 3, 1);
      x.restore();
    }
    drawSurface(x, w, camY, t);
    stepParticles(x, w, camY, dt);
    if (p < 0.28) drawDepth(x, depthAt(w, dy));
    return p;
  }

  // ---------- 結局 3：pass out ----------
  function koFrame(x, w, t, total, dt) {
    const p = t / total;
    const hover = w.surface + (w.camEnd + w.H * 0.55 - w.surface) * 0.75;
    const floorY = w.camEnd + w.H * 0.92;
    const dx = W / 2;
    let dy = hover + Math.round(Math.sin(t * 3));
    let ang = 0;
    if (p >= 0.38) {
      const k = clamp01((p - 0.38) / 0.62);
      dy = lerp(hover, floorY - 6, ease(k));
      ang = -lerp(0, Math.PI * 0.5, ease(clamp01(k * 1.6)));
    }
    const camY = Math.round(Math.min(w.camEnd, lerp(hover - w.H * 0.5, w.camEnd, ease(clamp01((p - 0.38) / 0.62)))));
    drawWorld(x, w, camY, t);
    if (p < 0.3) bubble(w, dx, dy, 0.25);
    const img = p < 0.32 ? w.diverK[Math.floor(t * 4) % 2] : w.ko;
    drawDiver(x, w, img, dx, dy - camY, ang);
    // 驚嘆號
    if (p > 0.18 && p < 0.34 && Math.floor(t * 8) % 2) x.drawImage(w.bang, Math.round(dx + 7), Math.round(dy - camY - 16));
    // 二級頭飄走往下掉
    if (p >= 0.32) {
      const k = clamp01((p - 0.32) / 0.68);
      x.save();
      x.translate(Math.round(dx + 4 + k * 14), Math.round(lerp(hover - 2, floorY - 2, k * k) - camY));
      x.rotate(Math.round((k * 6) / (Math.PI / 8)) * (Math.PI / 8));
      x.drawImage(w.reg, -2, -2);
      x.restore();
    }
    // 水越來越暗
    x.save();
    x.globalAlpha = clamp01((p - 0.3) / 0.7) * 0.55;
    x.fillStyle = '#020617';
    x.fillRect(0, 0, W, w.H);
    x.restore();
    // 小鬼魂飄出來
    if (p >= 0.55) {
      const k = clamp01((p - 0.55) / 0.45);
      const gx = Math.round(dx - 4 + Math.sin(t * 4) * 3);
      const gy = Math.round(lerp(dy - camY - 6, w.H * 0.25, k));
      x.save();
      x.globalAlpha = Math.min(0.95, k * 3);
      x.drawImage(w.ghost, gx, gy);
      x.restore();
    }
    drawSurface(x, w, camY, t);
    stepParticles(x, w, camY, dt);
    drawDepth(x, depthAt(w, dy));
    return p;
  }

  const SCENES = {
    intro: { draw: introFrame, captions: [[0, '🤿 背滾下水……'], [0.34, '💦 撲通！'], [0.55, '⬇️ 平壓……下潛中']] },
    safe: { draw: safeFrame, captions: [[0, '⬆️ 慢慢上升……'], [0.3, '🛑 5 米安全停留……'], [0.78, '👌 安全上升！全員平安上船']] },
    panting: { draw: pantFrame, captions: [[0, '🚀 衝上水面！'], [0.3, '😮‍💨 呼……呼……有點喘，但活著回來了']] },
    passout: { draw: koFrame, captions: [[0, '🫧 咦？殘壓表……'], [0.32, '💀 你在水裡 pass out 了'], [0.6, '👻（潛伴正在把你拖上船）']] },
  };

  // ---------- 播放器 ----------
  function mountCanvas(app, cls) {
    const old = app.querySelector('.scene');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = `scene pixel-scene ${cls}`;
    const cv = document.createElement('canvas');
    const H = Math.max(140, Math.round((W * app.clientHeight) / Math.max(1, app.clientWidth)));
    cv.width = W;
    cv.height = H;
    el.appendChild(cv);
    const cap = document.createElement('p');
    cap.className = 'caption';
    el.appendChild(cap);
    app.appendChild(el);
    const x = cv.getContext('2d');
    x.imageSmoothingEnabled = false;
    return { el, cv, x, H, cap };
  }

  function play(app, kind, ms, done, skippable) {
    const scene = SCENES[kind];
    const { el, x, H, cap } = mountCanvas(app, `pixel-${kind}`);
    const w = makeWorld(H);
    const total = ms / 1000;
    const t0 = performance.now();
    let lastFrame = -1;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      el.classList.add('fade');
      setTimeout(() => el.remove(), 350);
      if (done) done();
    };
    if (skippable) {
      const skip = document.createElement('p');
      skip.className = 'skip';
      skip.textContent = '點一下跳過';
      el.appendChild(skip);
      el.addEventListener('pointerdown', finish);
    }
    const loop = () => {
      if (!el.isConnected || finished) return;
      const t = Math.min(total, (performance.now() - t0) / 1000);
      const frame = Math.floor(t * FPS);
      if (frame !== lastFrame) {
        lastFrame = frame;
        const p = scene.draw(x, w, frame / FPS, total, 1 / FPS);
        const c = scene.captions.filter(([at]) => p >= at).pop();
        if (c && cap.textContent !== c[1]) { cap.textContent = c[1]; cap.classList.remove('final'); void cap.offsetWidth; cap.classList.add('final'); }
      }
      if (t < total) requestAnimationFrame(loop);
      else setTimeout(finish, skippable ? 1200 : 60);
    };
    requestAnimationFrame(loop);
    return el;
  }

  const PixelScenes = {
    W,
    FPS,
    intro(app, ms = 3500) { return play(app, 'intro', ms, null, false); },
    ending(app, kind, done, ms = 5000) { return play(app, kind, ms, done, true); },
    kindFor(reason, air) {
      if (reason === 'collapse') return 'passout';
      return air >= 60 ? 'safe' : 'panting';
    },

    /** 給錄影用：逐格畫（不靠時間，固定格數） */
    debugFrame(app, kind, ms, frame) {
      if (!this._dbg || this._dbg.kind !== kind) {
        const m = mountCanvas(app, `pixel-${kind}`);
        this._dbg = { ...m, kind, w: makeWorld(m.H) };
      }
      const d = this._dbg;
      const scene = SCENES[kind];
      const p = scene.draw(d.x, d.w, frame / FPS, ms / 1000, 1 / FPS);
      d.cap.textContent = scene.captions.filter(([at]) => p >= at).pop()[1];
    },
  };

  window.PixelScenes = PixelScenes;
})();
