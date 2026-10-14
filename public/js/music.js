/* =========================================================
   深海大亂潛 — 背景音樂（Web Audio 即時合成，不需要音檔）
   D 小調，依「緊張度」0～1 切換三個段落，每段有自己的和弦進行：
     平靜  Dm  → B♭ → Gm → Asus4→A     （轉折處用 sus4 再解決）
     緊張  Dm  → Gm → B♭ → A7          （回頭前用屬七）
     失控  Dm  → E♭ → C  → A7          （拿坡里色彩的 E♭，更不安）
   速度 84 → 140 BPM；水下濾波越緊張越打開；氣量低時加入心跳鼓。
   另外還有：船上主題曲（首頁／大廳／結算）、開場配樂、三種結局配樂、水面休息小過門。
   ========================================================= */
(() => {
  'use strict';

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // pad：和弦內音；bass：根音；resolve：同一小節後半要解決到的和弦
  const SECTIONS = {
    calm: [
      { pad: [62, 65, 69], bass: 38 },               // Dm
      { pad: [58, 62, 65], bass: 46 },               // B♭
      { pad: [55, 58, 62], bass: 43 },               // Gm
      { pad: [57, 62, 64], bass: 45, resolve: [57, 61, 64] }, // Asus4 → A
    ],
    tense: [
      { pad: [62, 65, 69], bass: 38 },               // Dm
      { pad: [55, 58, 62], bass: 43 },               // Gm
      { pad: [58, 62, 65], bass: 46 },               // B♭
      { pad: [57, 61, 64, 67], bass: 45 },           // A7
    ],
    chaos: [
      { pad: [62, 65, 69], bass: 38 },               // Dm
      { pad: [55, 58, 63], bass: 39 },               // E♭
      { pad: [55, 60, 64], bass: 36 },               // C
      { pad: [57, 61, 64, 67], bass: 45 },           // A7
    ],
  };
  const LEAD = [74, 81, 82, 81]; // 失控段的警報旋律 D5 A5 B♭5 A5

  class Engine {
    constructor(ctx, dest) {
      this.ctx = ctx;
      this.tension = 0;
      this.lowAir = false;
      this.out = ctx.createGain();
      this.out.gain.value = 0.0001;
      this.bus = ctx.createGain();
      this.bus.gain.value = 0.55;
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 900;
      this.filter.Q.value = 0.8;
      // 水下迴音
      this.delay = ctx.createDelay(1);
      this.delay.delayTime.value = 0.3;
      const fb = ctx.createGain();
      fb.gain.value = 0.28;
      const wet = ctx.createGain();
      wet.gain.value = 0.22;
      this.bus.connect(this.filter);
      this.filter.connect(this.out);
      this.filter.connect(this.delay);
      this.delay.connect(fb).connect(this.delay);
      this.delay.connect(wet).connect(this.out);
      this.out.connect(dest);

      const len = Math.floor(ctx.sampleRate * 0.5);
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      this.step = 0;
      this.bar = 0;
      this.next = 0;
      this.section = 'calm';
      this.chord = SECTIONS.calm[0];
    }

    begin(t, fadeIn = 1.5) {
      this.next = t + 0.05;
      this.step = 0;
      this.bar = 0;
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setValueAtTime(0.0001, t);
      this.out.gain.exponentialRampToValueAtTime(1, t + fadeIn);
    }

    fadeOut(t, secs = 1.2) {
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setValueAtTime(Math.max(0.0001, this.out.gain.value), t);
      this.out.gain.exponentialRampToValueAtTime(0.0001, t + secs);
    }

    stepDur() {
      const bpm = 84 + 56 * this.tension;
      return 60 / bpm / 4; // 16 分音符
    }

    schedule(until) {
      while (this.next < until) {
        this.playStep(this.step, this.next);
        this.next += this.stepDur();
        this.step = (this.step + 1) % 16;
        if (this.step === 0) this.bar++;
      }
    }

    playStep(s, t) {
      const sd = this.stepDur();
      if (s === 0) {
        this.section = this.tension < 0.35 ? 'calm' : this.tension < 0.7 ? 'tense' : 'chaos';
        this.chord = SECTIONS[this.section][this.bar % 4];
        this.filter.frequency.setTargetAtTime(700 + 2800 * this.tension, t, 0.5);
        this.pad(this.chord.pad, t, sd * (this.chord.resolve ? 8 : 16));
      }
      if (s === 8 && this.chord.resolve) this.pad(this.chord.resolve, t, sd * 8);

      const sec = this.section;
      const root = this.chord.bass;
      // 貝斯
      if (sec === 'calm' && (s === 0 || s === 8)) this.bassNote(root, t, 0.5);
      if (sec === 'tense' && s % 2 === 0) this.bassNote(s % 4 === 0 ? root : root + 12, t, 0.25, 0.24);
      if (sec === 'chaos') this.bassNote(s % 4 === 2 ? root + 12 : root, t, 0.14, 0.28);
      // 氣泡琶音
      const tones = this.chord.resolve && s >= 8 ? this.chord.resolve : this.chord.pad;
      if (sec === 'calm' && s % 4 === 2) this.blip(tones[(s / 4) % tones.length | 0] + 12, t, 0.025);
      if (sec === 'tense' && s % 2 === 0) this.blip(tones[(s / 2) % tones.length | 0] + 12, t, 0.055);
      if (sec === 'chaos') this.blip(tones[s % tones.length] + 12 + (s % 8 === 7 ? 12 : 0), t, 0.055);
      // 鈸
      if (sec === 'tense' && s % 2 === 1) this.hat(t, 0.08);
      if (sec === 'tense' && (s === 4 || s === 12)) this.snare(t, 0.12);
      if (sec === 'chaos') this.hat(t, s % 4 === 2 ? 0.12 : 0.06);
      if (sec === 'chaos' && (s === 4 || s === 12 || s === 14)) this.snare(t, 0.16);
      // 失控警報旋律
      if (sec === 'chaos' && s % 4 === 0 && this.bar % 2 === 1) this.lead(LEAD[s / 4], t, sd * 3);
      // 低氣量心跳
      if (this.lowAir && (s === 0 || s === 3 || (this.tension > 0.7 && (s === 8 || s === 11)))) this.kick(t);
    }

    env(g, t, peak, attack, decay) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }

    pad(notes, t, dur) {
      const ctx = this.ctx;
      for (const m of notes) {
        for (const [type, det, vol] of [['triangle', -4, 0.035], ['sine', 5, 0.03]]) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = type;
          o.frequency.value = mtof(m);
          o.detune.value = det;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.35, dur * 0.3));
          g.gain.setValueAtTime(vol, t + dur * 0.8);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.05);
          o.connect(g).connect(this.bus);
          o.start(t);
          o.stop(t + dur * 1.1);
        }
      }
    }

    bassNote(m, t, dur, peak = 0.2) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = mtof(m);
      f.type = 'lowpass';
      f.frequency.value = 380 + 500 * this.tension;
      this.env(g, t, peak, 0.01, dur);
      o.connect(f).connect(g).connect(this.bus);
      o.start(t);
      o.stop(t + dur + 0.05);
    }

    blip(m, t, vol) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(mtof(m), t);
      o.frequency.exponentialRampToValueAtTime(mtof(m) * 1.03, t + 0.08);
      this.env(g, t, vol, 0.008, 0.13);
      o.connect(g).connect(this.bus);
      o.start(t);
      o.stop(t + 0.18);
    }

    hat(t, vol) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      src.buffer = this.noise;
      f.type = 'highpass';
      f.frequency.value = 6500;
      this.env(g, t, vol, 0.003, 0.045);
      src.connect(f).connect(g).connect(this.out); // 鈸不經過水下濾波，比較清楚
      src.start(t, Math.random() * 0.3, 0.08);
    }

    snare(t, vol) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      src.buffer = this.noise;
      f.type = 'bandpass';
      f.frequency.value = 1800;
      f.Q.value = 0.7;
      this.env(g, t, vol, 0.003, 0.14);
      src.connect(f).connect(g).connect(this.out);
      src.start(t, Math.random() * 0.3, 0.2);
    }

    kick(t) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
      this.env(g, t, 0.36, 0.005, 0.26);
      o.connect(g).connect(this.out);
      o.start(t);
      o.stop(t + 0.3);
    }

    lead(m, t, dur) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = mtof(m);
      this.env(g, t, 0.035, 0.01, dur);
      o.connect(g).connect(this.bus);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  // =========================================================
  // 船上主題曲（首頁、大廳、結算）：F 大調、輕鬆的海島木琴
  // A 段  F → Dm → B♭ → Csus4→C
  // B 段  B♭ → C → Am → Gm→C7      （轉回 A 段前才用屬七）
  // 曲式 A A B A，第一次 A 段只有伴奏，之後才出旋律
  // =========================================================
  const MENU_A = [
    { pad: [65, 69, 72], bass: 41 },                         // F
    { pad: [62, 65, 69], bass: 38 },                         // Dm
    { pad: [62, 65, 70], bass: 46 },                         // B♭
    { pad: [65, 67, 72], bass: 36, resolve: [64, 67, 72] },  // Csus4 → C
  ];
  const MENU_B = [
    { pad: [62, 65, 70], bass: 46 },                         // B♭
    { pad: [64, 67, 72], bass: 36 },                         // C
    { pad: [64, 69, 72], bass: 45 },                         // Am
    { pad: [62, 67, 70], bass: 43, resolve: [64, 67, 70, 72], resolveBass: 36 }, // Gm → C7
  ];
  // 旋律：[第幾個 16 分音符, 音高, 長度(16分音符)]
  const MEL_A = [
    [[0, 72, 4], [4, 74, 2], [6, 72, 2], [8, 69, 6]],
    [[0, 69, 2], [2, 72, 2], [4, 74, 4], [8, 77, 6]],
    [[0, 77, 2], [2, 74, 2], [4, 72, 4], [8, 70, 4], [12, 69, 4]],
    [[0, 67, 4], [4, 72, 4], [8, 72, 8]],
  ];
  const MEL_B = [
    [[0, 74, 6], [6, 72, 2], [8, 70, 4], [12, 74, 4]],
    [[0, 76, 6], [6, 74, 2], [8, 72, 8]],
    [[0, 72, 4], [4, 76, 4], [8, 81, 8]],
    [[0, 79, 4], [4, 77, 4], [8, 76, 4], [12, 74, 4]],
  ];

  class MenuEngine extends Engine {
    constructor(ctx, dest) {
      super(ctx, dest);
      this.filter.frequency.value = 2600; // 在船上：聲音比較亮
      this.bus.gain.value = 1.05;
    }
    stepDur() { return 60 / 100 / 4; }
    playStep(s, t) {
      const sd = this.stepDur();
      const form = (this.bar % 16) >> 2;        // 0 A、1 A、2 B、3 A
      const inB = form === 2;
      const ch = (inB ? MENU_B : MENU_A)[this.bar % 4];
      const swing = s % 2 === 1 ? sd * 0.16 : 0; // 輕微搖擺
      const tt = t + swing;
      if (s === 0) this.pad(ch.pad, t, sd * (ch.resolve ? 8 : 16), 0.6);
      if (s === 8 && ch.resolve) this.pad(ch.resolve, t, sd * 8, 0.6);
      const half = ch.resolve && s >= 8;
      const tones = half ? ch.resolve : ch.pad;
      const root = half && ch.resolveBass ? ch.resolveBass : ch.bass;
      // 貝斯：1、2 拍後半、3 拍
      if (s === 0 || s === 8) this.bassNote(root, t, 0.32, 0.17);
      if (s === 6 || s === 14) this.bassNote(root + 7, tt, 0.18, 0.11);
      // 木琴分解和弦
      if ([0, 3, 6, 8, 11, 14].includes(s)) this.mallet(tones[[0, 3, 6, 8, 11, 14].indexOf(s) % tones.length] + 12, tt, 0.05);
      // 沙鈴
      if (s % 2 === 0) this.hat(tt, s % 4 === 2 ? 0.05 : 0.025);
      // 旋律（第一次 A 段不出）
      if (form > 0) {
        const mel = (inB ? MEL_B : MEL_A)[this.bar % 4];
        for (const [at, m, len] of mel) if (at === s) this.bell(m, tt, sd * len);
      }
    }
    pad(notes, t, dur, scale = 1) {
      const ctx = this.ctx;
      for (const m of notes) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = mtof(m);
        const vol = 0.028 * scale;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.2);
        g.gain.setValueAtTime(vol, t + dur * 0.8);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.05);
        o.connect(g).connect(this.bus);
        o.start(t);
        o.stop(t + dur * 1.1);
      }
    }
    mallet(m, t, vol) {
      const ctx = this.ctx;
      for (const [mult, v] of [[1, vol], [4, vol * 0.25]]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = mtof(m) * mult;
        this.env(g, t, v, 0.004, mult === 1 ? 0.35 : 0.08);
        o.connect(g).connect(this.bus);
        o.start(t);
        o.stop(t + 0.45);
      }
    }
    bell(m, t, dur) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = mtof(m);
      lfo.frequency.value = 5.5;
      lg.gain.value = 0.012;
      lfo.connect(lg).connect(g.gain);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.075, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.03, t + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.3, dur) + 0.2);
      o.connect(g).connect(this.bus);
      o.start(t);
      lfo.start(t);
      o.stop(t + dur + 0.3);
      lfo.stop(t + dur + 0.3);
    }
  }

  // =========================================================
  // 過場配樂（一次播完的「配樂片段」）
  // =========================================================
  function voice(ctx, dest) {
    const tone = (m, t, dur, { type = 'triangle', vol = 0.1, attack = 0.02, glideTo = null, vib = 0, release = null } = {}) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(mtof(m), t);
      if (glideTo != null) o.frequency.exponentialRampToValueAtTime(mtof(glideTo), t + dur);
      if (vib) {
        const l = ctx.createOscillator();
        const lg = ctx.createGain();
        l.frequency.value = 5;
        lg.gain.value = vib;
        l.connect(lg).connect(o.frequency);
        l.start(t);
        l.stop(t + dur + 0.1);
      }
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
      if (release) {
        g.gain.setValueAtTime(vol, t + Math.max(attack, dur - release));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      } else g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    const chord = (notes, t, dur, opts = {}) => notes.forEach((m) => tone(m, t, dur, { type: 'sine', vol: 0.045, attack: 0.15, release: 0.4, ...opts }));
    const strum = (notes, t, vol = 0.08) => notes.forEach((m, i) => tone(m, t + i * 0.018, 0.6, { type: 'triangle', vol, attack: 0.004 }));
    const noise = (t, dur, { vol = 0.2, freq = 900, type = 'bandpass', sweepTo = null, shape = 'swell' } = {}) => {
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let k = 0; k < len; k++) {
        const env = shape === 'swell' ? Math.sin((Math.PI * k) / len) : shape === 'rise' ? k / len : 1 - k / len;
        d[k] = (Math.random() * 2 - 1) * env;
      }
      const src = ctx.createBufferSource();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      f.type = type;
      f.frequency.setValueAtTime(freq, t);
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
      g.gain.value = vol;
      src.buffer = buf;
      src.connect(f).connect(g).connect(dest);
      src.start(t);
    };
    const kick = (t, vol = 0.3) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + 0.32);
    };
    const hat = (t, vol = 0.05) => noise(t, 0.05, { vol, freq: 7000, type: 'highpass', shape: 'fall' });
    return { tone, chord, strum, noise, kick, hat };
  }

  /** 開場：船上撥弦 → 撲通 → 水下 → 倒數往上推 → 「下潛！」 */
  function introCue(ctx, dest, t0, total) {
    const countMs = Math.min(3, total);
    const intro = total - countMs;
    const v = voice(ctx, dest);
    const splashAt = intro * 0.36;
    if (intro > 1) {
      // 船上：D → G → A 輕快撥弦 + 海浪
      v.noise(t0, Math.max(0.6, splashAt), { vol: 0.12, freq: 500, type: 'lowpass', shape: 'swell' });
      const beat = Math.max(0.18, splashAt / 4);
      v.strum([62, 66, 69, 74], t0);
      v.strum([62, 66, 69, 74], t0 + beat, 0.06);
      v.strum([62, 67, 71, 74], t0 + beat * 2);
      v.strum([61, 64, 69, 73], t0 + beat * 3);
      v.tone(81, t0 + beat * 3, beat * 0.9, { type: 'square', vol: 0.03, glideTo: 93 }); // 「一、二、三，跳！」的哨音
      // 撲通之後：往下滑的水聲 + 水下的 Dm
      const u = t0 + splashAt;
      v.tone(84, u, 0.8, { type: 'sine', vol: 0.08, glideTo: 50 });
      const deep = intro - splashAt;
      v.chord([50, 57, 62, 65], u + 0.2, deep + countMs + 0.4, { vol: 0.035 });
      [81, 77, 74, 72, 69, 65].forEach((m, i) => v.tone(m, u + 0.3 + i * (deep / 7), 0.18, { type: 'sine', vol: 0.05, glideTo: m + 5 }));
    }
    // 倒數：每一拍貝斯往上推，最後「下潛！」
    const c0 = t0 + intro;
    const gap = countMs / 4;
    v.noise(c0, gap * 3, { vol: 0.14, freq: 400, type: 'bandpass', sweepTo: 5000, shape: 'rise' });
    [38, 40, 41].forEach((m, i) => {
      v.kick(c0 + i * gap, 0.25 + i * 0.05);
      v.tone(m, c0 + i * gap, gap * 0.9, { type: 'sawtooth', vol: 0.09 });
      v.tone(m + 24, c0 + i * gap, gap * 0.5, { type: 'square', vol: 0.025 });
    });
    const go = c0 + gap * 3;
    v.kick(go, 0.4);
    v.chord([57, 62, 65, 69, 74], go, 1.4, { type: 'triangle', vol: 0.05, attack: 0.01 });
    v.noise(go, 0.6, { vol: 0.25, freq: 2500, type: 'lowpass', sweepTo: 300, shape: 'fall' });
  }

  /** 結局配樂（約 6 秒，配合 5 秒動畫＋字幕停留） */
  function endingCue(ctx, dest, kind, t0) {
    const v = voice(ctx, dest);
    if (kind === 'safe') {
      // D → G → Asus4→A → D：明亮、往上走的小號角
      const prog = [[0, [62, 66, 69], 38], [1, [62, 67, 71], 43], [2, [62, 64, 69], 45], [2.5, [61, 64, 69], 45], [3, [62, 66, 69, 74], 38]];
      prog.forEach(([at, notes, bass], i) => {
        const dur = (prog[i + 1] ? prog[i + 1][0] : 5.8) - at;
        v.chord(notes, t0 + at, dur + 0.1);
        v.tone(bass, t0 + at, Math.min(dur, 0.9), { type: 'triangle', vol: 0.16 });
      });
      [[0, 74, 0.25], [0.25, 78, 0.25], [0.5, 81, 0.5], [1, 83, 0.5], [1.5, 86, 0.5], [2, 86, 0.5], [2.5, 85, 0.5], [3, 86, 2.4]]
        .forEach(([at, m, d]) => v.tone(m, t0 + at, d + 0.15, { type: 'square', vol: 0.045, attack: 0.01, release: 0.12 }));
      for (let k = 0; k < 12; k++) v.hat(t0 + k * 0.25, k % 2 ? 0.03 : 0.05);
      [2.5, 2.625, 2.75, 2.875].forEach((at) => v.noise(t0 + at, 0.1, { vol: 0.12, freq: 1800, shape: 'fall' }));
      v.kick(t0 + 3, 0.35);
      [86, 90, 93, 98].forEach((m, i) => v.tone(m, t0 + 3.1 + i * 0.09, 0.5, { type: 'sine', vol: 0.05 }));
      [86, 90, 93, 98].forEach((m, i) => v.tone(m, t0 + 4.3 + i * 0.09, 0.5, { type: 'sine', vol: 0.03 }));
    } else if (kind === 'panting') {
      // Dm → B♭ → Asus4 → D：累到音都往下掉，最後一個大三和弦＝活著回來了
      const prog = [[0, [62, 65, 69], 38], [1.5, [58, 62, 65], 34], [3, [57, 62, 64], 33], [4.2, [57, 62, 66], 38]];
      prog.forEach(([at, notes, bass], i) => {
        const dur = (prog[i + 1] ? prog[i + 1][0] : 6) - at;
        v.chord(notes, t0 + at, dur + 0.1, { vol: 0.04 });
        [0, 0.75].forEach((o) => { if (o < dur) v.tone(bass, t0 + at + o, 0.35, { type: 'sawtooth', vol: 0.07 }); });
      });
      [[0, 74, 0.6], [0.75, 72, 0.6], [1.5, 70, 0.6], [2.25, 69, 0.6], [3, 67, 1.1], [4.2, 66, 1.6]]
        .forEach(([at, m, d]) => v.tone(m, t0 + at, d, { type: 'triangle', vol: 0.07, glideTo: m - 1.5 }));
      [0.5, 1.2, 1.9, 2.8, 3.6].forEach((at, i) => v.noise(t0 + at, 0.42, { vol: 0.22 - i * 0.03, freq: 900 }));
    } else {
      // pass out：音樂盒越轉越慢、走音 → 半音往下 → 平線嗶聲 → 靈魂飄走
      [[0, 74], [0.28, 77], [0.56, 81], [0.84, 79], [1.18, 77], [1.6, 74], [2.1, 73]].forEach(([at, m], i) =>
        v.tone(m + 12, t0 + at, 0.5, { type: 'sine', vol: 0.06, glideTo: m + 12 - i * 0.25 }));
      [50, 49, 48, 47, 46].forEach((m, i) => v.tone(m, t0 + 0.3 + i * 0.42, 0.45, { type: 'sawtooth', vol: 0.05 }));
      v.tone(38, t0 + 2.2, 2.6, { type: 'sine', vol: 0.22, glideTo: 26 });
      v.tone(95, t0 + 2.6, 1.3, { type: 'sine', vol: 0.035, attack: 0.005, release: 0.05 }); // 嗶——
      v.tone(72, t0 + 3.6, 2.2, { type: 'sine', vol: 0.05, glideTo: 88, vib: 18, attack: 0.3 }); // 嗚～靈魂往上飄
      v.chord([50, 53, 56], t0 + 3.6, 2.3, { vol: 0.03 });
    }
  }

  /** 舊版短音效（音樂關掉時，結局還是有一點聲音） */
  function sting(ctx, dest, kind, t0 = ctx.currentTime) {
    const v = voice(ctx, dest);
    if (kind === 'safe') {
      [62, 66, 69, 74, 78].forEach((m, i) => v.tone(m, t0 + i * 0.12, 0.6, { vol: 0.12, attack: 0.03 }));
    } else if (kind === 'panting') {
      [57, 62, 64].forEach((m) => v.tone(m, t0, 1.6, { vol: 0.08, attack: 0.03 }));
      for (let i = 0; i < 3; i++) v.noise(t0 + 0.5 + i * 0.6, 0.45, { vol: 0.25 });
    } else {
      [62, 61, 60, 59, 58].forEach((m, i) => v.tone(m, t0 + i * 0.32, 0.5, { type: 'sawtooth', vol: 0.05, attack: 0.03 }));
      v.tone(38, t0 + 1.6, 2.4, { type: 'sine', vol: 0.25, glideTo: 26 });
    }
  }

  /** 水面休息的小過門：輕快上行 */
  function surfaceJingle(ctx, dest, t0) {
    const v = voice(ctx, dest);
    [[0, 69], [0.12, 74], [0.24, 78], [0.36, 81]].forEach(([at, m]) => v.tone(m, t0 + at, 0.3, { type: 'square', vol: 0.04, attack: 0.005 }));
    v.chord([62, 66, 69, 74], t0 + 0.48, 1.4, { type: 'triangle', vol: 0.05, attack: 0.01 });
  }

  // ---------- 對外介面 ----------
  const store = {
    get() { try { return localStorage.getItem('dive-music') !== 'off'; } catch (e) { return true; } },
    set(on) { try { localStorage.setItem('dive-music', on ? 'on' : 'off'); } catch (e) { /* 略過 */ } },
  };

  const DiveMusic = {
    enabled: store.get(),
    ctx: null,
    eng: null,
    theme: null,   // 目前在播：'menu' | 'game' | 'cue' | null
    timer: null,
    cueBus: null,

    /** 播主題曲（menu／game）。同一首正在播就不重來 */
    play(theme, ctx, fadeIn) {
      if (ctx) this.ctx = ctx;
      if (!this.enabled || !this.ctx) return;
      if (this.theme === theme && this.eng) return;
      this.stop(theme === 'game' ? 0.4 : 0.8);
      const eng = theme === 'menu' ? new MenuEngine(this.ctx, this.ctx.destination) : new Engine(this.ctx, this.ctx.destination);
      eng.begin(this.ctx.currentTime, fadeIn != null ? fadeIn : theme === 'menu' ? 2 : 1.5);
      this.eng = eng;
      this.theme = theme;
      this.timer = setInterval(() => eng.schedule(this.ctx.currentTime + 0.25), 60);
    },
    /** 播一段過場配樂（開場／結局），會先把正在播的主題曲淡出 */
    cue(kind, ctx, seconds) {
      if (ctx) this.ctx = ctx;
      const c = this.ctx;
      if (!c) return;
      this.stop(0.5);
      if (!this.enabled) {
        if (kind !== 'intro') sting(c, c.destination, kind); // 音樂關掉：結局還是給一點音效
        return;
      }
      const bus = c.createGain();
      bus.gain.value = 0.9;
      bus.connect(c.destination);
      this.cueBus = bus;
      this.theme = 'cue';
      const t0 = c.currentTime + 0.05;
      if (kind === 'intro') introCue(c, bus, t0, seconds || 6.5);
      else endingCue(c, bus, kind, t0);
    },
    jingle(ctx) { const c = ctx || this.ctx; if (c && this.enabled) surfaceJingle(c, c.destination, c.currentTime + 0.02); },
    stop(fade = 1.2) {
      clearInterval(this.timer);
      this.timer = null;
      const eng = this.eng;
      this.eng = null;
      this.theme = null;
      if (eng && this.ctx) {
        eng.fadeOut(this.ctx.currentTime, fade);
        setTimeout(() => { try { eng.out.disconnect(); } catch (e) { /* 略過 */ } }, fade * 1000 + 300);
      }
      const bus = this.cueBus;
      this.cueBus = null;
      if (bus && this.ctx) {
        const t = this.ctx.currentTime;
        bus.gain.cancelScheduledValues(t);
        bus.gain.setValueAtTime(bus.gain.value, t);
        bus.gain.linearRampToValueAtTime(0, t + Math.max(0.05, fade));
        setTimeout(() => { try { bus.disconnect(); } catch (e) { /* 略過 */ } }, fade * 1000 + 300);
      }
    },
    setTension(x) { if (this.eng && this.theme === 'game') this.eng.tension = Math.max(0, Math.min(1, x)); },
    setLowAir(b) { if (this.eng && this.theme === 'game') this.eng.lowAir = !!b; },
    sting(kind, ctx) { const c = ctx || this.ctx; if (c) sting(c, c.destination, kind); },
    toggle() {
      this.enabled = !this.enabled;
      store.set(this.enabled);
      if (!this.enabled) this.stop(0.3);
      return this.enabled;
    },

    /** 離線算出一段試聽（給開發者預覽用） */
    async renderPreview(seconds, tensionAt, lowAirAt, endKind) {
      const rate = 44100;
      const total = seconds + (endKind ? 6.5 : 0);
      const ctx = new OfflineAudioContext(2, Math.ceil(rate * total), rate);
      const eng = new Engine(ctx, ctx.destination);
      eng.begin(0, 1.0);
      for (let t = 0; t < seconds; t += 0.1) {
        eng.tension = tensionAt(t);
        eng.lowAir = lowAirAt ? lowAirAt(t) : false;
        eng.schedule(t + 0.1);
      }
      eng.fadeOut(seconds, 0.8);
      if (endKind) endingCue(ctx, ctx.destination, endKind, seconds + 0.3);
      return ctx.startRendering();
    },
    /** 離線算出：主題曲／開場／結局 */
    async renderPiece(kind, seconds) {
      const rate = 44100;
      const ctx = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
      if (kind === 'menu') {
        const eng = new MenuEngine(ctx, ctx.destination);
        eng.begin(0, 1.0);
        eng.schedule(seconds - 1.2);
        eng.fadeOut(seconds - 1.2, 1);
      } else if (kind === 'intro') {
        introCue(ctx, ctx.destination, 0.05, 6.5);
        const eng = new Engine(ctx, ctx.destination);
        eng.begin(6.55, 0.4);
        eng.schedule(seconds - 1);
        eng.fadeOut(seconds - 1, 0.8);
      } else endingCue(ctx, ctx.destination, kind, 0.05);
      return ctx.startRendering();
    },
  };

  window.DiveMusic = DiveMusic;
})();
