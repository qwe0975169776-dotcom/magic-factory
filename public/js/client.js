/* =========================================================
   深海大亂潛 — 客戶端邏輯（Vanilla JS + Socket.io）
   ========================================================= */
(() => {
  'use strict';

  const socket = io();
  const $ = (id) => document.getElementById(id);

  const AIR_FULL = 100;
  const AIR_EMPTY = 20;
  const LOW_AIR = 50;
  const DIRS = ['N', 'E', 'S', 'W'];
  const DIR_NAME = { N: '北', E: '東', S: '南', W: '西' };

  const state = {
    room: null,
    screen: 'home',
    sliderMax: 4,
    timerEnd: 0,                                // performance.now() 基準的結束時間
    instr: { active: false, start: 0, duration: 15000 },
    stability: AIR_FULL,
    lowAirWarned: false,
  };

  // ---------------------------------------------------------
  // 共用工具
  // ---------------------------------------------------------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showScreen(name) {
    state.screen = name;
    for (const s of ['home', 'lobby', 'game', 'result']) $('screen-' + s).classList.toggle('hidden', s !== name);
    $('toast').classList.remove('show');
    if (name === 'lobby' || name === 'game') keepAwake(); else releaseAwake();
  }

  // 等人或遊戲中保持螢幕不關閉（手機鎖屏會斷線被踢出房間）
  let wakeLock = null;
  async function keepAwake() {
    try {
      if (!wakeLock && 'wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { /* 不支援或被拒絕時略過 */ }
  }
  function releaseAwake() {
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* 略過 */ }
    wakeLock = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (state.screen === 'lobby' || state.screen === 'game')) keepAwake();
  });

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const ROAST_WRONG = [
    '🐡 {n} 手滑亂按！', '🫧 {n} 吐了一大串泡泡', '🦑 {n} 亂噴墨汁', '🙈 {n} 面鏡起霧了嗎？',
    '🤿 {n} 按錯了，教練在搖頭', '💨 {n} 正在浪費大家的空氣', '🦀 {n} 橫著亂按', '🐠 {n} 被小丑魚帶歪了',
  ];
  const ROAST_TIMEOUT = [
    '🫧 {n} 喊到只剩泡泡', '📣 {n} 的指令沉到海底了', '🐢 大家慢得像海龜，{n} 等到睡著',
    '🔇 水下講話本來就聽不到啦 {n}',
  ];

  let toastTimer = null;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function retrigger(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // 強制重繪，讓動畫可以連續觸發
    el.classList.add(cls);
  }

  function fmtTime(ms) {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 無痕模式略過 */ } }

  // 背景氣泡
  (() => {
    const box = $('bubbles');
    for (let i = 0; i < 16; i++) {
      const b = document.createElement('span');
      const size = 4 + Math.random() * 14;
      b.style.width = b.style.height = `${size}px`;
      b.style.left = `${Math.random() * 100}%`;
      b.style.animationDuration = `${7 + Math.random() * 9}s`;
      b.style.animationDelay = `${-Math.random() * 14}s`;
      box.appendChild(b);
    }
  })();

  // ---------------------------------------------------------
  // 音效（Web Audio 即時合成：氣泡、聲納、潛水電腦錶嗶聲）
  // ---------------------------------------------------------
  let actx = null;
  function ensureAudio() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { actx = null; }
  }
  function sweep(f1, f2, delay, dur, type = 'sine', vol = 0.15) {
    if (!actx) return;
    const t0 = actx.currentTime + delay;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f1, t0);
    o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(actx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  const tone = (f, delay, dur, type, vol) => sweep(f, f, delay, dur, type, vol);
  function splash(delay = 0, dur = 0.5, vol = 0.25) {
    if (!actx) return;
    const t0 = actx.currentTime + delay;
    const buf = actx.createBuffer(1, Math.floor(actx.sampleRate * dur), actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = actx.createBufferSource();
    const filter = actx.createBiquadFilter();
    const g = actx.createGain();
    src.buffer = buf;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2500, t0);
    filter.frequency.exponentialRampToValueAtTime(300, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    src.connect(filter).connect(g).connect(actx.destination);
    src.start(t0);
  }
  const bubble = (delay = 0, base = 300) => sweep(base, base * 3, delay, 0.09, 'sine', 0.14);
  const sfx = {
    success() { [0, 0.07, 0.14, 0.21, 0.3].forEach((d, i) => bubble(d, 260 + i * 90)); [523.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.12 + i * 0.08, 0.3, 'triangle', 0.14)); },
    helped() { bubble(0, 400); bubble(0.08, 520); },
    error() { sweep(220, 70, 0, 0.45, 'sawtooth', 0.18); },
    timeout() { [0, 0.15, 0.3].forEach((d, i) => sweep(500 - i * 100, 200 - i * 40, d, 0.2, 'square', 0.06)); },
    click() { bubble(0, 350 + Math.random() * 150); },
    newInstr() { tone(1180, 0, 0.6, 'sine', 0.12); tone(1180, 0.32, 0.5, 'sine', 0.04); }, // 聲納 ping
    beep() { tone(2000, 0, 0.12, 'square', 0.05); },
    go() { splash(0, 0.6, 0.3); [0.1, 0.18, 0.24, 0.33].forEach((d) => bubble(d, 250 + Math.random() * 250)); },
    alarm() { for (let i = 0; i < 6; i++) tone(2400, i * 0.14, 0.08, 'square', 0.06); },
    lowAir() { for (let i = 0; i < 3; i++) tone(1700, i * 0.3, 0.18, 'square', 0.07); },
  };
  document.addEventListener('pointerdown', ensureAudio, { passive: true });

  // ---------------------------------------------------------
  // 視覺回饋
  // ---------------------------------------------------------
  function flashSuccess() {
    retrigger($('fx-green'), 'on');
    sfx.success();
    if (navigator.vibrate) navigator.vibrate(60);
  }
  function damageFx() {
    retrigger($('fx-red'), 'on');
    retrigger($('app'), 'shake');
    sfx.error();
    if (navigator.vibrate) navigator.vibrate([150, 60, 150]);
  }

  // ---------------------------------------------------------
  // 首頁
  // ---------------------------------------------------------
  const nameInput = $('input-name');
  const codeInput = $('input-code');
  nameInput.value = storageGet('mf-name') || '';
  const urlCode = new URLSearchParams(location.search).get('room');
  if (urlCode) codeInput.value = urlCode.toUpperCase().slice(0, 4);

  function myName() {
    const n = nameInput.value.trim();
    storageSet('mf-name', n);
    return n;
  }

  $('btn-create').addEventListener('click', () => {
    if (!myName()) return toast('先取個潛水暱稱吧！'), nameInput.focus();
    socket.emit('room:create', { name: myName() }, (res) => {
      if (!res.ok) return toast(res.error);
      showScreen('lobby');
    });
  });

  $('btn-join').addEventListener('click', () => {
    if (!myName()) return toast('先取個潛水暱稱吧！'), nameInput.focus();
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 4) return toast('船號是 4 個字');
    socket.emit('room:join', { name: myName(), code }, (res) => {
      if (!res.ok) return toast(res.error);
      showScreen('lobby');
    });
  });
  codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase(); });

  // 隱藏的後台入口：長按首頁標題 3 秒
  (() => {
    const title = document.querySelector('#screen-home h1');
    let timer = null;
    const cancelPress = () => clearTimeout(timer);
    title.addEventListener('pointerdown', () => { timer = setTimeout(() => { location.href = '/admin'; }, 3000); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => title.addEventListener(ev, cancelPress));
    title.addEventListener('contextmenu', (e) => e.preventDefault());
  })();

  // ---------------------------------------------------------
  // 大廳
  // ---------------------------------------------------------
  function renderLobby(r) {
    $('lobby-code').textContent = r.code;
    $('lobby-count').textContent = `${r.players.length} / ${r.maxPlayers}`;
    $('lobby-players').innerHTML = r.players.map((p) => `
      <li class="flex items-center gap-3 rounded-xl bg-black/30 px-3 py-2">
        <span class="text-xl">${p.isHost ? '🚤' : '🤿'}</span>
        <span class="flex-1 font-bold">${esc(p.name)}${p.isHost ? ' <span class="text-xs text-cyan-100/70">（船長）</span>' : ''}</span>
        ${p.id === socket.id ? '<span class="rounded-full bg-cyan-700/60 px-2 text-xs">你</span>' : ''}
      </li>`).join('');

    const isHost = r.hostId === socket.id;
    const enough = r.players.length >= r.minPlayers;
    const btn = $('btn-start');
    btn.classList.toggle('hidden', !isHost);
    btn.disabled = !enough;
    $('lobby-hint').textContent = !enough
      ? `還差 ${r.minPlayers - r.players.length} 位潛伴才能下水（至少 ${r.minPlayers} 人）`
      : isHost ? '潛伴到齊！檢查裝備，準備下潛' : '等待船長宣布下潛……';
  }

  $('btn-start').addEventListener('click', () => {
    socket.emit('game:start', null, (res) => { if (!res.ok) toast(res.error); });
  });

  $('btn-leave').addEventListener('click', () => {
    socket.emit('room:leave');
    state.room = null;
    showScreen('home');
  });

  $('btn-share').addEventListener('click', async () => {
    if (!state.room) return;
    const url = `${location.origin}${location.pathname}?room=${state.room.code}`;
    try {
      if (navigator.share) await navigator.share({ title: '深海大亂潛', text: `快上船！船號 ${state.room.code}`, url });
      else { await navigator.clipboard.writeText(url); toast('已複製上船連結'); }
    } catch (e) { /* 使用者取消分享 */ }
  });

  // ---------------------------------------------------------
  // 遊戲：機關生成
  // ---------------------------------------------------------
  const devices = new Map(); // id → { data, el, angle }

  function operate(id, value) {
    socket.emit('device:operate', { deviceId: id, value });
  }

  function createDevice(d) {
    const el = document.createElement('div');
    el.className = `device device-${d.type}`;
    el.dataset.id = d.id;
    let body = '';
    if (d.type === 'button') {
      body = `<button type="button" class="magic-btn" aria-label="${esc(d.name)}"><span class="magic-btn-core"></span></button>`;
    } else if (d.type === 'switch') {
      body = `<button type="button" class="lever" role="switch" aria-checked="false" aria-label="${esc(d.name)}">
                <span class="lever-track"><span class="lever-knob"></span></span>
                <span class="lever-labels"><b>關</b><b>開</b></span>
              </button>`;
    } else if (d.type === 'slider') {
      body = `<div class="slider-wrap">
                <input type="range" class="magic-range" min="0" max="${state.sliderMax}" step="1" value="0" aria-label="${esc(d.name)}">
                <div class="slider-ticks"><span>底</span><span>▪</span><span>中</span><span>▪</span><span>頂</span></div>
              </div>`;
    } else {
      body = `<div class="compass" role="slider" aria-label="${esc(d.name)}">
                ${DIRS.map((k) => `<b data-d="${k}">${DIR_NAME[k]}</b>`).join('')}
                <span class="needle"></span><span class="hub"></span>
              </div>`;
    }
    el.innerHTML = `<div class="device-plate">${esc(d.name)}</div><div class="device-body">${body}</div>`;
    const entry = { data: d, el, angle: 0 };
    devices.set(d.id, entry);

    if (d.type === 'button') {
      const btn = el.querySelector('.magic-btn');
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.classList.add('is-pressed');
        sfx.click();
        operate(d.id, 'press');
      });
      const release = () => setTimeout(() => btn.classList.remove('is-pressed'), 120);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointerleave', release);
      btn.addEventListener('pointercancel', release);
    } else if (d.type === 'switch') {
      const lever = el.querySelector('.lever');
      lever.addEventListener('click', () => {
        const next = lever.getAttribute('aria-checked') === 'true' ? 'off' : 'on';
        setDeviceValue(d.id, next);
        sfx.click();
        operate(d.id, next);
      });
    } else if (d.type === 'slider') {
      const range = el.querySelector('.magic-range');
      range.addEventListener('input', () => paintRange(range));
      range.addEventListener('change', () => { sfx.click(); operate(d.id, Number(range.value)); });
    } else {
      bindCompass(entry);
    }

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    setDeviceValue(d.id, d.value);
    return el;
  }

  // 指北針：拖曳指針轉方向（放開時吸附到最近的方位），輕點則順時針轉 90°
  function bindCompass(entry) {
    const dial = entry.el.querySelector('.compass');
    let drag = null;
    const angleAt = (e) => {
      const r = dial.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      return (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = 北，90 = 東
    };
    dial.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dial.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    dial.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) drag.moved = true;
      if (!drag.moved) return;
      dial.classList.add('dragging');
      entry.angle = nearestEquivalent(entry.angle, angleAt(e));
      dial.style.setProperty('--deg', `${entry.angle}deg`);
    });
    const finish = (e) => {
      if (!drag) return;
      const wasDrag = drag.moved;
      drag = null;
      dial.classList.remove('dragging');
      const before = entry.data.value;
      let next;
      if (wasDrag) next = DIRS[((Math.round(angleAt(e) / 90) % 4) + 4) % 4];
      else next = DIRS[(DIRS.indexOf(before) + 1) % 4];
      setDeviceValue(entry.data.id, next);
      if (next !== before) { sfx.click(); operate(entry.data.id, next); }
    };
    dial.addEventListener('pointerup', finish);
    dial.addEventListener('pointercancel', (e) => { drag = null; dial.classList.remove('dragging'); setDeviceValue(entry.data.id, entry.data.value); });
  }

  // 找與 current 最接近、和 target 同方向的角度，避免指針繞遠路轉一大圈
  function nearestEquivalent(current, target) {
    return target + 360 * Math.round((current - target) / 360);
  }

  function paintRange(range) {
    range.style.setProperty('--fill', `${(range.value / state.sliderMax) * 100}%`);
  }

  function setDeviceValue(id, value) {
    const dv = devices.get(id);
    if (!dv) return;
    dv.data.value = value;
    if (dv.data.type === 'switch') {
      dv.el.querySelector('.lever').setAttribute('aria-checked', value === 'on' ? 'true' : 'false');
    } else if (dv.data.type === 'slider') {
      const range = dv.el.querySelector('.magic-range');
      range.value = value;
      paintRange(range);
    } else if (dv.data.type === 'compass') {
      const dial = dv.el.querySelector('.compass');
      dv.angle = nearestEquivalent(dv.angle, DIRS.indexOf(value) * 90);
      dial.style.setProperty('--deg', `${dv.angle}deg`);
      dial.setAttribute('aria-valuetext', DIR_NAME[value] || '');
      dial.querySelectorAll('b').forEach((b) => b.classList.toggle('on', b.dataset.d === value));
    }
  }

  // ---------------------------------------------------------
  // 遊戲：指令區、氣瓶壓力、計時
  // ---------------------------------------------------------
  function setInstruction(html, { muted = false, timed = false, duration = 15000 } = {}) {
    const p = $('instruction-text');
    p.innerHTML = html;
    p.classList.toggle('muted', muted);
    p.classList.toggle('long', !muted && p.textContent.length > 16);
    retrigger(p, 'pop');
    state.instr = { active: timed, start: performance.now(), duration };
    if (!timed) {
      $('instr-bar').style.width = '0%';
      $('instr-seconds').textContent = '';
    }
  }

  function setStability(v) {
    const before = state.stability;
    state.stability = v;
    const frac = Math.max(0, Math.min(1, (v - AIR_EMPTY) / (AIR_FULL - AIR_EMPTY)));
    const fill = $('stability-fill');
    fill.style.width = `${frac * 100}%`;
    fill.style.setProperty('--stab-color', `hsl(${Math.round(frac * 120)}, 85%, ${frac > 0.5 ? 45 : 50}%)`);
    $('stability-text').textContent = `${v} bar`;
    const low = v < LOW_AIR;
    $('app').classList.toggle('low-air', low && state.screen === 'game');
    if (low && before >= LOW_AIR && !state.lowAirWarned) {
      state.lowAirWarned = true;
      sfx.lowAir();
      toast('⚠️ 氣量低於 50 bar！準備上升！');
    }
    if (v >= LOW_AIR + 5) state.lowAirWarned = false;
  }

  function loop() {
    const now = performance.now();
    if (state.screen === 'game') {
      const remaining = Math.max(0, state.timerEnd - now);
      $('game-timer').textContent = fmtTime(remaining);
      document.querySelector('.timer-box').classList.toggle('urgent', remaining <= 30000);

      if (state.instr.active) {
        const left = Math.max(0, state.instr.duration - (now - state.instr.start));
        const frac = left / state.instr.duration;
        const bar = $('instr-bar');
        bar.style.width = `${frac * 100}%`;
        bar.classList.toggle('warn', frac <= 0.5 && frac > 0.25);
        bar.classList.toggle('danger', frac <= 0.25);
        $('instr-seconds').textContent = `${Math.ceil(left / 1000)}s`;
        if (left <= 0) state.instr.active = false;
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---------------------------------------------------------
  // Socket 事件
  // ---------------------------------------------------------
  socket.on('room:update', (r) => {
    state.room = r;
    if (r.state === 'lobby') {
      renderLobby(r);
      if (state.screen !== 'home') showScreen('lobby');
    }
    if (state.screen === 'result') {
      const isHost = r.hostId === socket.id;
      $('btn-again').classList.toggle('hidden', !isHost);
      $('result-wait').classList.toggle('hidden', isHost);
    }
  });

  let countdownTimers = [];
  function runCountdown(ms) {
    countdownTimers.forEach(clearTimeout);
    countdownTimers = [];
    const box = $('countdown');
    const num = $('countdown-num');
    const steps = ['3', '2', '1', '下潛！'];
    const gap = ms / steps.length;
    $('app').classList.add('locked');
    box.classList.remove('hidden');
    steps.forEach((t, i) => countdownTimers.push(setTimeout(() => {
      num.textContent = t;
      num.classList.toggle('go', i === steps.length - 1);
      retrigger(num, 'tick');
      if (i === steps.length - 1) sfx.go(); else sfx.beep();
    }, i * gap)));
    countdownTimers.push(setTimeout(() => {
      box.classList.add('hidden');
      $('app').classList.remove('locked');
    }, ms));
  }

  socket.on('game:started', (g) => {
    state.sliderMax = g.sliderMax || 4;
    state.timerEnd = performance.now() + g.remainingMs;
    state.lowAirWarned = false;
    devices.clear();
    const panel = $('panel');
    panel.innerHTML = '';
    g.devices.forEach((d) => panel.appendChild(createDevice(d)));
    $('app').classList.remove('chaos', 'low-air');
    showScreen('game');
    setStability(g.stability);
    setInstruction('先看清楚你的四個機關！<br><span class="text-base">指令出現就大聲喊給潛伴聽</span>', { muted: true });
    runCountdown(g.countdownMs || 3000);
  });

  socket.on('game:timer', ({ remainingMs }) => {
    state.timerEnd = performance.now() + remainingMs;
  });

  socket.on('game:chaos', () => {
    $('app').classList.add('chaos');
    sfx.alarm();
    if (navigator.vibrate) navigator.vibrate([80, 40, 80, 40, 80]);
    toast('🌊 洋流失控！指令越來越快！');
  });

  socket.on('instruction:new', (ins) => {
    if (ins.none) return setInstruction(esc(ins.text), { muted: true });
    let html = esc(ins.text);
    if (ins.deviceName) html = html.split(esc(ins.deviceName)).join(`<span class="dev-name">${esc(ins.deviceName)}</span>`);
    html = html.replace(/轉到(北|東|南|西)/, '轉到<span class="dir">$1</span>');
    setInstruction(html, { timed: true, duration: ins.durationMs });
    sfx.newInstr();
  });

  socket.on('instruction:success', ({ byName }) => {
    flashSuccess();
    setInstruction(`🫧 ${esc(byName)} 幫你搞定了！`, { muted: true });
  });

  socket.on('instruction:failed', () => {
    sfx.timeout();
    setInstruction('⌛ 太慢了！指令沉到海底……', { muted: true });
  });

  socket.on('instruction:cancelled', ({ leaverName }) => {
    setInstruction(`${esc(leaverName)} 帶著裝備游走了，換一條指令……`, { muted: true });
  });

  socket.on('operate:result', ({ deviceId, ok, forName }) => {
    const dv = devices.get(deviceId);
    if (!dv) return;
    if (ok === true) {
      retrigger(dv.el, 'ok');
      sfx.helped();
      toast(`👍 你幫 ${forName} 完成了指令`);
    } else if (ok === false) {
      retrigger(dv.el, 'bad');
    } else if (ok === null) {
      const old = dv.el.querySelector('.hint');
      if (old) old.remove();
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = '還沒到位！';
      dv.el.appendChild(hint);
      setTimeout(() => hint.remove(), 1500);
    }
  });

  socket.on('device:state', ({ deviceId, value }) => setDeviceValue(deviceId, value));

  socket.on('stability:update', ({ stability, delta, reason, byName }) => {
    setStability(stability);
    if (delta < 0) {
      damageFx();
      if (reason === 'wrong') toast(pick(ROAST_WRONG).replace('{n}', byName));
      else if (reason === 'timeout') toast(pick(ROAST_TIMEOUT).replace('{n}', byName));
    }
  });

  socket.on('toast', ({ text }) => toast(text));

  socket.on('game:over', (r) => {
    state.instr.active = false;
    countdownTimers.forEach(clearTimeout);
    $('countdown').classList.add('hidden');
    $('app').classList.remove('locked', 'chaos', 'low-air');
    const reasons = {
      timeup: '⏰ 潛水時間到！全員平安回到船上',
      collapse: '🫧 氣瓶只剩 20 bar！全員緊急上升',
      notEnough: '😶 潛伴都游走了，只好收隊',
    };
    $('result-reason').textContent = reasons[r.reason] || '';
    $('result-rank').textContent = r.rank;
    $('result-completed').textContent = r.completed;
    $('result-failed').textContent = r.failed;
    $('result-wrong').textContent = r.wrong;
    $('result-stability').textContent = `${r.stability} bar`;
    $('result-time').textContent = fmtTime(r.survivedMs);
    const medals = ['🥇', '🥈', '🥉'];
    $('result-players').innerHTML = r.players.map((p, i) => `
      <li class="award pop-in ${p.id === socket.id ? 'me' : ''}" style="animation-delay:${0.25 + i * 0.35}s">
        <span class="pos">${medals[i] || i + 1}</span>
        <span class="who">${esc(p.name)}<small>幫忙 ${p.helped}｜亂按 ${p.mistakes}</small></span>
        <span class="title">${esc(p.title || '')}</span>
        <span class="why">${esc(p.titleWhy || '')}</span>
      </li>`).join('');
    const isHost = state.room && state.room.hostId === socket.id;
    $('btn-again').classList.toggle('hidden', !isHost);
    $('result-wait').classList.toggle('hidden', isHost);
    showScreen('result');
    if (r.reason === 'collapse') damageFx(); else sfx.success();
    r.players.forEach((_, i) => setTimeout(() => bubble(0, 300 + i * 60), 250 + i * 350));
  });

  $('btn-again').addEventListener('click', () => socket.emit('game:lobby'));

  socket.on('disconnect', () => {
    toast('與潛水船的連線中斷了……');
    showScreen('home');
  });
})();
