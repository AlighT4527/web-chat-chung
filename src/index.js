// Web Chat Chung — Worker entry: phục vụ file tĩnh + chuyển /ws về Durable Object.
// Tất cả người dùng dùng chung MỘT phòng (id 'global'), giống bản Node gốc.

import { ChatRoom } from './room.js';

export { ChatRoom };

function getRoomStub(env) {
  const id = env.CHAT_ROOM.idFromName('global');
  return env.CHAT_ROOM.get(id);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Realtime: mọi nâng cấp WebSocket đều vào cùng một Durable Object.
    // API REST (/api/*) và /health cũng do Durable Object phục vụ, vì trạng
    // thái (tin nhắn, người tham gia) sống trong ctx.storage của nó.
    if (url.pathname === '/ws' || url.pathname === '/health' || url.pathname.startsWith('/api/')) {
      return getRoomStub(env).fetch(request);
    }

    // File tĩnh (Workers Static Assets). Đường dẫn không có đuôi file mà
    // không khớp asset nào thì trả về index.html (kiểu SPA).
    let response = await env.ASSETS.fetch(request);
    if (response.status === 404 && !url.pathname.split('/').pop().includes('.')) {
      response = await env.ASSETS.fetch(new URL('/index.html', url));
    }
    return response;
  },
};
