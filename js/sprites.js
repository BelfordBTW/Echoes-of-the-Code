'use strict';
/*
 * Пиксель-арт задаётся строками-картами и один раз пререндерится в offscreen-canvas
 * (вместе с отражёнными копиями). В кадре рисуются уже готовые изображения — это дешевле,
 * чем рисовать каждый пиксель заново.
 */
const PAL = {
  '.': null, k: '#070a14', h: '#1a2034', H: '#2a3352', s: '#3a4670', m: '#ff2bd6', M: '#ff8af0',
  c: '#22e6ff', C: '#a8f6ff', w: '#e8f4ff', g: '#3dff9a', r: '#ff3b5c', y: '#ffd23b', p: '#6b2bff', d: '#0f1526',
};

function makeSprite(rows, pal = PAL, flip = false) {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][flip ? w - 1 - x : x] || '.';
      const col = pal[ch];
      if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
    }
  }
  return cv;
}

const PLAYER_PAL = Object.assign({}, PAL, { h: '#3d4a7c', H: '#6a7cc0', k: '#121830' });
const PLAYER_BODY = [
  '....hhhh....',
  '...hHHHHh...',
  '..hHhhhhHh..',
  '..hhkkkkhh..',
  '..hkmkkmkh..',
  '..hkkmmkkh..',
  '..hhkkkkhh..',
  '...hhhhhh...',
  '..hhHchHhh..',
  '.hhhHchHhhh.',
  '.hh.hhhh.hh.',
  '.k..hhhh..k.',
  '....hcch....',
];
const LEGS = {
  idle: ['....hh.hh...', '....hh.hh...', '...kkk.kkk..'],
  run1: ['...hh...hh..', '..hh.....hh.', '..kk......kk'],
  run2: ['....hhhh....', '.....hhh....', '....kkkk....'],
  run3: ['..hh...hh...', '.hh.....hh..', '.kk......kk.'],
  jump: ['...hh..hh...', '..hh....hh..', '..kk....kk..'],
};

const ICONS = {
  cable: [
    '................', '....cccccccc....', '...c........c...', '..c..mmmmmm..c..',
    '..c.m......m.c..', '..c.m.kkkk.m.c..', '..c.m.k..k.m.c..', '..c.m.kkkk.m.c..',
    '..c.m......m.c..', '..c..mmmmmm..c..', '...c........c...', '....ccc..ccc....',
    '.......cc.......', '.......mm.......', '.......cc.......', '................'],
  crypto: [
    '..c..c..c..c....', '.kkkkkkkkkkkk...', 'ckddddddddddkc..', '.kddddmmddddk...',
    'ckdddm..mdddkc..', '.kdddm..mdddk...', 'ckddmmmmmmddkc..', '.kddmmmkmmddk...',
    'ckddmmmkmmddkc..', '.kddmmmmmmddk...', 'ckddddddddddkc..', '.kkkkkkkkkkkk...',
    '..c..c..c..c....', '................', '................', '................'],
  visor: [
    '................', '................', '................', '................',
    '.kkkkkkkkkkkkkk.', 'kccccccmmmmmmmck', 'kcCCcccmMMmmmmck', 'kccccccmmmmmmmck',
    '.kccccckkmmmmck.', '..kkkkk..kkkkk..', '................', '................',
    '................', '................', '................', '................'],
  drone: [
    '.cccc......cccc.', '...k........k...', '...kk......kk...', '....kkkkkkkk....',
    '...kddddddddk...', '..kddssmmssddk..', '..kdsmMMMMmsdk..', '..kdsmMwwMmsdk..',
    '..kddssmmssddk..', '...kddddddddk...', '....kkkkkkkk....', '...kk......kk...',
    '.cccc......cccc.', '................', '................', '................'],
  holodeck: [
    '................', '...mmmmmmmmmm...', '...m.c..c..cm...', '...m.cc.c.c.m...',
    '...m..c.cc..m...', '...mmmmmmmmmm...', '.....m....m.....', '..kkkkkkkkkkkk..',
    '.kddddddddddddk.', '.kdhhhhhhhhhhdk.', '.kdhcchhhhhhhdk.', '.kddddddddddddk.',
    '..kkkkkkkkkkkk..', '................', '................', '................'],
};

const Sprites = {
  ready: false,
  init() {
    const P = {};
    for (const k in LEGS) {
      const rows = PLAYER_BODY.concat(LEGS[k]);
      P[k] = [makeSprite(rows, PLAYER_PAL), makeSprite(rows, PLAYER_PAL, true)];
    }
    this.player = P;
    this.drone = [
      makeSprite(['cc........cc', '.k........k.', '..kkkkkkkk..', '.kdddddddddk', 'kddsmMMmsddk', '.kddddddddk.', '..kkkkkkkk..', '...k....k...']),
      makeSprite(['.cc......cc.', '.k........k.', '..kkkkkkkk..', '.kdddddddddk', 'kddsmMMmsddk', '.kddddddddk.', '..kkkkkkkk..', '...k....k...']),
    ];
    this.icons = {};
    for (const k in ICONS) this.icons[k] = makeSprite(ICONS[k]);
    this.ready = true;
  },
  /* увеличенная копия для DOM (иконки инвентаря, портреты) */
  dataURL(cv, scale) {
    const o = document.createElement('canvas');
    o.width = cv.width * scale; o.height = cv.height * scale;
    const g = o.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(cv, 0, 0, o.width, o.height);
    return o.toDataURL();
  },
  /* портреты для диалогов: рисуются кодом */
  drawPortrait(g, who, t = 0) {
    const W = g.canvas.width, Hh = g.canvas.height;
    g.clearRect(0, 0, W, Hh);
    g.fillStyle = '#070a14'; g.fillRect(0, 0, W, Hh);
    const s = W / 32;
    const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x * s), Math.round(y * s), Math.ceil(w * s), Math.ceil(h * s)); };
    if (who === 'ghost') {
      for (let i = 0; i < 6; i++) R(2 + i * 5, 0, 1, 32, '#0d1530');
      R(9, 4, 14, 3, '#2a3352'); R(7, 7, 18, 3, '#2a3352'); R(6, 10, 20, 14, '#1a2034');
      R(9, 10, 14, 10, '#070a14');
      // V-образный визор
      for (let i = 0; i < 5; i++) { R(10 + i, 13 + i * 0.6, 2, 1.2, '#ff2bd6'); R(20 - i, 13 + i * 0.6, 2, 1.2, '#ff2bd6'); }
      R(15, 16, 2, 1.2, '#ff8af0');
      R(4, 24, 24, 8, '#1a2034'); R(12, 24, 2, 8, '#22e6ff'); R(18, 24, 2, 8, '#22e6ff');
      R(6, 7, 1, 17, '#22e6ff'); R(25, 7, 1, 17, '#22e6ff');
    } else {
      const cx = 16, cy = 16, pulse = 0.5 + 0.5 * Math.sin(t * 4);
      for (let r = 14; r > 2; r -= 3) {
        g.strokeStyle = r % 2 ? '#22e6ff' : '#0f6f86';
        g.lineWidth = s;
        g.beginPath(); g.arc(cx * s, cy * s, r * s, t + r, t + r + Math.PI * 1.5); g.stroke();
      }
      g.fillStyle = `rgba(168,246,255,${0.6 + pulse * 0.4})`;
      g.beginPath(); g.arc(cx * s, cy * s, 3 * s, 0, Math.PI * 2); g.fill();
    }
  },
};
