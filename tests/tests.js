'use strict';
/* Минимальный тест-раннер без зависимостей. Мир симулируется без отрисовки. */
const results = [];
function test(name, fn) {
  const t0 = performance.now();
  try { fn(); results.push({ name, ok: true, ms: performance.now() - t0 }); }
  catch (e) { results.push({ name, ok: false, err: e.message, ms: performance.now() - t0 }); }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'assert'); }
function near(a, b, eps, msg) { if (Math.abs(a - b) > eps) throw new Error(`${msg || ''} ожидалось ${b}±${eps}, получено ${a.toFixed(2)}`); }

const NONE = { left: false, right: false, down: false, slow: false, jumpHeld: false, jumpPressed: false, actPressed: false };
const inp = (o) => Object.assign({}, NONE, o);
const STEP = 1 / 120;
function mk(i = 0, ctx = {}) { return new World(LEVELS[i], Object.assign({ emit: () => {} }, ctx)); }
function run(w, sec, input = NONE) { const n = Math.round(sec / STEP); for (let i = 0; i < n; i++) w.update(STEP, i === 0 ? input : Object.assign({}, input, { jumpPressed: false, actPressed: false })); }
function settle(w) { run(w, 1.0); assert(w.player.onGround, 'игрок должен стоять на земле'); }

/* ---------- данные уровней ---------- */
LEVELS.forEach((L, li) => {
  test(`Уровень ${li + 1}: структура карты корректна`, () => {
    const all = L.rows.join('');
    assert(L.rows.length === LEVEL_H, 'высота');
    assert(L.rows.every((r) => r.length === L.w), 'ширина строк');
    assert((all.match(/P/g) || []).length === 1, 'ровно один старт P');
    assert((all.match(/X/g) || []).length >= 1, 'есть выход X');
    assert(!/[C]/.test(all) || all.includes('c'), 'символ C занят дверью: точки восстановления — @');
    for (const d of 'ABCDE') if (all.includes(d)) assert(all.includes(d.toLowerCase()), `дверь ${d} без терминала`);
    for (const [i, n] of [...'12345'].entries()) if (all.includes(n)) assert(all.includes('abcde'[i]), `лазер ${n} без терминала`);
    for (const it of L.items) assert(ITEMS[it.id], `неизвестный предмет ${it.id}`);
    assert(L.intro && L.intro.length, 'есть вступительный диалог');
  });
  test(`Уровень ${li + 1}: игрок появляется на твёрдой поверхности`, () => { const w = mk(li); settle(w); });
});

/*
 * Проверка проходимости: поиск в ширину по «опорным» клеткам (над твёрдым полом или платформой).
 * Переход возможен, если цель в пределах дальности прыжка: вверх до 4 тайлов (двойной прыжок)
 * и до 4 тайлов по горизонтали; на ту же высоту или вниз — до 5 тайлов. Двери и лазеры считаются взломанными
 * (терминалы проверяются на достижимость отдельно).
 */
function reach(L) {
  const g = L.rows, H = g.length, W = L.w;
  const solid = (x, y) => x < 0 || x >= W ? true : y < 0 || y >= H ? false : g[y][x] === '#';
  const floor = (x, y) => y + 1 < H && (solid(x, y + 1) || g[y + 1][x] === '=');
  const stand = (x, y) => !solid(x, y) && floor(x, y) && g[y][x] !== '^' && !solid(x, y - 1);
  const key = (x, y) => y * W + x;
  let sx = 0, sy = 0;
  g.forEach((r, y) => { const i = r.indexOf('P'); if (i >= 0) { sx = i; sy = y; } });
  while (!stand(sx, sy) && sy < H - 1) sy++;
  const seen = new Set([key(sx, sy)]), q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    for (let dx = -5; dx <= 5; dx++) {
      for (let dy = -4; dy <= 8; dy++) {
        const nx = x + dx, ny = y + dy;
        if (dy < 0 && Math.abs(dx) > 4) continue;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H || seen.has(key(nx, ny)) || !stand(nx, ny)) continue;
        if (dy < 0) { let blocked = false; for (let yy = y - 1; yy >= ny - 1; yy--) if (solid(x, yy)) blocked = true; if (blocked) continue; }
        // горизонтальный путь не должен упираться в стену на уровне выше обеих точек
        const top = Math.min(y, ny) - (dy < 0 ? 1 : 0); let wall = false;
        for (let xx = Math.min(x, nx); xx <= Math.max(x, nx); xx++) if (solid(xx, top) && solid(xx, top - 1) && solid(xx, top - 2) && solid(xx, top - 3)) wall = true;
        if (wall && Math.abs(dx) > 0) continue;
        seen.add(key(nx, ny)); q.push([nx, ny]);
      }
    }
  }
  const reachable = (tx, ty) => { for (let dx = -3; dx <= 3; dx++) for (let dy = 0; dy <= 4; dy++) if (seen.has(key(tx + dx, ty + dy))) return true; return false; };
  return { reachable, seen };
}
LEVELS.forEach((L, li) => {
  test(`Уровень ${li + 1}: выход, терминалы, предметы и фрагменты достижимы`, () => {
    const r = reach(L);
    L.rows.forEach((row, y) => [...row].forEach((c, x) => {
      if ('Xabcde*i@'.includes(c)) assert(r.reachable(x, y), `«${c}» (${x},${y}) недостижим`);
    }));
  });
});

test('Все 5 предметов концепта размещены на уровнях', () => {
  const placed = new Set(LEVELS.flatMap((L) => L.items.map((i) => i.id)));
  for (const id in ITEMS) assert(placed.has(id), `предмет ${id} не размещён`);
});

/* ---------- физика ---------- */
function maxRise(w, holdSec, double) {
  settle(w);
  const y0 = w.player.y; let minY = y0;
  const n = Math.round(1.2 / STEP);
  for (let i = 0; i < n; i++) {
    const second = double && i === Math.round(0.30 / STEP);
    w.update(STEP, inp({ jumpHeld: i * STEP < holdSec || (double && i * STEP < 0.7), jumpPressed: i === 0 || second }));
    minY = Math.min(minY, w.player.y);
  }
  return y0 - minY;
}
test('Обычный прыжок: высота ≈ 3 тайла (45–52 px)', () => { const r = maxRise(mk(0), 1, false); assert(r >= 45 && r <= 52, 'высота ' + r.toFixed(1)); });
test('Короткое нажатие даёт низкий прыжок (< 60%)', () => { const r = maxRise(mk(0), 0.05, false); assert(r < 30, 'высота ' + r.toFixed(1)); });
test('Двойной прыжок: выше 4 тайлов (> 64 px)', () => { const r = maxRise(mk(0), 1, true); assert(r > 64, 'высота ' + r.toFixed(1)); });
test('Стена в 4 тайла непреодолима одиночным прыжком', () => { const r = maxRise(mk(0), 1, false); assert(r < 64); });
test('Дальность прыжка с разбега ≥ 4 тайлов', () => {
  const w = mk(0); settle(w);
  run(w, 0.4, inp({ right: true }));
  w.player.x = 40; w.player.vx = PHYS.RUN;
  const x0 = w.player.x;
  for (let i = 0; i < 200; i++) {
    w.update(STEP, inp({ right: true, jumpHeld: true, jumpPressed: i === 0 }));
    if (i > 5 && w.player.onGround) break;
  }
  assert(w.player.x - x0 >= 64, 'дальность ' + (w.player.x - x0).toFixed(1));
});
test('Буфер прыжка: нажатие за 0,1 с до приземления срабатывает', () => {
  const w = mk(0); settle(w);
  w.player.y -= 40; w.player.vy = 0;
  let jumped = false; w.emit = (e) => { if (e === 'jump') jumped = true; };
  for (let i = 0; i < 120 && !jumped; i++) {
    const dist = 208 + 32 - (w.player.y + w.player.h);
    w.update(STEP, inp({ jumpPressed: dist < 12 && dist > 6, jumpHeld: true }));
  }
  assert(jumped, 'прыжок не сработал');
});
test('Стены блокируют движение (нет туннелирования)', () => {
  const w = mk(0); const p = w.player;
  p.x = 42 * TILE - 30; p.y = 13 * TILE - p.h; p.vx = 0;
  run(w, 2, inp({ right: true }));
  assert(p.x + p.w <= 42 * TILE + 0.01, 'прошёл сквозь стену x=' + p.x);
});
test('Платформа проходима снизу и держит сверху', () => {
  const w = mk(0); const p = w.player;
  p.x = 85 * TILE; p.y = 13 * TILE - p.h; settle(w);
  for (let i = 0; i < 100; i++) w.update(STEP, inp({ jumpHeld: true, jumpPressed: i === 0 || i === 30 }));
  run(w, 1.0);
  near(p.y + p.h, 10 * TILE, 0.5, 'стоит на платформе');
});

/* ---------- время, урон, смерть ---------- */
test('Замедление времени расходует энергию (35/с) и замедляет мир', () => {
  const w = mk(0); settle(w);
  const wt = w.worldTime;
  run(w, 1, inp({ slow: true }));
  near(w.player.energy, 65, 1.5, 'энергия');
  near(w.worldTime - wt, PHYS.SLOW_WORLD, 0.02, 'мировое время');
});
test('Энергия восстанавливается после паузы 0,6 с', () => {
  const w = mk(0); settle(w);
  run(w, 1, inp({ slow: true })); run(w, 0.6); const e = w.player.energy; run(w, 1);
  near(w.player.energy - e, PHYS.SLOW_REGEN, 1.5, 'регенерация');
});
test('Шипы наносят урон, неуязвимость 1 с', () => {
  const w = mk(0); const p = w.player; const hp = p.hp;
  p.x = 78 * TILE; p.y = 15 * TILE - p.h - 1; p.vy = 0;
  w.update(STEP, NONE);
  assert(p.hp === hp - 1, 'hp ' + p.hp);
  w.hurt(1, 0); assert(p.hp === hp - 1, 'урон в неуязвимости');
});
test('Падение в пропасть: смерть и возрождение на точке', () => {
  const w = mk(0); const p = w.player;
  p.cp = { x: 100, y: 200 };
  p.y = LEVEL_H * TILE + 30; w.update(STEP, NONE);
  assert(w.stats.deaths === 1, 'смертей ' + w.stats.deaths);
  run(w, 1.2);
  assert(p.dead <= 0 && Math.abs(p.x - 100) < 1 && p.hp === p.maxHp, 'возрождение');
});

/* ---------- взлом, двери, стелс ---------- */
test('Успешный взлом открывает дверь A', () => {
  const w = mk(0); const t = w.terminals.find((x) => x.key === 'a');
  assert(w.solidAt(56, 10), 'дверь закрыта');
  w.finishHack(t, true);
  assert(!w.solidAt(56, 10), 'дверь открыта');
});
test('Успешный взлом выключает лазер 2', () => {
  const w = mk(0); assert(w.laserOn('2'));
  w.finishHack(w.terminals.find((x) => x.key === 'b'), true);
  assert(!w.laserOn('2'));
});
test('Проваленный взлом включает тревогу', () => {
  const w = mk(0); w.finishHack(w.terminals[0], false);
  assert(w.alarm > 0 && w.stats.spotted === 1);
});
test('Параметры взлома: импланты укорачивают код и дают время', () => {
  const w0 = mk(0), w1 = mk(0, { owned: new Set(['crypto', 'cable']) });
  const a = w0.hackParams(w0.terminals[0]), b = w1.hackParams(w1.terminals[0]);
  assert(b.len === a.len - 1, 'длина'); near(b.time, a.time * 1.4, 0.01, 'время');
});
test('Дрон замечает игрока в конусе (тревога ≈ через 0,4 с)', () => {
  const w = mk(0); const d = w.drones[0]; const p = w.player;
  run(w, 0.05); d.dir = 1; d.x = 64 * TILE; d.ox = d.x;
  p.x = d.x + 50; p.y = 13 * TILE - p.h;
  let t = 0;
  for (let i = 0; i < 240 && w.alarm <= 0; i++) { d.dir = 1; d.x = 64 * TILE; w.update(STEP, NONE); t += STEP; }
  assert(w.alarm > 0, 'тревога не включилась'); assert(t > 0.25 && t < 0.6, 'время ' + t.toFixed(2));
});
test('Игрок в тени невидим для дрона', () => {
  const w = mk(0); const d = w.drones[0]; const p = w.player;
  for (let i = 0; i < 120; i++) { d.dir = -1; d.x = 64 * TILE; p.x = 60 * TILE + 4; p.y = 13 * TILE - p.h; p.vx = 0; w.update(STEP, NONE); }
  assert(w.playerHidden(), 'в тени'); assert(w.alarm === 0 && w.sus === 0, 'обнаружен');
});
test('Стены перекрывают линию обзора', () => {
  const w = mk(0);
  assert(!w.los(41 * TILE, 11 * TILE, 46 * TILE, 11 * TILE), 'обзор сквозь стену');
  assert(w.los(36 * TILE, 11 * TILE, 40 * TILE, 11 * TILE), 'свободный обзор');
});
test('Визор замедляет обнаружение на 40%', () => {
  const w0 = mk(0), w1 = mk(0, { owned: new Set(['visor']) });
  [w0, w1].forEach((w) => { w.drones[0].seeing = true; });
  const rateTime = (w) => { const d = w.drones[0], p = w.player; let t = 0; while (w.alarm <= 0 && t < 2) { d.dir = 1; d.x = 64 * TILE; d.ox = d.x; p.x = d.x + 50; p.y = 13 * TILE - p.h; w.update(STEP, NONE); t += STEP; } return t; };
  const a = rateTime(w0), b = rateTime(w1);
  assert(b > a * 1.5, `${a.toFixed(2)} vs ${b.toFixed(2)}`);
});
test('Голо-дек: +2 к здоровью', () => {
  const w = mk(0, { owned: new Set(['holodeck']) });
  assert(w.player.maxHp === DIFFICULTY.normal.hp + 2);
});

/* ---------- предметы и финал ---------- */
test('Подбор фрагмента и предмета', () => {
  const w = mk(0); const f = w.fragments[0], it = w.items[0], p = w.player;
  p.x = f.x; p.y = f.y; w.update(STEP, NONE);
  assert(f.got && w.stats.frags === 1, 'фрагмент');
  p.x = it.x; p.y = it.y; w.update(STEP, NONE);
  assert(it.got && w.stats.items[0] === 'cable', 'предмет');
});
test('Финал: выход закрыт, пока не взломаны 3 узла; щит Ядра падает', () => {
  const w = mk(2);
  assert(!w.exitOpen(), 'выход открыт сразу');
  run(w, 3); assert(w.bullets.length > 0, 'Ядро стреляет');
  w.terminals.forEach((t) => w.finishHack(t, true));
  assert(w.exitOpen() && w.boss.down && w.bullets.length === 0, 'щит');
});
test('Завершение уровня через портал', () => {
  const w = mk(0); let done = false; w.emit = (e) => { if (e === 'complete') done = true; };
  const e = w.exits[0]; w.player.x = e.x + 4; w.player.y = e.y + 8;
  w.update(STEP, NONE); assert(done && w.done);
});

/* ---------- производительность ---------- */
test('Производительность: 10 000 шагов симуляции уровня 3 < 1500 мс', () => {
  const w = mk(2); const t0 = performance.now();
  for (let i = 0; i < 10000; i++) w.update(STEP, inp({ right: i % 400 < 200, left: i % 400 >= 200, jumpPressed: i % 90 === 0, jumpHeld: true }));
  const ms = performance.now() - t0;
  assert(ms < 1500, ms.toFixed(0) + ' мс');
  window.__simMs = ms;
});

/* ---------- вывод ---------- */
const out = document.getElementById('out');
let ok = 0;
for (const r of results) {
  if (r.ok) ok++;
  const tr = document.createElement('tr');
  tr.innerHTML = `<td class="${r.ok ? 'ok' : 'fail'}">${r.ok ? 'PASS' : 'FAIL'}</td><td>${r.name}</td><td class="dim">${r.ms.toFixed(1)} мс</td><td class="fail">${r.err || ''}</td>`;
  out.appendChild(tr);
}
document.getElementById('sum').innerHTML = `<span class="${ok === results.length ? 'ok' : 'fail'}">Пройдено ${ok} из ${results.length}</span>` +
  (window.__simMs ? ` <span class="dim">· 10 000 шагов симуляции: ${window.__simMs.toFixed(0)} мс</span>` : '');
window.__testResults = { ok, total: results.length, results };
