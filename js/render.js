'use strict';
/*
 * Отрисовка. Внутреннее разрешение 480×270 (16:9), масштабирование — средствами CSS
 * (image-rendering: pixelated), т.е. на GPU. Статичная геометрия уровня и фон пререндерятся
 * один раз при загрузке уровня; в кадре рисуется только видимая часть + динамика.
 */
const THEMES = {
  city: { sky: ['#06030f', '#1b0a33', '#3a0f4a'], edge: '#22e6ff', edge2: '#ff2bd6', wall: '#0c1120', wall2: '#121a2e', line: '#1a2a48', rain: true },
  server: { sky: ['#03060d', '#08122a', '#0b1838'], edge: '#ff2bd6', edge2: '#22e6ff', wall: '#0b0f1c', wall2: '#111829', line: '#24204a', rain: false },
  core: { sky: ['#05030c', '#170a2e', '#2b0d45'], edge: '#ff2bd6', edge2: '#22e6ff', wall: '#0d0f1e', wall2: '#151a30', line: '#2a1f4d', rain: true },
};

const Render = {
  cv: null, g: null, cam: { x: 0, y: 0 }, layers: null, theme: THEMES.city,
  debug: false, lowFx: false, rain: [],

  init(canvas) {
    this.cv = canvas;
    this.g = canvas.getContext('2d', { alpha: false });
    this.g.imageSmoothingEnabled = false;
  },

  prepare(world) {
    const th = this.theme = THEMES[world.def.theme] || THEMES.city;
    const W = world.W * TILE, H = world.H * TILE;
    const tiles = document.createElement('canvas'); tiles.width = W; tiles.height = H;
    const g = tiles.getContext('2d');
    const solid = (x, y) => world.tile(x, y) === '#';
    for (let y = 0; y < world.H; y++) {
      for (let x = 0; x < world.W; x++) {
        const c = world.grid[y][x], px = x * TILE, py = y * TILE;
        if (c === '#') {
          g.fillStyle = th.wall; g.fillRect(px, py, TILE, TILE);
          g.fillStyle = th.wall2; g.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
          // «схемотехника» — детерминированный узор
          g.fillStyle = th.line;
          const r = U.hash(x, y);
          if (r < 0.35) { g.fillRect(px + 3, py + 7, 10, 1); g.fillRect(px + 12, py + 7, 1, 5); }
          else if (r < 0.6) { g.fillRect(px + 7, py + 2, 1, 9); g.fillRect(px + 5, py + 11, 5, 2); }
          else if (r < 0.7) { g.fillRect(px + 4, py + 4, 2, 2); g.fillRect(px + 10, py + 10, 2, 2); }
          if (!solid(x, y - 1)) {
            g.fillStyle = th.edge; g.fillRect(px, py, TILE, 2);
            g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(px, py, TILE, 1);
            if (U.hash(x, y, 3) < 0.15) { g.fillStyle = th.edge2; g.fillRect(px + 6, py + 3, 4, 1); }
          }
          if (!solid(x - 1, y)) { g.fillStyle = '#1f2d50'; g.fillRect(px, py, 1, TILE); }
          if (!solid(x + 1, y)) { g.fillStyle = '#1f2d50'; g.fillRect(px + TILE - 1, py, 1, TILE); }
        } else if (c === '=') {
          g.fillStyle = '#18213d'; g.fillRect(px, py, TILE, 5);
          g.fillStyle = th.edge2; g.fillRect(px, py, TILE, 1);
          g.fillStyle = '#0b1020'; g.fillRect(px + 2, py + 5, 2, 3); g.fillRect(px + 12, py + 5, 2, 3);
        } else if (c === '^') {
          g.fillStyle = th.edge2;
          for (let i = 0; i < 4; i++) {
            g.beginPath(); g.moveTo(px + i * 4, py + 16); g.lineTo(px + i * 4 + 2, py + 8); g.lineTo(px + i * 4 + 4, py + 16); g.fill();
          }
          g.fillStyle = 'rgba(255,255,255,0.5)';
          for (let i = 0; i < 4; i++) g.fillRect(px + i * 4 + 2, py + 9, 1, 1);
        }
      }
    }
    // слой тени: рисуется поверх игрока
    const sh = document.createElement('canvas'); sh.width = W; sh.height = H;
    const sg = sh.getContext('2d');
    for (const t of world.shadowTiles) {
      // на слое тайлов — заметная «зона укрытия»: фиолетовая подложка и пунктир по верхнему краю
      sg.fillStyle = 'rgba(24,10,58,0.58)'; sg.fillRect(t.x * TILE, t.y * TILE, TILE, TILE);
      if (world.tile(t.x, t.y - 1) !== 's') { sg.fillStyle = '#9a6cff'; for (let i = 0; i < TILE; i += 4) sg.fillRect(t.x * TILE + i, t.y * TILE, 2, 1); }
      if (world.tile(t.x - 1, t.y) !== 's') { sg.fillStyle = 'rgba(154,108,255,0.7)'; for (let i = 0; i < TILE; i += 4) sg.fillRect(t.x * TILE, t.y * TILE + i, 1, 2); }
      if (world.tile(t.x + 1, t.y) !== 's') { sg.fillStyle = 'rgba(154,108,255,0.7)'; for (let i = 0; i < TILE; i += 4) sg.fillRect(t.x * TILE + TILE - 1, t.y * TILE + i, 1, 2); }
      sg.fillStyle = 'rgba(107,43,255,0.10)';
      for (let i = 0; i < TILE; i += 4) sg.fillRect(t.x * TILE + i, t.y * TILE + ((i + t.y * 3) % TILE), 2, 1);
    }
    this.layers = { tiles, shadow: sh, far: this.makeBg(world.def.theme, 0), near: this.makeBg(world.def.theme, 1) };
    this.rain = [];
    for (let i = 0; i < 90; i++) this.rain.push({ x: Math.random() * VIEW_W, y: Math.random() * VIEW_H, s: 180 + Math.random() * 120 });
    const p = world.player;
    this.cam.x = U.clamp(p.x - VIEW_W / 2, 0, W - VIEW_W);
    this.cam.y = U.clamp(p.y - VIEW_H * 0.55, 0, Math.max(0, H - VIEW_H));
  },

  makeBg(theme, layer) {
    const th = THEMES[theme] || THEMES.city;
    const W = VIEW_W * 2, H = VIEW_H;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    if (layer === 0) {
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, th.sky[0]); gr.addColorStop(0.6, th.sky[1]); gr.addColorStop(1, th.sky[2]);
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(168,246,255,${0.2 + U.hash(i, 1) * 0.5})`; g.fillRect(U.hash(i, 2) * W, U.hash(i, 3) * H * 0.5, 1, 1); }
    }
    if (theme === 'server') {
      // стойки серверов
      const n = layer ? 14 : 22;
      for (let i = 0; i < n; i++) {
        const w = layer ? 40 : 24, x = (i * W) / n, top = layer ? 60 : 30;
        g.fillStyle = layer ? '#0a1124' : '#070c1a'; g.fillRect(x + 2, top, w, H - top);
        g.fillStyle = layer ? '#111b36' : '#0b1328';
        for (let y = top + 6; y < H; y += layer ? 12 : 8) g.fillRect(x + 4, y, w - 4, layer ? 8 : 5);
        for (let y = top + 8; y < H; y += layer ? 12 : 8) {
          if (U.hash(i, y, layer) < 0.5) { g.fillStyle = U.hash(i, y, 9) < 0.5 ? '#22e6ff' : '#ff2bd6'; g.globalAlpha = layer ? 0.9 : 0.5; g.fillRect(x + 6 + Math.floor(U.hash(y, i) * (w - 10)), y, 2, 1); g.globalAlpha = 1; }
        }
      }
      return c;
    }
    if (theme === 'core' && layer === 0) {
      // башня ИИ с ядром
      const cx = W / 4, tw = 150;
      g.fillStyle = '#0c0a1e'; g.fillRect(cx - tw / 2, 0, tw, H);
      for (let y = 0; y < H; y += 6) { g.fillStyle = y % 12 ? '#141130' : '#1c1640'; g.fillRect(cx - tw / 2 + 4, y, tw - 8, 3); }
      for (let r = 60; r > 4; r -= 8) {
        g.strokeStyle = `rgba(34,230,255,${0.15 + (60 - r) / 120})`; g.lineWidth = 2;
        g.beginPath(); g.arc(cx, 110, r, 0, Math.PI * 2); g.stroke();
      }
      const rg = g.createRadialGradient(cx, 110, 2, cx, 110, 40);
      rg.addColorStop(0, 'rgba(200,250,255,0.9)'); rg.addColorStop(1, 'rgba(34,230,255,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(cx, 110, 40, 0, Math.PI * 2); g.fill();
      // копия справа для бесшовного повтора
      g.drawImage(c, 0, 0, W / 2, H, W / 2, 0, W / 2, H);
    }
    // силуэты небоскрёбов
    const n = layer ? 16 : 26;
    for (let i = 0; i < n; i++) {
      const w = (layer ? 26 : 16) + U.hash(i, 7, layer) * (layer ? 30 : 20);
      const h = (layer ? 70 : 90) + U.hash(i, 8, layer) * (layer ? 90 : 120);
      const x = (i * W) / n + U.hash(i, 9) * 10;
      if (theme === 'core' && layer === 0 && Math.abs(x + w / 2 - W / 4) < 100) continue;
      g.fillStyle = layer ? '#0b0918' : '#100c22';
      g.fillRect(x, H - h, w, h);
      for (let y = H - h + 4; y < H; y += layer ? 6 : 5) {
        for (let xx = x + 3; xx < x + w - 3; xx += layer ? 5 : 4) {
          const r = U.hash(Math.floor(xx), y, layer);
          if (r < (layer ? 0.18 : 0.12)) { g.fillStyle = r < 0.06 ? th.edge2 : th.edge; g.globalAlpha = layer ? 0.75 : 0.45; g.fillRect(xx, y, layer ? 2 : 1, 1); g.globalAlpha = 1; }
        }
      }
      if (layer && U.hash(i, 11) < 0.3) { g.fillStyle = th.edge2; g.fillRect(x + 4, H - h - 2, w - 8, 2); }
    }
    return c;
  },

  updateCamera(world, dt) {
    const p = world.player, W = world.W * TILE, H = world.H * TILE;
    const tx = U.clamp(p.x + p.w / 2 - VIEW_W / 2 + p.face * 36, 0, W - VIEW_W);
    const ty = U.clamp(p.y - VIEW_H * 0.55, 0, Math.max(0, H - VIEW_H));
    const k = 1 - Math.exp(-dt * 6);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
  },

  draw(world, dt, shakeOn) {
    const g = this.g, th = this.theme, L = this.layers;
    this.updateCamera(world, dt);
    let sx = 0, sy = 0;
    if (shakeOn && world.shake > 0) { sx = (Math.random() - 0.5) * world.shake * 8; sy = (Math.random() - 0.5) * world.shake * 8; }
    const cx = Math.round(this.cam.x + sx), cy = Math.round(this.cam.y + sy);
    const t = world.time, wt = world.worldTime;

    // фон с параллаксом
    const bw = VIEW_W * 2;
    const fx = Math.floor((cx * 0.15) % bw), nx = Math.floor((cx * 0.4) % bw);
    g.drawImage(L.far, fx, 0, Math.min(VIEW_W, bw - fx), VIEW_H, 0, 0, Math.min(VIEW_W, bw - fx), VIEW_H);
    if (bw - fx < VIEW_W) g.drawImage(L.far, 0, 0, VIEW_W - (bw - fx), VIEW_H, bw - fx, 0, VIEW_W - (bw - fx), VIEW_H);
    g.drawImage(L.near, nx, 0, Math.min(VIEW_W, bw - nx), VIEW_H, 0, 12, Math.min(VIEW_W, bw - nx), VIEW_H);
    if (bw - nx < VIEW_W) g.drawImage(L.near, 0, 0, VIEW_W - (bw - nx), VIEW_H, bw - nx, 12, VIEW_W - (bw - nx), VIEW_H);

    // дождь
    if (th.rain && !this.lowFx) {
      g.fillStyle = 'rgba(120,200,255,0.25)';
      for (const r of this.rain) {
        r.y += r.s * dt; r.x -= r.s * dt * 0.15;
        if (r.y > VIEW_H) { r.y = -6; r.x = Math.random() * (VIEW_W + 40); }
        g.fillRect(r.x | 0, r.y | 0, 1, 5);
      }
    }

    g.save();
    g.translate(-cx, -cy);
    // тайлы: только видимая часть пререндера
    g.drawImage(L.tiles, cx, cy, VIEW_W, VIEW_H, cx, cy, VIEW_W, VIEW_H);
    const vis = (x, w) => x + w > cx - 8 && x < cx + VIEW_W + 8;

    // двери
    for (const d of world.doorTiles) {
      const px = d.x * TILE, py = d.y * TILE;
      if (!vis(px, TILE)) continue;
      const a = world.doorAnim[d.key] || 0;
      if (a >= 1) { g.fillStyle = '#1a2340'; g.fillRect(px, py, TILE, 2); continue; }
      g.globalAlpha = 1 - a;
      g.fillStyle = '#2a0f33'; g.fillRect(px + 2, py, 12, TILE);
      g.fillStyle = '#ff2bd6';
      for (let i = 0; i < 4; i++) g.fillRect(px + 3, py + ((i * 4 + (t * 20) | 0) % 16), 10, 1);
      g.fillStyle = '#ff8af0'; g.fillRect(px + 2, py, 1, TILE); g.fillRect(px + 13, py, 1, TILE);
      g.globalAlpha = 1;
    }
    // лазеры
    const beam = (px, py, on, warn) => {
      g.fillStyle = '#3a1240'; g.fillRect(px + 5, py, 6, 1);
      if (on) {
        if (!this.lowFx) { g.fillStyle = 'rgba(255,43,214,0.22)'; g.fillRect(px + 4, py, 8, TILE); }
        g.fillStyle = (t * 30 | 0) % 2 ? '#ff2bd6' : '#ff5ce0'; g.fillRect(px + 7, py, 2, TILE);
        g.fillStyle = '#ffd6f8'; g.fillRect(px + 7.5, py, 1, TILE);
      } else if (warn) { g.fillStyle = (t * 20 | 0) % 2 ? 'rgba(255,43,214,0.6)' : 'rgba(255,43,214,0.15)'; g.fillRect(px + 7, py, 2, TILE); }
    };
    for (const l of world.laserTiles) { const px = l.x * TILE; if (vis(px, TILE)) beam(px, l.y * TILE, world.laserOn(l.key), false); }
    for (const l of world.timedTiles) { const px = l.x * TILE; if (vis(px, TILE)) { const s = world.timedState(l.x); beam(px, l.y * TILE, s === 'on', s === 'warn'); } }

    // подсказки (голо-таблички)
    for (const h of world.hints) {
      const px = h.x * TILE + 4, py = h.y * TILE + 2;
      if (!vis(px, 8)) continue;
      g.fillStyle = 'rgba(34,230,255,0.18)'; g.fillRect(px - 1, py - 1, 10, 10);
      g.fillStyle = '#22e6ff'; g.fillRect(px, py, 8, 1); g.fillRect(px, py + 7, 8, 1); g.fillRect(px, py, 1, 8); g.fillRect(px + 7, py, 1, 8);
      g.fillRect(px + 3, py + 2, 2, 3); g.fillRect(px + 3, py + 6, 2, 1);
    }
    // чекпойнты
    for (const c of world.checkpoints) {
      if (!vis(c.x, TILE)) continue;
      g.fillStyle = '#1c2540'; g.fillRect(c.x + 7, c.y + 2, 2, 14);
      g.fillStyle = '#0d1220'; g.fillRect(c.x + 4, c.y + 14, 8, 2);
      const on = c.on, pulse = 0.5 + 0.5 * Math.sin(t * 5);
      g.fillStyle = on ? '#22e6ff' : '#3a4670'; g.fillRect(c.x + 5, c.y, 6, 3);
      if (on) { g.fillStyle = `rgba(34,230,255,${0.15 + pulse * 0.2})`; g.fillRect(c.x + 2, c.y - 3, 12, 8); }
    }
    // терминалы
    for (const tm of world.terminals) {
      if (!vis(tm.x, TILE)) continue;
      const x = tm.x, y = tm.y;
      g.fillStyle = '#141c30'; g.fillRect(x + 3, y + 2, 10, 14);
      g.fillStyle = '#0a0f1c'; g.fillRect(x + 4, y + 3, 8, 6);
      const col = tm.hacked ? '#3dff9a' : '#22e6ff';
      g.fillStyle = col;
      if (tm.hacked) { g.fillRect(x + 5, y + 6, 2, 1); g.fillRect(x + 7, y + 7, 1, 1); g.fillRect(x + 8, y + 5, 3, 1); }
      else { for (let i = 0; i < 3; i++) if (((t * 3) | 0) % 3 !== i) g.fillRect(x + 5, y + 4 + i * 2, 2 + ((i * 5 + (t * 8 | 0)) % 5), 1); }
      g.fillStyle = '#ff2bd6'; g.fillRect(x + 5, y + 11, 6, 1);
      if (world.nearTerminal === tm) { g.strokeStyle = `rgba(34,230,255,${0.5 + 0.5 * Math.sin(t * 8)})`; g.strokeRect(x + 1.5, y + 0.5, 13, 16); }
    }
    // фрагменты
    for (const f of world.fragments) {
      if (f.got || !vis(f.x, 10)) continue;
      const bob = Math.sin(t * 3 + f.idx) * 2, w = Math.max(1, Math.abs(Math.cos(t * 3 + f.idx)) * 5);
      const x = f.x + 5, y = f.y + 5 + bob;
      g.fillStyle = f.old ? 'rgba(34,230,255,0.35)' : '#22e6ff';
      g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + w, y); g.lineTo(x, y + 5); g.lineTo(x - w, y); g.fill();
      g.fillStyle = '#e8f4ff'; g.fillRect(x - 0.5, y - 1, 1, 2);
    }
    // предметы
    for (const it of world.items) {
      if (it.got || !vis(it.x, 12)) continue;
      const col = RARITY[ITEMS[it.id].rarity].color, bob = Math.sin(t * 2.5) * 2;
      g.fillStyle = col; g.globalAlpha = 0.25 + 0.15 * Math.sin(t * 4); g.fillRect(it.x - 3, it.y - 3 + bob, 18, 18); g.globalAlpha = 1;
      g.drawImage(Sprites.icons[it.id], it.x - 2, it.y - 2 + bob);
    }
    // выход
    for (const e of world.exits) {
      const open = world.exitOpen(), x = e.x + 8, y = e.y + 12;
      for (let i = 3; i >= 1; i--) {
        g.strokeStyle = open ? (i % 2 ? '#22e6ff' : '#ff2bd6') : '#ff3b5c';
        g.globalAlpha = open ? 0.4 + 0.2 * Math.sin(t * 4 + i) : 0.5;
        g.lineWidth = 1;
        g.beginPath(); g.ellipse(x, y, 4 + i * 2 + Math.sin(t * 3 + i), 8 + i * 2, 0, 0, Math.PI * 2); g.stroke();
      }
      g.globalAlpha = 1;
      if (!open) { g.fillStyle = '#ff3b5c'; g.fillRect(x - 3, y - 1, 6, 2); }
    }

    // конусы обзора
    const cone = (ox, oy, ang, half, range, seeing) => {
      const n = this.lowFx ? 6 : 14;
      g.beginPath(); g.moveTo(ox, oy);
      for (let i = 0; i <= n; i++) {
        const a = ang - half + (2 * half * i) / n, dx = Math.cos(a), dy = Math.sin(a);
        let d = 0;
        while (d < range) { d += 4; if (world.solidAt(Math.floor((ox + dx * d) / TILE), Math.floor((oy + dy * d) / TILE))) break; }
        g.lineTo(ox + dx * d, oy + dy * d);
      }
      g.closePath();
      g.fillStyle = world.alarm > 0 ? 'rgba(255,59,92,0.16)' : seeing ? 'rgba(255,43,214,0.24)' : 'rgba(34,230,255,0.10)';
      g.fill();
    };
    for (const c of world.cameras) {
      if (!vis(c.x - 150, 300)) continue;
      cone(c.x, c.y, c.angle, 0.3, 150, c.seeing);
      g.fillStyle = '#1c2540'; g.fillRect(c.x - 4, c.y - 4, 8, 5);
      g.fillStyle = c.seeing || world.alarm > 0 ? '#ff3b5c' : '#22e6ff';
      g.fillRect(c.x - 1 + Math.cos(c.angle) * 2, c.y - 1 + Math.sin(c.angle) * 2, 3, 3);
    }
    for (const d of world.drones) {
      if (!vis(d.x - 100, 220)) continue;
      const by = Math.sin(d.bob * 3) * 2;
      cone(d.x + 6, d.y + 4 + by, world.droneAngle(d), 0.5, 100, d.seeing);
      const spr = Sprites.drone[(t * 12 | 0) % 2];
      g.drawImage(spr, Math.round(d.x), Math.round(d.y + by));
      if (d.seeing || world.alarm > 0) { g.fillStyle = '#ff3b5c'; g.fillRect(Math.round(d.x + 5), Math.round(d.y + 4 + by), 2, 1); }
      if (d.seeing && world.alarm <= 0) { g.fillStyle = '#ffd23b'; g.fillRect(d.x + 5, d.y - 8 + by, 2, 4); g.fillRect(d.x + 5, d.y - 3 + by, 2, 1); }
    }
    // Ядро ИИ
    const b = world.boss;
    if (b) {
      for (let i = 0; i < 4; i++) {
        g.strokeStyle = i % 2 ? '#22e6ff' : '#0f6f86'; g.lineWidth = 2;
        g.beginPath(); g.arc(b.x, b.y, 10 + i * 6, b.rot * (i % 2 ? 1 : -1.3) + i, b.rot * (i % 2 ? 1 : -1.3) + i + Math.PI * 1.4); g.stroke();
      }
      const rg = g.createRadialGradient(b.x, b.y, 1, b.x, b.y, 14);
      rg.addColorStop(0, b.down ? '#ffffff' : '#c8faff'); rg.addColorStop(1, 'rgba(34,230,255,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(b.x, b.y, 14, 0, Math.PI * 2); g.fill();
      if (!b.down) {
        g.strokeStyle = `rgba(255,43,214,${0.5 + 0.3 * Math.sin(t * 6)})`; g.lineWidth = 2;
        g.beginPath(); g.arc(b.x, b.y, 38, 0, Math.PI * 2); g.stroke();
      }
    }

    // игрок
    const p = world.player;
    for (const tr of p.trail) {
      g.globalAlpha = Math.max(0, tr.a) * 0.6;
      g.drawImage(this.playerFrame(p, true)[tr.face > 0 ? 0 : 1], Math.round(tr.x - 2), Math.round(tr.y - 2));
    }
    g.globalAlpha = 1;
    if (p.dead <= 0 && !(p.inv > 0 && ((t * 16) | 0) % 2)) {
      if (!this.lowFx) {
        const gl = g.createRadialGradient(p.x + 4, p.y + 7, 1, p.x + 4, p.y + 7, 16);
        gl.addColorStop(0, 'rgba(34,230,255,0.22)'); gl.addColorStop(1, 'rgba(34,230,255,0)');
        g.fillStyle = gl; g.fillRect(p.x - 12, p.y - 9, 32, 32);
      }
      const fr = this.playerFrame(p, false);
      g.drawImage(fr[p.face > 0 ? 0 : 1], Math.round(p.x - 2), Math.round(p.y - 2));
    }
    // тень поверх игрока
    g.drawImage(L.shadow, cx, cy, VIEW_W, VIEW_H, cx, cy, VIEW_W, VIEW_H);

    // пули
    for (const bl of world.bullets) {
      if (!vis(bl.x, 3)) continue;
      if (!this.lowFx) { g.fillStyle = 'rgba(255,43,214,0.3)'; g.fillRect(bl.x - 3, bl.y - 3, 6, 6); }
      g.fillStyle = '#ff8af0'; g.fillRect(bl.x - 1.5, bl.y - 1.5, 3, 3);
    }
    // частицы
    for (const q of world.particles) {
      g.globalAlpha = Math.max(0, q.life / q.max);
      g.fillStyle = q.color; g.fillRect(q.x | 0, q.y | 0, 2, 2);
    }
    g.globalAlpha = 1;

    if (this.debug) {
      g.strokeStyle = '#3dff9a'; g.lineWidth = 1;
      g.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
      for (const d of world.drones) g.strokeRect(d.x + 0.5, d.y + 0.5, d.w, d.h);
    }
    g.restore();

    // пост-эффекты
    if (p.slow) {
      g.fillStyle = 'rgba(34,230,255,0.08)'; g.fillRect(0, 0, VIEW_W, VIEW_H);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, VIEW_W, 10); g.fillRect(0, VIEW_H - 10, VIEW_W, 10);
    }
    if (world.alarm > 0) { g.fillStyle = `rgba(255,30,70,${0.07 + 0.05 * Math.sin(t * 10)})`; g.fillRect(0, 0, VIEW_W, VIEW_H); }
    if (p.dead > 0) { g.fillStyle = `rgba(5,6,13,${U.clamp(1 - p.dead, 0, 1)})`; g.fillRect(0, 0, VIEW_W, VIEW_H); }
  },

  playerFrame(p, ghost) {
    const P = Sprites.player;
    if (!p.onGround) return P.jump;
    if (Math.abs(p.vx) > 10) return [P.run1, P.run2, P.run3, P.run2][Math.floor(p.anim * 10) % 4];
    return P.idle;
  },

  /* фон для меню: тот же город, медленная прокрутка */
  drawMenuBg(t) {
    const g = this.g;
    if (!this.menuLayers) this.menuLayers = { far: this.makeBg('city', 0), near: this.makeBg('city', 1) };
    const bw = VIEW_W * 2, fx = Math.floor((t * 6) % bw), nx = Math.floor((t * 16) % bw);
    const L = this.menuLayers;
    g.drawImage(L.far, fx, 0, Math.min(VIEW_W, bw - fx), VIEW_H, 0, 0, Math.min(VIEW_W, bw - fx), VIEW_H);
    if (bw - fx < VIEW_W) g.drawImage(L.far, 0, 0, VIEW_W - (bw - fx), VIEW_H, bw - fx, 0, VIEW_W - (bw - fx), VIEW_H);
    g.drawImage(L.near, nx, 0, Math.min(VIEW_W, bw - nx), VIEW_H, 0, 12, Math.min(VIEW_W, bw - nx), VIEW_H);
    if (bw - nx < VIEW_W) g.drawImage(L.near, 0, 0, VIEW_W - (bw - nx), VIEW_H, bw - nx, 12, VIEW_W - (bw - nx), VIEW_H);
  },
};
