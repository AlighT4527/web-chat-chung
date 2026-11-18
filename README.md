# Web Chat Chung — bản Cloudflare (Workers + Durable Objects)

Web chat nhóm realtime: nhiều người cùng vào một văn phòng pixel-art nhìn từ
trên xuống, chọn tạo hình nhân vật chibi, trò chuyện trên một kênh công ty
chung và hỗ trợ nhau làm việc. Đây là bản chạy trên Cloudflare Workers, cùng
giao diện và giao thức với bản Node/Render gốc
(`web-chat-chung-standalone`), chỉ thay tầng máy chủ.

## Kiến trúc

```
Trình duyệt ── https://<tên>.workers.dev ──► Worker (src/index.js)
   │  /            → Workers Static Assets (public/)
   │  /ws          → Durable Object ChatRoom (src/room.js, phòng 'global' duy nhất)
   │  /health, /api/* → Durable Object (số người online + API REST)
```

- **Worker** (`src/index.js`): phục vụ file tĩnh qua Static Assets, chuyển
  mọi kết nối WebSocket ở `/ws`, `/health` và mọi request `/api/*` về cùng
  một Durable Object.
- **Durable Object** (`src/room.js`, class `ChatRoom`): giữ danh sách người
  tham gia, lịch sử chat (tối đa 200 tin) và vị trí/hành động/biểu cảm gần
  nhất của từng người (roster). Dữ liệu lưu bền trong `ctx.storage` nên sống
  sót qua các lần Durable Object ngủ đông và khởi động lại. WebSocket dùng API
  hibernatable (`ctx.acceptWebSocket`), trạng thái mỗi người gắn kèm socket
  qua attachment. Durable Object cũng phục vụ API REST (xem `API.md`): đọc
  tin nhắn/người tham gia/trạng thái, gửi tin nhắn (tùy chọn bảo vệ bằng
  secret `API_KEY`).
- **Giao thức** giống hệt bản Node: client gửi `join`/`chat`/`move`/`action`/
  `mode`/`ping`; server gửi `init`/`state`/`chat`/`pong`, cùng các kiểm tra
  (8 avatar, 4 khu, 6 hành động, 6 biểu cảm, tên tối đa 24 ký tự, tin tối đa
  500 ký tự, tên trùng tự thêm hậu tố " (2)", " (3)"...). Message
  `move`/`action` có thêm trường `expression` tùy chọn; trạng thái participant
  và roster đều lưu `expression`.
- **Frontend** (`public/`): `index.html`, `style.css`, `app.js` — y nguyên
  bản gốc, gồm sprite biểu cảm/dáng theo hành động, khung hình bước đi 6
  frame và hàng nút chọn biểu cảm. Client tự nối WebSocket cùng origin
  (`wss://<host>/ws` từ `location.host`) nên chạy được trên mọi host mà
  không cần sửa.

## Ảnh tài sản

Tất cả ảnh PNG (nền văn phòng + 8 sprite gốc + sprite biểu cảm/dáng và khung
hình bước đi của 8 nhân vật) được lưu kèm dưới dạng base64 trong
`assets-base64.json`, vì kênh đẩy lên GitHub của Muse chỉ nhận file text.
Script `decode-assets.js` giải mã chúng ra `public/assets/` ở bước build.
Mỗi sprite nhân vật cao tối đa 160px để tổng bundle luôn dưới 10 MB.
**Không commit file `.png` nào** (đã có trong `.gitignore`).

## Deploy lên Cloudflare (Workers Builds, gói Free)

Deploy từ nhánh git **`cloudflare`** của repo (khác với nhánh `main` của bản
Render). Trên Cloudflare Dashboard → **Workers & Pages** → **Create** →
**Workers** → **Connect to Git** (hoặc Workers Builds cho Worker có sẵn):

1. Chọn repo và nhánh **`cloudflare`**.
2. **Build command:** `node decode-assets.js`
   (chỉ cần giải mã ảnh; không có bước build/bundle nào khác, Worker dùng mã
   nguồn trực tiếp từ `src/`.)
3. **Deploy command:** để trống hoặc `npx wrangler deploy` (Workers Builds
   tự đọc `wrangler.toml`).
4. **Lưu ý Durable Object:** lần deploy đầu tiên sẽ áp dụng migration `v1`
   trong `wrangler.toml` và tạo class `ChatRoom`. Sau lần đầu, mọi người
   dùng chung một instance phòng `global` duy nhất.

Gói Workers Free: 100.000 request/ngày, không cần thẻ thanh toán.
Durable Objects Free: 100.000 request/ngày. Không có custom domain — dùng
địa chỉ `<tên>.workers.dev` mà Cloudflare cấp.

## Chạy local

```bash
npm install
node decode-assets.js   # tạo public/assets/*.png để thử local (không commit)
npm run dev             # wrangler dev, mở http://localhost:8787
```

`wrangler dev` chạy Durable Object ngay trên máy, không cần đăng nhập
Cloudflare. Sau khi thử xong, xóa `public/assets/*.png` để thư mục chỉ còn
file text commit được.

## Cấu trúc

```
src/
  index.js           Worker entry: static assets + route /ws, /health, /api/*
  room.js            Durable Object ChatRoom: phòng chat chung duy nhất + API REST
API.md               Tài liệu API REST (đọc/gửi tin nhắn, trạng thái)
public/
  index.html         Màn hình vào + khung văn phòng + chat
  style.css          Giao diện + animation nhân vật
  app.js             Logic client: di chuyển, hành động, autopilot, chat
  assets/            (build mới tạo) office.png + sprite nhân vật/biểu cảm/bước đi
assets-base64.json   Ảnh PNG dạng base64 (để commit qua kênh text-only)
decode-assets.js     Giải mã assets-base64.json → public/assets/
wrangler.toml        Cấu hình Worker, Static Assets, Durable Object
```

## Công nghệ

Cloudflare Workers + Durable Objects (Hibernatable WebSocket API),
`wrangler` 4. Giao diện tiếng Việt, không cần bước build.
