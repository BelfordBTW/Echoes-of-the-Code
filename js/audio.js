'use strict';
/*
 * Звук целиком синтезируется Web Audio API: нет аудиофайлов — нечего грузить,
 * сборка весит десятки килобайт. Контекст создаётся по первому жесту пользователя
 * (требование браузеров к автозапуску звука).
 */
const Sound = {
  ctx: null, master: null, sfxGain: null, musGain: null, filter: null,
  sfxVol: 0.7, musVol: 0.4, musicOn: false, nextNote: 0, step: 0, timer: null,

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass'; this.filter.frequency.value = 18000;
      this.master = this.ctx.createGain(); this.master.gain.value = 0.9;
      this.sfxGain = this.ctx.createGain(); this.musGain = this.ctx.createGain();
      this.sfxGain.connect(this.filter); this.musGain.connect(this.filter);
      this.filter.connect(this.master); this.master.connect(this.ctx.destination);
      this.setVolumes(this.sfxVol, this.musVol);
    } catch (e) { this.ctx = null; }
  },
  setVolumes(sfx, mus) {
    this.sfxVol = sfx; this.musVol = mus;
    if (!this.ctx) return;
    this.sfxGain.gain.value = sfx * 0.5;
    this.musGain.gain.value = mus * 0.35;
  },
  setSlow(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.filter.frequency.cancelScheduledValues(t);
    this.filter.frequency.setTargetAtTime(on ? 900 : 18000, t, 0.08);
  },
  suspend(on) { if (this.ctx) { if (on) this.ctx.suspend(); else this.ctx.resume(); } },

  tone(type, f1, f2, dur, vol = 0.5, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f1, t);
    if (f2 !== f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol = 0.3, freq = 1200, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfxGain); s.start(t);
  },
  play(name) {
    switch (name) {
      case 'jump': this.tone('square', 260, 520, 0.12, 0.25); break;
      case 'djump': this.tone('square', 420, 980, 0.14, 0.25); this.noise(0.08, 0.15, 3000); break;
      case 'land': this.noise(0.05, 0.12, 400); break;
      case 'hurt': this.tone('sawtooth', 240, 70, 0.25, 0.4); this.noise(0.15, 0.25, 800); break;
      case 'death': this.tone('sawtooth', 400, 40, 0.7, 0.45); this.noise(0.5, 0.3, 500); break;
      case 'fragment': this.tone('triangle', 880, 880, 0.08, 0.35); this.tone('triangle', 1320, 1320, 0.12, 0.3, 0.07); break;
      case 'item': [523, 659, 784, 1046].forEach((f, i) => this.tone('square', f, f, 0.12, 0.2, i * 0.08)); break;
      case 'checkpoint': this.tone('triangle', 660, 990, 0.25, 0.3); break;
      case 'key': this.tone('square', 700, 700, 0.05, 0.2); break;
      case 'keyBad': this.tone('square', 180, 140, 0.12, 0.3); break;
      case 'hackOk': [392, 523, 659, 784].forEach((f, i) => this.tone('triangle', f, f, 0.1, 0.3, i * 0.06)); this.noise(0.3, 0.12, 2500, 0.2); break;
      case 'hackFail': this.tone('sawtooth', 300, 90, 0.5, 0.35); break;
      case 'alarm': for (let i = 0; i < 4; i++) this.tone('square', i % 2 ? 520 : 760, i % 2 ? 520 : 760, 0.14, 0.18, i * 0.15); break;
      case 'shoot': this.tone('square', 900, 300, 0.08, 0.12); break;
      case 'bossFire': this.tone('sawtooth', 120, 60, 0.3, 0.2); break;
      case 'slowOn': this.tone('sine', 500, 140, 0.35, 0.35); break;
      case 'slowOff': this.tone('sine', 140, 500, 0.25, 0.25); break;
      case 'door': this.noise(0.35, 0.2, 700); break;
      case 'ui': this.tone('square', 1200, 1200, 0.03, 0.12); break;
      case 'uiOk': this.tone('square', 880, 1320, 0.08, 0.18); break;
      case 'uiBack': this.tone('square', 660, 440, 0.08, 0.15); break;
      case 'complete': [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone('triangle', f, f, 0.2, 0.3, i * 0.1)); break;
      case 'shield': this.tone('sawtooth', 800, 60, 1.2, 0.35); this.noise(1.0, 0.3, 300); break;
      default: break;
    }
  },

  /* фоновая музыка: простой генеративный секвенсор (бас + арпеджио) */
  startMusic(theme) {
    if (!this.ctx) return;
    this.theme = theme || 'city';
    if (this.musicOn) return;
    this.musicOn = true; this.nextNote = this.ctx.currentTime + 0.1; this.step = 0;
    this.timer = setInterval(() => this.schedule(), 50);
  },
  stopMusic() { this.musicOn = false; clearInterval(this.timer); this.timer = null; },
  schedule() {
    if (!this.ctx || !this.musicOn) return;
    const spb = 60 / 104 / 2; // восьмые при 104 BPM
    const roots = { city: [45, 45, 41, 43], server: [40, 40, 43, 38], core: [38, 41, 36, 40], menu: [45, 41, 43, 40] }[this.theme] || [45, 41, 43, 40];
    while (this.nextNote < this.ctx.currentTime + 0.2) {
      const bar = Math.floor(this.step / 8) % 4, s = this.step % 8, root = roots[bar];
      const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
      const t = this.nextNote;
      // бас
      if (s % 2 === 0) this.note('sawtooth', mtof(root - 12), t, spb * 1.6, 0.22, 500);
      // арпеджио
      const arp = [0, 7, 12, 15, 12, 7, 3, 7][s];
      this.note('square', mtof(root + 12 + arp), t, spb * 0.8, 0.06, 2400);
      this.nextNote += spb; this.step++;
    }
  },
  note(type, f, t, dur, vol, cutoff) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), fl = this.ctx.createBiquadFilter();
    o.type = type; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(fl); fl.connect(g); g.connect(this.musGain); o.start(t); o.stop(t + dur + 0.05);
  },
};
