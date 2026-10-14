/* =========================================================
   深海大亂潛 — 開場與結局動畫（純 SVG + CSS，不需要圖檔）
   DiveScenes.intro(app, ms)        背滾下水 → 濺起水花 → 往下潛
   DiveScenes.ending(app, kind, cb)  safe 安全上升／panting 喘氣上岸／passout 昏倒沉下去
   ========================================================= */
(() => {
  'use strict';

  const DIVER = `
  <svg class="diver" viewBox="0 0 100 170" aria-hidden="true">
    <rect class="tank" x="33" y="22" width="34" height="26" rx="9" fill="#facc15" stroke="#a16207" stroke-width="2"/>
    <rect x="45" y="15" width="10" height="9" rx="2" fill="#94a3b8"/>
    <g class="arm arm-l"><line x1="32" y1="66" x2="14" y2="96" stroke="#1e3a5f" stroke-width="11" stroke-linecap="round"/><circle cx="13" cy="99" r="6" fill="#f1c27d"/></g>
    <g class="arm arm-r"><line x1="68" y1="66" x2="86" y2="96" stroke="#1e3a5f" stroke-width="11" stroke-linecap="round"/><circle cx="87" cy="99" r="6" fill="#f1c27d"/></g>
    <rect x="34" y="108" width="13" height="34" rx="6" fill="#1e3a5f"/>
    <rect x="53" y="108" width="13" height="34" rx="6" fill="#1e3a5f"/>
    <path class="fin" d="M30 138 h20 l4 26 h-28 z" fill="#ff8a00"/>
    <path class="fin" d="M50 138 h20 l4 26 h-28 z" fill="#ff8a00"/>
    <rect x="28" y="58" width="44" height="56" rx="18" fill="#1e3a5f"/>
    <rect x="31" y="62" width="38" height="30" rx="10" fill="#0f172a"/>
    <path d="M36 62 L44 92 M64 62 L56 92" stroke="#ff8a00" stroke-width="4"/>
    <circle cx="50" cy="40" r="19" fill="#f1c27d"/>
    <path d="M31 38 a19 19 0 0 1 38 0 v-6 a19 19 0 0 0 -38 0 z" fill="#0f172a"/>
    <ellipse class="cheek" cx="36" cy="49" rx="4" ry="2.5" fill="#fb7185"/>
    <ellipse class="cheek" cx="64" cy="49" rx="4" ry="2.5" fill="#fb7185"/>
    <rect x="34" y="30" width="32" height="16" rx="6" fill="#a5f3fc" fill-opacity=".85" stroke="#facc15" stroke-width="3"/>
    <g class="eyes"><circle cx="43" cy="38" r="2.6" fill="#0f172a"/><circle cx="57" cy="38" r="2.6" fill="#0f172a"/></g>
    <g class="eyes-x" stroke="#0f172a" stroke-width="2.2" stroke-linecap="round">
      <path d="M40 35 l6 6 M46 35 l-6 6"/><path d="M54 35 l6 6 M60 35 l-6 6"/>
    </g>
    <g class="reg"><path d="M50 55 q14 4 22 -8" stroke="#111" stroke-width="3" fill="none"/><circle cx="50" cy="54" r="5.5" fill="#111"/></g>
    <g class="sweat" fill="#7dd3fc"><path d="M74 26 q3 5 0 7 q-3 -2 0 -7z"/><path d="M26 30 q3 5 0 7 q-3 -2 0 -7z"/></g>
  </svg>`;

  const BOAT = `
  <svg class="boat" viewBox="0 0 220 90" aria-hidden="true">
    <rect x="120" y="12" width="6" height="30" fill="#64748b"/>
    <path d="M126 12 l28 8 l-28 8 z" fill="#ef4444"/>
    <rect x="60" y="22" width="70" height="28" rx="4" fill="#f8fafc" stroke="#94a3b8" stroke-width="2"/>
    <rect x="70" y="29" width="14" height="10" rx="2" fill="#7dd3fc"/><rect x="92" y="29" width="14" height="10" rx="2" fill="#7dd3fc"/>
    <path d="M8 50 h204 l-26 34 h-150 z" fill="#f8fafc" stroke="#94a3b8" stroke-width="2"/>
    <path d="M14 58 h192" stroke="#ef4444" stroke-width="6"/>
    <text x="110" y="78" text-anchor="middle" font-size="12" font-weight="900" fill="#0e7490">深海大亂潛號</text>
  </svg>`;

  function bubblesHtml(n) {
    let s = '';
    for (let i = 0; i < n; i++) {
      const size = 5 + Math.random() * 12;
      s += `<i style="left:${35 + Math.random() * 30}%;width:${size}px;height:${size}px;animation-delay:${(Math.random() * 1.6).toFixed(2)}s;animation-duration:${(1.6 + Math.random() * 1.4).toFixed(2)}s"></i>`;
    }
    return `<div class="scene-bubbles">${s}</div>`;
  }

  function mount(app, cls, inner) {
    const old = app.querySelector('.scene');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = `scene ${cls}`;
    el.innerHTML = inner;
    app.appendChild(el);
    return el;
  }

  const DiveScenes = {
    /** 開場：坐在船邊背滾下水 → 水花 → 下潛（ms 內播完，之後自動移除） */
    intro(app, ms = 3400) {
      const el = mount(app, 'scene-intro', `
        <div class="sky"></div><div class="sea"></div><div class="surface"></div>
        ${BOAT}
        <div class="diver-wrap">${DIVER}</div>
        <div class="splash"><i></i><i></i><i></i><i></i><i></i></div>
        ${bubblesHtml(14)}
        <div class="depth">0 m</div>
        <p class="caption">🤿 背滾下水……</p>`);
      el.style.setProperty('--dur', `${ms}ms`);
      const depth = el.querySelector('.depth');
      const cap = el.querySelector('.caption');
      const t0 = performance.now();
      const tick = () => {
        const p = (performance.now() - t0) / ms;
        if (p >= 1 || !el.isConnected) return;
        if (p > 0.38) depth.textContent = `${Math.round(((p - 0.38) / 0.62) * 18)} m`;
        if (p > 0.4 && cap.dataset.s !== '1') { cap.dataset.s = '1'; cap.textContent = '💦 撲通！'; }
        if (p > 0.6 && cap.dataset.s !== '2') { cap.dataset.s = '2'; cap.textContent = '⬇️ 平壓……下潛中'; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      setTimeout(() => el.remove(), ms + 50);
      return el;
    },

    /** 結局動畫，播完（或點一下跳過）呼叫 done */
    ending(app, kind, done, ms = 4600) {
      const captions = {
        safe: ['🛑 5 米安全停留……', '👌 安全上升！全員平安上船'],
        panting: ['🚀 衝上水面！', '😮‍💨 呼……呼……有點喘，但活著回來了'],
        passout: ['🫧 氣瓶見底……', '💀 你在水裡 pass out 了（潛伴正在把你拖上船）'],
      }[kind];
      const el = mount(app, `scene-end end-${kind}`, `
        <div class="sky"></div><div class="sea"></div><div class="surface"></div>
        ${BOAT}
        <div class="diver-wrap">${DIVER}</div>
        <div class="splash"><i></i><i></i><i></i><i></i><i></i></div>
        ${kind === 'passout' ? '<div class="ghost">👻</div><div class="lost-reg"></div>' : bubblesHtml(10)}
        ${kind === 'panting' ? '<div class="huff"><b>呼</b><b>呼</b><b>呼</b></div>' : ''}
        ${kind === 'safe' ? '<div class="ok">👌</div><div class="sparkle">✨</div>' : ''}
        <p class="caption">${captions[0]}</p>
        <p class="skip">點一下跳過</p>`);
      el.style.setProperty('--dur', `${ms}ms`);
      const cap = el.querySelector('.caption');
      setTimeout(() => { if (el.isConnected) { cap.textContent = captions[1]; cap.classList.add('final'); } }, ms * 0.48);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        el.classList.add('fade');
        setTimeout(() => el.remove(), 350);
        done && done();
      };
      el.addEventListener('pointerdown', finish);
      setTimeout(finish, ms + 900);
      return el;
    },

    /** 依結果選結局 */
    kindFor(reason, air) {
      if (reason === 'collapse') return 'passout';
      return air >= 60 ? 'safe' : 'panting';
    },
  };

  window.DiveScenes = DiveScenes;
})();
