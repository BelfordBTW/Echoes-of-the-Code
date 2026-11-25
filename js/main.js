'use strict';
/*
 * Точка входа: игровой цикл, состояния (меню / игра / пауза / взлом / диалог),
 * сохранение, статистика, авто-качество.
 * Физика идёт фиксированным шагом 1/120 с (стабильна на 30–240 Гц), отрисовка — раз в кадр.
 */
const STEP = 1 / 120;

const Game = {
  save: null, world: null, state: 'menu', levelIdx: 0,
  last: 0, acc: 0, menuT: 0, touchOn: false,
  perf: { frames: 0, t: 0, fps: 60, ms: 0, lowT: 0 },
  lockToastT: 0, persistT: 0,

  init() {
    this.save = Store.load() || defaultSave();
    this.save.stats.sessions++;
    this.persist();
    Sprites.init();
    Render.init($('game'));
    Input.init();
    UI.init();
    this.applySettings();
    addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'play') this.pause();
      Sound.suspend(document.hidden);
      this.last = performance.now();
    });
    const unlock = () => { Sound.unlock(); Sound.setVolumes(this.save.settings.sfx / 10, this.save.settings.music / 10); Sound.startMusic(this.world ? this.world.def.theme : 'menu'); };
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });
    UI.open('scr-title');
    requestAnimationFrame((t) => { this.last = t; this.frame(t); });
  },

  persist() { Store.save(this.save); },

  applySettings() {
    const s = this.save.settings;
    Sound.setVolumes(s.sfx / 10, s.music / 10);
    $('crt').classList.toggle('hidden', !s.crt);
    const touchCapable = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.touchOn = s.touch === 'on' || (s.touch === 'auto' && touchCapable);
    $('touch').classList.toggle('hidden', !(this.touchOn && this.state === 'play'));
    Render.lowFx = s.quality === 'low';
    if (s.quality === 'high') Render.lowFx = false;
    if (this.world) { this.world.lowFx = Render.lowFx; this.world.diff = DIFFICULTY[s.difficulty]; }
    this.resize();
  },

  resize() {
    const w = innerWidth, h = innerHeight, cv = $('game'), mode = this.save.settings.scale;
    let sw, sh;
    if (mode === 'stretch') { sw = w; sh = h; }
    else {
      let s = Math.min(w / VIEW_W, h / VIEW_H);
      if (mode === 'integer' && s >= 1) s = Math.floor(s);
      sw = Math.round(VIEW_W * s); sh = Math.round(VIEW_H * s);
    }
    cv.style.width = sw + 'px'; cv.style.height = sh + 'px';
    const r = document.documentElement.style;
    r.setProperty('--gw', sw + 'px'); r.setProperty('--gh', sh + 'px');
    r.setProperty('--gx', Math.round((w - sw) / 2) + 'px'); r.setProperty('--gy', Math.round((h - sh) / 2) + 'px');
    r.setProperty('--px', Math.max(0.6, Math.min(sw / VIEW_W, sh / VIEW_H)) + 'px');
    $('rotate').classList.toggle('hidden', !(this.touchOn && h > w));
  },

  /* ---------- уровни ---------- */
  newGame() {
    const keep = this.save.settings, stats = this.save.stats, fb = this.save.feedback;
    this.save = defaultSave();
    Object.assign(this.save, { settings: keep, stats, feedback: fb });
    this.persist();
    this.startLevel(0, false);
  },

  startLevel(i, skipIntro) {
    const def = LEVELS[i];
    this.levelIdx = i; this.save.current = i;
    this.world = new World(def, {
      owned: new Set(this.save.active), difficulty: this.save.settings.difficulty,
      collected: this.save.fragments[def.id] || [], lowFx: Render.lowFx,
      emit: (e, d) => this.onEvent(e, d),
    });
    Render.prepare(this.world);
    const ls = this.lvlStats(def.id); ls.attempts++;
    this.persist();
    UI.closeAll();
    UI.showHud(true);
    Sound.stopMusic(); Sound.startMusic(def.theme);
    Input.clearLatches();
    this.acc = 0;
    const go = () => { this.state = 'play'; Input.clearLatches(); this.applySettings(); };
    if (def.intro && !skipIntro) { this.state = 'dialog'; UI.Dialog.start(def.intro, go); }
    else go();
  },

  lvlStats(id) {
    const L = this.save.stats.levels;
    return L[id] || (L[id] = { attempts: 0, completions: 0, deaths: 0, bestTime: 0, hacks: 0, hackFails: 0, spotted: 0, bestFrags: 0 });
  },

  completeLevel() {
    const w = this.world, def = w.def, ls = this.lvlStats(def.id);
    ls.completions++; ls.hacks += w.stats.hacks; ls.hackFails += w.stats.hackFails; ls.spotted += w.stats.spotted;
    ls.bestTime = ls.bestTime ? Math.min(ls.bestTime, w.stats.time) : w.stats.time;
    const got = new Set(this.save.fragments[def.id] || []);
    w.fragments.forEach((f) => { if (f.got) got.add(f.idx); });
    this.save.fragments[def.id] = Array.from(got).sort((a, b) => a - b);
    ls.bestFrags = Math.max(ls.bestFrags, got.size);
    const last = this.levelIdx >= LEVELS.length - 1;
    this.save.unlocked = Math.max(this.save.unlocked, Math.min(LEVELS.length, this.levelIdx + 2));
    if (!last) this.save.current = this.levelIdx + 1;
    this.persist();
    Telemetry.send('level_complete', { level: def.id, time: w.stats.time, deaths: w.stats.deaths, spotted: w.stats.spotted });
    Sound.play('complete');
    this.state = 'complete';
    $('touch').classList.add('hidden');
    const rating = w.stats.spotted === 0 ? 'ПРИЗРАК' : w.stats.spotted <= 2 ? 'ТЕНЬ' : 'ШУМ';
    const body = `<table class="result">
      <tr><td>Время</td><td>${U.fmtTime(w.stats.time)}</td></tr>
      <tr><td>Фрагменты памяти</td><td>${got.size} / ${w.fragTotal}</td></tr>
      <tr><td>Смерти</td><td>${w.stats.deaths}</td></tr>
      <tr><td>Взломы (провалы)</td><td>${w.stats.hacks} (${w.stats.hackFails})</td></tr>
      <tr><td>Обнаружений</td><td>${w.stats.spotted}</td></tr>
      <tr><td>Скрытность</td><td class="${rating === 'ПРИЗРАК' ? 'c' : rating === 'ТЕНЬ' ? '' : 'm'}">${rating}</td></tr></table>`;
    const show = () => {
      if (last) {
        const all = LEVELS.reduce((n, L) => n + (this.save.fragments[L.id] || []).length, 0);
        const total = LEVELS.reduce((n, L) => n + L.rows.join('').split('*').length - 1, 0);
        $('ending-body').innerHTML = `<p class="story">ИИ-страж перезагружен. «Нексус» больше не охотится за Призраком.<br>Восстановлено воспоминаний: <b class="c">${all} / ${total}</b>.</p>${body}<p class="note">Спасибо за игру! Это прототип — ваш отзыв поможет следующей версии.</p>`;
        UI.open('scr-ending');
      } else { $('complete-body').innerHTML = body; UI.open('scr-complete'); }
    };
    if (def.outro) { this.state = 'dialog'; UI.Dialog.start(def.outro, () => { this.state = 'complete'; show(); }); }
    else show();
  },

  pause() {
    if (this.state !== 'play') return;
    this.state = 'pause';
    Sound.setSlow(false);
    $('touch').classList.add('hidden');
    UI.open('scr-pause');
  },
  resume() {
    UI.closeAll();
    if (!this.world) { this.toMenu(); return; }
    this.state = 'play';
    Input.clearLatches();
    if (this.world.player.slow) Sound.setSlow(true);
    this.applySettings();
    this.last = performance.now();
  },
  onUiEmpty() {
    if (this.world && (this.state === 'pause' || this.state === 'inventory')) this.resume();
    else if (!this.world) UI.open('scr-title');
  },
  toMenu() {
    this.world = null; this.state = 'menu';
    UI.closeAll(); UI.showHud(false);
    $('touch').classList.add('hidden');
    Sound.setSlow(false); Sound.stopMusic(); Sound.startMusic('menu');
    UI.open('scr-title');
  },
  onImplantsChanged() { if (this.world) this.world.applyImplants(new Set(this.save.active), false); },

  /* ---------- события мира ---------- */
  onEvent(e, d) {
    const w = this.world;
    switch (e) {
      case 'jump': case 'djump': case 'land': case 'hurt': case 'fragment': case 'shoot': case 'bossFire':
        Sound.play(e); break;
      case 'death':
        Sound.play('death'); this.lvlStats(w.def.id).deaths++; this.persist(); break;
      case 'slowOn': Sound.play('slowOn'); Sound.setSlow(true); break;
      case 'slowOff': Sound.play('slowOff'); Sound.setSlow(false); break;
      case 'checkpoint': Sound.play('checkpoint'); UI.toast('Точка восстановления активирована'); break;
      case 'item': {
        Sound.play('item');
        const it = ITEMS[d.id];
        if (!this.save.items.includes(d.id)) this.save.items.push(d.id);
        let msg = `Получен предмет: ${it.name} [${RARITY[it.rarity].name}]`;
        if (!this.save.active.includes(d.id) && this.save.active.length < MAX_IMPLANTS) { this.save.active.push(d.id); msg += ' — активирован'; }
        this.persist(); this.onImplantsChanged();
        UI.toast(msg, 'item');
        break;
      }
      case 'hackStart':
        this.state = 'hack';
        Sound.setSlow(false);
        UI.Hack.start(d, (ok) => {
          w.finishHack(d.terminal, ok);
          if (this.world === w && this.state === 'hack') { this.state = 'play'; Input.clearLatches(); if (w.player.slow) Sound.setSlow(true); }
        });
        break;
      case 'hackOk': Sound.play('hackOk'); Sound.play('door'); UI.toast('Доступ получен', 'ok'); break;
      case 'hackFail': Sound.play('hackFail'); UI.toast('Взлом провален — тревога!', 'warn'); break;
      case 'alarm': Sound.play('alarm'); break;
      case 'exitLocked':
        if (w.time - this.lockToastT > 3) { this.lockToastT = w.time; UI.toast('Выход заблокирован: взломайте все узлы', 'warn'); }
        break;
      case 'shieldDown': Sound.play('shield'); UI.toast('Щит Ядра отключён! Портал открыт.', 'ok'); break;
      case 'complete': this.completeLevel(); break;
      default: break;
    }
  },

  /* ---------- цикл ---------- */
  frame(ts) {
    const t0 = performance.now();
    let dt = (ts - this.last) / 1000; this.last = ts;
    if (!(dt > 0)) dt = 0; if (dt > 0.1) dt = 0.1;
    Input.update();
    if (Input.consume('debug')) { Render.debug = !Render.debug; }

    if (this.state === 'play' && this.world) {
      if (Input.consume('pause')) this.pause();
      else if (Input.consume('inv')) { this.state = 'inventory'; $('touch').classList.add('hidden'); UI.open('scr-inventory'); }
      else {
        this.acc += dt;
        let n = 0;
        while (this.acc >= STEP && n < 10 && this.state === 'play') {
          const inp = {
            left: Input.held('left'), right: Input.held('right'), down: Input.held('down'),
            slow: Input.held('slow'), jumpHeld: Input.held('jump') || Input.held('up'),
            jumpPressed: n === 0 ? (Input.consume('jump') | Input.consume('up')) === 1 : false,
            actPressed: n === 0 ? Input.consume('act') : false,
          };
          this.world.update(STEP, inp);
          this.acc -= STEP; n++;
        }
        if (n >= 10) this.acc = 0;
        this.save.stats.playTime += dt;
        this.persistT += dt;
        if (this.persistT > 15) { this.persistT = 0; this.persist(); }
      }
    } else if (this.state === 'hack') UI.Hack.tick(dt);
    if (this.state === 'dialog') UI.Dialog.tick(dt);

    if (this.world) Render.draw(this.world, this.state === 'play' ? dt : 0, this.save.settings.shake);
    else { this.menuT += dt; Render.drawMenuBg(this.menuT); }

    // производительность и авто-качество
    const P = this.perf;
    P.frames++; P.t += dt; P.ms = P.ms * 0.9 + (performance.now() - t0) * 0.1;
    if (P.t >= 1) {
      P.fps = Math.round(P.frames / P.t); P.frames = 0; P.t = 0;
      if (this.save.settings.quality === 'auto' && this.state === 'play') {
        // низкий FPS при дешёвом кадре = троттлинг вкладки, а не нагрузка игры: не реагируем
        if (P.fps < 45 && P.ms > 6) P.lowT++; else P.lowT = 0;
        if (P.lowT >= 3 && !Render.lowFx) { Render.lowFx = true; if (this.world) this.world.lowFx = true; UI.toast('Низкий FPS: эффекты упрощены'); }
      }
    }
    if (this.world) {
      let dbg = '';
      if (this.save.settings.fps || Render.debug) dbg = `FPS ${P.fps} · кадр ${P.ms.toFixed(2)} мс`;
      if (Render.debug) {
        const w = this.world;
        dbg += ` · частиц ${w.particles.length} · пуль ${w.bullets.length} · дронов ${w.drones.length} · x ${w.player.x.toFixed(0)} y ${w.player.y.toFixed(0)} · ${Render.lowFx ? 'LOW' : 'HIGH'}`;
      }
      UI.updateHud(this.world, dbg);
    }
    requestAnimationFrame((t) => this.frame(t));
  },

  /* ---------- аналитика ---------- */
  analytics() {
    return {
      version: VERSION, exportedAt: new Date().toISOString(),
      device: { ua: navigator.userAgent, screen: `${screen.width}x${screen.height}`, dpr: devicePixelRatio, touch: this.touchOn },
      settings: this.save.settings, progress: { unlocked: this.save.unlocked, items: this.save.items, fragments: this.save.fragments },
      stats: this.save.stats, avgFps: this.perf.fps,
    };
  },
  exportJSON(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    UI.toast('Файл ' + name + ' сохранён');
  },
};

addEventListener('DOMContentLoaded', () => Game.init());
