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
  const DIR_NAME = { N: '北', NE: '東北', E: '東', SE: '東南', S: '南', SW: '西南', W: '西', NW: '西北' };

  const state = {
    room: null,
    screen: 'home',
    sliderMax: 4,
    stepMax: 10,
    level: 'medium',
    timerEnd: 0,                                // performance.now() 基準的結束時間
    instr: { active: false, start: 0, duration: 15000 },
    stability: AIR_FULL,
    lowAirWarned: false,
    durationMs: 180000,
    timerFrozen: null,   // 水面休息時，計時器停在這個值
    surface: false,
    inEnding: false,
    stageInfo: null,     // { label, stage, stages, site }
  };
  const MENU_SCREENS = new Set(['home', 'solo', 'lobby', 'result']);

  // ---------------------------------------------------------
  // 共用工具
  // ---------------------------------------------------------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showScreen(name) {
    state.screen = name;
    for (const s of ['home', 'solo', 'lobby', 'game', 'result']) $('screen-' + s).classList.toggle('hidden', s !== name);
    $('app').dataset.screen = name;
    $('toast').classList.remove('show');
    if (MENU_SCREENS.has(name) && !state.inEnding) menuMusic();
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
  // 瀏覽器規定要先點一下畫面才能出聲音：第一次點擊就開始播船上主題曲
  const unlockAudio = () => {
    ensureAudio();
    if (MENU_SCREENS.has(state.screen) && !state.inEnding && !DiveMusic.theme) menuMusic();
  };
  ['pointerdown', 'touchend', 'click'].forEach((ev) => document.addEventListener(ev, unlockAudio, { passive: true }));

  // ---------------------------------------------------------
  // 防止手機「快速連點 → 畫面放大」與雙指縮放
  // iPhone Safari 不理會 user-scalable=no，要在觸控事件上主動擋下
  // （輸入框除外，打字時仍可正常操作）
  // ---------------------------------------------------------
  const isTyping = (el) => el && el.closest && el.closest('input, textarea, select, [contenteditable]');
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 400 && !isTyping(e.target)) {
      e.preventDefault(); // 第二下太快 → 不當成「點兩下放大」
      // 擋掉放大的同時，按鈕本身仍要算一次點擊（例如快速連按 ＋／－）
      const btn = e.target.closest && e.target.closest('button, .knob, .compass');
      if (btn && !btn.classList.contains('compass') && !btn.classList.contains('magic-btn')) btn.click();
    }
    lastTouchEnd = now;
  }, { passive: false });
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) e.preventDefault(); // 兩指 → 擋掉縮放
  }, { passive: false });
  document.addEventListener('dblclick', (e) => { if (!isTyping(e.target)) e.preventDefault(); }, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));
  // 萬一還是被放大了（例如系統設定強制允許縮放），回到遊戲畫面時提示
  if (window.visualViewport) {
    let zoomWarned = 0;
    window.visualViewport.addEventListener('resize', () => {
      if (window.visualViewport.scale > 1.05 && state.screen === 'game' && Date.now() - zoomWarned > 8000) {
        zoomWarned = Date.now();
        toast('🔍 畫面被放大了，用兩指縮小回來');
      }
    });
  }

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
      lastResultSolo = false;
      showScreen('lobby');
    });
  });

  $('btn-join').addEventListener('click', () => {
    if (!myName()) return toast('先取個潛水暱稱吧！'), nameInput.focus();
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 4) return toast('船號是 4 個字');
    socket.emit('room:join', { name: myName(), code }, (res) => {
      if (!res.ok) return toast(res.error);
      lastResultSolo = false;
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
    const picker = $('diff-picker');
    picker.classList.toggle('readonly', !isHost);
    picker.querySelectorAll('.diff').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.level === r.difficulty));
      b.disabled = !isHost;
    });
    const lv = r.levels && r.levels[r.difficulty];
    $('diff-note').textContent = isHost ? '船長點選切換' : `船長選了 ${lv ? lv.label : ''}`;
    const enough = r.players.length >= r.minPlayers;
    const btn = $('btn-start');
    btn.classList.toggle('hidden', !isHost);
    btn.disabled = !enough;
    $('lobby-hint').textContent = !enough
      ? `還差 ${r.minPlayers - r.players.length} 位潛伴才能下水（至少 ${r.minPlayers} 人）`
      : isHost ? '潛伴到齊！檢查裝備，準備下潛' : '等待船長宣布下潛……';
  }

  $('diff-picker').addEventListener('click', (e) => {
    const b = e.target.closest('.diff');
    if (!b || b.disabled) return;
    sfx.click();
    socket.emit('room:difficulty', { level: b.dataset.level }, (res) => { if (!res.ok) toast(res.error); });
  });

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
  // 遊戲：機關生成（依難度畫出不同的控制元件）
  // ---------------------------------------------------------
  const devices = new Map(); // id → { data, el, angle }
  const DIR8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const TRI_LABEL = ['關', '半開', '全開'];

  function operate(id, value) {
    if (SOLO.active) soloOperate(id, value);
    else socket.emit('device:operate', { deviceId: id, value });
  }

  // 連續調整型（刻度、選擇器）：停手 0.6 秒後才送出，避免中途數值被當成亂按
  function debounceOperate(entry, value) {
    clearTimeout(entry.sendTimer);
    entry.sendTimer = setTimeout(() => operate(entry.data.id, value), 600);
  }

  function controlHtml(d) {
    const label = esc(d.name);
    switch (d.mode) {
      case 'tap':
      case 'gesture':
        return `<button type="button" class="magic-btn" aria-label="${label}"><span class="magic-btn-core"></span><span class="hold-ring"></span></button>`;
      case 'twoWay':
        return `<button type="button" class="lever" role="switch" aria-checked="false" aria-label="${label}">
                  <span class="lever-track"><span class="lever-knob"></span></span>
                  <span class="lever-labels"><b>關</b><b>開</b></span>
                </button>`;
      case 'threeWay':
        return `<div class="tri" role="radiogroup" aria-label="${label}"><span class="tri-knob"></span>
                  ${TRI_LABEL.map((t, i) => `<button type="button" data-v="${i}" aria-pressed="false">${t}</button>`).join('')}
                </div>`;
      case 'range5':
        return `<div class="slider-wrap">
                  <input type="range" class="magic-range" min="0" max="${state.sliderMax}" step="1" value="0" aria-label="${label}">
                  <div class="slider-ticks"><span>底</span><span>▪</span><span>中</span><span>▪</span><span>頂</span></div>
                </div>`;
      case 'step10':
        return `<div class="stepper" aria-label="${label}">
                  <div class="stepper-row"><button type="button" data-step="-1" aria-label="減少">−</button>
                  <span class="step-val">0</span>
                  <button type="button" data-step="1" aria-label="增加">＋</button></div>
                  <div class="ticks">${'<i></i>'.repeat(state.stepMax + 1)}</div>
                </div>`;
      case 'dir4':
      case 'dir8': {
        const dirs = d.mode === 'dir8' ? DIR8 : DIRS;
        return `<div class="compass-wrap"><div class="compass ${d.mode}" role="slider" aria-label="${label}">
                  <span class="hold-ring"></span>
                  ${dirs.map((k) => `<b data-d="${k}">${DIR_NAME[k]}</b>`).join('')}
                  <span class="needle"></span><span class="hub"></span>
                </div><span class="compass-tip">${d.mode === 'dir8' ? '滑一下・按住保持' : '往方向滑一下'}</span></div>`;
      }
      case 'options':
        return `<div class="selector" aria-label="${label}">
                  <div class="selector-row"><button type="button" class="arrow" data-step="-1" aria-label="上一個">◀</button>
                  <span class="knob"></span>
                  <button type="button" class="arrow" data-step="1" aria-label="下一個">▶</button></div>
                  <span class="opt"></span>
                  <span class="opt-list">${d.options.map(() => '<i></i>').join('')}</span>
                </div>`;
      default:
        return '';
    }
  }

  function createDevice(d) {
    const el = document.createElement('div');
    el.className = `device device-${d.type}`;
    el.dataset.id = d.id;
    el.innerHTML = `<div class="device-plate">${esc(d.name)}</div><div class="device-body">${controlHtml(d)}</div>`;
    const entry = { data: d, el, angle: 0, sendTimer: null };
    devices.set(d.id, entry);

    switch (d.mode) {
      case 'tap': bindTap(entry); break;
      case 'gesture': bindGesture(entry); break;
      case 'twoWay': {
        const lever = el.querySelector('.lever');
        lever.addEventListener('click', () => {
          const next = lever.getAttribute('aria-checked') === 'true' ? 'off' : 'on';
          setDeviceValue(d.id, next);
          sfx.click();
          operate(d.id, next);
        });
        break;
      }
      case 'threeWay':
        el.querySelectorAll('.tri button').forEach((b) => b.addEventListener('click', () => {
          const v = Number(b.dataset.v);
          if (v === entry.data.value) return;
          setDeviceValue(d.id, v);
          sfx.click();
          operate(d.id, v);
        }));
        break;
      case 'range5': {
        const range = el.querySelector('.magic-range');
        range.addEventListener('input', () => paintRange(range));
        range.addEventListener('change', () => { sfx.click(); operate(d.id, Number(range.value)); });
        break;
      }
      case 'step10':
        el.querySelectorAll('.stepper button').forEach((b) => b.addEventListener('click', () => {
          const v = Math.max(0, Math.min(state.stepMax, entry.data.value + Number(b.dataset.step)));
          if (v === entry.data.value) return;
          setDeviceValue(d.id, v);
          sfx.click();
          debounceOperate(entry, v);
        }));
        break;
      case 'dir4':
      case 'dir8':
        bindCompass(entry, d.mode === 'dir8' ? DIR8 : DIRS);
        break;
      case 'options': {
        const n = d.options.length;
        const step = (k) => {
          const v = (entry.data.value + k + n) % n;
          setDeviceValue(d.id, v);
          sfx.click();
          debounceOperate(entry, v);
        };
        el.querySelectorAll('.selector .arrow').forEach((b) => b.addEventListener('click', () => step(Number(b.dataset.step))));
        el.querySelector('.knob').addEventListener('click', () => step(1));
        break;
      }
      default: break;
    }

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    setDeviceValue(d.id, d.value);
    return el;
  }

  function bindTap(entry) {
    const btn = entry.el.querySelector('.magic-btn');
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.classList.add('is-pressed');
      sfx.click();
      operate(entry.data.id, 'press');
    });
    const release = () => setTimeout(() => btn.classList.remove('is-pressed'), 120);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, release));
  }

  // 高難度按鈕：按一下、連按（停手 0.45 秒後判定次數）、長按 1.5 秒
  function bindGesture(entry) {
    const btn = entry.el.querySelector('.magic-btn');
    const HOLD_MS = 1500;
    let taps = 0, decideTimer = null, downAt = 0, raf = 0, holdDone = false, badge = null;
    const showCount = () => {
      if (!badge) { badge = document.createElement('span'); badge.className = 'tap-count'; entry.el.appendChild(badge); }
      badge.textContent = `×${taps}`;
      retrigger(badge, 'tap-count');
    };
    const clearBadge = () => { if (badge) badge.remove(); badge = null; };
    const fillRing = () => {
      const p = Math.min(1, (performance.now() - downAt) / HOLD_MS);
      btn.style.setProperty('--p', p);
      if (p >= 1 && !holdDone) {
        holdDone = true;
        btn.classList.remove('holding');
        sfx.helped();
        if (navigator.vibrate) navigator.vibrate(40);
        clearTimeout(decideTimer);
        taps = 0;
        clearBadge();
        operate(entry.data.id, 'hold');
        return;
      }
      if (!holdDone) raf = requestAnimationFrame(fillRing);
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('is-pressed', 'holding');
      sfx.click();
      downAt = performance.now();
      holdDone = false;
      clearTimeout(decideTimer);
      raf = requestAnimationFrame(fillRing);
    });
    const up = () => {
      if (!downAt) return;
      cancelAnimationFrame(raf);
      downAt = 0;
      btn.classList.remove('is-pressed', 'holding');
      btn.style.setProperty('--p', 0);
      if (holdDone) return;
      taps++;
      if (taps > 1) showCount();
      clearTimeout(decideTimer);
      decideTimer = setTimeout(() => {
        const v = taps >= 3 ? 'triple' : taps === 2 ? 'double' : 'press';
        taps = 0;
        setTimeout(clearBadge, 300);
        operate(entry.data.id, v);
      }, 450);
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
  }

  // 指北針：往哪個方向「滑一下」就指向哪裡（中難度 4 方位、高難度 8 方位）
  // 高難度另外可以「按住拖曳」：指針會被洋流推著晃，要撐在同一個方向 1.5 秒
  let compassTipAt = 0;
  function bindCompass(entry, dirs) {
    const dial = entry.el.querySelector('.compass');
    const n = dirs.length;
    const step = 360 / n;
    const hard = n === 8;
    const HOLD_MS = 1500;
    let g = null;
    let raf = 0;
    const angleOf = (dx, dy) => (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = 北，90 = 東
    const snap = (deg) => dirs[((Math.round(deg / step) % n) + n) % n];
    const wobble = (t) => (hard ? 18 * Math.sin(t * 1.9) + 9 * Math.sin(t * 3.3 + 1) : 0); // 洋流推力
    const showDir = (d) => dial.querySelectorAll('b').forEach((b) => b.classList.toggle('on', b.dataset.d === d));
    const setRing = (p) => { dial.style.setProperty('--hp', p); dial.classList.toggle('holding', p > 0); };

    const tick = () => {
      if (!g) return;
      const now = performance.now();
      if (g.moved && now - g.t0 > 260) {
        g.long = true;
        const r = dial.getBoundingClientRect();
        const needle = angleOf(g.x - (r.left + r.width / 2), g.y - (r.top + r.height / 2)) + wobble(now / 1000);
        g.needle = needle;
        entry.angle = nearestEquivalent(entry.angle, needle);
        dial.classList.add('dragging');
        dial.style.setProperty('--deg', `${entry.angle}deg`);
        const d = snap(needle);
        showDir(d);
        if (hard) {
          if (d !== g.holdDir) { g.holdDir = d; g.holdSince = now; }
          const p = Math.min(1, (now - g.holdSince) / HOLD_MS);
          setRing(p);
          if (p >= 1 && g.heldDir !== d) {
            g.heldDir = d;
            entry.data.value = d;
            sfx.helped();
            if (navigator.vibrate) navigator.vibrate(50);
            operate(entry.data.id, `hold:${d}`);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    dial.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dial.setPointerCapture(e.pointerId);
      g = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), moved: false, long: false, holdDir: null, holdSince: 0, heldDir: null, needle: 0 };
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    });
    dial.addEventListener('pointermove', (e) => {
      if (!g) return;
      g.x = e.clientX;
      g.y = e.clientY;
      if (Math.hypot(g.x - g.x0, g.y - g.y0) > 10) g.moved = true;
    });
    const end = (e, cancelled) => {
      if (!g) return;
      cancelAnimationFrame(raf);
      const gg = g;
      g = null;
      dial.classList.remove('dragging');
      setRing(0);
      if (cancelled) { setDeviceValue(entry.data.id, entry.data.value); return; }
      const dx = e.clientX - gg.x0;
      const dy = e.clientY - gg.y0;
      let next = null;
      if (Math.hypot(dx, dy) >= 18) next = gg.long ? snap(gg.needle) : snap(angleOf(dx, dy));
      if (!next) {
        // 只是點一下：提醒要用滑的
        retrigger(dial, 'nudge');
        if (Date.now() - compassTipAt > 4000) { compassTipAt = Date.now(); toast(hard ? '🧭 往方向滑一下；要「保持」就按住拖著撐 1.5 秒' : '🧭 往你要的方向滑一下！'); }
        setDeviceValue(entry.data.id, entry.data.value);
        return;
      }
      const before = entry.data.value;
      setDeviceValue(entry.data.id, next);
      if (next !== before && gg.heldDir !== next) { sfx.click(); operate(entry.data.id, next); }
    };
    dial.addEventListener('pointerup', (e) => end(e, false));
    dial.addEventListener('pointercancel', (e) => end(e, true));
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
    const el = dv.el;
    switch (dv.data.mode) {
      case 'twoWay':
        el.querySelector('.lever').setAttribute('aria-checked', value === 'on' ? 'true' : 'false');
        break;
      case 'threeWay': {
        const tri = el.querySelector('.tri');
        tri.dataset.v = value;
        tri.style.setProperty('--v', value);
        tri.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === value)));
        break;
      }
      case 'range5': {
        const range = el.querySelector('.magic-range');
        range.value = value;
        paintRange(range);
        break;
      }
      case 'step10':
        el.querySelector('.step-val').textContent = value;
        el.querySelectorAll('.ticks i').forEach((t, i) => t.classList.toggle('on', i <= value));
        break;
      case 'dir4':
      case 'dir8': {
        const dirs = dv.data.mode === 'dir8' ? DIR8 : DIRS;
        const dial = el.querySelector('.compass');
        dv.angle = nearestEquivalent(dv.angle, dirs.indexOf(value) * (360 / dirs.length));
        dial.style.setProperty('--deg', `${dv.angle}deg`);
        dial.setAttribute('aria-valuetext', DIR_NAME[value] || '');
        dial.querySelectorAll('b').forEach((b) => b.classList.toggle('on', b.dataset.d === value));
        break;
      }
      case 'options': {
        const n = dv.data.options.length;
        el.querySelector('.opt').textContent = dv.data.options[value];
        el.querySelector('.knob').style.setProperty('--deg', `${-120 + (240 / Math.max(1, n - 1)) * value}deg`);
        el.querySelectorAll('.opt-list i').forEach((t, i) => t.classList.toggle('on', i === value));
        break;
      }
      default: break;
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

  /** 指令文字：機關名稱標黃、要調整的值標紅 */
  function formatInstruction(text, deviceName) {
    let html = esc(text);
    if (deviceName) html = html.split(esc(deviceName)).join(`<span class="dev-name">${esc(deviceName)}</span>`);
    return html
      .replace(/轉到(東北|東南|西北|西南|北|東|南|西)！/, '轉到<span class="act">$1</span>！')
      .replace(/「(.+?)」/, '「<span class="act">$1</span>」')
      .replace(/調到 (\d+)！/, '調到 <span class="act">$1</span>！')
      .replace(/(關掉|調到半開|全開)！$/, '<span class="act">$1</span>！')
      .replace(/(連按三下|長按|按住)/, '<span class="act">$1</span>')
      .replace(/保持在(東北|東南|西北|西南|北|東|南|西)！/, '保持在<span class="act">$1</span>！')
      .replace(/(兩秒)！$/, '<span class="act">$1</span>！');
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
      const remaining = state.timerFrozen != null ? state.timerFrozen : Math.max(0, state.timerEnd - now);
      if (state.timerFrozen != null) {
        $('game-timer').textContent = fmtTime(state.timerFrozen);
        document.querySelector('.timer-box').classList.remove('urgent');
      } else if (SOLO.active && SOLO.mode === 'endless') {
        $('game-timer').textContent = fmtTime(SOLO.startAt ? now - SOLO.startAt : 0);
        document.querySelector('.timer-box').classList.remove('urgent');
      } else {
        $('game-timer').textContent = fmtTime(remaining);
        document.querySelector('.timer-box').classList.toggle('urgent', remaining <= 30000 && remaining > 0);
      }
      if (SOLO.active) renderSoloBars(now);
      if (DiveMusic.theme === 'game') {
        const airFrac = (state.stability - AIR_EMPTY) / (AIR_FULL - AIR_EMPTY);
        const progress = SOLO.active ? SOLO.progress : 1 - remaining / state.durationMs;
        const chaos = $('app').classList.contains('chaos') ? 0.3 : 0;
        // 水面休息：音樂退回平靜段
        DiveMusic.setTension(state.surface ? 0 : 0.35 * progress + 0.45 * (1 - airFrac) + chaos + (SOLO.active ? SOLO.extra : 0));
        DiveMusic.setLowAir(!state.surface && state.stability < LOW_AIR);
      }

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

  // 開局：先播跳水動畫，最後 3 秒倒數「3、2、1、下潛！」，結束後開始音樂
  let countdownTimers = [];
  function runCountdown(ms, onGo) {
    countdownTimers.forEach(clearTimeout);
    countdownTimers = [];
    const box = $('countdown');
    const num = $('countdown-num');
    const steps = ['3', '2', '1', '下潛！'];
    const countMs = Math.min(3000, ms);
    const introMs = ms - countMs;
    $('app').classList.add('locked');
    box.classList.add('hidden');
    ensureAudio();
    if (actx) DiveMusic.cue('intro', actx, ms / 1000);
    if (introMs >= 1500) {
      PixelScenes.intro($('app'), introMs);
      countdownTimers.push(setTimeout(() => splash(0, 0.7, 0.3), introMs * 0.36));
    }
    const gap = countMs / steps.length;
    steps.forEach((t, i) => countdownTimers.push(setTimeout(() => {
      box.classList.remove('hidden');
      num.textContent = t;
      num.classList.toggle('go', i === steps.length - 1);
      retrigger(num, 'tick');
      if (i === steps.length - 1) sfx.go(); else sfx.beep();
    }, introMs + i * gap)));
    countdownTimers.push(setTimeout(() => {
      box.classList.add('hidden');
      $('app').classList.remove('locked');
      startMusic();
      if (onGo) onGo();
    }, ms));
  }

  // ---------------------------------------------------------
  // 背景音樂
  // ---------------------------------------------------------
  // 首頁／大廳／結算：船上主題曲；遊戲中：緊張度音樂；開場、結局：過場配樂
  function startMusic() {
    ensureAudio();
    if (actx) DiveMusic.play('game', actx, 0.4);
  }
  function menuMusic() {
    if (actx && DiveMusic.enabled) DiveMusic.play('menu', actx);
  }
  function paintMusicBtn() {
    ['btn-music', 'btn-music-float'].forEach((id) => $(id).classList.toggle('off', !DiveMusic.enabled));
    $('solo-music').checked = DiveMusic.enabled;
  }
  paintMusicBtn();
  function toggleMusic() {
    ensureAudio();
    DiveMusic.toggle();
    paintMusicBtn();
    if (DiveMusic.enabled) {
      if (state.screen === 'game' && !state.inEnding && (state.surface || !$('app').classList.contains('locked'))) startMusic();
      else if (MENU_SCREENS.has(state.screen) && !state.inEnding) menuMusic();
    }
    toast(DiveMusic.enabled ? '🎵 音樂開' : '🔇 音樂關');
  }
  $('btn-music').addEventListener('click', toggleMusic);
  $('btn-music-float').addEventListener('click', toggleMusic);

  /** 結束：停音樂 → 播結局動畫 → 顯示結算 */
  function playEnding(reason, air, then) {
    state.inEnding = true;
    state.surface = false;
    state.timerFrozen = null;
    hideSurface();
    state.instr.active = false;
    countdownTimers.forEach(clearTimeout);
    $('countdown').classList.add('hidden');
    $('app').classList.remove('locked', 'chaos', 'low-air', 'fog', 'narc');
    accidentTimers.forEach(clearTimeout);
    const kind = PixelScenes.kindFor(reason, air);
    ensureAudio();
    if (actx) DiveMusic.cue(kind, actx);
    PixelScenes.ending($('app'), kind, () => { state.inEnding = false; then(); }, 5000);
  }

  socket.on('game:started', (g) => {
    leaveSoloUi();
    state.durationMs = g.durationMs || 180000;
    state.sliderMax = g.sliderMax || 4;
    state.stepMax = g.stepMax || 10;
    state.level = g.difficulty || 'medium';
    $('level-chip').textContent = g.levelLabel || '';
    accidentTimers.forEach(clearTimeout);
    $('app').classList.remove('fog', 'narc');
    state.timerEnd = performance.now() + g.remainingMs;
    state.timerFrozen = null;
    state.surface = false;
    state.lowAirWarned = false;
    hideSurface();
    rebuildPanel(g.devices, false);
    $('app').classList.remove('chaos', 'low-air');
    showScreen('game');
    setStability(g.stability);
    state.stageInfo = { label: g.levelLabel || '', stage: g.stage || 0, stages: g.stages || 1, site: g.site };
    paintChip();
    setInstruction(`${g.site && g.stages > 1 ? `${g.site.emoji} 第 1 潛：${esc(g.site.name)}<br>` : ''}先看清楚你的四個機關！<br><span class="text-base">指令出現就大聲喊給潛伴聽</span>`, { muted: true });
    runCountdown(g.countdownMs || 3000);
  });

  socket.on('game:timer', ({ remainingMs, paused }) => {
    if (paused) state.timerFrozen = remainingMs;
    else { state.timerFrozen = null; state.timerEnd = performance.now() + remainingMs; }
  });

  // ---------------------------------------------------------
  // 換潛點：水面休息 → 機關整組換新
  // ---------------------------------------------------------
  function paintChip() {
    const s = state.stageInfo;
    if (!s) return;
    const stageText = s.site ? `｜${s.site.emoji} 第${s.stage + 1}${s.stages ? `/${s.stages}` : ''}潛` : '';
    $('level-chip').textContent = `${s.label}${stageText}`;
  }
  function rebuildPanel(list, animate) {
    devices.clear();
    const panel = $('panel');
    panel.innerHTML = '';
    list.forEach((d, i) => {
      const el = createDevice(d);
      if (animate) { el.classList.add('dealt'); el.style.animationDelay = `${i * 0.08}s`; }
      panel.appendChild(el);
    });
    relayoutPanel();
  }
  function relayoutPanel() {
    const panel = $('panel');
    panel.classList.toggle('many', panel.children.length > 4);
  }
  let surfaceTimer = null;
  function showSurface({ stage, stages, site, ms, bonus }) {
    const card = $('surface-card');
    $('s-site').textContent = `${site.emoji} 第 ${stage + 1}${stages ? `/${stages}` : ''} 潛：${site.name}`;
    $('s-line').textContent = site.line || '';
    $('s-bonus').textContent = bonus > 0 ? `喝口水喘口氣　氣瓶 +${bonus} bar` : '';
    card.classList.remove('hidden');
    retrigger(card, 'pop');
    $('app').classList.add('locked');
    $('app').classList.remove('chaos', 'fog', 'narc');
    const end = performance.now() + ms;
    clearInterval(surfaceTimer);
    const paint = () => {
      const left = Math.max(0, Math.ceil((end - performance.now()) / 1000));
      $('s-count').textContent = left > 0 ? `${left} 秒後下潛` : '下潛！';
    };
    paint();
    surfaceTimer = setInterval(paint, 250);
    ensureAudio();
    if (actx) DiveMusic.jingle(actx);
    sfx.go();
    if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
  }
  function hideSurface() {
    clearInterval(surfaceTimer);
    $('surface-card').classList.add('hidden');
    if (state.screen === 'game' && !state.inEnding) $('app').classList.remove('locked');
  }

  socket.on('stage:surface', (s) => {
    if (SOLO.active) return;
    state.surface = true;
    state.instr.active = false;
    accidentTimers.forEach(clearTimeout);
    setInstruction('', { muted: true });
    rebuildPanel(s.devices, true);
    setStability(s.stability);
    state.stageInfo = { ...state.stageInfo, stage: s.stage, stages: s.stages, site: s.site };
    paintChip();
    showSurface(s);
  });
  socket.on('stage:dive', ({ stage, site }) => {
    if (SOLO.active) return;
    state.surface = false;
    hideSurface();
    setInstruction(`${site.emoji} 第 ${stage + 1} 潛：${esc(site.name)}<br><span class="text-base">指令來了就大聲喊！</span>`, { muted: true });
    sfx.beep();
  });

  // ---------------------------------------------------------
  // 機關故障：藤壺、名牌糊掉、漂到別人那邊
  // ---------------------------------------------------------
  function scrapeSfx() {
    if (!actx) return;
    sweep(1800 + Math.random() * 900, 900, 0, 0.05, 'sawtooth', 0.025);
  }
  function addBarnacle(id, need, onFixed) {
    const dv = devices.get(id);
    if (!dv || dv.barnacle) return;
    const body = dv.el.querySelector('.device-body');
    const ov = document.createElement('div');
    ov.className = 'barnacle';
    let shells = '';
    for (let i = 0; i < 10; i++) {
      shells += `<i style="left:${4 + Math.random() * 82}%;top:${2 + Math.random() * 70}%;--r:${Math.round(Math.random() * 360)}deg;--s:${(0.8 + Math.random() * 0.7).toFixed(2)}">${pick(['🐚', '🦪', '🪸', '🐚'])}</i>`;
    }
    ov.innerHTML = `${shells}<span class="barnacle-tip">🐚 手指來回搓掉！</span><span class="barnacle-bar"><b></b></span>`;
    body.appendChild(ov);
    dv.barnacle = { ov, need: need * 70, got: 0 };
    retrigger(dv.el, 'bad');
    if (navigator.vibrate) navigator.vibrate([30, 30, 30, 30, 30]);
    let last = null;
    ov.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { ov.setPointerCapture(e.pointerId); } catch (err) { /* 略過 */ }
      last = { x: e.clientX, y: e.clientY };
    });
    ov.addEventListener('pointermove', (e) => {
      if (!last || !dv.barnacle) return;
      const d = Math.hypot(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
      dv.barnacle.got += Math.min(d, 60);
      const p = Math.min(1, dv.barnacle.got / dv.barnacle.need);
      ov.style.setProperty('--p', p.toFixed(3));
      if (d > 4 && Math.random() < 0.3) scrapeSfx();
      if (p >= 1) {
        clearBarnacle(id, true);
        if (onFixed) onFixed();
      }
    });
    const up = () => { last = null; };
    ov.addEventListener('pointerup', up);
    ov.addEventListener('pointercancel', up);
  }
  function clearBarnacle(id, byMe) {
    const dv = devices.get(id);
    if (!dv || !dv.barnacle) return;
    const ov = dv.barnacle.ov;
    dv.barnacle = null;
    ov.classList.add('gone');
    setTimeout(() => ov.remove(), 450);
    if (byMe) {
      sfx.helped();
      toast('✨ 藤壺搓乾淨了！');
      if (navigator.vibrate) navigator.vibrate(40);
    }
  }
  function smudgeDevice(id, ms) {
    const dv = devices.get(id);
    if (!dv) return;
    const plate = dv.el.querySelector('.device-plate');
    const chars = [...dv.data.name];
    const hide = new Set();
    const n = Math.min(chars.length - 1, Math.ceil(chars.length * 0.55));
    while (hide.size < n) hide.add(Math.floor(Math.random() * chars.length));
    plate.innerHTML = chars.map((c, i) => (hide.has(i) ? `<i class="smudge">${esc(c)}</i>` : esc(c))).join('');
    plate.classList.add('wet');
    clearTimeout(dv.smudgeTimer);
    dv.smudgeTimer = setTimeout(() => { plate.textContent = dv.data.name; plate.classList.remove('wet'); }, ms);
    sweep(700, 300, 0, 0.25, 'sine', 0.08);
  }
  function driftOut(id, toName) {
    const dv = devices.get(id);
    if (!dv) return;
    devices.delete(id);
    dv.el.classList.add('drift-out');
    toast(`🌊「${dv.data.name}」被洋流沖到 ${toName} 那邊了！`);
    sweep(500, 150, 0, 0.6, 'sine', 0.1);
    setTimeout(() => { dv.el.remove(); relayoutPanel(); }, 900);
  }
  function driftIn(d, fromName) {
    const el = createDevice(d);
    el.classList.add('drift-in');
    $('panel').appendChild(el);
    relayoutPanel();
    toast(`🌊 ${fromName} 的「${d.name}」漂到你這裡了！`);
    sweep(150, 500, 0, 0.6, 'sine', 0.1);
    if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
  }
  socket.on('device:break', ({ deviceId, kind, scrub, ms }) => {
    if (state.screen !== 'game' || SOLO.active) return;
    if (kind === 'barnacle') {
      addBarnacle(deviceId, scrub || 7, () => socket.emit('device:fixed', { deviceId }));
      toast('🐚 有機關被藤壺黏住了！搓掉才能用');
    } else if (kind === 'smudge') {
      smudgeDevice(deviceId, ms || 12000);
      toast('💧 機關名牌被水糊掉了！靠潛伴喊的名字猜');
    }
  });
  socket.on('device:fixed', ({ deviceId }) => clearBarnacle(deviceId, false));
  socket.on('device:drift-out', ({ deviceId, toName }) => driftOut(deviceId, toName));
  socket.on('device:drift-in', ({ device, fromName }) => { if (state.screen === 'game') driftIn(device, fromName); });

  socket.on('game:chaos', () => {
    $('app').classList.add('chaos');
    sfx.alarm();
    if (navigator.vibrate) navigator.vibrate([80, 40, 80, 40, 80]);
    toast('🌊 洋流失控！指令越來越快！');
  });

  socket.on('instruction:new', (ins) => {
    if (ins.none) return setInstruction(esc(ins.text), { muted: true });
    setInstruction(formatInstruction(ins.text, ins.deviceName), { timed: true, duration: ins.durationMs });
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
      hint.textContent = hintText(dv);
      dv.el.appendChild(hint);
      setTimeout(() => hint.remove(), 1500);
    }
  });

  function hintText(dv) {
    if (dv.data.type === 'button') return '按法不對！';
    if (dv.data.type === 'compass') return dv.data.mode === 'dir8' ? '方向不對？還是要按住撐住？' : '方向不對！';
    return '還沒到位！';
  }

  socket.on('device:state', ({ deviceId, value }) => setDeviceValue(deviceId, value));

  // 高難度：潛水事故
  let accidentTimers = [];
  socket.on('accident', applyAccident);
  function applyAccident({ kind, ms, text }) {
    if (state.screen !== 'game') return;
    toast(text);
    sweep(900, 200, 0, 0.6, 'sine', 0.12);
    sweep(950, 180, 0.05, 0.6, 'sine', 0.08);
    if (navigator.vibrate) navigator.vibrate([60, 30, 60]);
    if (kind === 'fog' || kind === 'narcosis') {
      const cls = kind === 'fog' ? 'fog' : 'narc';
      $('app').classList.add(cls);
      accidentTimers.push(setTimeout(() => $('app').classList.remove(cls), ms));
    } else if (kind === 'current') {
      const panel = $('panel');
      const kids = [...panel.children];
      for (let i = kids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [kids[i], kids[j]] = [kids[j], kids[i]];
      }
      kids.forEach((k) => panel.appendChild(k));
      retrigger(panel, 'swirl');
      accidentTimers.push(setTimeout(() => panel.classList.remove('swirl'), ms));
    }
  }

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
    if (SOLO.active) return;
    lastResultSolo = false;
    playEnding(r.reason, r.stability, () => showMultiResult(r));
  });

  function showMultiResult(r) {
    const reasons = {
      timeup: '⏰ 潛水時間到！全員平安回到船上',
      collapse: '🫧 氣瓶只剩 20 bar！全員緊急上升',
      notEnough: '😶 潛伴都游走了，只好收隊',
    };
    $('result-reason').textContent = `${r.levelLabel ? r.levelLabel + '｜' : ''}${reasons[r.reason] || ''}`;
    $('result-rank').textContent = r.rank;
    $('result-completed').textContent = r.completed;
    $('result-failed').textContent = r.failed;
    $('result-wrong').textContent = r.wrong;
    $('result-stability').textContent = `${r.stability} bar`;
    $('result-time').textContent = fmtTime(r.survivedMs);
    const medals = ['🥇', '🥈', '🥉'];
    renderHighlights(r.highlights || []);
    state.card = {
      kind: PixelScenes.kindFor(r.reason, r.stability),
      level: r.levelLabel || '',
      reason: reasons[r.reason] || '',
      rank: r.rank,
      stats: [['完成', r.completed], ['逾時', r.failed], ['亂按', r.wrong], ['剩餘', `${r.stability} bar`]],
      players: r.players.map((p) => ({ name: p.name, title: p.title || '' })),
      highlights: r.highlights || [],
      sites: r.sites || [],
    };
    $('result-players').innerHTML = r.players.map((p, i) => `
      <li class="award pop-in ${p.id === socket.id ? 'me' : ''}" style="animation-delay:${0.25 + i * 0.35}s">
        <span class="pos">${medals[i] || i + 1}</span>
        <span class="who">${esc(p.name)}<small>幫忙 ${p.helped}｜亂按 ${p.mistakes}</small></span>
        <span class="title">${esc(p.title || '')}</span>
        <span class="why">${esc(p.titleWhy || '')}</span>
      </li>`).join('');
    const isHost = state.room && state.room.hostId === socket.id;
    $('btn-again').textContent = '🔁 回船上再潛一次';
    $('btn-again').classList.toggle('hidden', !isHost);
    $('result-wait').classList.toggle('hidden', isHost);
    $('btn-result-home').classList.add('hidden');
    showScreen('result');
    r.players.forEach((_, i) => setTimeout(() => bubble(0, 300 + i * 60), 250 + i * 350));
  }

  function renderHighlights(list) {
    $('result-hl-box').classList.toggle('hidden', !list.length);
    $('result-highlights').innerHTML = list.map((h, i) => `
      <li class="hl pop-in" style="animation-delay:${0.15 + i * 0.25}s">
        <span class="hl-icon">${esc(h.icon)}</span>
        <span class="hl-body"><b>${esc(h.title)}</b>${esc(h.text)}</span>
      </li>`).join('');
  }

  // ---------------------------------------------------------
  // 成績卡：用 canvas 畫一張可以存、可以傳到群組的圖
  // ---------------------------------------------------------
  const CARD_SANS = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC", sans-serif';
  const CARD_SERIF = '"Noto Serif TC", "Noto Serif CJK TC", "PMingLiU", serif';
  function fitFont(x, text, weight, size, family, maxW) {
    let px = size;
    x.font = `${weight} ${px}px ${family}`;
    while (px > 14 && x.measureText(text).width > maxW) { px -= 2; x.font = `${weight} ${px}px ${family}`; }
    return px;
  }
  async function drawCard(c) {
    const Wd = 1080, Ht = 1350;
    const cv = document.createElement('canvas');
    cv.width = Wd;
    cv.height = Ht;
    const x = cv.getContext('2d');
    const allText = [c.level, c.reason, c.rank, ...c.players.map((p) => p.name + p.title), ...c.highlights.map((h) => h.title + h.text), '深海大亂潛頒獎精華完成逾時亂按剩餘', ...c.stats.map((s) => String(s[1]))].join('');
    try {
      await Promise.race([
        Promise.all([`900 80px ${CARD_SERIF}`, `700 40px ${CARD_SANS}`, `900 40px ${CARD_SANS}`, `500 30px ${CARD_SANS}`].map((f) => document.fonts.load(f, allText))),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    } catch (e) { /* 字型載入失敗就用系統字 */ }
    // 海底背景
    const bg = x.createLinearGradient(0, 0, 0, Ht);
    bg.addColorStop(0, '#0e6a9a');
    bg.addColorStop(0.35, '#073b5e');
    bg.addColorStop(1, '#020b15');
    x.fillStyle = bg;
    x.fillRect(0, 0, Wd, Ht);
    x.save();
    x.globalAlpha = 0.08;
    x.fillStyle = '#e0f7ff';
    [[120, 260], [380, 520], [700, 820], [900, 1040]].forEach(([a, b]) => { x.beginPath(); x.moveTo(a, 0); x.lineTo(b, 0); x.lineTo(b + 220, Ht); x.lineTo(a - 60, Ht); x.fill(); });
    x.restore();
    x.strokeStyle = 'rgba(224,247,255,.16)';
    x.lineWidth = 3;
    for (let i = 0; i < 26; i++) {
      const bx = (i * 397) % Wd, by = 300 + ((i * 613) % (Ht - 300)), r = 6 + ((i * 7) % 18);
      x.beginPath(); x.arc(bx, by, r, 0, Math.PI * 2); x.stroke();
    }
    x.textAlign = 'center';
    x.textBaseline = 'alphabetic';
    // 標題
    x.shadowColor = 'rgba(103,232,249,.8)';
    x.shadowBlur = 24;
    x.fillStyle = '#e0f7ff';
    x.font = `900 92px ${CARD_SERIF}`;
    x.fillText('深海大亂潛', Wd / 2, 130);
    x.shadowBlur = 0;
    x.fillStyle = 'rgba(207,250,254,.85)';
    fitFont(x, c.level, 700, 36, CARD_SANS, 900);
    x.fillText(`${c.level}　${new Date().toLocaleDateString('zh-TW')}`, Wd / 2, 190);
    // 像素潛水員
    const icon = PixelScenes.icon(c.kind);
    const scale = 13;
    x.imageSmoothingEnabled = false;
    x.drawImage(icon, Wd / 2 - (icon.width * scale) / 2, 220, icon.width * scale, icon.height * scale);
    let y = 220 + icon.height * scale + 60;
    x.fillStyle = '#cffafe';
    fitFont(x, c.reason, 700, 36, CARD_SANS, 960);
    x.fillText(c.reason, Wd / 2, y);
    y += 78;
    x.fillStyle = '#facc15';
    x.shadowColor = 'rgba(0,0,0,.6)';
    x.shadowBlur = 10;
    fitFont(x, c.rank, 900, 66, CARD_SERIF, 980);
    x.fillText(c.rank, Wd / 2, y);
    x.shadowBlur = 0;
    // 數字
    y += 40;
    const colW = 960 / c.stats.length;
    c.stats.forEach(([label, val], i) => {
      const cx = 60 + colW * i;
      x.fillStyle = 'rgba(0,0,0,.35)';
      x.beginPath();
      x.roundRect ? x.roundRect(cx + 8, y, colW - 16, 120, 20) : x.rect(cx + 8, y, colW - 16, 120);
      x.fill();
      x.fillStyle = ['#6ee7b7', '#fcd34d', '#fda4af', '#7dd3fc'][i % 4];
      fitFont(x, String(val), 900, 50, CARD_SANS, colW - 40);
      x.fillText(String(val), cx + colW / 2, y + 62);
      x.fillStyle = 'rgba(207,250,254,.75)';
      x.font = `500 26px ${CARD_SANS}`;
      x.fillText(label, cx + colW / 2, y + 100);
    });
    y += 175;
    // 稱號
    const hl = c.highlights.slice(0, 2);
    const footer = Ht - 50;
    const listBottom = footer - 30 - hl.length * 58;
    const n = Math.max(1, c.players.length);
    const rowH = Math.min(70, (listBottom - y) / n);
    x.textAlign = 'left';
    c.players.forEach((p, i) => {
      const ry = y + rowH * i + rowH * 0.7;
      x.fillStyle = '#ecfeff';
      const namePx = fitFont(x, p.name, 900, Math.min(36, rowH * 0.62), CARD_SANS, 260);
      x.font = `900 ${namePx}px ${CARD_SANS}`;
      x.fillText(p.name, 80, ry);
      x.fillStyle = '#facc15';
      fitFont(x, p.title, 900, Math.min(36, rowH * 0.62), CARD_SERIF, 640);
      x.fillText(p.title, 360, ry);
    });
    // 精華
    let hy = listBottom + 40;
    hl.forEach((h) => {
      x.fillStyle = '#a5f3fc';
      const t = `${h.icon} ${h.title}：${h.text}`;
      fitFont(x, t, 500, 30, CARD_SANS, 940);
      x.fillText(t, 70, hy);
      hy += 58;
    });
    x.textAlign = 'center';
    x.fillStyle = 'rgba(207,250,254,.55)';
    x.font = `500 26px ${CARD_SANS}`;
    x.fillText(`🤿 ${location.host || '深海大亂潛'}`, Wd / 2, footer);
    return new Promise((res) => cv.toBlob(res, 'image/png'));
  }
  let cardUrl = null;
  let cardBlob = null;
  $('btn-card').addEventListener('click', async () => {
    if (!state.card) return;
    const btn = $('btn-card');
    btn.disabled = true;
    btn.textContent = '📸 製作中……';
    try {
      cardBlob = await drawCard(state.card);
      if (cardUrl) URL.revokeObjectURL(cardUrl);
      cardUrl = URL.createObjectURL(cardBlob);
      $('card-img').src = cardUrl;
      $('btn-card-dl').href = cardUrl;
      const file = new File([cardBlob], '深海大亂潛-成績卡.png', { type: 'image/png' });
      $('btn-card-share').classList.toggle('hidden', !(navigator.canShare && navigator.canShare({ files: [file] })));
      $('card-modal').classList.remove('hidden');
    } catch (e) {
      toast('成績卡做不出來，換個瀏覽器試試');
    }
    btn.disabled = false;
    btn.textContent = '📸 存成績卡（分享到群組）';
  });
  $('btn-card-share').addEventListener('click', async () => {
    if (!cardBlob) return;
    try {
      await navigator.share({ files: [new File([cardBlob], '深海大亂潛-成績卡.png', { type: 'image/png' })], title: '深海大亂潛' });
    } catch (e) { /* 取消分享 */ }
  });
  $('btn-card-close').addEventListener('click', () => $('card-modal').classList.add('hidden'));
  $('card-modal').addEventListener('click', (e) => { if (e.target.id === 'card-modal') $('card-modal').classList.add('hidden'); });

  let lastResultSolo = false;
  $('btn-again').addEventListener('click', () => {
    if (lastResultSolo) startSolo();
    else socket.emit('game:lobby');
  });
  $('btn-result-home').addEventListener('click', () => { leaveSoloUi(); showScreen('home'); });

  socket.on('disconnect', () => {
    if (SOLO.active || state.screen === 'solo' || lastResultSolo) return;
    toast('與潛水船的連線中斷了……');
    showScreen('home');
  });

  // =========================================================
  // 單人練習：AI 潛伴用語音喊你，機關都在自己手上
  // =========================================================
  const SOLO_LEVELS = {
    easy: { label: '🐠 體驗潛水', count: 6, conc: 1, ms: [9000, 6500], wrong: 2, timeout: 4, bonus: 3, rate: 1.0, hide: 0, accidents: false, chaosMs: 0, breakMs: 22000, breaks: ['barnacle'] },
    medium: { label: '🐬 進階潛水員', count: 6, conc: 2, ms: [9500, 6500], wrong: 4, timeout: 6, bonus: 2, rate: 1.1, hide: 0, accidents: false, chaosMs: 30000, breakMs: 16000, breaks: ['barnacle', 'smudge'] },
    hard: { label: '🦈 技術潛水', count: 6, conc: 2, ms: [10000, 6500], wrong: 5, timeout: 8, bonus: 1, rate: 1.2, hide: 0.45, accidents: true, chaosMs: 45000, breakMs: 12000, breaks: ['barnacle', 'smudge'] },
  };
  const SOLO_STAGES = 3;            // 計時模式分 3 個潛點
  const SOLO_ENDLESS_STAGE_MS = 60000; // 無盡模式每 60 秒換一個潛點
  const SOLO_SURFACE_MS = 6000;
  const SITES = {
    first: [
      { name: '小琉球・海龜村', emoji: '🐢', line: '先暖身，別被海龜笑' },
      { name: '墾丁・後壁湖', emoji: '🐠', line: '水很淺，丟臉會被看光光' },
    ],
    middle: [
      { name: '綠島・大香菇', emoji: '🍄', line: '水流開始變大，抓緊裝備' },
      { name: '東北角・龍洞', emoji: '🐉', line: '浪有點兇，機關換一批新的' },
      { name: '蘭嶼・八代灣沉船', emoji: '🚢', line: '沉船裡的機關都長藤壺了' },
    ],
    final: [
      { name: '深藍・無底斷崖', emoji: '🌌', line: '最後一潛！指令只會更快' },
      { name: '綠島・夜潛', emoji: '🔦', line: '黑漆漆的，喊大聲一點' },
    ],
  };
  function soloSite(i) {
    if (SOLO.sites[i]) return SOLO.sites[i];
    let site;
    if (i === 0) site = pick(SITES.first);
    else if (SOLO.mode === 'timed' && i === SOLO_STAGES - 1) site = pick(SITES.final);
    else {
      const prev = SOLO.sites[i - 1];
      const opts = (SOLO.mode === 'timed' ? SITES.middle : SITES.middle.concat(SITES.final)).filter((x) => x !== prev);
      site = pick(opts);
    }
    SOLO.sites[i] = site;
    return site;
  }
  const SOLO_TIMED_MS = (/[?&]debug/.test(location.search) && Number(new URLSearchParams(location.search).get('solosec')) * 1000) || 180000; // 測試用可縮短
  const BUDDIES = [
    { e: '🐢', n: '龜龜教練', pitch: 0.75 },
    { e: '🐙', n: '八爪阿姨', pitch: 1.35 },
    { e: '🐡', n: '膨膨', pitch: 1.7 },
    { e: '🦈', n: '豆丁鯊', pitch: 1.0 },
  ];
  const THANKS = ['讚啦！', '你是神！', '手速很可以喔', '下一潛帶你去綠島', '這就是默契！', '水下推進器本人'];
  const SOLO_WRONG = ['你在按什麼啦！', '那顆不是我說的！', '手滑了齁？', '教練在搖頭了', '別亂摸！'];
  const SOLO_TIMEOUT = ['我喊到沒氣了……', '你有在聽嗎？', '我的指令沉到海底了', '算了我自己來……'];
  const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const SOLO = { active: false, running: false, progress: 0, extra: 0, orders: [], mode: 'timed', level: 'medium' };
  if (/[?&]debug/.test(location.search)) window.__solo = SOLO;
  let soloBank = null;
  let soloVoice = null;

  // ---- 和伺服器相同的機關規則（單人版在手機上自己判斷） ----
  const SLIDE_NAME = { 0: '拉到底部', 2: '推到中間', 4: '推到頂端' };
  const TRI_NAME = ['關掉', '調到半開', '全開'];
  function soloMode(level, d) {
    switch (d.type) {
      case 'button': return level === 'hard' ? 'gesture' : 'tap';
      case 'switch': return level === 'easy' ? 'twoWay' : 'threeWay';
      case 'slider': return level === 'hard' ? 'step10' : 'range5';
      case 'compass': return level === 'hard' ? 'dir8' : 'dir4';
      default: return 'options';
    }
  }
  const readyOf = (d) => (d.type === 'switch' ? (d.target === 'on' ? 'off' : 'on') : d.type === 'slider' ? (d.target === 0 ? 4 : 0) : null);
  function soloInitial(level, d) {
    const r = (arr) => arr[Math.floor(Math.random() * arr.length)];
    switch (soloMode(level, d)) {
      case 'twoWay': return readyOf(d);
      case 'threeWay': return r([0, 1, 2]);
      case 'range5': return level === 'easy' ? readyOf(d) : r([0, 2, 4]);
      case 'step10': return Math.floor(Math.random() * 11);
      case 'dir4': return r(DIRS);
      case 'dir8': return r(DIR8);
      case 'options': return Math.floor(Math.random() * d.options.length);
      default: return null;
    }
  }
  /** 回傳 { target, text, key }；key 是語音辨識時要聽到的關鍵字 */
  function soloBuild(level, d, current) {
    const other = (arr) => { const o = arr.filter((v) => v !== current); return o[Math.floor(Math.random() * o.length)]; };
    switch (soloMode(level, d)) {
      case 'tap': return { target: 'press', text: d.instruction, key: '' };
      case 'twoWay': return { target: d.target, text: d.instruction, key: d.target === 'on' ? '開' : '關' };
      case 'range5': {
        if (level === 'easy') return { target: d.target, text: d.instruction, key: { 0: '底', 2: '中', 4: '頂' }[d.target] };
        const t = other([0, 2, 4]);
        return { target: t, text: `把${d.name}${SLIDE_NAME[t]}！`, key: { 0: '底', 2: '中', 4: '頂' }[t] };
      }
      case 'gesture': {
        const t = pick(['press', 'press', 'triple', 'hold']);
        if (t === 'triple') return { target: t, text: `連按三下${d.name}！`, key: '三' };
        if (t === 'hold') return { target: t, text: `長按${d.name}兩秒！`, key: '長' };
        return { target: t, text: d.instruction, key: '' };
      }
      case 'threeWay': { const t = other([0, 1, 2]); return { target: t, text: `把${d.name}${TRI_NAME[t]}！`, key: ['關', '半', '全'][t] }; }
      case 'step10': { const t = other([...Array(11).keys()]); return { target: t, text: `把${d.name}調到 ${t}！`, key: String(t) }; }
      case 'dir4':
      case 'dir8': {
        const t = other(level === 'hard' ? DIR8 : DIRS);
        if (level === 'hard' && Math.random() < 0.35) return { target: `hold:${t}`, text: `按住${d.name}，保持在${DIR_NAME[t]}！`, key: DIR_NAME[t] };
        return { target: t, text: `把${d.name}轉到${DIR_NAME[t]}！`, key: DIR_NAME[t] };
      }
      case 'options': { const t = other([...d.options.keys()]); return { target: t, text: `把${d.name}轉到「${d.options[t]}」！`, key: d.options[t] }; }
      default: return { target: 'press', text: d.instruction, key: '' };
    }
  }
  function targetMatches(target, value) {
    if (typeof target === 'string' && target.startsWith('hold:')) return value === target;
    if (typeof value === 'string' && value.startsWith('hold:')) return value.slice(5) === target;
    return value === target;
  }
  function mixTypes(list) {
    const buckets = Object.values(list.reduce((a, d) => ((a[d.type] = a[d.type] || []).push(d), a), {}))
      .map((b) => b.sort(() => Math.random() - 0.5)).sort(() => Math.random() - 0.5);
    const out = [];
    while (buckets.some((b) => b.length)) for (const b of buckets) if (b.length) out.push(b.pop());
    return out;
  }

  // ---- 設定畫面 ----
  const soloPrefs = { level: storageGet('solo-level') || 'medium', mode: storageGet('solo-mode') || 'timed' };
  const bestKey = (level, mode) => `dive-best-${level}-${mode}`;
  function getBest(level, mode) { try { return JSON.parse(storageGet(bestKey(level, mode))) || null; } catch (e) { return null; } }
  function renderSoloSetup() {
    $('solo-diff').querySelectorAll('.diff').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.level === soloPrefs.level)));
    $('solo-mode').querySelectorAll('.diff').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === soloPrefs.mode)));
    $('solo-mic-row').classList.toggle('hidden', !SR);
    $('solo-music').checked = DiveMusic.enabled;
    if (!canSpeak) { $('solo-voice').checked = false; $('solo-voice').disabled = true; }
    $('solo-best').innerHTML = ['easy', 'medium', 'hard'].map((lv) => {
      const b = getBest(lv, soloPrefs.mode);
      return `<div class="best-cell">${SOLO_LEVELS[lv].label}<b>${b ? b.score.toLocaleString() : '—'}</b>${b ? `完成 ${b.completed}` : '還沒玩過'}</div>`;
    }).join('');
  }
  $('btn-solo').addEventListener('click', () => {
    ensureAudio();
    renderSoloSetup();
    showScreen('solo');
    loadSoloBank().catch(() => {});
  });
  $('btn-solo-back').addEventListener('click', () => showScreen('home'));
  $('solo-diff').addEventListener('click', (e) => {
    const b = e.target.closest('.diff');
    if (!b) return;
    soloPrefs.level = b.dataset.level;
    storageSet('solo-level', soloPrefs.level);
    sfx.click();
    renderSoloSetup();
  });
  $('solo-mode').addEventListener('click', (e) => {
    const b = e.target.closest('.diff');
    if (!b) return;
    soloPrefs.mode = b.dataset.mode;
    storageSet('solo-mode', soloPrefs.mode);
    sfx.click();
    renderSoloSetup();
  });
  $('solo-music').addEventListener('change', (e) => {
    if (e.target.checked !== DiveMusic.enabled) toggleMusic();
  });
  $('btn-solo-start').addEventListener('click', () => startSolo());

  async function loadSoloBank() {
    if (soloBank) return soloBank;
    const res = await fetch('/api/devices');
    const data = await res.json();
    if (!data.ok) throw new Error('bank');
    soloBank = data;
    return data;
  }

  // ---- 語音朗讀 ----
  function pickVoice() {
    if (!canSpeak) return null;
    const voices = speechSynthesis.getVoices();
    return voices.find((v) => /zh[-_]TW/i.test(v.lang)) || voices.find((v) => /zh[-_](HK|Hant)/i.test(v.lang))
      || voices.find((v) => /^zh/i.test(v.lang)) || null;
  }
  if (canSpeak) {
    soloVoice = pickVoice();
    speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', () => { soloVoice = pickVoice(); });
  }
  function speak(text, buddy, onStart) {
    if (!SOLO.voice || !canSpeak) { onStart(); return; }
    const u = new SpeechSynthesisUtterance(text.replace(/[「」]/g, ''));
    u.lang = (soloVoice && soloVoice.lang) || 'zh-TW';
    if (soloVoice) u.voice = soloVoice;
    u.rate = SOLO.L.rate * (SOLO.mode === 'endless' ? 1 + Math.min(0.25, SOLO.extra) : 1);
    u.pitch = buddy.pitch;
    let started = false;
    const go = () => { if (!started) { started = true; onStart(); } };
    u.onstart = go;
    u.onerror = go;
    setTimeout(go, 3500); // 有些手機不會觸發 onstart，最多等 3.5 秒就開始計時
    speechSynthesis.speak(u);
  }

  // ---- 開始 ----
  async function startSolo() {
    ensureAudio();
    let bank;
    try { bank = await loadSoloBank(); } catch (e) { toast('載入題庫失敗，請檢查網路再試一次'); return; }
    const level = soloPrefs.level;
    const L = SOLO_LEVELS[level];
    const pool = mixTypes(bank.devices.filter((d) => (bank.typeLevels[d.type] || []).includes(level)));
    if (pool.length < L.count) { toast('這個難度的機關不夠，請到後台多啟用幾個'); return; }
    if (canSpeak) { try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(' ')); } catch (e) { /* 解鎖語音 */ } }

    Object.assign(SOLO, {
      active: true, running: false, level, mode: soloPrefs.mode, L,
      voice: $('solo-voice').checked && canSpeak, mic: !!SR && $('solo-mic').checked,
      air: AIR_FULL, orders: [], mine: pool.slice(0, L.count), relayPool: pool.slice(L.count),
      relayState: new Map(), stats: { completed: 0, failed: 0, wrong: 0, combo: 0, bestCombo: 0, react: [] },
      startAt: 0, nextOrderAt: 0, lastDevice: null, lastPenaltyAt: 0, chaos: false, lastAccidentAt: 0,
      progress: 0, extra: 0, tick: null, ended: false,
      pool, stage: 0, sites: [], surfaceAt: 0, surfaceUntil: 0, nextBreakAt: 0,
      log: { drops: [], devTimeouts: new Map(), fastest: null, stageDone: [0], fiddles: 0, scrubbed: 0, slowScrub: 0 },
    });
    lastResultSolo = true;
    state.level = level;
    state.sliderMax = 4;
    state.stepMax = 10;
    state.durationMs = SOLO_TIMED_MS;
    state.timerEnd = performance.now() + 6500 + SOLO_TIMED_MS;
    state.lowAirWarned = false;
    $('app').classList.add('solo-mode');
    $('app').classList.remove('chaos', 'low-air', 'fog', 'narc');
    $('solo-orders').classList.remove('hidden');
    $('solo-orders').innerHTML = '';
    $('instruction-text').innerHTML = '';
    $('timer-label').textContent = SOLO.mode === 'timed' ? '剩餘潛水時間' : '已潛時間';
    state.timerFrozen = null;
    state.surface = false;
    hideSurface();
    const site = soloSite(0);
    state.stageInfo = { label: `${L.label}｜${SOLO.mode === 'timed' ? '計時' : '無盡'}`, stage: 0, stages: SOLO.mode === 'timed' ? SOLO_STAGES : null, site };
    paintChip();
    rebuildPanel(SOLO.mine.map((d) => ({ ...d, mode: soloMode(level, d), value: soloInitial(level, d) })), false);
    showScreen('game');
    setStability(AIR_FULL);
    renderOrders();
    runCountdown(6500, soloBegin);
  }

  function soloBegin() {
    if (!SOLO.active) return;
    SOLO.running = true;
    SOLO.startAt = performance.now();
    state.timerEnd = SOLO.startAt + SOLO_TIMED_MS;
    SOLO.nextOrderAt = SOLO.startAt + 300;
    SOLO.nextBreakAt = SOLO.startAt + SOLO.L.breakMs * 0.7;
    SOLO.tick = setInterval(soloTick, 150);
  }

  function soloTick() {
    if (!SOLO.running) return;
    const now = performance.now();
    const L = SOLO.L;
    const timed = SOLO.mode === 'timed';
    // 水面休息中
    if (SOLO.surfaceUntil) {
      if (now < SOLO.surfaceUntil) return;
      const rest = now - SOLO.surfaceAt;
      SOLO.surfaceUntil = 0;
      SOLO.startAt += rest; // 休息不算潛水時間
      state.timerEnd += rest;
      state.timerFrozen = null;
      state.surface = false;
      hideSurface();
      SOLO.nextOrderAt = now + 500;
      SOLO.lastAccidentAt = now;
      SOLO.nextBreakAt = now + L.breakMs * 0.6;
      renderOrders();
      sfx.beep();
      return;
    }
    const elapsed = now - SOLO.startAt;
    if (timed && elapsed >= SOLO_TIMED_MS) return endSolo('timeup');
    const stageLen = timed ? SOLO_TIMED_MS / SOLO_STAGES : SOLO_ENDLESS_STAGE_MS;
    if ((!timed || SOLO.stage < SOLO_STAGES - 1) && elapsed >= (SOLO.stage + 1) * stageLen) return soloSurface(now, elapsed);
    if (L.breakMs && now >= SOLO.nextBreakAt) {
      SOLO.nextBreakAt = now + L.breakMs * (0.75 + Math.random() * 0.5);
      soloBreakdown(now);
    }
    SOLO.progress = Math.min(1, elapsed / SOLO_TIMED_MS);
    SOLO.extra = timed ? 0 : Math.min(0.6, Math.max(0, (elapsed - SOLO_TIMED_MS) / 200000));

    // 洋流失控：計時模式最後 N 秒；無盡模式 2 分 30 秒後
    const chaosAt = timed ? SOLO_TIMED_MS - L.chaosMs : 150000;
    if (!SOLO.chaos && (L.chaosMs > 0 || !timed) && elapsed >= chaosAt) {
      SOLO.chaos = true;
      $('app').classList.add('chaos');
      sfx.alarm();
      if (navigator.vibrate) navigator.vibrate([80, 40, 80, 40, 80]);
      toast('🌊 洋流失控！潛伴們開始亂喊了！');
    }
    if (SOLO.chaos && L.accidents && now - SOLO.lastAccidentAt > 7000) {
      SOLO.lastAccidentAt = now;
      applyAccident(pick([
        { kind: 'fog', ms: 3500, text: '🌫️ 面鏡起霧！什麼都看不清楚' },
        { kind: 'current', ms: 1200, text: '🌊 洋流把你的裝備沖亂了！' },
        { kind: 'narcosis', ms: 5000, text: '🍸 氮醉了！字都顛倒了' },
      ]));
    }

    // 逾時
    for (const o of SOLO.orders.slice()) {
      if (o.startedAt && now - o.startedAt >= o.duration) soloTimeout(o);
      if (!SOLO.running) return;
    }
    // 配發新指令
    let conc = L.conc + (SOLO.chaos ? 1 : 0) + (!timed && elapsed > 120000 ? 1 : 0);
    conc = Math.min(conc, SOLO.mine.length - 1, 3); // 畫面最多同時 3 條
    if (SOLO.orders.length < conc && now >= SOLO.nextOrderAt) {
      issueSoloOrder(now, elapsed);
      SOLO.nextOrderAt = now + 700 + Math.random() * (SOLO.chaos ? 700 : 1500);
    }
  }

  /** 單人：換潛點 */
  function soloSurface(now, elapsed) {
    const L = SOLO.L;
    const timed = SOLO.mode === 'timed';
    SOLO.stage++;
    SOLO.log.stageDone[SOLO.stage] = 0;
    SOLO.surfaceAt = now;
    SOLO.surfaceUntil = now + SOLO_SURFACE_MS;
    state.surface = true;
    state.timerFrozen = timed ? Math.max(0, SOLO_TIMED_MS - elapsed) : elapsed;
    if (canSpeak) speechSynthesis.cancel();
    for (const o of SOLO.orders.slice()) removeOrder(o); // 作廢，不扣氣
    SOLO.chaos = false;
    accidentTimers.forEach(clearTimeout);
    const used = new Set(SOLO.mine.map((d) => d.id));
    const next = [...mixTypes(SOLO.pool.filter((d) => !used.has(d.id))), ...mixTypes(SOLO.pool.filter((d) => used.has(d.id)))];
    SOLO.mine = next.slice(0, L.count);
    SOLO.relayPool = next.slice(L.count);
    SOLO.lastDevice = null;
    rebuildPanel(SOLO.mine.map((d) => ({ ...d, mode: soloMode(SOLO.level, d), value: soloInitial(SOLO.level, d) })), true);
    const bonus = Math.min(5, AIR_FULL - SOLO.air);
    SOLO.air += bonus;
    setStability(SOLO.air);
    const site = soloSite(SOLO.stage);
    state.stageInfo = { ...state.stageInfo, stage: SOLO.stage, site };
    paintChip();
    showSurface({ stage: SOLO.stage, stages: timed ? SOLO_STAGES : null, site, ms: SOLO_SURFACE_MS, bonus });
  }

  /** 單人：機關故障（藤壺、糊字） */
  function soloBreakdown(now) {
    const ids = [...devices.keys()].filter((id) => !devices.get(id).barnacle);
    if (!ids.length) return;
    const hot = SOLO.orders.filter((o) => !o.relay && ids.includes(o.deviceId)).map((o) => o.deviceId);
    const id = hot.length && Math.random() < 0.6 ? pick(hot) : pick(ids);
    const kind = pick(SOLO.L.breaks);
    if (kind === 'barnacle') {
      const at = now;
      addBarnacle(id, SOLO.level === 'hard' ? 9 : 7, () => {
        SOLO.log.scrubbed++;
        SOLO.log.slowScrub = Math.max(SOLO.log.slowScrub, performance.now() - at);
      });
      setTimeout(() => clearBarnacle(id, false), 25000);
      toast('🐚 有機關被藤壺黏住了！搓掉才能用');
    } else {
      smudgeDevice(id, 12000);
      toast('💧 機關名牌被水糊掉了！聽潛伴喊的名字猜');
    }
  }

  function issueSoloOrder(now, elapsed) {
    const L = SOLO.L;
    const busyBuddies = new Set(SOLO.orders.map((o) => o.buddy));
    const buddy = pick(BUDDIES.filter((b) => !busyBuddies.has(b)).length ? BUDDIES.filter((b) => !busyBuddies.has(b)) : BUDDIES);
    let dur = L.ms[0] - (L.ms[0] - L.ms[1]) * SOLO.progress;
    if (SOLO.mode === 'endless') dur = Math.max(3500, dur * (1 - 0.35 * Math.min(1, SOLO.extra / 0.6)));

    // 偶爾換你喊（需要語音辨識）
    if (SOLO.mic && SOLO.relayPool.length && !SOLO.orders.some((o) => o.relay) && Math.random() < 0.22) {
      const d = pick(SOLO.relayPool);
      const cur = SOLO.relayState.has(d.id) ? SOLO.relayState.get(d.id) : soloInitial(SOLO.level, d);
      const b = soloBuild(SOLO.level, d, cur);
      SOLO.relayState.set(d.id, b.target);
      const o = { id: Math.random().toString(36).slice(2), relay: true, buddy, dev: d, text: b.text, key: b.key, target: b.target, duration: dur * 1.6, startedAt: now };
      SOLO.orders.push(o);
      renderOrders();
      sfx.newInstr();
      return;
    }

    const targeted = new Set(SOLO.orders.filter((o) => !o.relay).map((o) => o.deviceId));
    let cands = SOLO.mine.filter((d) => !targeted.has(d.id));
    if (cands.length > 1) cands = cands.filter((d) => d.id !== SOLO.lastDevice);
    if (!cands.length) return;
    const d = pick(cands);
    const entry = devices.get(d.id);
    if (SOLO.level === 'easy') {
      const ready = readyOf(d);
      if (ready !== null && entry.data.value !== ready) setDeviceValue(d.id, ready);
    }
    const b = soloBuild(SOLO.level, d, entry.data.value);
    const o = {
      id: Math.random().toString(36).slice(2), relay: false, buddy, deviceId: d.id, dev: d, text: b.text, target: b.target,
      hidden: L.hide > 0 && Math.random() < L.hide, duration: dur, startedAt: 0, issuedAt: now,
    };
    SOLO.lastDevice = d.id;
    SOLO.orders.push(o);
    renderOrders();
    speak(o.text, buddy, () => { if (!o.startedAt && SOLO.orders.includes(o)) { o.startedAt = performance.now(); } });
    if (!SOLO.voice) sfx.newInstr();
  }

  function renderOrders() {
    const box = $('solo-orders');
    const keep = new Set(SOLO.orders.map((o) => o.id));
    box.querySelectorAll('.order').forEach((el) => { if (!keep.has(el.dataset.id) && !el.classList.contains('done')) el.remove(); });
    for (const o of SOLO.orders) {
      if (box.querySelector(`.order[data-id="${o.id}"]`)) continue;
      const el = document.createElement('div');
      el.className = `order ${o.relay ? 'relay' : ''}`;
      el.dataset.id = o.id;
      const say = o.relay
        ? `跟 ${esc(o.buddy.n)} 喊：${formatInstruction(o.text, o.dev.name)}`
        : o.hidden ? `🔊 ${esc(o.buddy.n)} 在喊……（點這裡再聽一次）` : formatInstruction(o.text, o.dev.name);
      el.innerHTML = `<span class="who">${o.buddy.e}</span><span class="say ${o.hidden ? 'hidden-text' : ''}">${say}</span>
        ${o.relay ? '<button type="button" class="mic" aria-label="按下後對手機喊">🎤</button>' : ''}<span class="bar"></span>`;
      if (o.hidden) el.addEventListener('click', () => speak(o.text, o.buddy, () => {}));
      if (o.relay) el.querySelector('.mic').addEventListener('click', () => listenRelay(o, el));
      box.appendChild(el);
    }
    if (!SOLO.orders.length && SOLO.running) {
      if (!box.querySelector('.idle')) box.insertAdjacentHTML('beforeend', '<p class="idle text-center text-sm text-sky-900/70">🫧 潛伴們在換氣……</p>');
    } else box.querySelectorAll('.idle').forEach((x) => x.remove());
  }

  function renderSoloBars(now) {
    for (const o of SOLO.orders) {
      const el = document.querySelector(`.order[data-id="${o.id}"] .bar`);
      if (!el) continue;
      const frac = o.startedAt ? Math.max(0, 1 - (now - o.startedAt) / o.duration) : 1;
      el.style.width = `${frac * 100}%`;
      el.classList.toggle('warn', frac <= 0.5 && frac > 0.25);
      el.classList.toggle('danger', frac <= 0.25);
    }
  }

  function removeOrder(o) {
    SOLO.orders = SOLO.orders.filter((x) => x !== o);
    const el = document.querySelector(`.order[data-id="${o.id}"]`);
    if (el) { el.classList.add('done'); setTimeout(() => { el.remove(); renderOrders(); }, 380); }
    if (o.recog) { try { o.recog.abort(); } catch (e) { /* 略過 */ } }
  }

  function changeAir(delta) {
    const before = SOLO.air;
    SOLO.air = Math.max(AIR_EMPTY, Math.min(AIR_FULL, SOLO.air + delta));
    if (SOLO.air < before) SOLO.log.drops.push([SOLO.stage, performance.now() - SOLO.startAt, before - SOLO.air]);
    setStability(SOLO.air);
    if (delta < 0) damageFx();
    if (SOLO.air <= AIR_EMPTY) endSolo('collapse');
  }

  function soloSuccess(o) {
    const st = SOLO.stats;
    st.completed++;
    st.combo++;
    st.bestCombo = Math.max(st.bestCombo, st.combo);
    if (o.startedAt) st.react.push(performance.now() - o.startedAt);
    SOLO.log.stageDone[SOLO.stage] = (SOLO.log.stageDone[SOLO.stage] || 0) + 1;
    if (!o.relay && o.startedAt) {
      const ms = performance.now() - o.startedAt;
      if (!SOLO.log.fastest || ms < SOLO.log.fastest.ms) SOLO.log.fastest = { ms, device: o.dev.name };
    }
    removeOrder(o);
    flashSuccess();
    toast(`${o.buddy.e} ${o.buddy.n}：${pick(THANKS)}${st.combo >= 3 ? `（${st.combo} 連擊！）` : ''}`);
    changeAir(SOLO.L.bonus);
  }

  function soloTimeout(o) {
    SOLO.stats.failed++;
    if (!o.relay) SOLO.log.devTimeouts.set(o.dev.name, (SOLO.log.devTimeouts.get(o.dev.name) || 0) + 1);
    SOLO.stats.combo = 0;
    removeOrder(o);
    sfx.timeout();
    toast(`${o.buddy.e} ${o.buddy.n}：${pick(SOLO_TIMEOUT)}`);
    changeAir(-SOLO.L.timeout);
  }

  function soloOperate(id, value) {
    if (!SOLO.running || SOLO.surfaceUntil) return;
    const dv = devices.get(id);
    const o = SOLO.orders.find((x) => !x.relay && x.deviceId === id);
    if (o && targetMatches(o.target, value)) {
      retrigger(dv.el, 'ok');
      sfx.helped();
      soloSuccess(o);
      if (SOLO.level === 'easy') {
        const ready = readyOf(o.dev);
        if (ready !== null) setTimeout(() => { if (SOLO.running && !SOLO.orders.some((x) => x.deviceId === id)) setDeviceValue(id, ready); }, 700);
      }
      return;
    }
    if (o) {
      SOLO.log.fiddles++;
      const old = dv.el.querySelector('.hint');
      if (old) old.remove();
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = hintText(dv);
      dv.el.appendChild(hint);
      setTimeout(() => hint.remove(), 1500);
      return;
    }
    retrigger(dv.el, 'bad');
    const now = performance.now();
    if (now - SOLO.lastPenaltyAt < 1000) return;
    SOLO.lastPenaltyAt = now;
    SOLO.stats.wrong++;
    SOLO.stats.combo = 0;
    toast(`${pick(BUDDIES).e} ${pick(SOLO_WRONG)}`);
    changeAir(-SOLO.L.wrong);
  }

  // ---- 換你喊：語音辨識 ----
  function normalizeSpeech(s) {
    return String(s).replace(/[\s，。！？、「」,.!?：:]/g, '').replace(/\d+/g, (n) => (Number(n) <= 10 ? CN_NUM[Number(n)] : n));
  }
  function relayMatches(transcript, o) {
    const t = normalizeSpeech(transcript);
    const name = normalizeSpeech(o.dev.name);
    let hit = 0;
    for (const ch of name) if (t.includes(ch)) hit++;
    const key = normalizeSpeech(o.key || '');
    return hit / name.length >= 0.6 && (!key || t.includes(key) || [...key].filter((c) => t.includes(c)).length / key.length >= 0.6);
  }
  function listenRelay(o, el) {
    if (!SR || o.recog) return;
    if (canSpeak) speechSynthesis.cancel();
    const rec = new SR();
    o.recog = rec;
    rec.lang = 'zh-TW';
    rec.interimResults = false;
    rec.maxAlternatives = 4;
    const btn = el.querySelector('.mic');
    btn.classList.add('listening');
    rec.onresult = (ev) => {
      const alts = [...ev.results[0]].map((a) => a.transcript);
      if (alts.some((a) => relayMatches(a, o))) {
        if (SOLO.orders.includes(o)) soloSuccess(o);
      } else {
        toast(`🎤 ${o.buddy.n} 沒聽懂：「${alts[0] || '……'}」再喊一次！`);
      }
    };
    rec.onerror = (ev) => { toast(ev.error === 'not-allowed' ? '🎤 需要允許使用麥克風' : '🎤 沒聽到，再按一次喊喊看'); };
    rec.onend = () => { o.recog = null; btn.classList.remove('listening'); };
    try { rec.start(); } catch (e) { o.recog = null; btn.classList.remove('listening'); }
  }

  // ---- 結束 ----
  function endSolo(reason) {
    if (!SOLO.running) return;
    SOLO.running = false;
    SOLO.surfaceUntil = 0;
    clearInterval(SOLO.tick);
    if (canSpeak) speechSynthesis.cancel();
    SOLO.orders.forEach((o) => { if (o.recog) try { o.recog.abort(); } catch (e) { /* 略過 */ } });
    const elapsed = performance.now() - SOLO.startAt;
    const st = SOLO.stats;
    const timed = SOLO.mode === 'timed';
    const score = st.completed * 100 + st.bestCombo * 25 + (timed ? (reason === 'timeup' ? (SOLO.air - AIR_EMPTY) * 5 : 0) : Math.floor(elapsed / 1000) * 2);
    const prev = getBest(SOLO.level, SOLO.mode);
    const isRecord = !prev || score > prev.score;
    if (isRecord) storageSet(bestKey(SOLO.level, SOLO.mode), JSON.stringify({ score, completed: st.completed, date: new Date().toISOString().slice(0, 10) }));
    const result = { reason, score, isRecord, prevBest: prev ? prev.score : 0, elapsed, air: SOLO.air, level: SOLO.level, mode: SOLO.mode };
    playEnding(reason, SOLO.air, () => showSoloResult(result));
  }

  function soloTitle(r) {
    const st = SOLO.stats;
    const avg = st.react.length ? st.react.reduce((a, b) => a + b, 0) / st.react.length : 0;
    if (r.reason === 'collapse') return ['👻 在海底領便當的潛水員', `撐了 ${fmtTime(r.elapsed)}，氣瓶先投降了`];
    if (st.wrong === 0 && st.completed >= 10) return ['🧘 中性浮力之神', '零失誤，穩到可以在水裡打坐'];
    if (avg && avg < 2200 && st.completed >= 8) return ['⚡ 閃電鬼蝠魟', `平均 ${(avg / 1000).toFixed(1)} 秒就搞定，手速快到起水泡`];
    if (st.bestCombo >= 10) return ['🐬 連擊海豚', `最高 ${st.bestCombo} 連擊，潛伴們看傻了`];
    if (st.wrong >= 6) return ['🐡 一碰就爆的河豚', `亂按 ${st.wrong} 次，裝備都被你玩壞了`];
    if (st.failed >= 6) return ['🐢 被海龜超車的潛水員', `${st.failed} 條指令沒接到，海龜回頭看了你一眼`];
    return pick([
      ['🫧 只會吐泡泡的觀光客', '全程貢獻最多的是氣泡'],
      ['🦀 橫著走的迷路螃蟹', '指北針在你手上也沒用'],
      ['🧜 自以為是美人魚的大叔', '動作很優雅，效率很普通'],
      ['🐙 手太多的章魚哥', '手很忙，但不一定按對'],
    ]);
  }

  function showSoloResult(r) {
    const st = SOLO.stats;
    const L = SOLO.L;
    const reasons = { timeup: '⏰ 潛水時間到，平安回船', collapse: '🫧 氣瓶只剩 20 bar，緊急上升' };
    $('result-reason').textContent = `${L.label}｜${r.mode === 'timed' ? '計時 3 分鐘' : '無盡下潛'}｜${reasons[r.reason] || ''}`;
    $('result-rank').textContent = `得分 ${r.score.toLocaleString()}${r.isRecord ? '　🎉 新紀錄！' : ''}`;
    $('result-completed').textContent = st.completed;
    $('result-failed').textContent = st.failed;
    $('result-wrong').textContent = st.wrong;
    $('result-stability').textContent = `${r.air} bar`;
    $('result-time').textContent = fmtTime(r.elapsed);
    const [title, why] = soloTitle(r);
    const avg = st.react.length ? (st.react.reduce((a, b) => a + b, 0) / st.react.length / 1000).toFixed(1) : '—';
    const outcome = PixelScenes.kindFor(r.reason, r.air);
    const quotes = {
      safe: ['下一潛帶你去蘭嶼！', '這默契可以考潛水長了', '今天的你值得一杯珍奶'],
      panting: ['還行啦，下次別喘成這樣', '你差點讓我們上新聞', '先去旁邊喘一下'],
      passout: ['……我們把你拖上船了', '下次記得看殘壓表好嗎', '你的氣瓶比你先放棄'],
    }[outcome];
    $('result-players').innerHTML = `
      <li class="award pop-in me" style="animation-delay:.25s">
        <span class="pos">🏅</span>
        <span class="who">你<small>最高 ${st.bestCombo} 連擊｜平均 ${avg} 秒</small></span>
        <span class="title">${esc(title)}</span>
        <span class="why">${esc(why)}${r.isRecord ? '' : `（最高紀錄 ${r.prevBest.toLocaleString()}）`}</span>
      </li>
      ${BUDDIES.slice(0, 3).map((b, i) => `
      <li class="award pop-in" style="animation-delay:${0.6 + i * 0.3}s">
        <span class="pos">${b.e}</span>
        <span class="who">${esc(b.n)}</span>
        <span class="why">「${esc(quotes[i % quotes.length])}」</span>
      </li>`).join('')}`;
    const hl = soloHighlights();
    renderHighlights(hl);
    state.card = {
      kind: outcome,
      level: `${L.label}｜${r.mode === 'timed' ? '計時 3 分鐘' : '無盡下潛'}`,
      reason: reasons[r.reason] || '',
      rank: `${title}${r.isRecord ? '　🎉新紀錄' : ''}`,
      stats: [['完成', st.completed], ['逾時', st.failed], ['亂按', st.wrong], ['得分', r.score.toLocaleString()]],
      players: [{ name: (nameInput.value.trim() || '我'), title: why }].concat(BUDDIES.slice(0, 3).map((b, i) => ({ name: `${b.e} ${b.n}`, title: `「${quotes[i % quotes.length]}」` }))),
      highlights: hl,
    };
    $('btn-again').textContent = '🔁 再潛一次';
    $('btn-again').classList.remove('hidden');
    $('result-wait').classList.add('hidden');
    $('btn-result-home').classList.remove('hidden');
    SOLO.active = false;
    showScreen('result');
    if (r.isRecord) setTimeout(() => sfx.success(), 600);
  }

  function soloHighlights() {
    const log = SOLO.log;
    const out = [];
    const site = (i) => (SOLO.sites[i] ? SOLO.sites[i].name : '');
    let worst = null;
    log.drops.forEach(([stg, t], i) => {
      let sum = 0;
      for (let j = i; j < log.drops.length && log.drops[j][0] === stg && log.drops[j][1] - t <= 10000; j++) sum += log.drops[j][2];
      if (!worst || sum > worst.sum) worst = { stg, sum };
    });
    if (worst && worst.sum >= 10) out.push({ icon: '💥', title: '最慘一刻', text: `第 ${worst.stg + 1} 潛（${site(worst.stg)}）10 秒內噴掉 ${worst.sum} bar` });
    const cursed = [...log.devTimeouts].sort((a, b) => b[1] - a[1])[0];
    if (cursed && cursed[1] >= 2) out.push({ icon: '👹', title: '最難搞的機關', text: `「${cursed[0]}」讓你逾時 ${cursed[1]} 次` });
    if (log.fastest && log.fastest.ms < 3500) out.push({ icon: '⚡', title: '最快的一次', text: `只花 ${(log.fastest.ms / 1000).toFixed(1)} 秒就搞定「${log.fastest.device}」` });
    if (log.fiddles >= 4) out.push({ icon: '🔧', title: '調到天荒地老', text: `調了 ${log.fiddles} 次才調對，機關都快轉壞了` });
    if (log.scrubbed >= 2) out.push({ icon: '🐚', title: '藤壺清潔工', text: `搓掉 ${log.scrubbed} 坨藤壺，可以去沉船打工了` });
    else if (log.slowScrub > 7000) out.push({ icon: '🐚', title: '跟藤壺奮戰', text: `一坨藤壺搓了 ${(log.slowScrub / 1000).toFixed(0)} 秒` });
    if (SOLO.sites.length > 1) {
      let best = 0;
      log.stageDone.forEach((n, i) => { if (n > (log.stageDone[best] || 0)) best = i; });
      if (log.stageDone[best] > 0) out.push({ icon: SOLO.sites[best].emoji, title: '手感最好的潛點', text: `${site(best)}：完成 ${log.stageDone[best]} 條` });
    }
    return out.slice(0, 4);
  }

  function leaveSoloUi() {
    if (SOLO.running) { SOLO.running = false; clearInterval(SOLO.tick); if (canSpeak) speechSynthesis.cancel(); }
    SOLO.active = false;
    $('app').classList.remove('solo-mode');
    $('solo-orders').classList.add('hidden');
    $('solo-orders').innerHTML = '';
    $('timer-label').textContent = '剩餘潛水時間';
    state.timerFrozen = null;
    state.surface = false;
    hideSurface();
  }
})();
