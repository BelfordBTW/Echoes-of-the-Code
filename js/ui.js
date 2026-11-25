'use strict';
/*
 * Интерфейс построен на HTML/CSS поверх canvas: текст остаётся чётким на любом
 * разрешении, анимации делает CSS (GPU), а меню доступны с клавиатуры, мыши,
 * сенсорного экрана и геймпада через одну систему навигации.
 */
const $ = (id) => document.getElementById(id);
const ARROW = { left: '←', up: '↑', right: '→', down: '↓' };

const UI = {
  stack: [],
  hudCache: {},

  init() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      Sound.unlock();
      if (b.hasAttribute('data-back')) { Sound.play('uiBack'); this.back(); return; }
      const act = b.dataset.act;
      if (act && this.actions[act]) {
        if (b.classList.contains('needs-confirm') && !b.classList.contains('confirm')) {
          b.classList.add('confirm'); b.dataset.label = b.textContent; b.textContent = 'Точно? Нажмите ещё раз';
          setTimeout(() => { if (b.classList.contains('confirm')) { b.classList.remove('confirm'); b.textContent = b.dataset.label; } }, 3000);
          Sound.play('ui'); return;
        }
        if (b.classList.contains('confirm')) { b.classList.remove('confirm'); b.textContent = b.dataset.label; }
        Sound.play('uiOk');
        this.actions[act](b);
      }
    });
    document.addEventListener('mouseover', (e) => {
      const b = e.target.closest('.screen.active button');
      if (b && document.activeElement !== b) b.focus({ preventScroll: true });
    });
    document.addEventListener('focusin', (e) => { if (e.target.closest && e.target.closest('.screen.active') && e.target.tagName === 'BUTTON') Sound.play('ui'); });
    Input.onAction((a, e) => this.onAction(a, e));
    document.querySelector('[data-act="reset-progress"]').classList.add('needs-confirm');
    document.querySelector('[data-act="reset-stats"]').classList.add('needs-confirm');
    $('ver-title').textContent = 'v' + VERSION;
    $('inv-ver').textContent = 'v' + VERSION;
    $('about-ver').textContent = 'Версия ' + VERSION;
    this.Hack.init(); this.Inv.init(); this.Feedback.init();
  },

  top() { return this.stack[this.stack.length - 1] || null; },
  open(id) {
    const cur = this.top();
    if (cur) $(cur).classList.remove('active');
    this.stack.push(id);
    const el = $(id);
    el.classList.add('active');
    if (this.onOpen[id]) this.onOpen[id]();
    this.focusFirst(el);
  },
  back() {
    const id = this.stack.pop();
    if (id) $(id).classList.remove('active');
    const cur = this.top();
    if (cur) { $(cur).classList.add('active'); if (this.onOpen[cur]) this.onOpen[cur](); this.focusFirst($(cur)); }
    else Game.onUiEmpty();
  },
  closeAll() { for (const id of this.stack) $(id).classList.remove('active'); this.stack = []; if (document.activeElement) document.activeElement.blur(); },
  focusFirst(el) {
    const b = this.buttons(el)[0];
    if (b) b.focus({ preventScroll: true });
  },
  buttons(el) { return Array.from(el.querySelectorAll('button')).filter((b) => !b.disabled && b.offsetParent !== null && !b.closest('.hack-pad,#touch')); },

  onAction(a, e) {
    const id = this.top();
    if (!id || !a) return;
    if (id === 'scr-hack') { if (ARROW[a]) this.Hack.key(a); return; }
    if (id === 'scr-dialog') { if (a === 'ok' || a === 'act' || a === 'jump') this.Dialog.advance(); else if (a === 'pause') this.Dialog.finish(); return; }
    if (id === 'scr-inventory') { this.Inv.onAction(a); return; }
    const el = $(id), list = this.buttons(el);
    const i = list.indexOf(document.activeElement);
    const act = document.activeElement;
    if (a === 'pause' || a === 'back') {
      if (id === 'scr-title') return;
      if (id === 'scr-pause') { Game.resume(); return; }
      if (id === 'scr-complete' || id === 'scr-ending') return;
      Sound.play('uiBack'); this.back(); return;
    }
    if ((a === 'left' || a === 'right') && act && act.dataset.setting) { this.Settings.change(act.dataset.setting, a === 'left' ? -1 : 1); return; }
    if (a === 'up' || a === 'left') { if (list.length) list[(i - 1 + list.length) % list.length].focus(); return; }
    if (a === 'down' || a === 'right') { if (list.length) list[(i + 1) % list.length].focus(); return; }
    if ((a === 'ok' && !e) || a === 'act') { if (act && list.includes(act)) act.click(); }
    if (a === 'inv' && id === 'scr-pause') this.open('scr-inventory');
  },

  actions: {
    continue: () => Game.startLevel(Game.save.current, false),
    new: () => Game.newGame(),
    levels: () => UI.open('scr-levels'),
    inventory: () => UI.open('scr-inventory'),
    settings: () => UI.open('scr-settings'),
    controls: () => UI.open('scr-controls'),
    stats: () => UI.open('scr-stats'),
    feedback: () => UI.open('scr-feedback'),
    about: () => UI.open('scr-about'),
    resume: () => Game.resume(),
    restart: () => Game.startLevel(Game.levelIdx, true),
    tomenu: () => Game.toMenu(),
    next: () => Game.startLevel(Math.min(Game.levelIdx + 1, LEVELS.length - 1), false),
    retry: () => Game.startLevel(Game.levelIdx, true),
    level: (b) => Game.startLevel(+b.dataset.level, false),
    'reset-progress': () => { const keep = Game.save.settings; Game.save = defaultSave(); Game.save.settings = keep; Game.persist(); UI.toast('Прогресс сброшен'); UI.back(); },
    'export-stats': () => Game.exportJSON('echoes_stats.json', Game.analytics()),
    'reset-stats': () => { Game.save.stats = { sessions: 1, playTime: 0, levels: {} }; Game.persist(); UI.onOpen['scr-stats'](); UI.toast('Статистика сброшена'); },
    'fb-send': () => UI.Feedback.send(),
    'fb-export': () => Game.exportJSON('echoes_feedback.json', { version: VERSION, feedback: Game.save.feedback }),
    setting: (b) => UI.Settings.change(b.dataset.setting, 1),
  },

  onOpen: {
    'scr-title': () => {
      const s = Game.save, has = s.unlocked > 1 || Object.keys(s.stats.levels).length > 0;
      $('btn-continue').classList.toggle('hidden', !has);
      document.querySelector('[data-act="new"]').classList.toggle('needs-confirm', has);
    },
    'scr-levels': () => {
      const box = $('level-cards'); box.innerHTML = '';
      LEVELS.forEach((L, i) => {
        const b = document.createElement('button');
        const st = Game.save.stats.levels[L.id] || {};
        const total = L.rows.join('').split('*').length - 1;
        const got = (Game.save.fragments[L.id] || []).length;
        const locked = i >= Game.save.unlocked;
        b.className = 'level-card' + (locked ? ' locked' : '');
        b.disabled = locked;
        b.dataset.act = 'level'; b.dataset.level = i;
        b.innerHTML = `<span class="lc-n">${L.name}</span><span class="lc-t">${L.title}</span>` +
          `<span class="lc-s">${locked ? 'ЗАБЛОКИРОВАНО' : `◆ ${got}/${total}` + (st.bestTime ? ` · ${U.fmtTime(st.bestTime)}` : '')}</span>`;
        box.appendChild(b);
      });
    },
    'scr-settings': () => UI.Settings.build(),
    'scr-stats': () => UI.Stats.build(),
    'scr-inventory': () => UI.Inv.build(),
    'scr-feedback': () => UI.Feedback.build(),
  },

  /* ---------- настройки ---------- */
  Settings: {
    defs: [
      { k: 'sfx', label: 'Звуки', type: 'vol' },
      { k: 'music', label: 'Музыка', type: 'vol' },
      { k: 'difficulty', label: 'Сложность', opts: ['easy', 'normal', 'hard'], names: { easy: 'Лёгкая', normal: 'Обычная', hard: 'Сложная' } },
      { k: 'scale', label: 'Масштаб', opts: ['fit', 'integer', 'stretch'], names: { fit: 'Вписать', integer: 'Целочисленный', stretch: 'Растянуть' } },
      { k: 'quality', label: 'Качество эффектов', opts: ['auto', 'high', 'low'], names: { auto: 'Авто', high: 'Высокое', low: 'Низкое' } },
      { k: 'crt', label: 'Эффект ЭЛТ', type: 'bool' },
      { k: 'shake', label: 'Тряска экрана', type: 'bool' },
      { k: 'touch', label: 'Сенсорные кнопки', opts: ['auto', 'on', 'off'], names: { auto: 'Авто', on: 'Вкл', off: 'Выкл' } },
      { k: 'fps', label: 'Счётчик FPS', type: 'bool' },
    ],
    build() {
      const box = $('settings-list'), focusKey = document.activeElement && document.activeElement.dataset.setting;
      box.innerHTML = '';
      for (const d of this.defs) {
        const b = document.createElement('button');
        b.dataset.act = 'setting'; b.dataset.setting = d.k;
        b.innerHTML = `<span>${d.label}</span><b>${this.valueText(d)}</b>`;
        box.appendChild(b);
      }
      if (focusKey) { const f = box.querySelector(`[data-setting="${focusKey}"]`); if (f) f.focus(); }
    },
    valueText(d) {
      const v = Game.save.settings[d.k];
      if (d.type === 'vol') return '<i class="vol">' + '■'.repeat(v) + '<s>' + '■'.repeat(10 - v) + '</s></i>';
      if (d.type === 'bool') return v ? 'ВКЛ' : 'ВЫКЛ';
      return d.names[v];
    },
    change(k, dir) {
      const d = this.defs.find((x) => x.k === k), s = Game.save.settings;
      if (d.type === 'vol') s[k] = U.clamp(s[k] + dir, 0, 10);
      else if (d.type === 'bool') s[k] = !s[k];
      else { const i = d.opts.indexOf(s[k]); s[k] = d.opts[(i + dir + d.opts.length) % d.opts.length]; }
      Game.applySettings(); Game.persist();
      Sound.play('ui');
      const b = $('settings-list').querySelector(`[data-setting="${k}"] b`);
      if (b) { b.innerHTML = this.valueText(d); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
    },
  },

  /* ---------- статистика (мониторинг) ---------- */
  Stats: {
    build() {
      const s = Game.save.stats;
      let html = `<div class="stat-top"><span>Сессий: <b>${s.sessions}</b></span><span>Время в игре: <b>${U.fmtTime(s.playTime)}</b></span><span>Отзывов: <b>${Game.save.feedback.length}</b></span></div>`;
      html += '<table class="stats"><tr><th>Сектор</th><th>Попыток</th><th>Пройден</th><th>Смертей</th><th>Лучшее время</th><th>Взломов</th><th>Провалов</th><th>Обнаружен</th></tr>';
      for (const L of LEVELS) {
        const v = s.levels[L.id] || {};
        html += `<tr><td>${L.title}</td><td>${v.attempts || 0}</td><td>${v.completions || 0}</td><td>${v.deaths || 0}</td><td>${v.bestTime ? U.fmtTime(v.bestTime) : '—'}</td><td>${v.hacks || 0}</td><td>${v.hackFails || 0}</td><td>${v.spotted || 0}</td></tr>`;
      }
      html += '</table><p class="note">Данные хранятся локально. Экспорт JSON используется для анализа баланса (смерти по секторам, провалы взлома).</p>';
      $('stats-body').innerHTML = html;
    },
  },

  /* ---------- отзыв ---------- */
  Feedback: {
    rating: 0, cat: 'Общее',
    init() {
      const st = $('fb-stars');
      for (let i = 1; i <= 5; i++) {
        const b = document.createElement('button'); b.className = 'star'; b.textContent = '★'; b.title = i;
        b.addEventListener('click', () => { this.rating = i; this.paint(); });
        st.appendChild(b);
      }
      const cats = ['Общее', 'Баг', 'Баланс', 'Управление', 'Интерфейс'], cb = $('fb-cat');
      for (const c of cats) {
        const b = document.createElement('button'); b.className = 'chip'; b.textContent = c;
        b.addEventListener('click', () => { this.cat = c; this.paint(); });
        cb.appendChild(b);
      }
    },
    paint() {
      $('fb-stars').querySelectorAll('.star').forEach((b, i) => b.classList.toggle('on', i < this.rating));
      $('fb-cat').querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', b.textContent === this.cat));
    },
    build() { this.paint(); $('fb-info').textContent = `Сохранено отзывов: ${Game.save.feedback.length}`; },
    send() {
      const text = $('fb-text').value.trim();
      if (!this.rating) { UI.toast('Поставьте оценку от 1 до 5', 'warn'); return; }
      Game.save.feedback.push({ at: new Date().toISOString(), version: VERSION, rating: this.rating, category: this.cat, text, level: Game.save.current, ua: navigator.userAgent.slice(0, 120) });
      Game.persist(); Telemetry.send('feedback', Game.save.feedback[Game.save.feedback.length - 1]);
      $('fb-text').value = ''; this.rating = 0; this.build();
      UI.toast('Спасибо! Отзыв сохранён', 'ok');
    },
  },

  /* ---------- инвентарь ---------- */
  Inv: {
    sel: 0, sorted: false, detail: false,
    init() {
      const grid = $('inv-grid');
      for (let i = 0; i < 25; i++) {
        const d = document.createElement('div'); d.className = 'slot'; d.dataset.i = i;
        d.addEventListener('click', () => { this.sel = i; this.paint(); });
        d.addEventListener('dblclick', () => { this.sel = i; this.toggle(); });
        grid.appendChild(d);
      }
      const pc = $('inv-portrait').getContext('2d');
      Sprites.drawPortrait(pc, 'ghost');
      this.iconCache = {};
    },
    list() {
      const items = Game.save.items.map((id) => ITEMS[id]).filter(Boolean);
      if (this.sorted) items.sort((a, b) => RARITY[b.rarity].order - RARITY[a.rarity].order);
      return items;
    },
    build() {
      const s = Game.save;
      const frags = Object.values(s.fragments).reduce((n, a) => n + a.length, 0);
      const lvl = 1 + frags * 2 + s.items.length * 3 + (s.unlocked - 1) * 4;
      let spotted = 0; for (const k in s.stats.levels) spotted += s.stats.levels[k].spotted || 0;
      $('inv-lvl').textContent = 'УРОВЕНЬ ' + lvl;
      $('inv-rep').textContent = 'РЕПУТАЦИЯ // ' + (spotted <= 3 ? 'ТЕНЬ' : spotted <= 10 ? 'ПРИЗРАК' : 'ШУМ');
      $('inv-count').textContent = s.items.length;
      this.detail = false; $('inv-detail').classList.add('hidden');
      this.paint();
    },
    icon(id) { return this.iconCache[id] || (this.iconCache[id] = Sprites.dataURL(Sprites.icons[id], 6)); },
    paint() {
      const items = this.list(), act = Game.save.active;
      $('inv-grid').querySelectorAll('.slot').forEach((el, i) => {
        const it = items[i];
        el.className = 'slot' + (i === this.sel ? ' sel' : '') + (it ? ' full r-' + it.rarity : '') + (it && act.includes(it.id) ? ' active' : '');
        el.innerHTML = it ? `<img src="${this.icon(it.id)}" alt=""><span class="nm">${it.name}</span><span class="rr">${RARITY[it.rarity].name}</span>` : '';
      });
      $('inv-implants').innerHTML = `<div class="imp-t">ИМПЛАНТЫ ${act.length}/${MAX_IMPLANTS}</div>` +
        (act.length ? act.map((id) => `<div class="imp">${ITEMS[id].name}</div>`).join('') : '<div class="imp dim">нет активных</div>');
      if (this.detail) this.showDetail();
    },
    showDetail() {
      const it = this.list()[this.sel], el = $('inv-detail');
      if (!it) { el.classList.add('hidden'); return; }
      const on = Game.save.active.includes(it.id);
      el.innerHTML = `<img src="${this.icon(it.id)}" alt=""><div><b class="r-${it.rarity}">${it.name}</b><i>${RARITY[it.rarity].name}</i><p>${it.desc}</p><p class="eff">${it.effect}</p><p class="st">${on ? '● АКТИВЕН' : '○ не активен — E, чтобы активировать'}</p></div>`;
      el.classList.remove('hidden');
    },
    toggle() {
      const it = this.list()[this.sel];
      if (!it) return;
      const a = Game.save.active, i = a.indexOf(it.id);
      if (i >= 0) a.splice(i, 1);
      else if (a.length >= MAX_IMPLANTS) { UI.toast(`Не больше ${MAX_IMPLANTS} имплантов`, 'warn'); Sound.play('keyBad'); return; }
      else a.push(it.id);
      Sound.play('uiOk'); Game.persist(); Game.onImplantsChanged();
      const el = $('inv-grid').children[this.sel]; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
      this.paint();
    },
    onAction(a) {
      const cols = 5;
      if (a === 'left') this.sel = (this.sel + 24) % 25;
      else if (a === 'right') this.sel = (this.sel + 1) % 25;
      else if (a === 'up') this.sel = (this.sel + 25 - cols) % 25;
      else if (a === 'down') this.sel = (this.sel + cols) % 25;
      else if (a === 'act' || a === 'ok' || a === 'jump') { this.toggle(); return; }
      else if (a === 'sort') { this.sorted = !this.sorted; UI.toast(this.sorted ? 'Сортировка: по редкости' : 'Сортировка: по времени находки'); Sound.play('ui'); }
      else if (a === 'detail') { this.detail = !this.detail; if (!this.detail) $('inv-detail').classList.add('hidden'); Sound.play('ui'); }
      else if (a === 'pause' || a === 'inv' || a === 'back') { Sound.play('uiBack'); UI.back(); return; }
      else return;
      if (['left', 'right', 'up', 'down'].includes(a)) Sound.play('ui');
      this.paint();
    },
  },

  /* ---------- мини-игра взлома ---------- */
  Hack: {
    running: false,
    init() {
      $('hack-pad').querySelectorAll('[data-k]').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.key(b.dataset.k); }));
    },
    start(params, cb) {
      const dirs = ['left', 'up', 'right', 'down'];
      this.seq = []; for (let i = 0; i < params.len; i++) this.seq.push(dirs[(Math.random() * 4) | 0]);
      this.pos = 0; this.tMax = params.time; this.t = params.time; this.cb = cb; this.running = true;
      $('hack-id').textContent = '#' + params.terminal.key.toUpperCase() + '-' + (100 + ((Math.random() * 900) | 0));
      $('hack-seq').innerHTML = this.seq.map((d, i) => `<span style="--d:${i * 60}ms">${ARROW[d]}</span>`).join('');
      $('hack-msg').textContent = 'Повторите последовательность';
      $('hack-msg').className = 'hack-msg';
      $('scr-hack').querySelector('.hack').className = 'hack';
      $('hack-pad').classList.toggle('show', Input.lastDevice === 'touch' || Game.touchOn);
      UI.open('scr-hack');
    },
    key(d) {
      if (!this.running) return;
      const spans = $('hack-seq').children;
      if (d === this.seq[this.pos]) {
        spans[this.pos].classList.add('ok'); this.pos++; Sound.play('key');
        if (this.pos >= this.seq.length) this.end(true);
      } else {
        Sound.play('keyBad');
        this.t -= 1.0; this.pos = 0;
        for (const s of spans) s.classList.remove('ok');
        const h = $('scr-hack').querySelector('.hack'); h.classList.remove('shake'); void h.offsetWidth; h.classList.add('shake');
        $('hack-msg').textContent = 'Ошибка! −1 с';
      }
    },
    tick(dt) {
      if (!this.running) return;
      this.t -= dt;
      $('hack-timer').style.transform = `scaleX(${U.clamp(this.t / this.tMax, 0, 1)})`;
      $('hack-timer').classList.toggle('low', this.t < this.tMax * 0.3);
      if (this.t <= 0) this.end(false);
    },
    end(ok) {
      this.running = false;
      $('hack-msg').textContent = ok ? 'ДОСТУП ПОЛУЧЕН' : 'ВЗЛОМ ПРОВАЛЕН';
      $('hack-msg').className = 'hack-msg ' + (ok ? 'ok' : 'bad');
      $('scr-hack').querySelector('.hack').classList.add(ok ? 'win' : 'lose');
      setTimeout(() => { UI.closeAll(); this.cb(ok); }, ok ? 550 : 750);
    },
  },

  /* ---------- диалоги ---------- */
  Dialog: {
    lines: [], i: 0, shown: 0, cb: null, t: 0,
    start(lines, cb) {
      this.lines = lines; this.i = 0; this.cb = cb;
      UI.open('scr-dialog'); this.show();
    },
    show() {
      const L = this.lines[this.i];
      this.shown = 0; this.full = L.text;
      const ai = L.who === 'ai';
      $('dlg-name').textContent = ai ? 'ИИ-СТРАЖ' : 'ПРИЗРАК';
      $('dlg-name').className = 'dlg-name ' + (ai ? 'm' : 'c');
      $('scr-dialog').querySelector('.dialog').className = 'dialog ' + (ai ? 'ai' : 'ghost');
      $('dlg-text').textContent = '';
    },
    tick(dt) {
      this.t += dt;
      const L = this.lines[this.i];
      if (!L) return;
      Sprites.drawPortrait($('dlg-portrait').getContext('2d'), L.who, this.t);
      if (this.shown < this.full.length) {
        const prev = Math.floor(this.shown);
        this.shown = Math.min(this.full.length, this.shown + dt * 45);
        if (Math.floor(this.shown) !== prev) $('dlg-text').textContent = this.full.slice(0, Math.floor(this.shown));
      }
    },
    advance() {
      if (this.shown < this.full.length) { this.shown = this.full.length; $('dlg-text').textContent = this.full; return; }
      Sound.play('ui');
      this.i++;
      if (this.i >= this.lines.length) this.finish(); else this.show();
    },
    finish() { UI.closeAll(); const cb = this.cb; this.cb = null; if (cb) cb(); },
  },

  /* ---------- HUD ---------- */
  setText(id, v) { if (this.hudCache[id] !== v) { this.hudCache[id] = v; $(id).textContent = v; } },
  setHtml(id, v) { if (this.hudCache[id] !== v) { this.hudCache[id] = v; $(id).innerHTML = v; } },
  toggle(id, show) { const k = id + ':v'; if (this.hudCache[k] !== show) { this.hudCache[k] = show; $(id).classList.toggle('hidden', !show); } },
  showHud(on) { $('hud').classList.toggle('hidden', !on); this.hudCache = {}; },
  updateHud(w, fpsText) {
    const p = w.player;
    let hp = '';
    for (let i = 0; i < p.maxHp; i++) hp += `<i class="${i < p.hp ? 'on' : ''}"></i>`;
    this.setHtml('hud-hp', hp);
    const e = Math.round(p.energy);
    if (this.hudCache.energy !== e) { this.hudCache.energy = e; $('hud-energy').style.transform = `scaleX(${e / 100})`; $('hud-energy').classList.toggle('low', e < 25); }
    this.setText('hud-level', w.def.name + ' · ' + w.def.title.toUpperCase());
    this.setText('hud-frag', `${w.fragments.filter((f) => f.got || f.old).length}/${w.fragTotal}`);
    this.setText('hud-time', U.fmtTime(w.stats.time));
    this.toggle('hud-alarm', w.alarm > 0);
    const sus = Math.round(w.sus * 20) / 20;
    if (this.hudCache.sus !== sus) { this.hudCache.sus = sus; const el = $('hud-sus'); el.firstChild.style.transform = `scaleX(${sus})`; el.classList.toggle('show', sus > 0 && w.alarm <= 0); }
    let prompt = '';
    if (w.nearTerminal) prompt = (Input.lastDevice === 'gp' ? '[X]' : Input.lastDevice === 'touch' ? '[E]' : '[E]') + ' ВЗЛОМАТЬ ТЕРМИНАЛ';
    this.setText('hud-prompt', prompt); this.toggle('hud-prompt', !!prompt);
    const hint = w.activeHint ? w.activeHint.text : '';
    this.setText('hud-hint', hint); this.toggle('hud-hint', !!hint);
    this.toggle('hud-debug', !!fpsText); if (fpsText) this.setText('hud-debug', fpsText);
  },

  toast(text, cls = '') {
    const box = $('toasts');
    const d = document.createElement('div');
    d.className = 'toast ' + cls; d.textContent = text;
    box.appendChild(d);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => d.classList.add('out'), 2300);
    setTimeout(() => d.remove(), 2800);
  },
};

/*
 * Телеметрия. В прототипе события только пишутся в локальную статистику;
 * при публикации достаточно указать ENDPOINT — отправка идёт через sendBeacon
 * и не блокирует игру.
 */
const Telemetry = {
  ENDPOINT: '',
  send(type, data) {
    if (!this.ENDPOINT || !navigator.sendBeacon) return false;
    try { return navigator.sendBeacon(this.ENDPOINT, JSON.stringify({ type, version: VERSION, at: Date.now(), data })); } catch (e) { return false; }
  },
};
