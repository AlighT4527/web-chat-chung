// Web Chat Chung — máy chủ chat realtime cho văn phòng 2.5D.
// Chạy: npm install && node server.js  (PORT mặc định 3000)
// API REST: xem API.md. Biến môi trường tùy chọn: API_KEY (bảo vệ POST /api/messages),
// DATA_FILE (đường dẫn file lưu trữ), PORT.

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const MAX_MESSAGES = 200;

// ---------- Ảnh tài sản (giải mã từ base64 nếu file PNG chưa có) ----------
// Repo GitHub chỉ nhận file text qua kênh đẩy của Muse, nên các ảnh PNG được
// lưu kèm dưới dạng base64 trong assets-base64.json. Lần chạy đầu tiên trên
// máy mới, server tự giải mã chúng ra public/assets/; lần sau file đã có
// sẵn thì bỏ qua.
try {
  const assetsDir = path.join(__dirname, 'public', 'assets');
  const bundlePath = path.join(__dirname, 'assets-base64.json');
  if (fs.existsSync(bundlePath)) {
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
    fs.mkdirSync(assetsDir, { recursive: true });
    for (const [name, b64] of Object.entries(bundle)) {
      const target = path.join(assetsDir, name);
      if (!fs.existsSync(target)) {
        fs.writeFileSync(target, Buffer.from(b64, 'base64'));
        console.log('Đã giải mã ảnh:', name);
      }
    }
  }
} catch (e) {
  console.error('Không giải mã được assets-base64.json:', e.message);
}

// ---------- Lưu trữ bền vững (file JSON) ----------
let store = { messages: [], roster: {} };
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(raw.messages)) store.messages = raw.messages.slice(-MAX_MESSAGES);
    if (raw.roster && typeof raw.roster === 'object') store.roster = raw.roster;
  }
} catch (e) {
  console.error('Không đọc được data.json, bắt đầu với dữ liệu trống:', e.message);
}

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 1));
    } catch (e) {
      console.error('Không ghi được data.json:', e.message);
    }
  }, 300);
}

// ---------- Trạng thái & hằng số dùng chung ----------
const clients = new Map(); // ws -> participant
let nextId = 1;

const VALID_AVATARS = ['tifa', 'aerith', 'yuna', 'cloud', 'squall', 'lightning', 'noctis', 'sakura'];
const VALID_ZONES = ['work', 'pantry', 'meeting', 'lobby'];
const VALID_ACTIONS = ['stand', 'sit', 'coffee', 'talk', 'relax', 'walk'];
const VALID_EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'shy'];

function cleanName(name) {
  return String(name || '').trim().slice(0, 24) || 'Khách';
}

function uniqueName(wanted) {
  const taken = new Set([...clients.values()].map((p) => p.name.toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  let i = 2;
  while (taken.has(`${wanted} (${i})`.toLowerCase())) i++;
  return `${wanted} (${i})`;
}

function publicState() {
  return [...clients.values()].map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    zone: p.zone,
    x: p.x,
    y: p.y,
    action: p.action,
    mode: p.mode,
    expression: p.expression || 'neutral',
    lastMessage: p.lastMessage || null,
  }));
}

function broadcast(obj, except) {
  const data = JSON.stringify(obj);
  for (const ws of clients.keys()) {
    if (ws !== except && ws.readyState === ws.OPEN) ws.send(data);
  }
}

function broadcastState() {
  broadcast({ type: 'state', participants: publicState() });
}

function addMessage(name, avatar, text) {
  const chatMsg = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    name,
    avatar,
    text,
    time: new Date().toISOString(),
  };
  store.messages.push(chatMsg);
  if (store.messages.length > MAX_MESSAGES) store.messages = store.messages.slice(-MAX_MESSAGES);
  saveSoon();
  return chatMsg;
}

// ---------- HTTP + API REST ----------
const app = express();
app.use(express.json({ limit: '64kb' }));

// CORS cho mọi endpoint /api/* (cho phép web/app khác gọi API).
app.use('/api', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (req, res) => res.json({ ok: true, online: clients.size }));
app.get('/api/health', (req, res) => res.json({ ok: true, online: clients.size }));

app.get('/api/messages', (req, res) => {
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 50;
  limit = Math.min(limit, MAX_MESSAGES);
  res.json({ messages: store.messages.slice(-limit) });
});

app.get('/api/participants', (req, res) => {
  res.json({ participants: publicState(), online: clients.size });
});

app.get('/api/state', (req, res) => {
  res.json({ messages: store.messages, participants: publicState(), online: clients.size });
});

app.post('/api/messages', (req, res) => {
  const apiKey = process.env.API_KEY;
  if (apiKey && req.get('X-API-Key') !== apiKey) {
    return res.status(401).json({ error: 'Thiếu hoặc sai X-API-Key' });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const text = String(body.text || '').trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'text không được để trống' });
  const name = cleanName(body.name);
  const avatar = VALID_AVATARS.includes(body.avatar) ? body.avatar : 'tifa';
  const chatMsg = addMessage(name, avatar, text);
  broadcast({ type: 'chat', message: chatMsg });
  res.status(201).json({ message: chatMsg });
});

// JSON lỗi cú pháp -> trả về JSON thay vì trang lỗi HTML mặc định.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON không hợp lệ' });
  }
  next(err);
});

app.use(express.static(path.join(__dirname, 'public')));

// ---------- WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function heartbeat() {
  for (const [ws, p] of clients) {
    if (ws.isAlive === false) {
      clients.delete(ws);
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  broadcastState();
}
setInterval(heartbeat, 30000);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const me = clients.get(ws);

    if (msg.type === 'join') {
      const name = uniqueName(cleanName(msg.name));
      const avatar = VALID_AVATARS.includes(msg.avatar) ? msg.avatar : 'tifa';
      const saved = store.roster[name] || store.roster[cleanName(msg.name)] || {};
      const p = {
        id: nextId++,
        name,
        avatar,
        zone: VALID_ZONES.includes(saved.zone) ? saved.zone : 'lobby',
        x: typeof saved.x === 'number' ? saved.x : 50,
        y: typeof saved.y === 'number' ? saved.y : 55,
        action: VALID_ACTIONS.includes(saved.action) ? saved.action : 'stand',
        mode: 'manual',
        expression: VALID_EXPRESSIONS.includes(saved.expression) ? saved.expression : 'neutral',
        lastMessage: null,
      };
      clients.set(ws, p);
      ws.send(JSON.stringify({
        type: 'init',
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        zone: p.zone,
        x: p.x,
        y: p.y,
        action: p.action,
        expression: p.expression,
        messages: store.messages,
        participants: publicState(),
      }));
      broadcastState();
      return;
    }

    if (!me) return;

    if (msg.type === 'chat') {
      const text = String(msg.text || '').trim().slice(0, 500);
      if (!text) return;
      const chatMsg = addMessage(me.name, me.avatar, text);
      me.lastMessage = { text, at: Date.now() };
      broadcast({ type: 'chat', message: chatMsg });
      broadcastState();
      return;
    }

    if (msg.type === 'move' || msg.type === 'action') {
      if (VALID_ZONES.includes(msg.zone)) me.zone = msg.zone;
      if (typeof msg.x === 'number') me.x = Math.max(2, Math.min(98, msg.x));
      if (typeof msg.y === 'number') me.y = Math.max(2, Math.min(98, msg.y));
      if (VALID_ACTIONS.includes(msg.action)) me.action = msg.action;
      if (VALID_EXPRESSIONS.includes(msg.expression)) me.expression = msg.expression;
      store.roster[me.name] = { avatar: me.avatar, zone: me.zone, x: me.x, y: me.y, action: me.action, expression: me.expression };
      saveSoon();
      broadcastState();
      return;
    }

    if (msg.type === 'mode') {
      me.mode = msg.mode === 'auto' ? 'auto' : 'manual';
      broadcastState();
      return;
    }

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  });

  ws.on('close', () => {
    if (clients.delete(ws)) broadcastState();
  });
});

server.listen(PORT, () => {
  console.log(`Web Chat Chung đang chạy tại http://localhost:${PORT}`);
});

// Ghi ngay dữ liệu đang chờ (debounce) khi tắt máy chủ, để lịch sử chat
// và roster không mất khi khởi động lại ngay sau tin nhắn cuối.
function flushAndExit() {
  clearTimeout(saveTimer);
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 1));
  } catch (e) {
    console.error('Không ghi được data.json:', e.message);
  }
  process.exit(0);
}
process.on('SIGTERM', flushAndExit);
process.on('SIGINT', flushAndExit);
