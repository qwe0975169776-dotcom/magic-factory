/* =========================================================
   深海大亂潛 — 背景音樂（Web Audio 即時合成，不需要音檔）
   D 小調，依「緊張度」0～1 切換三個段落，每段有自己的和弦進行：
     平靜  Dm  → B♭ → Gm → Asus4→A     （轉折處用 sus4 再解決）
     緊張  Dm  → Gm → B♭ → A7          （回頭前用屬七）
     失控  Dm  → E♭ → C  → A7          （拿坡里色彩的 E♭，更不安）
   速度 84 → 140 BPM；水下濾波越緊張越打開；氣量低時加入心跳鼓。
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

  // ---------- 結局音效 ----------
  function sting(ctx, dest, kind, t0 = ctx.currentTime) {
    const tone = (m, t, dur, type = 'triangle', vol = 0.12, glideTo) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(mtof(m), t);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(mtof(glideTo), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    if (kind === 'safe') {
      // D 大調琶音往上，最後一個大三和弦：平安上船
      [62, 66, 69, 74, 78].forEach((m, i) => tone(m, t0 + i * 0.12, 0.6, 'triangle', 0.12));
      [62, 66, 69, 74].forEach((m) => tone(m, t0 + 0.7, 1.8, 'sine', 0.07));
    } else if (kind === 'panting') {
      // 懸在 sus4 不解決 + 喘氣聲
      [57, 62, 64].forEach((m) => tone(m, t0, 1.6, 'triangle', 0.08));
      for (let i = 0; i < 3; i++) {
        const src = ctx.createBufferSource();
        const len = Math.floor(ctx.sampleRate * 0.45);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * Math.sin((Math.PI * k) / len);
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 900;
        const g = ctx.createGain();
        g.gain.value = 0.25;
        src.buffer = buf;
        src.connect(f).connect(g).connect(dest);
        src.start(t0 + 0.5 + i * 0.6);
      }
    } else {
      // pass out：半音一路往下，最後掉進深海低音
      [62, 61, 60, 59, 58].forEach((m, i) => tone(m, t0 + i * 0.32, 0.5, 'sawtooth', 0.05));
      tone(38, t0 + 1.6, 2.4, 'sine', 0.25, 26);
    }
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
    timer: null,

    start(ctx) {
      this.ctx = ctx;
      this.stop(0.05);
      if (!this.enabled || !ctx) return;
      const eng = new Engine(ctx, ctx.destination);
      eng.begin(ctx.currentTime);
      this.eng = eng;
      this.timer = setInterval(() => eng.schedule(ctx.currentTime + 0.25), 60);
    },
    stop(fade = 1.2) {
      clearInterval(this.timer);
      this.timer = null;
      const eng = this.eng;
      this.eng = null;
      if (eng && this.ctx) {
        eng.fadeOut(this.ctx.currentTime, fade);
        setTimeout(() => { try { eng.out.disconnect(); } catch (e) { /* 略過 */ } }, fade * 1000 + 300);
      }
    },
    setTension(x) { if (this.eng) this.eng.tension = Math.max(0, Math.min(1, x)); },
    setLowAir(b) { if (this.eng) this.eng.lowAir = !!b; },
    sting(kind, ctx) { const c = ctx || this.ctx; if (c) sting(c, c.destination, kind); }, // 結局音效不受音樂開關影響
    toggle() {
      this.enabled = !this.enabled;
      store.set(this.enabled);
      return this.enabled;
    },

    /** 離線算出一段試聽（tensionAt(秒) 決定每個時間點的緊張度） */
    async renderPreview(seconds, tensionAt, lowAirAt, endKind) {
      const rate = 44100;
      const total = seconds + (endKind ? 4 : 0);
      const ctx = new OfflineAudioContext(2, Math.ceil(rate * total), rate);
      const eng = new Engine(ctx, ctx.destination);
      eng.begin(0, 1.0);
      for (let t = 0; t < seconds; t += 0.1) {
        eng.tension = tensionAt(t);
        eng.lowAir = lowAirAt ? lowAirAt(t) : false;
        eng.schedule(t + 0.1);
      }
      eng.fadeOut(seconds, 0.8);
      if (endKind) sting(ctx, ctx.destination, endKind, seconds + 0.3);
      return ctx.startRendering();
    },
  };

  window.DiveMusic = DiveMusic;
})();
