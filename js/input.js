'use strict';
/*
 * Ввод: клавиатура, геймпад (Gamepad API) и сенсорные кнопки сводятся к одному набору действий.
 * «Нажатия» защёлкиваются до момента, когда их заберёт шаг симуляции (consume),
 * поэтому короткий тап не теряется даже на мониторах 144–240 Гц.
 */
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  Space: 'jump', KeyZ: 'jump',
  KeyE: 'act', KeyX: 'act', Enter: 'ok',
  ShiftLeft: 'slow', ShiftRight: 'slow', KeyK: 'slow',
  Escape: 'pause', KeyP: 'pause', KeyI: 'inv', Tab: 'inv',
  KeyQ: 'sort', KeyR: 'detail', F3: 'debug',
};

const Input = {
  kb: {}, touch: {}, gp: {}, prev: {}, latch: {}, down: {},
  lastDevice: 'kb', listeners: [],

  init() {
    addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      this.lastDevice = 'kb';
      if (e.target && e.target.tagName === 'TEXTAREA') return;
      if (a) {
        if (!e.repeat) this.latch[a] = true;
        this.kb[a] = true;
        if (a !== 'ok' || !e.target || e.target.tagName !== 'BUTTON') e.preventDefault();
      }
      for (const fn of this.listeners) fn(a, e);
    });
    addEventListener('keyup', (e) => { const a = KEYMAP[e.code]; if (a) this.kb[a] = false; });
    addEventListener('blur', () => { this.kb = {}; this.touch = {}; });
    // сенсорные кнопки
    document.querySelectorAll('#touch [data-t]').forEach((b) => {
      const a = b.dataset.t;
      const on = (e) => { e.preventDefault(); this.touch[a] = true; this.latch[a] = true; b.classList.add('on'); this.lastDevice = 'touch'; Sound.unlock(); };
      const off = (e) => { e.preventDefault(); this.touch[a] = false; b.classList.remove('on'); };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
    });
  },
  onAction(fn) { this.listeners.push(fn); },

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && Array.from(pads).find((p) => p && p.connected);
    const s = {};
    if (gp) {
      const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      s.left = ax < -0.4 || b(14); s.right = ax > 0.4 || b(15);
      s.up = ay < -0.5 || b(12); s.down = ay > 0.5 || b(13);
      s.jump = b(0); s.ok = b(0); s.act = b(2); s.back = b(1);
      s.slow = b(5) || b(7) || b(4) || b(6); s.pause = b(9); s.inv = b(3);
      for (const k in s) if (s[k] && !this.gp[k]) { this.latch[k] = true; this.lastDevice = 'gp'; for (const fn of this.listeners) fn(k, null); }
    }
    this.gp = s;
  },

  /* вызывается раз в кадр */
  update() {
    this.pollGamepad();
    const d = {};
    for (const src of [this.kb, this.touch, this.gp]) for (const k in src) if (src[k]) d[k] = true;
    this.down = d;
  },
  held(a) { return !!this.down[a]; },
  consume(a) { const v = !!this.latch[a]; this.latch[a] = false; return v; },
  peek(a) { return !!this.latch[a]; },
  clearLatches() { this.latch = {}; },
};
