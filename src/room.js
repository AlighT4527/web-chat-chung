// Web Chat Chung — Durable Object: một phòng chat chung duy nhất cho cả công ty.
// Bản sao hành vi của server.js (bản Render/Node), chạy trên Cloudflare Workers.
// Giao thức: client gửi join/chat/move/action/mode/ping;
// server gửi init/state/chat/pong. Trạng thái lưu bền trong ctx.storage.
// API REST (xem API.md): mọi request /api/* đều được Worker chuyển về đây.

import { DurableObject } from 'cloudflare:workers';

const MAX_MESSAGES = 200;
const VALID_AVATARS = ['tifa', 'aerith', 'yuna', 'cloud', 'squall', 'lightning', 'noctis', 'sakura'];
const VALID_ZONES = ['work', 'pantry', 'meeting', 'lobby'];
const VALID_ACTIONS = ['stand', 'sit', 'coffee', 'talk', 'relax', 'walk'];
const VALID_EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'shy'];

function cleanName(name) {
  return String(name || '').trim().slice(0, 24) || 'Khách';
}

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.apiKey = env.API_KEY || '';
    this.messages = [];
    this.roster = {};
    this.nextId = 1;
    // Nạp trạng thái bền trước khi xử lý request/message đầu tiên.
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get(['messages', 'roster', 'nextId']);
      if (Array.isArray(stored.get('messages'))) {
        this.messages = stored.get('messages').slice(-MAX_MESSAGES);
      }
      const roster = stored.get('roster');
      if (roster && typeof roster === 'object') this.roster = roster;
      const nextId = stored.get('nextId');
      if (typeof nextId === 'number' && nextId >= 1) this.nextId = nextId;
    });
  }

  async save() {
    await this.ctx.storage.put({
      messages: this.messages,
      roster: this.roster,
      nextId: this.nextId,
    });
  }

  // ---------- HTTP: bắt tay WebSocket + /health + API REST ----------
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ ok: true, online: this.participants().length });
    }
    if (url.pathname.startsWith('/api/')) {
      return this.handleApi(request, url);
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Hibernatable WebSocket: trạng thái participant gắn kèm qua attachment
    // để sống sót qua các lần DO ngủ đông (hibernate) và thức dậy.
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------- API REST (giống hệt bản Node, xem API.md) ----------
  apiResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
      },
    });
  }

  async handleApi(request, url) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
        },
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return this.apiResponse({ ok: true, online: this.participants().length });
    }

    if (request.method === 'GET' && url.pathname === '/api/messages') {
      let limit = parseInt(url.searchParams.get('limit'), 10);
      if (!Number.isFinite(limit) || limit <= 0) limit = 50;
      limit = Math.min(limit, MAX_MESSAGES);
      return this.apiResponse({ messages: this.messages.slice(-limit) });
    }

    if (request.method === 'GET' && url.pathname === '/api/participants') {
      const participants = this.publicState();
      return this.apiResponse({ participants, online: participants.length });
    }

    if (request.method === 'GET' && url.pathname === '/api/state') {
      const participants = this.publicState();
      return this.apiResponse({ messages: this.messages, participants, online: participants.length });
    }

    if (request.method === 'POST' && url.pathname === '/api/messages') {
      if (this.apiKey && request.headers.get('X-API-Key') !== this.apiKey) {
        return this.apiResponse({ error: 'Thiếu hoặc sai X-API-Key' }, 401);
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return this.apiResponse({ error: 'JSON không hợp lệ' }, 400);
      }
      if (!body || typeof body !== 'object') body = {};
      const text = String(body.text || '').trim().slice(0, 500);
      if (!text) return this.apiResponse({ error: 'text không được để trống' }, 400);
      const name = cleanName(body.name);
      const avatar = VALID_AVATARS.includes(body.avatar) ? body.avatar : 'tifa';
      const chatMsg = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        name,
        avatar,
        text,
        time: new Date().toISOString(),
      };
      this.messages.push(chatMsg);
      if (this.messages.length > MAX_MESSAGES) this.messages = this.messages.slice(-MAX_MESSAGES);
      await this.save();
      this.broadcast({ type: 'chat', message: chatMsg });
      return this.apiResponse({ message: chatMsg }, 201);
    }

    return this.apiResponse({ error: 'Không tìm thấy endpoint' }, 404);
  }

  // ---------- Trạng thái participant ----------
  // Participant được lưu trong attachment của từng WebSocket (chuẩn hibernation),
  // nên getWebSockets() + deserializeAttachment() luôn là nguồn sự thật.
  // `except` loại một socket khỏi danh sách (dùng khi socket đó vừa đóng:
  // lúc webSocketClose chạy, socket đóng vẫn còn trong getWebSockets()).
  participants(except) {
    const list = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (except && ws === except) continue;
      try {
        const p = ws.deserializeAttachment();
        if (p) list.push(p);
      } catch {
        // Socket chưa join (chưa có attachment) thì bỏ qua.
      }
    }
    return list;
  }

  publicState(except) {
    return this.participants(except).map((p) => ({
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

  broadcast(obj, except) {
    const data = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      if (except && ws === except) continue;
      try {
        ws.send(data);
      } catch {
        // Socket đã đóng: bỏ qua, webSocketClose sẽ dọn sau.
      }
    }
  }

  broadcastState(except) {
    this.broadcast({ type: 'state', participants: this.publicState(except) }, except);
  }

  uniqueName(wanted) {
    const taken = new Set(this.participants().map((p) => p.name.toLowerCase()));
    if (!taken.has(wanted.toLowerCase())) return wanted;
    let i = 2;
    while (taken.has(`${wanted} (${i})`.toLowerCase())) i++;
    return `${wanted} (${i})`;
  }

  // ---------- Xử lý message (giữ đúng giao thức của server.js) ----------
  async webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'join') {
      const cleaned = cleanName(msg.name);
      const name = this.uniqueName(cleaned);
      const avatar = VALID_AVATARS.includes(msg.avatar) ? msg.avatar : 'tifa';
      const saved = this.roster[name] || this.roster[cleaned] || {};
      const p = {
        id: this.nextId++,
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
      ws.serializeAttachment(p);
      await this.save();
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
        messages: this.messages,
        participants: this.publicState(),
      }));
      this.broadcastState();
      return;
    }

    let me = null;
    try {
      me = ws.deserializeAttachment();
    } catch {
      me = null;
    }
    if (!me) return;

    if (msg.type === 'chat') {
      const text = String(msg.text || '').trim().slice(0, 500);
      if (!text) return;
      const chatMsg = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        name: me.name,
        avatar: me.avatar,
        text,
        time: new Date().toISOString(),
      };
      this.messages.push(chatMsg);
      if (this.messages.length > MAX_MESSAGES) this.messages = this.messages.slice(-MAX_MESSAGES);
      me.lastMessage = { text, at: Date.now() };
      ws.serializeAttachment(me);
      await this.save();
      this.broadcast({ type: 'chat', message: chatMsg });
      this.broadcastState();
      return;
    }

    if (msg.type === 'move' || msg.type === 'action') {
      if (VALID_ZONES.includes(msg.zone)) me.zone = msg.zone;
      if (typeof msg.x === 'number') me.x = Math.max(2, Math.min(98, msg.x));
      if (typeof msg.y === 'number') me.y = Math.max(2, Math.min(98, msg.y));
      if (VALID_ACTIONS.includes(msg.action)) me.action = msg.action;
      if (VALID_EXPRESSIONS.includes(msg.expression)) me.expression = msg.expression;
      this.roster[me.name] = { avatar: me.avatar, zone: me.zone, x: me.x, y: me.y, action: me.action, expression: me.expression };
      ws.serializeAttachment(me);
      await this.save();
      this.broadcastState();
      return;
    }

    if (msg.type === 'mode') {
      me.mode = msg.mode === 'auto' ? 'auto' : 'manual';
      ws.serializeAttachment(me);
      this.broadcastState();
      return;
    }

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  }

  async webSocketClose(ws) {
    // Loại socket vừa đóng khỏi danh sách gửi đi (nó vẫn còn trong
    // getWebSockets() cho tới khi handler này trả về).
    this.broadcastState(ws);
  }

  async webSocketError(ws) {
    this.broadcastState(ws);
  }
}
