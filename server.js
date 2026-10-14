/**
 * 深海大亂潛 — 後端伺服器（原「失控魔法工廠」）
 * Node.js + Express + Socket.io
 *
 * 啟動：npm install → npm start → 瀏覽器開 http://localhost:3000
 * 測試用環境變數：MIN_PLAYERS=2（降低開局人數）、GAME_SECONDS=60（縮短一局時間）
 */
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

// ============================================================
// 遊戲參數
// ============================================================
const CONFIG = {
  PORT: Number(process.env.PORT) || 3000,
  MIN_PLAYERS: Number(process.env.MIN_PLAYERS) || 5,
  MAX_PLAYERS: 10,
  DEVICES_PER_PLAYER: 4,
  GAME_DURATION_MS: (Number(process.env.GAME_SECONDS) || 180) * 1000, // 一局 3 分鐘
  COUNTDOWN_MS: 6500,             // 開局：跳水動畫 3.5 秒＋「3、2、1、下潛！」倒數
  AIR_FULL: 100,                  // 氣瓶壓力：開局 100 bar
  AIR_EMPTY: 20,                  // 降到 20 bar → 全員緊急上升（遊戲結束）
  WRONG_COOLDOWN_MS: 1000,        // 同一人連續亂按，1 秒內只扣一次
  RESET_DELAY_MS: 700,            // 低難度：完成後機關自動歸位的延遲
  NEXT_INSTRUCTION_DELAY_MS: 1200,// 完成/失敗後多久配發下一條指令
  START_STAGGER_MS: 500,          // 開局時每位玩家指令錯開時間
  ACCIDENT_EVERY_MS: 7000,        // 高難度失控期間，每 7 秒發生一次潛水事故
  NAME_MAX: 12,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '12345678', // 後台密碼（建議在 Render 設定 ADMIN_PASSWORD 改掉）
  RESULTS_MAX: 300,
};

// 三種難度（後台可調）
const LEVELS = {
  easy: { label: '🐠 體驗潛水', INSTRUCTION_MS: 20000, INSTRUCTION_MIN_MS: 14000, WRONG_PENALTY: 2, TIMEOUT_PENALTY: 4, SUCCESS_BONUS: 3, CHAOS_MS: 0, ACCIDENTS: false },
  medium: { label: '🐬 進階潛水員', INSTRUCTION_MS: 15000, INSTRUCTION_MIN_MS: 9000, WRONG_PENALTY: 4, TIMEOUT_PENALTY: 6, SUCCESS_BONUS: 2, CHAOS_MS: 30000, ACCIDENTS: false },
  hard: { label: '🦈 技術潛水', INSTRUCTION_MS: 12000, INSTRUCTION_MIN_MS: 6000, WRONG_PENALTY: 5, TIMEOUT_PENALTY: 8, SUCCESS_BONUS: 1, CHAOS_MS: 45000, ACCIDENTS: true },
};
const LEVEL_KEYS = Object.keys(LEVELS);
const levelOf = (room) => LEVELS[room.difficulty] || LEVELS.medium;

// 各類機關在哪些難度出現
const TYPE_LEVELS = {
  button: ['easy', 'medium', 'hard'],
  switch: ['easy', 'medium', 'hard'],
  slider: ['easy', 'medium', 'hard'],
  compass: ['medium', 'hard'],
  selector: ['hard'],
};
const TYPES = new Set(Object.keys(TYPE_LEVELS));

// 後台可調整的參數：[key, 說明, 最小值, 最大值, 分組]
const SETTING_RULES = [
  ['GAME_SECONDS', '一局秒數', 30, 900, '共用'],
  ['MIN_PLAYERS', '最低開局人數', 2, 10, '共用'],
  ['WRONG_COOLDOWN_SECONDS', '亂按冷卻秒數', 0, 10, '共用'],
];
const LEVEL_RULES = [
  ['INSTRUCTION_SECONDS', '開局指令秒數', 4, 60],
  ['INSTRUCTION_MIN_SECONDS', '結尾指令秒數（越玩越快）', 3, 60],
  ['WRONG_PENALTY', '亂按扣氣（bar）', 0, 40],
  ['TIMEOUT_PENALTY', '逾時扣氣（bar）', 0, 40],
  ['SUCCESS_BONUS', '完成補氣（bar）', 0, 20],
  ['CHAOS_SECONDS', '洋流失控秒數（0＝沒有）', 0, 300],
];
for (const lv of LEVEL_KEYS) {
  for (const [k, label, min, max] of LEVEL_RULES) SETTING_RULES.push([`${lv}.${k}`, label, min, max, LEVELS[lv].label]);
}

function getSettings() {
  const s = {
    GAME_SECONDS: CONFIG.GAME_DURATION_MS / 1000,
    MIN_PLAYERS: CONFIG.MIN_PLAYERS,
    WRONG_COOLDOWN_SECONDS: CONFIG.WRONG_COOLDOWN_MS / 1000,
  };
  for (const lv of LEVEL_KEYS) {
    const L = LEVELS[lv];
    s[`${lv}.INSTRUCTION_SECONDS`] = L.INSTRUCTION_MS / 1000;
    s[`${lv}.INSTRUCTION_MIN_SECONDS`] = L.INSTRUCTION_MIN_MS / 1000;
    s[`${lv}.WRONG_PENALTY`] = L.WRONG_PENALTY;
    s[`${lv}.TIMEOUT_PENALTY`] = L.TIMEOUT_PENALTY;
    s[`${lv}.SUCCESS_BONUS`] = L.SUCCESS_BONUS;
    s[`${lv}.CHAOS_SECONDS`] = L.CHAOS_MS / 1000;
  }
  return s;
}
function applySettings(s) {
  CONFIG.GAME_DURATION_MS = s.GAME_SECONDS * 1000;
  CONFIG.MIN_PLAYERS = s.MIN_PLAYERS;
  CONFIG.WRONG_COOLDOWN_MS = s.WRONG_COOLDOWN_SECONDS * 1000;
  for (const lv of LEVEL_KEYS) {
    const L = LEVELS[lv];
    L.INSTRUCTION_MS = s[`${lv}.INSTRUCTION_SECONDS`] * 1000;
    L.INSTRUCTION_MIN_MS = Math.min(s[`${lv}.INSTRUCTION_MIN_SECONDS`], s[`${lv}.INSTRUCTION_SECONDS`]) * 1000;
    L.WRONG_PENALTY = s[`${lv}.WRONG_PENALTY`];
    L.TIMEOUT_PENALTY = s[`${lv}.TIMEOUT_PENALTY`];
    L.SUCCESS_BONUS = s[`${lv}.SUCCESS_BONUS`];
    L.CHAOS_MS = s[`${lv}.CHAOS_SECONDS`] * 1000;
  }
}

// 機關的數值範圍
const SLIDER_MAX = 4;   // 低／中難度滑桿：0~4（底、中、頂 = 0、2、4）
const STEP_MAX = 10;    // 高難度刻度滑桿：0~10
const DIR4 = ['N', 'E', 'S', 'W'];
const DIR8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const DIR_NAME = { N: '北', NE: '東北', E: '東', SE: '東南', S: '南', SW: '西南', W: '西', NW: '西北' };
const TRI_NAME = ['關掉', '調到半開', '全開'];
const SLIDE_NAME = { 0: '拉到底部', 2: '推到中間', 4: '推到頂端' };

// ============================================================
// 題庫載入
// ============================================================
function resolveTarget(d) {
  const t = d.target;
  const a = String(d.action || '');
  if (d.type === 'button') return 'press';
  if (d.type === 'compass' || d.type === 'selector') return 'random';
  if (d.type === 'switch') {
    if (t === 'on' || t === 'off') return t;
    if (/關|停/.test(a)) return 'off';
    if (/開|啟/.test(a)) return 'on';
    return null;
  }
  // slider（低難度用的固定目標）
  const named = { max: SLIDER_MAX, mid: SLIDER_MAX / 2, min: 0 };
  if (typeof t === 'string' && Object.prototype.hasOwnProperty.call(named, t)) return named[t];
  if (Number.isInteger(t) && t >= 0 && t <= SLIDER_MAX) return t;
  if (/頂|最大|最高|滿/.test(a)) return SLIDER_MAX;
  if (/底|最小|最低|歸零/.test(a)) return 0;
  if (/中/.test(a)) return SLIDER_MAX / 2;
  return null;
}

/** 檢查並整理題庫；回傳 { list, errors } */
function sanitizeDevices(raw) {
  const errors = [];
  const list = [];
  if (!Array.isArray(raw)) return { list, errors: ['題庫必須是陣列'] };
  const seen = new Set();
  raw.forEach((d, i) => {
    const label = `第 ${i + 1} 筆${d && d.name ? `（${d.name}）` : ''}`;
    if (!d || !String(d.id || '').trim() || !String(d.name || '').trim() || !TYPES.has(d.type)) {
      errors.push(`${label}：缺少 id、名稱或類型`);
      return;
    }
    const id = String(d.id).trim();
    if (seen.has(id)) return errors.push(`${label}：id「${id}」重複`);
    const target = resolveTarget(d);
    if (target === null) return errors.push(`${label}：看不懂操作狀態`);
    let options;
    if (d.type === 'selector') {
      options = (Array.isArray(d.options) ? d.options : String(d.options || '').split(/[,，、]/))
        .map((o) => String(o).trim().slice(0, 8)).filter(Boolean);
      options = [...new Set(options)];
      if (options.length < 2 || options.length > 6) return errors.push(`${label}：選擇器要有 2 到 6 個不重複的選項`);
    }
    seen.add(id);
    const name = String(d.name).trim().slice(0, 40);
    const action = String(d.action || '').trim().slice(0, 20);
    let instruction = String(d.instruction || '').trim().slice(0, 80);
    if (d.type === 'compass') instruction = `把${name}轉到（隨機方向）！`;
    else if (d.type === 'selector') instruction = `把${name}轉到（隨機選項）！`;
    else if (!instruction) instruction = d.type === 'slider' ? `把${name}${action}！` : `${action}${name}！`;
    list.push({ id, name, type: d.type, action, instruction, target, enabled: d.enabled !== false, ...(options ? { options } : {}) });
  });
  return { list, errors };
}

function loadDefaultDevices() {
  const file = path.join(__dirname, 'data', 'devices.json');
  const { list, errors } = sanitizeDevices(JSON.parse(fs.readFileSync(file, 'utf8')));
  errors.forEach((e) => console.warn('[題庫]', e));
  return list;
}

let DEVICES = loadDefaultDevices();
const activeDevices = () => DEVICES.filter((d) => d.enabled);
const poolFor = (level) => activeDevices().filter((d) => TYPE_LEVELS[d.type].includes(level));
const maxPlayersFor = (level) => Math.min(CONFIG.MAX_PLAYERS, Math.floor(poolFor(level).length / CONFIG.DEVICES_PER_PLAYER));
const maxPlayers = () => Math.min(...LEVEL_KEYS.map(maxPlayersFor)); // 各難度都能玩的上限
const DEFAULT_SETTINGS = getSettings();
console.log(`[題庫] 載入 ${DEVICES.length} 個潛水機關；最多人數 低 ${maxPlayersFor('easy')}／中 ${maxPlayersFor('medium')}／高 ${maxPlayersFor('hard')}`);

// ============================================================
// 機關在各難度的操作方式
// ============================================================
/** 告訴前端要畫哪種控制元件 */
function controlMode(level, dev) {
  switch (dev.type) {
    case 'button': return level === 'hard' ? 'gesture' : 'tap';
    case 'switch': return level === 'easy' ? 'twoWay' : 'threeWay';
    case 'slider': return level === 'hard' ? 'step10' : 'range5';
    case 'compass': return level === 'hard' ? 'dir8' : 'dir4';
    case 'selector': return 'options';
    default: return 'tap';
  }
}

/** 低難度用固定目標：機關「待命」狀態與目標相反，保證操作一次就能達成 */
function readyValue(dev) {
  if (dev.type === 'switch') return dev.target === 'on' ? 'off' : 'on';
  if (dev.type === 'slider') return dev.target === 0 ? SLIDER_MAX : 0;
  return null;
}

function initialValue(level, dev) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  switch (controlMode(level, dev)) {
    case 'twoWay': return readyValue(dev);
    case 'threeWay': return pick([0, 1, 2]);
    case 'range5': return level === 'easy' ? readyValue(dev) : pick([0, 2, 4]);
    case 'step10': return Math.floor(Math.random() * (STEP_MAX + 1));
    case 'dir4': return pick(DIR4);
    case 'dir8': return pick(DIR8);
    case 'options': return Math.floor(Math.random() * dev.options.length);
    default: return null;
  }
}

function normalizeValue(level, dev, value) {
  const int = (max) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : null;
  };
  switch (controlMode(level, dev)) {
    case 'tap': return 'press';
    case 'gesture': return ['press', 'double', 'triple', 'hold'].includes(value) ? value : 'press';
    case 'twoWay': return value === 'on' || value === true ? 'on' : 'off';
    case 'threeWay': return int(2);
    case 'range5': return int(SLIDER_MAX);
    case 'step10': return int(STEP_MAX);
    case 'dir4': return DIR4.includes(value) ? value : null;
    // 高難度可以回報「按住保持航向」：hold:方位
    case 'dir8': {
      const v = String(value || '');
      const d = v.startsWith('hold:') ? v.slice(5) : v;
      return DIR8.includes(d) ? v : null;
    }
    case 'options': return int(dev.options.length - 1);
    default: return null;
  }
}

/** 產生這條指令的目標與文字（目標永遠和機關目前狀態不同，一定要動手調整） */
function buildInstruction(level, dev, current) {
  const pickOther = (arr) => {
    const opts = arr.filter((v) => v !== current);
    return opts[Math.floor(Math.random() * opts.length)];
  };
  switch (controlMode(level, dev)) {
    case 'tap':
    case 'twoWay':
      return { target: dev.type === 'button' ? 'press' : dev.target, text: dev.instruction };
    case 'range5': {
      if (level === 'easy') return { target: dev.target, text: dev.instruction };
      const t = pickOther([0, 2, 4]);
      return { target: t, text: `把${dev.name}${SLIDE_NAME[t]}！` };
    }
    case 'gesture': {
      const t = ['press', 'press', 'triple', 'hold'][Math.floor(Math.random() * 4)];
      if (t === 'press') return { target: t, text: dev.instruction };
      if (t === 'triple') return { target: t, text: `連按三下${dev.name}！` };
      return { target: t, text: `長按${dev.name}兩秒！` };
    }
    case 'threeWay': {
      const t = pickOther([0, 1, 2]);
      return { target: t, text: `把${dev.name}${TRI_NAME[t]}！` };
    }
    case 'step10': {
      const t = pickOther([...Array(STEP_MAX + 1).keys()]);
      return { target: t, text: `把${dev.name}調到 ${t}！` };
    }
    case 'dir4':
    case 'dir8': {
      const t = pickOther(level === 'hard' ? DIR8 : DIR4);
      // 高難度約三分之一是「按住保持航向」：要撐住 1.5 秒
      if (level === 'hard' && Math.random() < 0.35) return { target: `hold:${t}`, text: `按住${dev.name}，保持在${DIR_NAME[t]}！` };
      return { target: t, text: `把${dev.name}轉到${DIR_NAME[t]}！` };
    }
    case 'options': {
      const t = pickOther([...dev.options.keys()]);
      return { target: t, text: `把${dev.name}轉到「${dev.options[t]}」！` };
    }
    default:
      return { target: 'press', text: dev.instruction };
  }
}

// ============================================================
// 小工具
// ============================================================
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cleanName(name) {
  const s = String(name || '').replace(/[<>]/g, '').trim().slice(0, CONFIG.NAME_MAX);
  return s || '菜鳥潛水員';
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 I O 0 1
function generateCode() {
  for (let i = 0; i < 1000; i++) {
    let c = '';
    for (let k = 0; k < 4; k++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('無法產生船號');
}

// ============================================================
// 伺服器
// ============================================================
const app = express();
app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.use('/api/admin', express.json({ limit: '200kb' }));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
// 單人練習用的題庫（只給啟用中的機關）
app.get('/api/devices', (_req, res) => {
  res.json({
    ok: true,
    typeLevels: TYPE_LEVELS,
    devices: activeDevices().map(({ id, name, type, action, instruction, target, options }) => ({ id, name, type, action, instruction, target, ...(options ? { options } : {}) })),
  });
});

// ============================================================
// 後台 API（密碼登入後取得 token）
// ============================================================
const adminTokens = new Map();   // token → 到期時間
const loginAttempts = new Map(); // ip → { count, until }
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireAdmin(req, res, next) {
  const token = String(req.get('x-admin-token') || '');
  const exp = adminTokens.get(token);
  if (!exp || exp < Date.now()) {
    adminTokens.delete(token);
    return res.status(401).json({ ok: false, error: '請重新登入' });
  }
  next();
}

function adminDeviceView(d) {
  const sliderName = { 4: 'max', 2: 'mid', 0: 'min' };
  return { ...d, target: d.type === 'slider' ? sliderName[d.target] : d.target };
}

function adminState() {
  return {
    settings: getSettings(),
    defaults: DEFAULT_SETTINGS,
    rules: SETTING_RULES,
    devices: DEVICES.map(adminDeviceView),
    activeCount: activeDevices().length,
    maxPlayers: { easy: maxPlayersFor('easy'), medium: maxPlayersFor('medium'), hard: maxPlayersFor('hard') },
    typeLevels: TYPE_LEVELS,
    results: gameLog,
    usingDefaultPassword: !process.env.ADMIN_PASSWORD,
  };
}

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip;
  const rec = loginAttempts.get(ip) || { count: 0, until: 0 };
  if (rec.until > Date.now()) return res.status(429).json({ ok: false, error: '嘗試太多次，請 10 分鐘後再試' });
  if (!safeEqual((req.body && req.body.password) || '', CONFIG.ADMIN_PASSWORD)) {
    rec.count++;
    if (rec.count >= 8) { rec.count = 0; rec.until = Date.now() + 10 * 60 * 1000; }
    loginAttempts.set(ip, rec);
    return res.status(401).json({ ok: false, error: '密碼錯誤' });
  }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.set(token, Date.now() + TOKEN_TTL_MS);
  res.json({ ok: true, token });
});

app.get('/api/admin/state', requireAdmin, (_req, res) => res.json({ ok: true, ...adminState() }));

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const input = req.body || {};
  const next = getSettings();
  for (const [key, label, min, max, group] of SETTING_RULES) {
    if (input[key] === undefined) continue;
    const v = Number(input[key]);
    if (!Number.isFinite(v) || v < min || v > max) {
      return res.status(400).json({ ok: false, error: `${group}「${label}」要介於 ${min} 到 ${max}` });
    }
    next[key] = key === 'MIN_PLAYERS' ? Math.round(v) : Math.round(v * 10) / 10;
  }
  if (next.MIN_PLAYERS > maxPlayers()) {
    return res.status(400).json({ ok: false, error: `目前啟用的機關只夠 ${maxPlayers()} 人，最低人數不能超過這個數字` });
  }
  applySettings(next);
  res.json({ ok: true, ...adminState() });
});

app.post('/api/admin/settings/reset', requireAdmin, (_req, res) => {
  applySettings(DEFAULT_SETTINGS);
  res.json({ ok: true, ...adminState() });
});

app.put('/api/admin/devices', requireAdmin, (req, res) => {
  const { list, errors } = sanitizeDevices(req.body && req.body.devices);
  if (errors.length) return res.status(400).json({ ok: false, error: errors.slice(0, 5).join('\n') });
  const needed = CONFIG.MIN_PLAYERS * CONFIG.DEVICES_PER_PLAYER;
  for (const lv of LEVEL_KEYS) {
    const n = list.filter((d) => d.enabled && TYPE_LEVELS[d.type].includes(lv)).length;
    if (n < needed) {
      return res.status(400).json({ ok: false, error: `${LEVELS[lv].label}至少要有 ${needed} 個啟用的機關（${CONFIG.MIN_PLAYERS} 人 × 每人 4 個），目前只有 ${n} 個` });
    }
  }
  DEVICES = list;
  res.json({ ok: true, ...adminState() });
});

app.post('/api/admin/devices/reset', requireAdmin, (_req, res) => {
  DEVICES = loadDefaultDevices();
  res.json({ ok: true, ...adminState() });
});

app.delete('/api/admin/results', requireAdmin, (_req, res) => {
  gameLog.length = 0;
  res.json({ ok: true, ...adminState() });
});

// ============================================================
// 房間與玩家
// ============================================================
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

/** @type {Map<string, any>} 船號 → 房間 */
const rooms = new Map();
/** 成績紀錄（只存在記憶體，伺服器休眠後清空） */
const gameLog = [];
if (process.env.EXPOSE_ROOMS_FOR_TEST) global.__rooms = rooms;

function newPlayer(id, name) {
  return { id, name, devices: [], instruction: null, lastDeviceId: null, requested: 0, helped: 0, mistakes: 0, timeouts: 0, fastestMs: 0, lastPenaltyAt: 0 };
}

function createRoom(hostId) {
  const room = {
    code: generateCode(),
    hostId,
    state: 'lobby', // lobby | playing | ended
    difficulty: 'medium',
    players: new Map(),
    stability: CONFIG.AIR_FULL,
    startedAt: 0,
    endsAt: 0,
    deviceOwner: new Map(), // deviceId → playerId
    deviceState: new Map(), // deviceId → 目前狀態
    devMap: new Map(),      // 本局題庫快照
    stats: { completed: 0, failed: 0, wrong: 0 },
    timeouts: new Set(),
    tickInterval: null,
    lastAccidentAt: 0,
    result: null,
  };
  rooms.set(room.code, room);
  return room;
}

// ---- 計時器管理（遊戲結束時一次清乾淨） ----
function later(room, fn, ms) {
  const t = setTimeout(() => {
    room.timeouts.delete(t);
    fn();
  }, ms);
  room.timeouts.add(t);
  return t;
}
function cancel(room, t) {
  if (!t) return;
  clearTimeout(t);
  room.timeouts.delete(t);
}
function clearAllTimers(room) {
  for (const t of room.timeouts) clearTimeout(t);
  room.timeouts.clear();
  if (room.tickInterval) clearInterval(room.tickInterval);
  room.tickInterval = null;
  for (const p of room.players.values()) p.instruction = null;
}

// ---- 廣播 ----
function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    difficulty: room.difficulty,
    levels: Object.fromEntries(LEVEL_KEYS.map((k) => [k, { label: LEVELS[k].label, maxPlayers: maxPlayersFor(k) }])),
    minPlayers: CONFIG.MIN_PLAYERS,
    maxPlayers: maxPlayersFor(room.difficulty),
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, isHost: p.id === room.hostId })),
  };
}
function emitRoom(room) {
  io.to(room.code).emit('room:update', publicRoom(room));
}
function deviceView(room, id) {
  const d = room.devMap.get(id);
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    mode: controlMode(room.difficulty, d),
    value: room.deviceState.get(id),
    ...(d.options ? { options: d.options } : {}),
  };
}
function setDeviceState(room, deviceId, value, notifyOwner) {
  room.deviceState.set(deviceId, value);
  if (notifyOwner) {
    const owner = room.deviceOwner.get(deviceId);
    if (owner) io.to(owner).emit('device:state', { deviceId, value });
  }
}

// ============================================================
// 遊戲流程
// ============================================================
function startGame(room) {
  clearAllTimers(room);
  const level = room.difficulty;
  const L = levelOf(room);
  const players = [...room.players.values()];
  const pool = mixTypes(poolFor(level));
  room.devMap = new Map(pool.map((d) => [d.id, d])); // 本局題庫快照：後台中途修改不影響進行中的遊戲

  room.deviceOwner.clear();
  room.deviceState.clear();
  room.stability = CONFIG.AIR_FULL;
  room.stats = { completed: 0, failed: 0, wrong: 0 };
  room.result = null;
  room.state = 'playing';
  room.startedAt = Date.now() + CONFIG.COUNTDOWN_MS; // 倒數結束才算正式下潛
  room.endsAt = room.startedAt + CONFIG.GAME_DURATION_MS;
  room.chaos = false;
  room.lastAccidentAt = 0;
  room.gameDurationMs = CONFIG.GAME_DURATION_MS;

  // 狀態分發：每人 4 個完全不同的機關
  players.forEach((p, i) => {
    const start = i * CONFIG.DEVICES_PER_PLAYER;
    Object.assign(p, newPlayer(p.id, p.name), { devices: pool.slice(start, start + CONFIG.DEVICES_PER_PLAYER).map((d) => d.id) });
    for (const id of p.devices) {
      room.deviceOwner.set(id, p.id);
      room.deviceState.set(id, initialValue(level, room.devMap.get(id)));
    }
  });

  emitRoom(room);
  for (const p of players) {
    io.to(p.id).emit('game:started', {
      difficulty: level,
      levelLabel: L.label,
      devices: p.devices.map((id) => deviceView(room, id)),
      stability: room.stability,
      durationMs: room.gameDurationMs,
      remainingMs: room.gameDurationMs,
      countdownMs: CONFIG.COUNTDOWN_MS,
      sliderMax: SLIDER_MAX,
      stepMax: STEP_MAX,
    });
  }

  // 倒數計時（每秒同步一次）
  room.tickInterval = setInterval(() => tick(room), 1000);

  // 錯開配發第一條指令
  players.forEach((p, i) => later(room, () => issueInstruction(room, p.id), CONFIG.COUNTDOWN_MS + 300 + i * CONFIG.START_STAGGER_MS));
}

/** 洗牌後把不同類型交錯排列，這樣每人分到的 4 個機關盡量是不同種類 */
function mixTypes(devices) {
  const buckets = shuffle(Object.values(devices.reduce((acc, d) => ((acc[d.type] = acc[d.type] || []).push(d), acc), {})).map((b) => shuffle(b.slice())));
  const out = [];
  while (buckets.some((b) => b.length)) {
    for (const b of buckets) if (b.length) out.push(b.pop());
  }
  return out;
}

function tick(room) {
  const L = levelOf(room);
  const remainingMs = Math.max(0, Math.min(room.gameDurationMs, room.endsAt - Date.now()));
  io.to(room.code).emit('game:timer', { remainingMs });
  const chaosAt = Math.min(L.CHAOS_MS, room.gameDurationMs * 0.5);
  if (!room.chaos && chaosAt > 0 && remainingMs > 0 && remainingMs <= chaosAt) {
    room.chaos = true;
    io.to(room.code).emit('game:chaos', { remainingMs, accidents: L.ACCIDENTS });
  }
  if (room.chaos && L.ACCIDENTS && remainingMs > 3000 && Date.now() - room.lastAccidentAt >= CONFIG.ACCIDENT_EVERY_MS) {
    room.lastAccidentAt = Date.now();
    triggerAccident(room);
  }
  if (remainingMs <= 0) endGame(room, 'timeup');
}

/** 高難度的潛水事故：隨機挑一位玩家 */
const ACCIDENTS = [
  { kind: 'fog', ms: 3500, text: '🌫️ 面鏡起霧！什麼都看不清楚', short: '🌫️ 面鏡起霧' },
  { kind: 'current', ms: 1200, text: '🌊 洋流把你的裝備沖亂了！', short: '🌊 被洋流沖到' },
  { kind: 'narcosis', ms: 5000, text: '🍸 氮醉了！字都顛倒了', short: '🍸 氮醉' },
];
function triggerAccident(room) {
  const players = [...room.players.values()];
  if (!players.length) return;
  const victim = players[Math.floor(Math.random() * players.length)];
  const acc = ACCIDENTS[Math.floor(Math.random() * ACCIDENTS.length)];
  io.to(victim.id).emit('accident', acc);
  for (const p of players) {
    if (p.id !== victim.id) io.to(p.id).emit('toast', { text: `${acc.short}：${victim.name} 出事了！` });
  }
}

/** 依遊戲進度計算這條指令有幾毫秒：從開局秒數線性縮短到結尾秒數 */
function instructionDuration(room) {
  const L = levelOf(room);
  const progress = Math.max(0, Math.min(1, (Date.now() - room.startedAt) / room.gameDurationMs));
  const ms = L.INSTRUCTION_MS - (L.INSTRUCTION_MS - L.INSTRUCTION_MIN_MS) * progress;
  return Math.round(ms / 500) * 500;
}

/** 指令生成：目標機關必須在「其他玩家」畫面上，且同一時間不會有兩條指令指向同一個機關 */
function issueInstruction(room, playerId) {
  if (room.state !== 'playing') return;
  const player = room.players.get(playerId);
  if (!player) return;
  if (player.instruction) cancel(room, player.instruction.timer);
  player.instruction = null;

  const targeted = new Set();
  for (const p of room.players.values()) if (p.instruction) targeted.add(p.instruction.deviceId);

  let candidates = [];
  for (const [deviceId, ownerId] of room.deviceOwner) {
    if (ownerId !== player.id && !targeted.has(deviceId)) candidates.push(deviceId);
  }
  if (candidates.length > 1) candidates = candidates.filter((id) => id !== player.lastDeviceId);

  if (candidates.length === 0) {
    io.to(player.id).emit('instruction:new', { none: true, text: '暫時沒有指令……豎起耳朵幫潛伴！' });
    later(room, () => issueInstruction(room, player.id), 2000);
    return;
  }

  const deviceId = candidates[Math.floor(Math.random() * candidates.length)];
  const dev = room.devMap.get(deviceId);

  // 低難度的固定目標：若機關不在待命狀態（例如剛被亂撥），先強制歸位
  if (room.difficulty === 'easy') {
    const ready = readyValue(dev);
    if (ready !== null && room.deviceState.get(deviceId) !== ready) setDeviceState(room, deviceId, ready, true);
  }

  const { target, text } = buildInstruction(room.difficulty, dev, room.deviceState.get(deviceId));
  const durationMs = instructionDuration(room);
  const instruction = { deviceId, target, text, issuedAt: Date.now(), expiresAt: Date.now() + durationMs, timer: null };
  instruction.timer = later(room, () => onInstructionTimeout(room, player.id, instruction), durationMs);
  player.instruction = instruction;
  player.lastDeviceId = deviceId;

  io.to(player.id).emit('instruction:new', { text, deviceName: dev.name, durationMs });
}

function onInstructionTimeout(room, playerId, instruction) {
  const player = room.players.get(playerId);
  if (room.state !== 'playing' || !player || player.instruction !== instruction) return;
  player.instruction = null;
  player.timeouts++;
  room.stats.failed++;
  io.to(player.id).emit('instruction:failed', { text: instruction.text });
  changeStability(room, -levelOf(room).TIMEOUT_PENALTY, 'timeout', player.name);
  if (room.state === 'playing') later(room, () => issueInstruction(room, player.id), CONFIG.NEXT_INSTRUCTION_DELAY_MS);
}

/** 目標比對：要求「保持」就必須是 hold；一般轉向則按住保持也算 */
function targetMatches(target, value) {
  if (typeof target === 'string' && target.startsWith('hold:')) return value === target;
  if (typeof value === 'string' && value.startsWith('hold:')) return value.slice(5) === target;
  return value === target;
}

/** 指令驗證 */
function handleOperate(room, operator, deviceId, rawValue) {
  const dev = room.devMap.get(deviceId);
  if (!dev || room.deviceOwner.get(deviceId) !== operator.id) return; // 只能操作自己畫面上的機關

  const value = normalizeValue(room.difficulty, dev, rawValue);
  if (value === null) return;
  if (dev.type !== 'button') room.deviceState.set(deviceId, typeof value === 'string' && value.startsWith('hold:') ? value.slice(5) : value);

  // 找出正在要求這個機關的玩家
  let requester = null;
  for (const p of room.players.values()) {
    if (p.instruction && p.instruction.deviceId === deviceId) {
      requester = p;
      break;
    }
  }

  if (requester && targetMatches(requester.instruction.target, value)) {
    // ✅ 正確
    const reactMs = Date.now() - requester.instruction.issuedAt;
    cancel(room, requester.instruction.timer);
    requester.instruction = null;
    requester.requested++;
    operator.helped++;
    if (!operator.fastestMs || reactMs < operator.fastestMs) operator.fastestMs = reactMs;
    room.stats.completed++;
    io.to(requester.id).emit('instruction:success', { byName: operator.name, deviceName: dev.name });
    io.to(operator.id).emit('operate:result', { deviceId, ok: true, forName: requester.name });
    changeStability(room, levelOf(room).SUCCESS_BONUS, 'success', operator.name);

    if (room.difficulty === 'easy') {
      const ready = readyValue(dev);
      if (ready !== null) {
        later(room, () => {
          if (room.state !== 'playing' || !room.deviceOwner.has(deviceId)) return;
          const busy = [...room.players.values()].some((p) => p.instruction && p.instruction.deviceId === deviceId);
          if (!busy) setDeviceState(room, deviceId, ready, true);
        }, CONFIG.RESET_DELAY_MS);
      }
    }
    later(room, () => issueInstruction(room, requester.id), CONFIG.NEXT_INSTRUCTION_DELAY_MS);
    return;
  }

  if (requester) {
    // 有人要求這個機關，但狀態還沒到位（或按法不對）→ 不扣氣，讓玩家繼續調整
    io.to(operator.id).emit('operate:result', { deviceId, ok: null });
    return;
  }

  // ❌ 沒人要求這個機關 → 扣全隊氣瓶壓力
  io.to(operator.id).emit('operate:result', { deviceId, ok: false });
  const now = Date.now();
  if (now - operator.lastPenaltyAt < CONFIG.WRONG_COOLDOWN_MS) return; // 冷卻中：只有畫面抖動，不重複扣氣
  operator.lastPenaltyAt = now;
  operator.mistakes++;
  room.stats.wrong++;
  changeStability(room, -levelOf(room).WRONG_PENALTY, 'wrong', operator.name);
}

function changeStability(room, delta, reason, byName) {
  if (room.state !== 'playing') return;
  const before = room.stability;
  room.stability = Math.max(CONFIG.AIR_EMPTY, Math.min(CONFIG.AIR_FULL, room.stability + delta));
  io.to(room.code).emit('stability:update', { stability: room.stability, delta: room.stability - before, reason, byName });
  if (room.stability <= CONFIG.AIR_EMPTY) endGame(room, 'collapse');
}

// ============================================================
// 結算稱號：每位玩家都拿一個（越滑稽越好；部分稱號隨難度升級）
// ============================================================
const byLevel = (easy, medium, hard) => (level) => ({ easy, medium, hard }[level] || medium);
const AWARDS = [
  { ok: (p) => p.helped > 0, score: (p) => p.helped, title: byLevel('🐠 熱心過頭的觀光潛水員', '🐬 人肉水下推進器', '🦈 技術潛水界的鯨鯊'), why: (p) => `幫潛伴完成 ${p.helped} 條指令，比 DPV 還好用` },
  { ok: (p) => p.mistakes > 0, score: (p) => p.mistakes, title: byLevel('🎈 浮力失控的小氣球', '🐡 一碰就爆的河豚', '💣 氮醉亂按的人形炸彈'), why: (p) => `亂按 ${p.mistakes} 次，整片海都被你搞瘋了` },
  { ok: (p) => p.fastestMs > 0, score: (p) => -p.fastestMs, title: byLevel('🐟 動作還算快的小丑魚', '⚡ 閃電鬼蝠魟', '🚀 人體水下推進器 Pro Max'), why: (p) => `最快 ${(p.fastestMs / 1000).toFixed(1)} 秒就搞定，手速快到起水泡` },
  { ok: (p) => p.timeouts > 0, score: (p) => p.timeouts, title: byLevel('📣 水下大聲公', '📣 喊破喉嚨的水下大聲公', '📡 聲納壞掉的潛艇'), why: (p) => `${p.timeouts} 條指令沒人理，建議改用水下寫字板` },
  { ok: (p) => p.helped === 0 && p.mistakes === 0, score: () => 0, title: byLevel('🪨 海底裝死的石頭魚', '🪨 海底裝死的石頭魚', '🪨 千年不動的海底化石'), why: () => '全場一動也不動，偽裝技術滿分' },
  { ok: (p) => p.mistakes === 0, score: (p) => p.helped, title: byLevel('🧘 中性浮力新手', '🧘 中性浮力之神', '🧘 技術潛水宗師'), why: () => '零失誤，穩到可以在水裡打坐' },
  { ok: (p) => p.requested > 0, score: (p) => p.requested, title: byLevel('👑 被服侍的海洋公主', '👑 被潛伴服侍的海洋女王', '👑 深海霸主（只會出一張嘴）'), why: (p) => `${p.requested} 條指令都有人搶著幫你做，命真好` },
];
const FALLBACK_TITLES = [
  ['🐢 被海龜超車的潛水員', '游得比海龜還慢，海龜回頭看了你一眼'],
  ['🫧 只會吐泡泡的觀光客', '全程貢獻最多的是氣泡'],
  ['🦀 橫著走的迷路螃蟹', '指北針在你手上也沒用'],
  ['🧜 自以為是美人魚的大叔', '動作很優雅，但沒有任何幫助'],
  ['🎈 浮力控制像氣球', '一下沉底一下衝上水面'],
  ['🤿 面鏡起霧什麼都看不到', '建議下次先吐口水'],
  ['🌊 暈船吐到餵魚的英雄', '魚群因為你吃得很飽'],
  ['🐙 手太多的章魚哥', '八隻手卻按不到對的機關'],
  ['🐟 尼莫失散多年的表哥', '一直在找爸爸，沒空幫忙'],
  ['🥒 受驚就噴內臟的海參', '一緊張就全部亂掉'],
  ['📸 只顧拍照的相機狂魔', '水下照片很多張，指令沒做幾條'],
  ['🦈 假裝很兇的豆丁鯊', '氣勢很足，實力很迷你'],
];

function assignTitles(players, level) {
  const left = new Set(shuffle(players.slice())); // 同分時隨機
  for (const award of AWARDS) {
    if (!left.size) break;
    const cands = [...left].filter(award.ok);
    if (!cands.length) continue;
    const best = cands.reduce((a, b) => (award.score(b) > award.score(a) ? b : a));
    best.title = award.title(level);
    best.titleWhy = award.why(best);
    left.delete(best);
  }
  const fallback = shuffle(FALLBACK_TITLES.slice());
  [...left].forEach((p, i) => {
    const [title, why] = fallback[i % fallback.length];
    p.title = title;
    p.titleWhy = why;
  });
}

function endGame(room, reason) {
  if (room.state !== 'playing') return;
  room.state = 'ended';
  clearAllTimers(room);

  const survivedMs = Math.max(0, Math.min(room.gameDurationMs, Date.now() - room.startedAt));
  const s = room.stats;
  let rank;
  if (reason === 'collapse') rank = '🆘 被教練拎上船的菜鳥團';
  else if (room.stability >= 84 && s.completed >= room.players.size * 6) rank = '🏆 傳說級潛水長小隊';
  else if (room.stability >= 60) rank = '🐠 進階開放水域潛水員';
  else if (room.stability >= 40) rank = '🤿 體驗潛水觀光團';
  else rank = '🫧 差點吸到空氣的冒險團';

  const players = [...room.players.values()]
    .map((p) => ({ id: p.id, name: p.name, helped: p.helped, requested: p.requested, mistakes: p.mistakes, timeouts: p.timeouts, fastestMs: p.fastestMs }))
    .sort((a, b) => b.helped - a.helped || a.mistakes - b.mistakes);
  assignTitles(players, room.difficulty);

  room.result = {
    reason, // timeup | collapse | notEnough
    rank,
    difficulty: room.difficulty,
    levelLabel: levelOf(room).label,
    stability: room.stability,
    survivedMs,
    completed: s.completed,
    failed: s.failed,
    wrong: s.wrong,
    players,
  };
  io.to(room.code).emit('game:over', room.result);
  gameLog.unshift({
    time: new Date().toISOString(),
    code: room.code,
    difficulty: room.difficulty,
    playerCount: room.players.size,
    names: players.map((p) => p.name),
    reason,
    rank,
    completed: s.completed,
    failed: s.failed,
    wrong: s.wrong,
    stability: room.stability,
    survivedSeconds: Math.round(survivedMs / 1000),
  });
  if (gameLog.length > CONFIG.RESULTS_MAX) gameLog.length = CONFIG.RESULTS_MAX;
  emitRoom(room);
}

function backToLobby(room) {
  clearAllTimers(room);
  room.state = 'lobby';
  room.deviceOwner.clear();
  room.deviceState.clear();
  room.stability = CONFIG.AIR_FULL;
  for (const p of room.players.values()) p.devices = [];
  emitRoom(room);
}

/** 玩家離開／斷線 */
function removePlayer(socket) {
  const code = socket.data.roomCode;
  const room = code && rooms.get(code);
  socket.data.roomCode = null;
  if (!room) return;
  socket.leave(code);

  const leaver = room.players.get(socket.id);
  if (!leaver) return;
  if (leaver.instruction) cancel(room, leaver.instruction.timer);
  room.players.delete(socket.id);

  if (room.players.size === 0) {
    clearAllTimers(room);
    rooms.delete(code);
    return;
  }
  if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;

  if (room.state === 'playing') {
    // 收回他的機關；指向這些機關的指令改發新的
    for (const id of leaver.devices) {
      room.deviceOwner.delete(id);
      room.deviceState.delete(id);
    }
    for (const p of room.players.values()) {
      if (p.instruction && leaver.devices.includes(p.instruction.deviceId)) {
        cancel(room, p.instruction.timer);
        p.instruction = null;
        io.to(p.id).emit('instruction:cancelled', { leaverName: leaver.name });
        later(room, () => issueInstruction(room, p.id), CONFIG.NEXT_INSTRUCTION_DELAY_MS);
      }
    }
    io.to(code).emit('toast', { text: `${leaver.name} 游走了` });
    if (room.players.size < 2) endGame(room, 'notEnough');
  }
  emitRoom(room);
}

// ============================================================
// Socket.io 事件
// ============================================================
io.on('connection', (socket) => {
  const reply = (ack, data) => typeof ack === 'function' && ack(data);
  const myRoom = () => rooms.get(socket.data.roomCode);

  // 1. 房間系統 -------------------------------------------------
  socket.on('room:create', (payload, ack) => {
    removePlayer(socket);
    const room = createRoom(socket.id);
    room.players.set(socket.id, newPlayer(socket.id, cleanName(payload && payload.name)));
    socket.join(room.code);
    socket.data.roomCode = room.code;
    reply(ack, { ok: true, code: room.code, me: socket.id });
    emitRoom(room);
  });

  socket.on('room:join', (payload, ack) => {
    const code = String((payload && payload.code) || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return reply(ack, { ok: false, error: '找不到這艘船，請確認船號' });
    if (room.state !== 'lobby') return reply(ack, { ok: false, error: '這團已經下水了，請等下一潛' });
    if (room.players.size >= CONFIG.MAX_PLAYERS) return reply(ack, { ok: false, error: `船已經坐滿了（最多 ${CONFIG.MAX_PLAYERS} 人）` });

    removePlayer(socket);
    let name = cleanName(payload && payload.name);
    const names = new Set([...room.players.values()].map((p) => p.name));
    if (names.has(name)) {
      let n = 2;
      while (names.has(`${name}${n}`)) n++;
      name = `${name}${n}`;
    }
    room.players.set(socket.id, newPlayer(socket.id, name));
    socket.join(code);
    socket.data.roomCode = code;
    reply(ack, { ok: true, code, me: socket.id });
    emitRoom(room);
  });

  socket.on('room:leave', () => removePlayer(socket));

  // 船長選難度
  socket.on('room:difficulty', (payload, ack) => {
    const room = myRoom();
    const level = payload && payload.level;
    if (!room || room.hostId !== socket.id || room.state !== 'lobby') return reply(ack, { ok: false, error: '只有船長可以選難度' });
    if (!LEVELS[level]) return reply(ack, { ok: false, error: '沒有這個難度' });
    room.difficulty = level;
    reply(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('game:start', (_payload, ack) => {
    const room = myRoom();
    if (!room) return reply(ack, { ok: false, error: '你不在任何一艘船上' });
    if (room.hostId !== socket.id) return reply(ack, { ok: false, error: '只有船長可以宣布下潛' });
    if (room.state !== 'lobby') return reply(ack, { ok: false, error: '已經下水了' });
    if (room.players.size < CONFIG.MIN_PLAYERS) {
      return reply(ack, { ok: false, error: `至少需要 ${CONFIG.MIN_PLAYERS} 位潛伴才能下水` });
    }
    if (room.players.size > maxPlayersFor(room.difficulty)) {
      return reply(ack, { ok: false, error: `${LEVELS[room.difficulty].label}的機關只夠 ${maxPlayersFor(room.difficulty)} 人玩，請換難度或請主持人到後台多啟用幾個` });
    }
    reply(ack, { ok: true });
    startGame(room);
  });

  // 4. 指令驗證 -------------------------------------------------
  socket.on('device:operate', (payload) => {
    const room = myRoom();
    if (!room || room.state !== 'playing' || !payload) return;
    const operator = room.players.get(socket.id);
    if (!operator || Date.now() < room.startedAt) return; // 倒數中不算
    handleOperate(room, operator, String(payload.deviceId), payload.value);
  });

  // 結算後回大廳（船長）
  socket.on('game:lobby', () => {
    const room = myRoom();
    if (room && room.hostId === socket.id && room.state === 'ended') backToLobby(room);
  });

  socket.on('disconnect', () => removePlayer(socket));
});

server.listen(CONFIG.PORT, () => {
  console.log(`🤿 深海大亂潛已開放下水：http://localhost:${CONFIG.PORT}`);
});
