/**
 * 失控魔法工廠 — 後端伺服器
 * Node.js + Express + Socket.io
 *
 * 啟動：npm install → npm start → 瀏覽器開 http://localhost:3000
 * 測試用環境變數：MIN_PLAYERS=2（降低開局人數）、GAME_SECONDS=60（縮短一局時間）
 */
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

// ============================================================
// 遊戲參數（想調難度改這裡）
// ============================================================
const CONFIG = {
  PORT: Number(process.env.PORT) || 3000,
  MIN_PLAYERS: Number(process.env.MIN_PLAYERS) || 5,
  MAX_PLAYERS: 10,
  DEVICES_PER_PLAYER: 4,
  GAME_DURATION_MS: (Number(process.env.GAME_SECONDS) || 180) * 1000, // 一局 3 分鐘
  INSTRUCTION_MS: 15000,          // 每條指令 15 秒
  START_STABILITY: 100,           // 工廠穩定度起始值
  WRONG_PENALTY: 5,               // 亂按（沒人要求的機關）扣分
  WRONG_COOLDOWN_MS: 1000,        // 同一人連續亂按，1 秒內只扣一次（避免狂按秒殺工廠）
  TIMEOUT_PENALTY: 8,             // 指令逾時扣分
  SUCCESS_BONUS: 2,               // 完成指令回復
  RESET_DELAY_MS: 700,            // 完成後機關自動歸位的延遲
  NEXT_INSTRUCTION_DELAY_MS: 1200,// 完成/失敗後多久配發下一條指令
  START_STAGGER_MS: 500,          // 開局時每位玩家指令錯開時間
  NAME_MAX: 12,
};

const SLIDER_MAX = 4; // 滑桿 0~4 共五格：0=底、2=中、4=頂
const TYPES = new Set(['button', 'switch', 'slider']);

// ============================================================
// 題庫載入
// ============================================================
function resolveTarget(d) {
  const t = d.target;
  const a = String(d.action || '');
  if (d.type === 'button') return 'press';
  if (d.type === 'switch') {
    if (t === 'on' || t === 'off') return t;
    if (/關|停/.test(a)) return 'off';
    if (/開|啟/.test(a)) return 'on';
    return null;
  }
  // slider
  const named = { max: SLIDER_MAX, mid: SLIDER_MAX / 2, min: 0 };
  if (typeof t === 'string' && Object.prototype.hasOwnProperty.call(named, t)) return named[t];
  if (Number.isInteger(t) && t >= 0 && t <= SLIDER_MAX) return t;
  // 沒寫 target 時，從 action 文字推斷
  if (/頂|最大|最高|滿/.test(a)) return SLIDER_MAX;
  if (/底|最小|最低|歸零/.test(a)) return 0;
  if (/中/.test(a)) return SLIDER_MAX / 2;
  return null;
}

function loadDevices() {
  const file = path.join(__dirname, 'data', 'devices.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('data/devices.json 必須是 JSON 陣列');
  const seen = new Set();
  const list = [];
  for (const d of raw) {
    if (!d || !d.id || !d.name || !TYPES.has(d.type)) {
      console.warn('[題庫] 格式錯誤，略過：', d && d.id);
      continue;
    }
    if (seen.has(d.id)) {
      console.warn('[題庫] id 重複，略過：', d.id);
      continue;
    }
    const target = resolveTarget(d);
    if (target === null) {
      console.warn('[題庫] 看不懂操作狀態，略過：', d.id);
      continue;
    }
    seen.add(d.id);
    list.push({
      id: String(d.id),
      name: String(d.name),
      type: d.type,
      action: String(d.action || ''),
      instruction: String(d.instruction || `${d.action}${d.name}！`),
      target,
    });
  }
  return list;
}

const DEVICES = loadDevices();
const DEVICE_MAP = new Map(DEVICES.map((d) => [d.id, d]));
const MAX_PLAYERS = Math.min(CONFIG.MAX_PLAYERS, Math.floor(DEVICES.length / CONFIG.DEVICES_PER_PLAYER));
if (MAX_PLAYERS < CONFIG.MIN_PLAYERS) {
  throw new Error(`題庫只有 ${DEVICES.length} 個機關，不夠 ${CONFIG.MIN_PLAYERS} 人遊玩`);
}
console.log(`[題庫] 載入 ${DEVICES.length} 個魔法機關，最多 ${MAX_PLAYERS} 人一房`);

/** 機關「待命」狀態：與目標相反，保證玩家操作一次就能達成 */
function readyValue(dev) {
  if (dev.type === 'switch') return dev.target === 'on' ? 'off' : 'on';
  if (dev.type === 'slider') return dev.target === 0 ? SLIDER_MAX : 0;
  return null; // button 無狀態
}

function normalizeValue(dev, value) {
  if (dev.type === 'button') return 'press';
  if (dev.type === 'switch') return value === 'on' || value === true ? 'on' : 'off';
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(SLIDER_MAX, n));
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
  return s || '魔法學徒';
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 I O 0 1
function generateCode() {
  for (let i = 0; i < 1000; i++) {
    let c = '';
    for (let k = 0; k < 4; k++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('無法產生房間碼');
}

// ============================================================
// 伺服器
// ============================================================
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

/** @type {Map<string, any>} 房間碼 → 房間 */
const rooms = new Map();

function newPlayer(id, name) {
  return { id, name, devices: [], instruction: null, lastDeviceId: null, requested: 0, helped: 0, mistakes: 0, lastPenaltyAt: 0 };
}

function createRoom(hostId) {
  const room = {
    code: generateCode(),
    hostId,
    state: 'lobby', // lobby | playing | ended
    players: new Map(),
    stability: CONFIG.START_STABILITY,
    startedAt: 0,
    endsAt: 0,
    deviceOwner: new Map(), // deviceId → playerId
    deviceState: new Map(), // deviceId → 目前狀態
    stats: { completed: 0, failed: 0, wrong: 0 },
    timeouts: new Set(),
    tickInterval: null,
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
  for (const p of room.players.values()) {
    if (p.instruction) p.instruction.timer = null;
    p.instruction = null;
  }
}

// ---- 廣播 ----
function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    minPlayers: CONFIG.MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, isHost: p.id === room.hostId })),
  };
}
function emitRoom(room) {
  io.to(room.code).emit('room:update', publicRoom(room));
}
function deviceView(room, id) {
  const d = DEVICE_MAP.get(id);
  return { id: d.id, name: d.name, type: d.type, action: d.action, value: room.deviceState.get(id) };
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
  const players = [...room.players.values()];
  const pool = shuffle(DEVICES.slice());

  room.deviceOwner.clear();
  room.deviceState.clear();
  room.stability = CONFIG.START_STABILITY;
  room.stats = { completed: 0, failed: 0, wrong: 0 };
  room.result = null;
  room.state = 'playing';
  room.startedAt = Date.now();
  room.endsAt = room.startedAt + CONFIG.GAME_DURATION_MS;

  // 狀態分發：每人 4 個完全不同的機關
  players.forEach((p, i) => {
    const start = i * CONFIG.DEVICES_PER_PLAYER;
    p.devices = pool.slice(start, start + CONFIG.DEVICES_PER_PLAYER).map((d) => d.id);
    p.instruction = null;
    p.lastDeviceId = null;
    p.requested = 0;
    p.helped = 0;
    p.mistakes = 0;
    p.lastPenaltyAt = 0;
    for (const id of p.devices) {
      room.deviceOwner.set(id, p.id);
      room.deviceState.set(id, readyValue(DEVICE_MAP.get(id)));
    }
  });

  emitRoom(room);
  for (const p of players) {
    io.to(p.id).emit('game:started', {
      devices: p.devices.map((id) => deviceView(room, id)),
      stability: room.stability,
      durationMs: CONFIG.GAME_DURATION_MS,
      remainingMs: CONFIG.GAME_DURATION_MS,
      instructionMs: CONFIG.INSTRUCTION_MS,
      sliderMax: SLIDER_MAX,
    });
  }

  // 倒數計時（每秒同步一次）
  room.tickInterval = setInterval(() => {
    const remainingMs = Math.max(0, room.endsAt - Date.now());
    io.to(room.code).emit('game:timer', { remainingMs });
    if (remainingMs <= 0) endGame(room, 'timeup');
  }, 1000);

  // 錯開配發第一條指令
  players.forEach((p, i) => later(room, () => issueInstruction(room, p.id), 800 + i * CONFIG.START_STAGGER_MS));
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
    io.to(player.id).emit('instruction:new', { none: true, text: '暫時沒有指令……豎起耳朵幫隊友！' });
    later(room, () => issueInstruction(room, player.id), 2000);
    return;
  }

  const deviceId = candidates[Math.floor(Math.random() * candidates.length)];
  const dev = DEVICE_MAP.get(deviceId);

  // 若機關目前不在待命狀態（例如剛被亂撥），先強制歸位
  const ready = readyValue(dev);
  if (ready !== null && room.deviceState.get(deviceId) !== ready) setDeviceState(room, deviceId, ready, true);

  const instruction = {
    deviceId,
    target: dev.target,
    text: dev.instruction,
    issuedAt: Date.now(),
    expiresAt: Date.now() + CONFIG.INSTRUCTION_MS,
    timer: null,
  };
  instruction.timer = later(room, () => onInstructionTimeout(room, player.id, instruction), CONFIG.INSTRUCTION_MS);
  player.instruction = instruction;
  player.lastDeviceId = deviceId;

  io.to(player.id).emit('instruction:new', {
    text: dev.instruction,
    deviceName: dev.name,
    durationMs: CONFIG.INSTRUCTION_MS,
  });
}

function onInstructionTimeout(room, playerId, instruction) {
  const player = room.players.get(playerId);
  if (room.state !== 'playing' || !player || player.instruction !== instruction) return;
  player.instruction = null;
  room.stats.failed++;
  io.to(player.id).emit('instruction:failed', { text: instruction.text });
  changeStability(room, -CONFIG.TIMEOUT_PENALTY, 'timeout', player.name);
  if (room.state === 'playing') later(room, () => issueInstruction(room, player.id), CONFIG.NEXT_INSTRUCTION_DELAY_MS);
}

/** 指令驗證 */
function handleOperate(room, operator, deviceId, rawValue) {
  const dev = DEVICE_MAP.get(deviceId);
  if (!dev || room.deviceOwner.get(deviceId) !== operator.id) return; // 只能操作自己畫面上的機關

  const value = normalizeValue(dev, rawValue);
  if (value === null) return;
  if (dev.type !== 'button') room.deviceState.set(deviceId, value);

  // 找出正在要求這個機關的玩家
  let requester = null;
  for (const p of room.players.values()) {
    if (p.instruction && p.instruction.deviceId === deviceId) {
      requester = p;
      break;
    }
  }

  if (requester && value === requester.instruction.target) {
    // ✅ 正確
    cancel(room, requester.instruction.timer);
    requester.instruction = null;
    requester.requested++;
    operator.helped++;
    room.stats.completed++;
    io.to(requester.id).emit('instruction:success', { byName: operator.name, deviceName: dev.name });
    io.to(operator.id).emit('operate:result', { deviceId, ok: true, forName: requester.name });
    changeStability(room, CONFIG.SUCCESS_BONUS, 'success', operator.name);

    const ready = readyValue(dev);
    if (ready !== null) {
      later(room, () => {
        if (room.state !== 'playing' || !room.deviceOwner.has(deviceId)) return;
        const busy = [...room.players.values()].some((p) => p.instruction && p.instruction.deviceId === deviceId);
        if (!busy) setDeviceState(room, deviceId, ready, true);
      }, CONFIG.RESET_DELAY_MS);
    }
    later(room, () => issueInstruction(room, requester.id), CONFIG.NEXT_INSTRUCTION_DELAY_MS);
    return;
  }

  if (requester) {
    // 有人要求這個機關，但狀態還沒到位（例如滑桿推到一半）→ 不扣分，讓玩家繼續調整
    io.to(operator.id).emit('operate:result', { deviceId, ok: null });
    return;
  }

  // ❌ 沒人要求這個機關 → 扣全隊工廠穩定度
  io.to(operator.id).emit('operate:result', { deviceId, ok: false });
  const now = Date.now();
  if (now - operator.lastPenaltyAt < CONFIG.WRONG_COOLDOWN_MS) return; // 冷卻中：只有畫面抖動，不重複扣分
  operator.lastPenaltyAt = now;
  operator.mistakes++;
  room.stats.wrong++;
  changeStability(room, -CONFIG.WRONG_PENALTY, 'wrong', operator.name);
}

function changeStability(room, delta, reason, byName) {
  if (room.state !== 'playing') return;
  const before = room.stability;
  room.stability = Math.max(0, Math.min(CONFIG.START_STABILITY, room.stability + delta));
  io.to(room.code).emit('stability:update', {
    stability: room.stability,
    delta: room.stability - before,
    reason,
    byName,
  });
  if (room.stability <= 0) endGame(room, 'collapse');
}

function endGame(room, reason) {
  if (room.state !== 'playing') return;
  room.state = 'ended';
  clearAllTimers(room);

  const survivedMs = Math.min(CONFIG.GAME_DURATION_MS, Date.now() - room.startedAt);
  const s = room.stats;
  let rank;
  if (reason === 'collapse') rank = '💥 廢墟清潔工';
  else if (room.stability >= 80 && s.completed >= room.players.size * 6) rank = '🏆 傳說級魔導廠長';
  else if (room.stability >= 50) rank = '🔮 資深鍊金技師';
  else if (room.stability >= 20) rank = '🧪 勉強及格學徒';
  else rank = '🔥 差點炸掉的實習生';

  room.result = {
    reason, // timeup | collapse | notEnough
    rank,
    stability: room.stability,
    survivedMs,
    completed: s.completed,
    failed: s.failed,
    wrong: s.wrong,
    players: [...room.players.values()]
      .map((p) => ({ id: p.id, name: p.name, helped: p.helped, requested: p.requested, mistakes: p.mistakes }))
      .sort((a, b) => b.helped - a.helped || a.mistakes - b.mistakes),
  };
  io.to(room.code).emit('game:over', room.result);
  emitRoom(room);
}

function backToLobby(room) {
  clearAllTimers(room);
  room.state = 'lobby';
  room.deviceOwner.clear();
  room.deviceState.clear();
  room.stability = CONFIG.START_STABILITY;
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
    io.to(code).emit('toast', { text: `${leaver.name} 離開了工廠` });
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
    if (!room) return reply(ack, { ok: false, error: '找不到這個房間，請確認邀請碼' });
    if (room.state !== 'lobby') return reply(ack, { ok: false, error: '這座工廠已經開工了，請等下一局' });
    if (room.players.size >= MAX_PLAYERS) return reply(ack, { ok: false, error: `房間已滿（最多 ${MAX_PLAYERS} 人）` });

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

  socket.on('game:start', (_payload, ack) => {
    const room = myRoom();
    if (!room) return reply(ack, { ok: false, error: '你不在任何房間' });
    if (room.hostId !== socket.id) return reply(ack, { ok: false, error: '只有房主可以開始遊戲' });
    if (room.state !== 'lobby') return reply(ack, { ok: false, error: '遊戲已經開始了' });
    if (room.players.size < CONFIG.MIN_PLAYERS) {
      return reply(ack, { ok: false, error: `至少需要 ${CONFIG.MIN_PLAYERS} 人才能開工` });
    }
    reply(ack, { ok: true });
    startGame(room);
  });

  // 4. 指令驗證 -------------------------------------------------
  socket.on('device:operate', (payload) => {
    const room = myRoom();
    if (!room || room.state !== 'playing' || !payload) return;
    const operator = room.players.get(socket.id);
    if (!operator) return;
    handleOperate(room, operator, String(payload.deviceId), payload.value);
  });

  // 結算後回大廳（房主）
  socket.on('game:lobby', () => {
    const room = myRoom();
    if (room && room.hostId === socket.id && room.state === 'ended') backToLobby(room);
  });

  socket.on('disconnect', () => removePlayer(socket));
});

server.listen(CONFIG.PORT, () => {
  console.log(`🏭 失控魔法工廠已開工：http://localhost:${CONFIG.PORT}`);
});
