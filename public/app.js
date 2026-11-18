// Web Chat Chung — logic phía trình duyệt: cảnh văn phòng, nhân vật, chat realtime.

const CHARACTERS = {
  tifa:      { label: 'Tifa',      hair: '#2e2019', aspect: 293 / 640, longHair: true  },
  aerith:    { label: 'Aerith',    hair: '#9c6b30', aspect: 302 / 640, longHair: true  },
  yuna:      { label: 'Yuna',      hair: '#5d3a1e', aspect: 353 / 640, longHair: false },
  cloud:     { label: 'Cloud',     hair: '#e8c93c', aspect: 320 / 640, longHair: false },
  squall:    { label: 'Squall',    hair: '#96714a', aspect: 271 / 640, longHair: false },
  lightning: { label: 'Lightning', hair: '#f2a7bb', aspect: 305 / 640, longHair: true  },
  noctis:    { label: 'Noctis',    hair: '#191920', aspect: 270 / 640, longHair: false },
  sakura:    { label: 'Sakura',    hair: '#f4a8c8', aspect: 450 / 640, longHair: true  },
};

const ZONES = {
  work:    { label: 'Khu làm việc', spots: [[19.3, 46.5], [28.1, 46.5], [36.4, 46.5], [44.7, 46.5], [19.3, 77.5], [28.1, 77.5], [36.4, 77.5], [44.7, 77.5]] },
  pantry:  { label: 'Khu ăn uống',  spots: [[78, 21], [85, 21], [73, 32], [83, 32], [78, 39], [70, 26]] },
  meeting: { label: 'Phòng họp',    spots: [[68.5, 62.5], [73.5, 62.5], [78.5, 62.5], [68.5, 82], [73.5, 82], [78.5, 82], [92.5, 70], [92.5, 88]] },
  lobby:   { label: 'Sảnh',         spots: [[52, 55], [55, 62], [50, 68]] },
};
const SOFA_SPOTS = [[92.5, 70], [92.5, 88]];
const COFFEE_SPOTS = [[78, 21], [85, 21]];
const TALK_SPOTS = [[73, 32], [83, 32], [78, 39], [68.5, 62.5], [73.5, 62.5], [78.5, 62.5]];

const ACTION_META = {
  stand:  { label: 'Đang đứng',      badge: ''   },
  sit:    { label: 'Đang làm việc',  badge: '💻' },
  coffee: { label: 'Đang pha cafe',  badge: '☕' },
  talk:   { label: 'Đang trò chuyện', badge: '💬' },
  relax:  { label: 'Đang nghỉ ngơi', badge: '😌' },
  walk:   { label: 'Đang di chuyển', badge: ''   },
};

const TIFA_TIPS = [
  'Bấm vào bất kỳ khu nào trong văn phòng để nhân vật của bạn bước tới đó.',
  'Nút Làm việc sẽ cho nhân vật ngồi vào bàn PC, màn hình sáng lên như đang gõ phím.',
  'Bật chế độ tự động, Tifa sẽ lo cho nhân vật của bạn khi bạn vắng mặt — bạn quay lại là lấy quyền điều khiển ngay.',
  'Kênh chat công ty là kênh chung: một tin nhắn, cả văn phòng đều đọc được.',
  'Khi bạn nhắn tin, tin nhắn sẽ hiện thành bong bóng thoại ngay trên đầu nhân vật của bạn.',
  'Pha cafe xong, thử bấm Trò chuyện để nhân vật ra bàn ăn tám với mọi người nhé.',
];

const $ = (sel) => document.querySelector(sel);
const sceneEl = $('#scene');
const charsEl = $('#characters');
const messagesEl = $('#messages');
const peopleListEl = $('#people-list');

let ws = null;
let myId = null;
let myName = '';
let myAvatar = 'tifa';
let participants = [];
let selectedAvatar = localStorage.getItem('wcc-avatar') || 'tifa';
let connected = false;

// ---------- Màn hình vào ----------
function buildAvatarGrid() {
  const grid = $('#avatar-grid');
  grid.innerHTML = '';
  for (const [key, c] of Object.entries(CHARACTERS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'avatar-opt' + (key === selectedAvatar ? ' selected' : '');
    btn.innerHTML = `<img src="assets/${key}.png" alt="${c.label}"><span>${c.label}</span>`;
    btn.addEventListener('click', () => {
      selectedAvatar = key;
      grid.querySelectorAll('.avatar-opt').forEach((el) => el.classList.remove('selected'));
      btn.classList.add('selected');
    });
    grid.appendChild(btn);
  }
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.addEventListener('open', () => {
    connected = true;
    ws.send(JSON.stringify({ type: 'join', name: myName, avatar: myAvatar }));
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'init') {
      myId = msg.id;
      myName = msg.name;
      myAvatar = msg.avatar;
      myMode = 'manual';
      messagesEl.innerHTML = '';
      msg.messages.forEach((m) => appendMessage(m));
      applyState(msg.participants);
      $('#entry-overlay').classList.add('hidden');
      markInteraction();
    } else if (msg.type === 'state') {
      applyState(msg.participants);
    } else if (msg.type === 'chat') {
      appendMessage(msg.message);
      showBubble(msg.message);
    }
  });

  ws.addEventListener('close', () => {
    connected = false;
    stopAutopilot();
    setTimeout(() => { if (myName) connect(); }, 3000);
  });

  ws.addEventListener('error', () => { try { ws.close(); } catch {} });
}

setInterval(() => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' })); }, 20000);

// ---------- Nhân vật trên cảnh ----------
const charEls = new Map(); // id -> {el, x, y, action, walkTimer, bubbleTimer}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function createCharEl(p) {
  const c = CHARACTERS[p.avatar] || CHARACTERS.tifa;
  const el = document.createElement('div');
  el.className = 'char' + (p.id === myId ? ' me' : '') + (c.longHair ? ' long-hair' : '');
  el.style.left = p.x + '%';
  el.style.top = p.y + '%';
  el.innerHTML = `
    <div class="bubble"></div>
    <div class="nametag">${escapeHtml(p.name)}<span class="mode-dot"></span></div>
    <div class="sprite" style="--w: calc(var(--char-h) * ${c.aspect}); --hair: ${c.hair}">
      <img class="sprite-img" src="assets/${p.avatar}.png" alt="${c.label}">
      <div class="slices">
        <div class="upper" style="background-image:url('assets/${p.avatar}.png')"></div>
        <div class="leg leg-l" style="background-image:url('assets/${p.avatar}.png')"></div>
        <div class="leg leg-r" style="background-image:url('assets/${p.avatar}.png')"></div>
      </div>
      <div class="hair-back"></div>
      <div class="hair-long"></div>
      <div class="chair-back"></div>
      <div class="glow"></div>
      <div class="cup">☕</div>
      <div class="badge"></div>
    </div>`;
  charsEl.appendChild(el);
  return { el, x: p.x, y: p.y, action: p.action, walkTimer: null, bubbleTimer: null };
}

function poseClass(action) {
  return { sit: 'sitting', coffee: 'coffee', talk: 'talking', relax: 'relaxing' }[action] || '';
}

function applyPose(rec, p) {
  const el = rec.el;
  el.classList.remove('sitting', 'coffee', 'talking', 'relaxing', 'show-badge');
  const pc = poseClass(p.action);
  if (pc) el.classList.add(pc);
  const badge = ACTION_META[p.action] ? ACTION_META[p.action].badge : '';
  const badgeEl = el.querySelector('.badge');
  if (badge) { badgeEl.textContent = badge; el.classList.add('show-badge'); }
  const dot = el.querySelector('.mode-dot');
  dot.textContent = p.mode === 'auto' ? '🤖' : '✋';
  dot.title = p.mode === 'auto' ? 'Đang tự động' : 'Điều khiển tay';
}

function applyState(list) {
  participants = list;
  const seen = new Set();
  for (const p of list) {
    seen.add(p.id);
    let rec = charEls.get(p.id);
    if (!rec) {
      rec = createCharEl(p);
      charEls.set(p.id, rec);
      applyPose(rec, p);
    }
    // Nhân vật đứng thấp hơn (y lớn hơn) thì vẽ đè lên nhân vật đứng cao hơn.
    rec.el.style.zIndex = String(5 + Math.round(p.y));
    const moved = Math.abs(rec.x - p.x) > 0.5 || Math.abs(rec.y - p.y) > 0.5;
    const actionChanged = rec.action !== p.action;
    if (moved) {
      const dx = p.x - rec.x, dy = p.y - rec.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const dur = Math.max(500, Math.min(2200, dist * 55));
      rec.el.classList.toggle('flip', dx < -0.5);
      rec.el.classList.remove('sitting', 'coffee', 'talking', 'relaxing', 'show-badge');
      rec.el.classList.add('walking');
      rec.el.style.transitionDuration = dur + 'ms';
      rec.el.style.left = p.x + '%';
      rec.el.style.top = p.y + '%';
      clearTimeout(rec.walkTimer);
      rec.walkTimer = setTimeout(() => {
        rec.el.classList.remove('walking');
        applyPose(rec, p);
      }, dur);
      rec.x = p.x; rec.y = p.y;
    } else if (actionChanged) {
      clearTimeout(rec.walkTimer);
      rec.el.classList.remove('walking');
      applyPose(rec, p);
    } else {
      applyPose(rec, p);
    }
    rec.action = p.action;
  }
  for (const [id, rec] of charEls) {
    if (!seen.has(id)) {
      clearTimeout(rec.walkTimer); clearTimeout(rec.bubbleTimer);
      rec.el.remove();
      charEls.delete(id);
    }
  }
  renderPeople();
  updateMyStatus();
}

function renderPeople() {
  $('#online-count').textContent = `🟢 ${participants.length} người online`;
  peopleListEl.innerHTML = '';
  for (const p of participants) {
    const c = CHARACTERS[p.avatar] || CHARACTERS.tifa;
    const li = document.createElement('li');
    const zoneLabel = (ZONES[p.zone] || ZONES.lobby).label;
    const actLabel = (ACTION_META[p.action] || ACTION_META.stand).label;
    li.innerHTML = `
      <img src="assets/${p.avatar}.png" alt="${c.label}">
      <span class="p-name">${escapeHtml(p.name)}${p.id === myId ? ' (bạn)' : ''}</span>
      <span class="p-status">${actLabel} · ${zoneLabel}</span>
      <span class="p-mode ${p.mode === 'auto' ? 'auto' : 'manual'}">${p.mode === 'auto' ? '🤖 Tự động' : '✋ Thủ công'}</span>`;
    peopleListEl.appendChild(li);
  }
}

function updateMyStatus() {
  const me = participants.find((p) => p.id === myId);
  if (!me) { $('#my-status').textContent = ''; return; }
  const actLabel = (ACTION_META[me.action] || ACTION_META.stand).label;
  const zoneLabel = (ZONES[me.zone] || ZONES.lobby).label;
  $('#my-status').textContent = `Bạn đang: ${actLabel} · ${zoneLabel} · ${me.mode === 'auto' ? '🤖 Tự động' : '✋ Thủ công'}`;
  document.querySelectorAll('.action-btn').forEach((b) => {
    const map = { work: 'sit', coffee: 'coffee', talk: 'talk', rest: 'relax' };
    b.classList.toggle('active', map[b.dataset.action] === me.action);
  });
}

// ---------- Chat ----------
function appendMessage(m) {
  const time = new Date(m.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  div.className = 'msg' + (m.name === myName ? ' mine' : '');
  div.innerHTML = `
    <img src="assets/${m.avatar}.png" alt="">
    <div class="msg-body">
      <div class="msg-head"><b>${escapeHtml(m.name)}</b> · ${time}</div>
      <div class="msg-text">${escapeHtml(m.text)}</div>
    </div>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showBubble(m) {
  const p = participants.find((x) => x.name === m.name);
  if (!p) return;
  const rec = charEls.get(p.id);
  if (!rec) return;
  const bubble = rec.el.querySelector('.bubble');
  bubble.textContent = m.text.length > 90 ? m.text.slice(0, 90) + '…' : m.text;
  rec.el.classList.add('has-bubble');
  clearTimeout(rec.bubbleTimer);
  rec.bubbleTimer = setTimeout(() => rec.el.classList.remove('has-bubble'), 6000);
}

$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text || !connected) return;
  ws.send(JSON.stringify({ type: 'chat', text }));
  input.value = '';
  markInteraction();
});

// ---------- Di chuyển & hành động ----------
function zoneAt(x, y) {
  if (x < 56) return 'work';
  return y < 50 ? 'pantry' : 'meeting';
}

function freeSpot(spots) {
  const taken = participants.filter((p) => p.id !== myId);
  for (const [x, y] of spots) {
    const occupied = taken.some((p) => Math.abs(p.x - x) < 3 && Math.abs(p.y - y) < 3);
    if (!occupied) return [x, y];
  }
  const [x, y] = spots[Math.floor(Math.random() * spots.length)];
  return [x + (Math.random() * 4 - 2), y + (Math.random() * 3 - 1.5)];
}

function sendMove(zone, x, y, action) {
  if (!connected) return;
  ws.send(JSON.stringify({ type: 'move', zone, x, y, action }));
}

function doAction(kind) {
  if (kind === 'work') {
    const [x, y] = freeSpot(ZONES.work.spots);
    sendMove('work', x, y, 'sit');
  } else if (kind === 'coffee') {
    const [x, y] = freeSpot(COFFEE_SPOTS);
    sendMove('pantry', x, y, 'coffee');
  } else if (kind === 'talk') {
    const [x, y] = freeSpot(TALK_SPOTS);
    sendMove(zoneAt(x, y), x, y, 'talk');
  } else if (kind === 'rest') {
    const [x, y] = freeSpot(SOFA_SPOTS);
    sendMove('meeting', x, y, 'relax');
  } else if (kind === 'meeting') {
    const [x, y] = freeSpot(ZONES.meeting.spots.slice(0, 6));
    sendMove('meeting', x, y, 'talk');
  }
}

document.querySelectorAll('.action-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    markInteraction();
    doAction(btn.dataset.action);
  });
});

sceneEl.addEventListener('click', (e) => {
  const rect = sceneEl.getBoundingClientRect();
  const x = Math.max(3, Math.min(97, ((e.clientX - rect.left) / rect.width) * 100));
  const y = Math.max(4, Math.min(95, ((e.clientY - rect.top) / rect.height) * 100));
  $('#zone-hint').style.display = 'none';
  markInteraction();
  sendMove(zoneAt(x, y), x, y, 'stand');
});

// ---------- Chế độ tự động ----------
let lastInteract = Date.now();
let autopilotTimer = null;
let autopilotStep = 0;
let myMode = 'manual';

const AUTOPILOT_CYCLE = ['work', 'coffee', 'rest', 'meeting'];

function setMode(mode) {
  if (myMode === mode) return;
  myMode = mode;
  if (connected) ws.send(JSON.stringify({ type: 'mode', mode }));
}

function markInteraction() {
  lastInteract = Date.now();
  if (autopilotTimer) stopAutopilot();
  setMode('manual');
}

function startAutopilot() {
  if (autopilotTimer) return;
  setMode('auto');
  const step = () => {
    doAction(AUTOPILOT_CYCLE[autopilotStep % AUTOPILOT_CYCLE.length]);
    autopilotStep++;
  };
  step();
  autopilotTimer = setInterval(step, 22000);
}

function stopAutopilot() {
  if (autopilotTimer) { clearInterval(autopilotTimer); autopilotTimer = null; }
}

setInterval(() => {
  const autoOn = $('#autopilot-toggle').checked;
  if (!connected || !myId) return;
  if (autoOn && !autopilotTimer && Date.now() - lastInteract > 60000) startAutopilot();
  if (!autoOn && autopilotTimer) { stopAutopilot(); setMode('manual'); }
}, 5000);

['pointerdown', 'keydown'].forEach((ev) => {
  document.addEventListener(ev, () => {
    // Tương tác của người dùng: lấy lại quyền điều khiển ngay.
    if (Date.now() - lastInteract > 1000) markInteraction();
    else lastInteract = Date.now();
  }, { passive: true });
});

$('#autopilot-toggle').addEventListener('change', (e) => {
  markInteraction();
  if (!e.target.checked) { stopAutopilot(); setMode('manual'); }
});

// ---------- Hướng dẫn & mẹo ----------
$('#guide-btn').addEventListener('click', () => $('#guide-overlay').classList.remove('hidden'));
$('#guide-close').addEventListener('click', () => $('#guide-overlay').classList.add('hidden'));
$('#guide-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'guide-overlay') $('#guide-overlay').classList.add('hidden');
});

let tipIdx = 0;
function rotateTip() {
  $('#tifa-tip-text').textContent = TIFA_TIPS[tipIdx % TIFA_TIPS.length];
  tipIdx++;
}
rotateTip();
setInterval(rotateTip, 12000);

// ---------- Vào văn phòng ----------
buildAvatarGrid();
$('#name-input').value = localStorage.getItem('wcc-name') || '';

function enterOffice() {
  const name = $('#name-input').value.trim();
  if (!name) {
    $('#entry-error').textContent = 'Anh/chị nhập tên hiển thị trước nhé.';
    return;
  }
  myName = name;
  myAvatar = selectedAvatar;
  localStorage.setItem('wcc-name', myName);
  localStorage.setItem('wcc-avatar', myAvatar);
  $('#entry-error').textContent = '';
  connect();
}

$('#enter-btn').addEventListener('click', enterOffice);
$('#name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') enterOffice(); });
