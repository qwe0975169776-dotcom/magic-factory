/* =========================================================
   失控魔法工廠 — 客戶端邏輯（Vanilla JS + Socket.io）
   ========================================================= */
(() => {
  'use strict';

  const socket = io();
  const $ = (id) => document.getElementById(id);

  const state = {
    room: null,
    screen: 'home',
    sliderMax: 4,
    timerEnd: 0,                                // performance.now() 基準的結束時間
    instr: { active: false, start: 0, duration: 15000 },
    stability: 100,
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
  }

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

  // ---------------------------------------------------------
  // 音效（Web Audio 即時合成，不需要音檔）
  // ---------------------------------------------------------
  let actx = null;
  function ensureAudio() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { actx = null; }
  }
  function tone(freq, delay, dur, type = 'triangle', vol = 0.2) {
    if (!actx) return;
    const t0 = actx.currentTime + delay;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(actx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  const sfx = {
    success() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.07, 0.35, 'triangle', 0.22)); },
    helped() { tone(880, 0, 0.12, 'sine', 0.15); tone(1318.5, 0.08, 0.2, 'sine', 0.15); },
    error() { tone(110, 0, 0.4, 'sawtooth', 0.18); tone(116.5, 0, 0.4, 'sawtooth', 0.18); },
    timeout() { [392, 349.2, 311.1, 261.6].forEach((f, i) => tone(f, i * 0.12, 0.25, 'square', 0.08)); },
    click() { tone(1500, 0, 0.04, 'square', 0.04); },
    newInstr() { tone(659.25, 0, 0.1, 'sine', 0.12); tone(987.8, 0.07, 0.15, 'sine', 0.12); },
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
    if (!myName()) return toast('先取個魔法師名字吧！'), nameInput.focus();
    socket.emit('room:create', { name: myName() }, (res) => {
      if (!res.ok) return toast(res.error);
      showScreen('lobby');
    });
  });

  $('btn-join').addEventListener('click', () => {
    if (!myName()) return toast('先取個魔法師名字吧！'), nameInput.focus();
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 4) return toast('邀請碼是 4 個字');
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
        <span class="text-xl">${p.isHost ? '👑' : '🧙'}</span>
        <span class="flex-1 font-bold">${esc(p.name)}</span>
        ${p.id === socket.id ? '<span class="rounded-full bg-amber-700/60 px-2 text-xs">你</span>' : ''}
      </li>`).join('');

    const isHost = r.hostId === socket.id;
    const enough = r.players.length >= r.minPlayers;
    const btn = $('btn-start');
    btn.classList.toggle('hidden', !isHost);
    btn.disabled = !enough;
    $('lobby-hint').textContent = !enough
      ? `還差 ${r.minPlayers - r.players.length} 人才能開工（至少 ${r.minPlayers} 人）`
      : isHost ? '人數到齊！按下開始吧' : '等待房主按下開始……';
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
      if (navigator.share) await navigator.share({ title: '失控魔法工廠', text: `快來工廠上班！邀請碼 ${state.room.code}`, url });
      else { await navigator.clipboard.writeText(url); toast('已複製邀請連結'); }
    } catch (e) { /* 使用者取消分享 */ }
  });

  // ---------------------------------------------------------
  // 遊戲：機關生成
  // ---------------------------------------------------------
  const devices = new Map(); // id → { data, el }

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
    } else {
      body = `<div class="slider-wrap">
                <input type="range" class="magic-range" min="0" max="${state.sliderMax}" step="1" value="0" aria-label="${esc(d.name)}">
                <div class="slider-ticks"><span>底</span><span>▪</span><span>中</span><span>▪</span><span>頂</span></div>
              </div>`;
    }
    el.innerHTML = `<div class="device-plate">${esc(d.name)}</div><div class="device-body">${body}</div>`;

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
    } else {
      const range = el.querySelector('.magic-range');
      range.addEventListener('input', () => paintRange(range));
      range.addEventListener('change', () => { sfx.click(); operate(d.id, Number(range.value)); });
    }

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    devices.set(d.id, { data: d, el });
    setDeviceValue(d.id, d.value);
    return el;
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
    }
  }

  // ---------------------------------------------------------
  // 遊戲：指令區、穩定度、計時
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
    state.stability = v;
    const fill = $('stability-fill');
    fill.style.width = `${v}%`;
    fill.style.setProperty('--stab-color', `hsl(${Math.round(v * 1.2)}, 85%, 50%)`);
    $('stability-text').textContent = `${v}%`;
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

  socket.on('game:started', (g) => {
    state.sliderMax = g.sliderMax || 4;
    state.timerEnd = performance.now() + g.remainingMs;
    devices.clear();
    const panel = $('panel');
    panel.innerHTML = '';
    g.devices.forEach((d) => panel.appendChild(createDevice(d)));
    setStability(g.stability);
    setInstruction('準備開工……<br><span class="text-base">看看你的機關，聽隊友喊！</span>', { muted: true });
    showScreen('game');
  });

  socket.on('game:timer', ({ remainingMs }) => {
    state.timerEnd = performance.now() + remainingMs;
  });

  socket.on('instruction:new', (ins) => {
    if (ins.none) return setInstruction(esc(ins.text), { muted: true });
    let html = esc(ins.text);
    if (ins.deviceName) html = html.split(esc(ins.deviceName)).join(`<span class="dev-name">${esc(ins.deviceName)}</span>`);
    setInstruction(html, { timed: true, duration: ins.durationMs });
    sfx.newInstr();
  });

  socket.on('instruction:success', ({ byName }) => {
    flashSuccess();
    setInstruction(`✨ ${esc(byName)} 幫你搞定了！`, { muted: true });
  });

  socket.on('instruction:failed', () => {
    sfx.timeout();
    setInstruction('⌛ 太慢了！指令失效……', { muted: true });
  });

  socket.on('instruction:cancelled', ({ leaverName }) => {
    setInstruction(`${esc(leaverName)} 帶著機關落跑了，換一條指令……`, { muted: true });
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
    }
  });

  socket.on('device:state', ({ deviceId, value }) => setDeviceValue(deviceId, value));

  socket.on('stability:update', ({ stability, delta, reason, byName }) => {
    setStability(stability);
    if (delta < 0) {
      damageFx();
      if (reason === 'wrong') toast(`💢 ${byName} 亂按機關！`);
      else if (reason === 'timeout') toast(`⌛ ${byName} 的指令逾時了`);
    }
  });

  socket.on('toast', ({ text }) => toast(text));

  socket.on('game:over', (r) => {
    state.instr.active = false;
    const reasons = {
      timeup: '⏰ 下班鈴響了！工廠撐過了這一班',
      collapse: '💥 轟隆！工廠穩定度歸零，整座工廠炸飛了',
      notEnough: '😶 人都跑光了，工廠被迫停工',
    };
    $('result-reason').textContent = reasons[r.reason] || '';
    $('result-rank').textContent = r.rank;
    $('result-completed').textContent = r.completed;
    $('result-failed').textContent = r.failed;
    $('result-wrong').textContent = r.wrong;
    $('result-stability').textContent = `${r.stability}%`;
    $('result-time').textContent = fmtTime(r.survivedMs);
    const medals = ['🥇', '🥈', '🥉'];
    $('result-players').innerHTML = r.players.map((p, i) => `
      <li class="flex items-center gap-3 rounded-xl bg-black/30 px-3 py-2 ${p.id === socket.id ? 'ring-2 ring-amber-400' : ''}">
        <span class="w-6 text-center text-lg">${medals[i] || i + 1}</span>
        <span class="flex-1 font-bold">${esc(p.name)}</span>
        <span class="text-xs text-emerald-300">幫忙 ${p.helped}</span>
        <span class="text-xs text-rose-300">亂按 ${p.mistakes}</span>
      </li>`).join('');
    const isHost = state.room && state.room.hostId === socket.id;
    $('btn-again').classList.toggle('hidden', !isHost);
    $('result-wait').classList.toggle('hidden', isHost);
    showScreen('result');
    if (r.reason === 'collapse') damageFx(); else sfx.success();
  });

  $('btn-again').addEventListener('click', () => socket.emit('game:lobby'));

  socket.on('disconnect', () => {
    toast('與工廠的連線中斷了……');
    showScreen('home');
  });
})();
