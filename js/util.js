'use strict';
/* Общие утилиты: математика, хранилище, данные предметов. Без зависимостей от DOM. */

const VERSION = '1.0.0';
const TILE = 16;
const VIEW_W = 480;
const VIEW_H = 270;

const U = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  rand: (a, b) => a + Math.random() * (b - a),
  sign: (v) => (v > 0 ? 1 : v < 0 ? -1 : 0),
  aabb: (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y,
  // детерминированный «шум» для процедурной отрисовки тайлов
  hash: (x, y, s = 0) => {
    let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  },
  fmtTime: (sec) => {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  },
};

/* Предметы. Совпадают с концептом инвентаря из 6 семестра. */
const RARITY = {
  rare: { name: 'РЕДКИЙ', color: '#22e6ff', order: 1 },
  epic: { name: 'ЭПИЧЕСКИЙ', color: '#ff2bd6', order: 2 },
  legendary: { name: 'ЛЕГЕНДАРНЫЙ', color: '#ff5cf0', order: 3 },
};

const ITEMS = {
  cable: { id: 'cable', name: 'НЕЙРО-КАБЕЛЬ', rarity: 'rare',
    desc: 'Прямое подключение к терминалу.', effect: '+40% времени на взлом.' },
  crypto: { id: 'crypto', name: 'КРИПТО-МОДУЛЬ', rarity: 'epic',
    desc: 'Подбирает часть ключа заранее.', effect: 'Последовательность взлома короче на 1.' },
  visor: { id: 'visor', name: 'ВИЗОР', rarity: 'rare',
    desc: 'Глушит сканеры противника.', effect: 'Враги замечают на 40% медленнее.' },
  drone: { id: 'drone', name: 'ДРОН', rarity: 'epic',
    desc: 'Компаньон-аккумулятор.', effect: 'Энергия замедления восстанавливается в 1,5 раза быстрее.' },
  holodeck: { id: 'holodeck', name: 'ГОЛО-ДЕК', rarity: 'legendary',
    desc: 'Резервная копия сознания.', effect: '+2 к максимальному здоровью.' },
};
const MAX_IMPLANTS = 3;

const DIFFICULTY = {
  easy: { name: 'Лёгкая', hp: 7, hack: 1.3 },
  normal: { name: 'Обычная', hp: 5, hack: 1.0 },
  hard: { name: 'Сложная', hp: 3, hack: 0.8 },
};

function defaultSave() {
  return {
    version: 1,
    unlocked: 1,          // сколько секторов открыто
    current: 0,           // индекс последнего сектора
    items: [],            // найденные предметы
    active: [],           // активные импланты (до 3)
    fragments: {},        // levelId -> [индексы собранных фрагментов]
    settings: {
      sfx: 7, music: 4, scale: 'fit', crt: true, shake: true, fps: false,
      touch: 'auto', difficulty: 'normal', quality: 'auto',
    },
    stats: { sessions: 0, playTime: 0, levels: {} },
    feedback: [],
  };
}

const Store = {
  key: 'echoes_of_code_save_v1',
  load() {
    try {
      const s = localStorage.getItem(this.key);
      if (!s) return null;
      const d = JSON.parse(s);
      const def = defaultSave();
      // слияние со значениями по умолчанию (миграция старых сохранений)
      return Object.assign(def, d, {
        settings: Object.assign(def.settings, d.settings || {}),
        stats: Object.assign(def.stats, d.stats || {}),
      });
    } catch (e) { return null; }
  },
  save(d) {
    try { localStorage.setItem(this.key, JSON.stringify(d)); return true; } catch (e) { return false; }
  },
  clear() { try { localStorage.removeItem(this.key); } catch (e) { /* приватный режим */ } },
};

if (typeof module !== 'undefined') module.exports = { U, TILE, ITEMS, RARITY, DIFFICULTY, defaultSave };
