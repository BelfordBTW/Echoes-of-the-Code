'use strict';
/*
 * Игровой мир: физика, враги, стелс, взлом, подбор предметов.
 * Модуль не обращается к DOM и звуку — наружу уходят только события (emit),
 * поэтому его можно тестировать отдельно (tests/index.html).
 */

const PHYS = {
  GRAV: 980, MAXFALL: 420, RUN: 120, ACC_G: 1100, ACC_A: 750, FRIC: 1500,
  JUMP: 310, DJUMP: 280, COYOTE: 0.1, BUFFER: 0.12, CUT: 0.45,
  SLOW_WORLD: 0.35, SLOW_PLAYER: 0.8, SLOW_DRAIN: 35, SLOW_REGEN: 18,
};

const TERM_KEYS = 'abcde', DOOR_KEYS = 'ABCDE', LASER_KEYS = '12345';

class World {
  constructor(def, ctx = {}) {
    this.def = def;
    this.emit = ctx.emit || (() => {});
    this.owned = ctx.owned || new Set();
    this.diff = DIFFICULTY[ctx.difficulty] || DIFFICULTY.normal;
    this.lowFx = !!ctx.lowFx;
    this.W = def.w; this.H = def.h;
    this.grid = def.rows.map((r) => r.split(''));
    this.time = 0; this.worldTime = 0;
    this.doorsOpen = {}; this.doorAnim = {};
    this.terminals = []; this.drones = []; this.cameras = []; this.checkpoints = [];
    this.fragments = []; this.items = []; this.exits = []; this.boss = null;
    this.doorTiles = []; this.laserTiles = []; this.timedTiles = []; this.shadowTiles = [];
    this.hints = (def.hints || []).map((h) => Object.assign({}, h));
    this.bullets = []; this.particles = [];
    this.alarm = 0; this.sus = 0; this.shake = 0;
    this.nearTerminal = null; this.activeHint = null; this.done = false;
    this.stats = { deaths: 0, hacks: 0, hackFails: 0, spotted: 0, time: 0, frags: 0, items: [] };
    const collected = new Set(ctx.collected || []);
    let start = { x: 32, y: 32 };

    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const c = this.grid[y][x];
        const px = x * TILE, py = y * TILE;
        let clear = true;
        if (c === 'P') start = { x: px + 4, y: py + 2 };
        else if (c === '@') this.checkpoints.push({ x: px, y: py, on: false });
        else if (c === '*') {
          const idx = this.fragments.length;
          this.fragments.push({ x: px + 3, y: py + 3, w: 10, h: 10, idx, got: false, old: collected.has(idx) });
        } else if (c === 'i') {
          const it = (def.items || []).find((o) => o.x === x && o.y === y);
          if (it) this.items.push({ x: px + 2, y: py + 2, w: 12, h: 12, id: it.id, got: false });
        } else if (c === 'g') this.drones.push({ x: px + 2, y: py + 4, w: 12, h: 8, ox: px + 2, dir: 1, range: 5 * TILE, cd: 0.8, seeing: false, bob: Math.random() * 6 });
        else if (c === 'k') this.cameras.push({ x: px + 8, y: py + 4, angle: Math.PI / 2, phase: x * 0.7, period: 4.5, seeing: false });
        else if (c === 'B') this.boss = { x: px + 8, y: py + 8, t: 2.5, rot: 0, down: false, hit: 0 };
        else if (c === 'X') this.exits.push({ x: px, y: py - 8, w: 16, h: 24 });
        else if (TERM_KEYS.includes(c)) this.terminals.push({ x: px, y: py, key: c, idx: TERM_KEYS.indexOf(c), hacked: false });
        else clear = false;
        if (clear) this.grid[y][x] = '.';
        if (DOOR_KEYS.includes(c)) this.doorTiles.push({ x, y, key: c });
        else if (LASER_KEYS.includes(c)) this.laserTiles.push({ x, y, key: c });
        else if (c === '!') this.timedTiles.push({ x, y });
        else if (c === 's') this.shadowTiles.push({ x, y });
      }
    }
    this.fragTotal = this.fragments.length;

    this.player = {
      x: start.x, y: start.y, w: 8, h: 14, vx: 0, vy: 0, face: 1,
      onGround: false, coyote: 0, buffer: 0, canDouble: true, jumping: false, dropT: 0,
      hp: 0, maxHp: 0, inv: 0, energy: 100, slow: false, slowDelay: 0,
      dead: 0, cp: { x: start.x, y: start.y }, anim: 0, trail: [], trailT: 0, wasGround: false,
    };
    this.applyImplants(this.owned, true);
  }

  /* --- импланты (активные предметы) --- */
  applyImplants(set, fill) {
    this.owned = set;
    const p = this.player;
    p.maxHp = this.diff.hp + (set.has('holodeck') ? 2 : 0);
    p.hp = fill ? p.maxHp : Math.min(p.hp, p.maxHp);
  }

  /* --- тайлы --- */
  tile(x, y) {
    if (x < 0 || x >= this.W) return '#';
    if (y < 0 || y >= this.H) return '.';
    return this.grid[y][x];
  }
  solidAt(x, y) {
    const c = this.tile(x, y);
    if (c === '#') return true;
    const di = DOOR_KEYS.indexOf(c);
    if (di >= 0) return !this.doorsOpen[c];
    return false;
  }
  laserOn(key) { return !this.terminals.some((t) => t.hacked && LASER_KEYS[t.idx] === key); }
  timedState(tx) {
    const per = 1.7, ph = (this.worldTime + tx * 0.29) % per;
    if (ph < 0.9) return 'on';
    if (ph > per - 0.25) return 'warn';
    return 'off';
  }

  /* --- движение с разрешением столкновений по осям --- */
  moveX(e, dx) {
    e.x += dx;
    const t = TILE, top = Math.floor(e.y / t), bot = Math.floor((e.y + e.h - 0.01) / t);
    if (dx > 0) {
      const tx = Math.floor((e.x + e.w - 0.01) / t);
      for (let ty = top; ty <= bot; ty++) if (this.solidAt(tx, ty)) { e.x = tx * t - e.w; e.vx = 0; return true; }
    } else if (dx < 0) {
      const tx = Math.floor(e.x / t);
      for (let ty = top; ty <= bot; ty++) if (this.solidAt(tx, ty)) { e.x = (tx + 1) * t; e.vx = 0; return true; }
    }
    return false;
  }
  moveY(e, dy) {
    const prevBottom = e.y + e.h;
    e.y += dy; e.onGround = false;
    const t = TILE, l = Math.floor(e.x / t), r = Math.floor((e.x + e.w - 0.01) / t);
    if (dy > 0) {
      const ty = Math.floor((e.y + e.h - 0.01) / t);
      for (let tx = l; tx <= r; tx++) {
        const oneWay = this.tile(tx, ty) === '=' && prevBottom <= ty * t + 0.01 && !(e.dropT > 0);
        if (this.solidAt(tx, ty) || oneWay) { e.y = ty * t - e.h; e.vy = 0; e.onGround = true; return; }
      }
    } else if (dy < 0) {
      const ty = Math.floor(e.y / t);
      for (let tx = l; tx <= r; tx++) if (this.solidAt(tx, ty)) { e.y = (ty + 1) * t; e.vy = 0; return; }
    }
  }
  standingOnOneWay(e) {
    const ty = Math.floor((e.y + e.h + 1) / TILE);
    const l = Math.floor(e.x / TILE), r = Math.floor((e.x + e.w - 0.01) / TILE);
    let ow = false;
    for (let tx = l; tx <= r; tx++) { if (this.solidAt(tx, ty)) return false; if (this.tile(tx, ty) === '=') ow = true; }
    return ow;
  }

  /* --- главный шаг симуляции --- */
  update(dt, inp) {
    const p = this.player;
    const wantSlow = inp.slow && p.energy > 0 && p.dead <= 0;
    if (wantSlow && !p.slow) { p.slow = true; this.emit('slowOn'); }
    if (!wantSlow && p.slow) { p.slow = false; p.slowDelay = 0.6; this.emit('slowOff'); }
    if (p.slow) p.energy = Math.max(0, p.energy - PHYS.SLOW_DRAIN * dt);
    else if (p.slowDelay > 0) p.slowDelay -= dt;
    else p.energy = Math.min(100, p.energy + PHYS.SLOW_REGEN * dt * (this.owned.has('drone') ? 1.5 : 1));

    const wdt = dt * (p.slow ? PHYS.SLOW_WORLD : 1);
    const pdt = dt * (p.slow ? PHYS.SLOW_PLAYER : 1);
    this.time += dt; this.worldTime += wdt; this.stats.time += dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3);
    for (const k in this.doorsOpen) this.doorAnim[k] = Math.min(1, (this.doorAnim[k] || 0) + dt * 3);

    if (p.dead > 0) {
      p.dead -= dt;
      if (p.dead <= 0) this.respawn();
      this.updateParticles(wdt);
      this.updateBullets(wdt, false);
      return;
    }
    this.updatePlayer(pdt, inp);
    this.updateCameras(wdt);
    this.updateDrones(wdt);
    this.updateBoss(wdt);
    this.updateBullets(wdt, true);
    this.updateDetection(wdt);
    this.updateHazards();
    this.updatePickups(inp);
    this.updateParticles(wdt);
  }

  updatePlayer(dt, inp) {
    const p = this.player;
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (dir) p.face = dir;
    const acc = p.onGround ? PHYS.ACC_G : PHYS.ACC_A;
    if (dir) {
      // разворот на земле резче
      const boost = p.onGround && U.sign(p.vx) === -dir ? 2 : 1;
      p.vx = U.clamp(p.vx + dir * acc * boost * dt, -PHYS.RUN, PHYS.RUN);
    } else if (p.onGround) {
      const f = PHYS.FRIC * dt;
      p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - U.sign(p.vx) * f;
    } else p.vx *= 1 - 2 * dt;

    if (inp.jumpPressed) p.buffer = PHYS.BUFFER; else p.buffer -= dt;
    if (p.onGround) { p.coyote = PHYS.COYOTE; p.canDouble = true; } else p.coyote -= dt;

    if (p.buffer > 0) {
      if (p.coyote > 0) {
        if (inp.down && this.standingOnOneWay(p)) { p.dropT = 0.25; p.y += 2; }
        else { p.vy = -PHYS.JUMP; p.jumping = true; this.emit('jump'); }
        p.buffer = 0; p.coyote = 0; p.onGround = false;
      } else if (p.canDouble) {
        p.vy = -PHYS.DJUMP; p.canDouble = false; p.jumping = true; p.buffer = 0;
        this.emit('djump');
        this.burst(p.x + p.w / 2, p.y + p.h, 8, '#22e6ff', 60);
      }
    }
    if (p.jumping && !inp.jumpHeld && p.vy < 0) { p.vy *= PHYS.CUT; p.jumping = false; }
    if (p.vy >= 0) p.jumping = false;
    p.vy = Math.min(PHYS.MAXFALL, p.vy + PHYS.GRAV * dt);
    if (p.dropT > 0) p.dropT -= dt;

    this.moveX(p, p.vx * dt);
    this.moveY(p, p.vy * dt);
    if (p.onGround && !p.wasGround) { this.emit('land'); if (!this.lowFx) this.burst(p.x + p.w / 2, p.y + p.h, 4, '#6b7bb0', 30); }
    p.wasGround = p.onGround;
    if (p.inv > 0) p.inv -= dt;
    p.anim += dt * (Math.abs(p.vx) > 10 ? 1 : 0);
    // шлейф при замедлении времени
    p.trailT -= dt;
    if (p.slow && p.trailT <= 0) { p.trail.push({ x: p.x, y: p.y, face: p.face, a: 0.5 }); p.trailT = 0.05; }
    for (const t of p.trail) t.a -= dt * 1.6;
    while (p.trail.length && p.trail[0].a <= 0) p.trail.shift();
    if (p.y > this.H * TILE + 24) this.kill();
  }

  updateCameras(dt) {
    for (const c of this.cameras) {
      c.angle = Math.PI / 2 + Math.sin((this.worldTime * Math.PI * 2) / c.period + c.phase) * 0.7;
    }
  }

  updateDrones(dt) {
    const p = this.player, pcx = p.x + p.w / 2, pcy = p.y + p.h / 2;
    for (const d of this.drones) {
      d.bob += dt;
      const alert = this.alarm > 0;
      if (alert && Math.abs(pcx - d.x) < 200) d.dir = pcx > d.x + 6 ? 1 : -1;
      const sp = alert ? 62 : 32;
      const nx = d.x + d.dir * sp * dt;
      const ahead = Math.floor((d.dir > 0 ? nx + d.w : nx) / TILE), ty = Math.floor((d.y + 4) / TILE);
      const lim = alert ? d.range * 1.6 : d.range;
      if (this.solidAt(ahead, ty) || Math.abs(nx - d.ox) > lim) { if (!alert) d.dir *= -1; }
      else d.x = nx;
      if (alert) {
        d.cd -= dt;
        const dist = Math.hypot(pcx - (d.x + 6), pcy - (d.y + 4));
        if (d.cd <= 0 && dist < 170 && this.los(d.x + 6, d.y + 4, pcx, pcy)) {
          const a = Math.atan2(pcy - (d.y + 4), pcx - (d.x + 6));
          this.fire(d.x + 6, d.y + 6, Math.cos(a) * 150, Math.sin(a) * 150);
          d.cd = 1.1; this.emit('shoot');
        }
      }
      const box = { x: d.x, y: d.y + Math.sin(d.bob * 3) * 2, w: d.w, h: d.h };
      if (U.aabb(box, p)) this.hurt(1, d.x + 6);
    }
  }

  updateBoss(dt) {
    const b = this.boss;
    if (!b) return;
    b.rot += dt * 0.6;
    if (b.down) return;
    b.t -= dt;
    if (b.t <= 0) {
      const n = 10, sp = 85;
      for (let i = 0; i < n; i++) {
        const a = b.rot * 2 + (i * Math.PI * 2) / n;
        this.fire(b.x, b.y, Math.cos(a) * sp, Math.sin(a) * sp);
      }
      const hacked = this.terminals.filter((t) => t.hacked).length;
      b.t = [2.2, 1.7, 1.3, 1.3][hacked];
      this.emit('bossFire');
    }
  }

  fire(x, y, vx, vy) {
    if (this.bullets.length > 200) return;
    this.bullets.push({ x, y, vx, vy, life: 6 });
  }

  updateBullets(dt, collide) {
    const p = this.player;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let dead = b.life <= 0 || this.solidAt(Math.floor(b.x / TILE), Math.floor(b.y / TILE));
      if (!dead && collide && b.x > p.x - 1.5 && b.x < p.x + p.w + 1.5 && b.y > p.y - 1.5 && b.y < p.y + p.h + 1.5) {
        this.hurt(1, b.x); dead = true;
      }
      if (dead) { this.bullets[i] = this.bullets[this.bullets.length - 1]; this.bullets.pop(); }
    }
  }

  /* --- стелс: конусы обзора, подозрение, тревога --- */
  playerHidden() {
    const p = this.player;
    return this.tile(Math.floor((p.x + p.w / 2) / TILE), Math.floor((p.y + p.h / 2) / TILE)) === 's';
  }
  inCone(ox, oy, ang, half, range, tx, ty) {
    const dx = tx - ox, dy = ty - oy, d = Math.hypot(dx, dy);
    if (d > range) return false;
    let a = Math.atan2(dy, dx) - ang;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    if (Math.abs(a) > half) return false;
    return this.los(ox, oy, tx, ty);
  }
  los(ox, oy, tx, ty) {
    const dx = tx - ox, dy = ty - oy, n = Math.ceil(Math.hypot(dx, dy) / 4);
    for (let i = 1; i < n; i++) {
      if (this.solidAt(Math.floor((ox + (dx * i) / n) / TILE), Math.floor((oy + (dy * i) / n) / TILE))) return false;
    }
    return true;
  }
  droneAngle(d) { return d.dir > 0 ? 0.45 : Math.PI - 0.45; }
  updateDetection(dt) {
    const p = this.player, cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    const hidden = this.playerHidden();
    let seen = false;
    for (const d of this.drones) {
      d.seeing = !hidden && this.inCone(d.x + 6, d.y + 4, this.droneAngle(d), 0.5, 100, cx, cy);
      seen = seen || d.seeing;
    }
    for (const c of this.cameras) {
      c.seeing = !hidden && this.inCone(c.x, c.y, c.angle, 0.3, 150, cx, cy);
      seen = seen || c.seeing;
    }
    const rate = this.owned.has('visor') ? 1.6 : 2.7;
    if (seen) {
      this.sus = Math.min(1, this.sus + rate * dt);
      if (this.sus >= 1) {
        if (this.alarm <= 0) { this.stats.spotted++; this.emit('alarm'); }
        this.alarm = 5;
      }
    } else this.sus = Math.max(0, this.sus - 0.8 * dt);
    if (this.alarm > 0) { this.alarm -= dt; if (this.alarm <= 0) { this.alarm = 0; this.emit('alarmEnd'); } }
  }

  updateHazards() {
    const p = this.player;
    const l = Math.floor(p.x / TILE), r = Math.floor((p.x + p.w - 0.01) / TILE);
    const t = Math.floor(p.y / TILE), b = Math.floor((p.y + p.h - 0.01) / TILE);
    for (let ty = t; ty <= b; ty++) {
      for (let tx = l; tx <= r; tx++) {
        const c = this.tile(tx, ty);
        if (c === '^') {
          if (p.y + p.h > ty * TILE + 8) { this.hurt(1, tx * TILE + 8); p.vy = -220; }
        } else if (LASER_KEYS.includes(c) && this.laserOn(c)) {
          const lx = tx * TILE + 6;
          if (p.x + p.w > lx && p.x < lx + 4) this.hurt(1, lx + 2);
        } else if (c === '!' && this.timedState(tx) === 'on') {
          const lx = tx * TILE + 6;
          if (p.x + p.w > lx && p.x < lx + 4) this.hurt(1, lx + 2);
        }
      }
    }
  }

  updatePickups(inp) {
    const p = this.player;
    const grow = { x: p.x - 2, y: p.y - 2, w: p.w + 4, h: p.h + 4 };
    for (const f of this.fragments) {
      if (!f.got && U.aabb(grow, f)) {
        f.got = true; this.stats.frags++;
        this.emit('fragment', f); this.burst(f.x + 5, f.y + 5, 10, '#22e6ff', 70);
      }
    }
    for (const it of this.items) {
      if (!it.got && U.aabb(grow, it)) {
        it.got = true; this.stats.items.push(it.id);
        this.emit('item', it); this.burst(it.x + 6, it.y + 6, 16, RARITY[ITEMS[it.id].rarity].color, 90);
      }
    }
    for (const c of this.checkpoints) {
      if (!c.on && Math.abs(p.x + p.w / 2 - (c.x + 8)) < 10 && Math.abs(p.y + p.h - (c.y + 16)) < 20) {
        for (const o of this.checkpoints) o.on = false;
        c.on = true; p.cp = { x: c.x + 4, y: c.y + 2 };
        p.hp = p.maxHp;
        this.emit('checkpoint');
      }
    }
    // терминалы
    this.nearTerminal = null;
    for (const t of this.terminals) {
      if (!t.hacked && Math.abs(p.x + p.w / 2 - (t.x + 8)) < 16 && Math.abs(p.y + p.h / 2 - (t.y + 8)) < 20) { this.nearTerminal = t; break; }
    }
    if (inp.actPressed && this.nearTerminal) this.emit('hackStart', this.hackParams(this.nearTerminal));
    // подсказки
    this.activeHint = null;
    for (const h of this.hints) {
      if (Math.abs(p.x / TILE - h.x) < 4 && Math.abs(p.y / TILE - h.y) < 4) { this.activeHint = h; break; }
    }
    // выход
    for (const e of this.exits) {
      if (U.aabb(p, e)) {
        if (!this.exitOpen()) { this.emit('exitLocked'); continue; }
        if (!this.done) { this.done = true; this.emit('complete'); }
      }
    }
  }
  exitOpen() { return !this.def.requireAll || this.terminals.every((t) => t.hacked); }

  hackParams(t) {
    const len = Math.max(3, this.def.hackLen - (this.owned.has('crypto') ? 1 : 0));
    const time = this.def.hackTime * this.diff.hack * (this.owned.has('cable') ? 1.4 : 1);
    return { terminal: t, len, time };
  }
  finishHack(t, ok) {
    if (ok) {
      t.hacked = true; this.stats.hacks++;
      this.doorsOpen[DOOR_KEYS[t.idx]] = true;
      this.emit('hackOk', t);
      this.burst(t.x + 8, t.y + 6, 14, '#3dff9a', 80);
      if (this.boss && this.terminals.every((x) => x.hacked)) { this.boss.down = true; this.bullets.length = 0; this.emit('shieldDown'); }
    } else {
      this.stats.hackFails++;
      this.sus = 1;
      if (this.alarm <= 0) { this.stats.spotted++; this.emit('alarm'); }
      this.alarm = 5;
      this.emit('hackFail', t);
    }
  }

  /* --- урон и смерть --- */
  hurt(n, fromX) {
    const p = this.player;
    if (p.inv > 0 || p.dead > 0 || this.done) return;
    p.hp -= n; p.inv = 1.0;
    p.vx = (p.x + p.w / 2 < fromX ? -1 : 1) * 150; p.vy = -200; p.onGround = false;
    this.shake = 0.5;
    this.emit('hurt');
    this.burst(p.x + 4, p.y + 7, 10, '#ff2bd6', 90);
    if (p.hp <= 0) this.kill();
  }
  kill() {
    const p = this.player;
    if (p.dead > 0) return;
    p.dead = 1.0; p.hp = 0; this.stats.deaths++;
    this.shake = 0.8;
    this.burst(p.x + 4, p.y + 7, 30, '#ff2bd6', 140);
    this.emit('death');
  }
  respawn() {
    const p = this.player;
    p.x = p.cp.x; p.y = p.cp.y; p.vx = 0; p.vy = 0; p.hp = p.maxHp; p.inv = 1.2;
    p.dead = 0; p.energy = Math.max(p.energy, 50); p.trail.length = 0;
    this.alarm = 0; this.sus = 0; this.bullets.length = 0;
    this.emit('respawn');
  }

  /* --- частицы --- */
  burst(x, y, n, color, sp) {
    if (this.lowFx) n = Math.ceil(n / 3);
    for (let i = 0; i < n && this.particles.length < 320; i++) {
      const a = Math.random() * Math.PI * 2, s = sp * (0.3 + Math.random() * 0.7);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 20, life: 0.4 + Math.random() * 0.4, max: 0.8, color });
    }
  }
  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 300 * dt; q.life -= dt;
      if (q.life <= 0) { this.particles[i] = this.particles[this.particles.length - 1]; this.particles.pop(); }
    }
  }
}

if (typeof module !== 'undefined') module.exports = { World, PHYS };
