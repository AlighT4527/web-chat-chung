# API REST — Web Chat Chung

API đọc trạng thái văn phòng và gửi tin nhắn vào kênh chat công ty chung,
dùng cho web/app/bot bên ngoài. Mọi endpoint đều trả về JSON và cho phép
CORS từ mọi nguồn (`Access-Control-Allow-Origin: *`).

`BASE_URL` dưới đây là địa chỉ web đã deploy, ví dụ
`https://web-chat-chung.onrender.com` (bản Render) hoặc địa chỉ
`https://<worker>.workers.dev` (bản Cloudflare).

## Kiểm tra sức khỏe

```bash
curl $BASE_URL/api/health
```

Trả về số người đang online:

```json
{ "ok": true, "online": 3 }
```

Endpoint cũ `/health` vẫn hoạt động và trả về cùng nội dung.

## Đọc tin nhắn

```bash
curl "$BASE_URL/api/messages?limit=20"
```

Tham số `limit`: số tin nhắn mới nhất, mặc định 50, tối đa 200.

```json
{
  "messages": [
    { "id": "1731900000000-a1b2c3", "name": "Quang Anh", "avatar": "tifa",
      "text": "Chào mọi người!", "time": "2026-11-18T07:00:00.000Z" }
  ]
}
```

## Đọc danh sách người trong văn phòng

```bash
curl $BASE_URL/api/participants
```

```json
{
  "participants": [
    { "id": 1, "name": "Quang Anh", "avatar": "tifa", "zone": "work",
      "x": 28.1, "y": 46.5, "action": "sit", "mode": "manual",
      "expression": "happy", "lastMessage": null }
  ],
  "online": 1
}
```

Các giá trị: `zone` thuộc `work | pantry | meeting | lobby`;
`action` thuộc `stand | sit | coffee | talk | relax | walk`;
`mode` thuộc `manual | auto`;
`expression` thuộc `neutral | happy | sad | angry | surprised | shy`;
`avatar` thuộc `tifa | aerith | yuna | cloud | squall | lightning | noctis | sakura`.

## Đọc toàn bộ trạng thái

```bash
curl $BASE_URL/api/state
```

Trả về `{ "messages": [...], "participants": [...], "online": N }` —
toàn bộ lịch sử chat (tối đa 200 tin) và danh sách người tham gia.

## Gửi tin nhắn

```bash
curl -X POST $BASE_URL/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"name": "Bot Nhắc Việc", "text": "Họp lúc 15h nhé!", "avatar": "cloud"}'
```

- `name`: tên hiển thị, tối đa 24 ký tự (bỏ trống thì dùng `Khách`).
- `text`: nội dung, bắt buộc, tối đa 500 ký tự.
- `avatar`: một trong 8 id ở trên; sai hoặc bỏ trống thì dùng `tifa`.

Thành công trả về mã `201` cùng tin nhắn đã tạo:

```json
{ "message": { "id": "...", "name": "Bot Nhắc Việc", "avatar": "cloud",
  "text": "Họp lúc 15h nhé!", "time": "2026-11-18T07:05:00.000Z" } }
```

Tin nhắn được lưu vào lịch sử và phát ngay tới mọi trình duyệt đang mở
văn phòng qua WebSocket, giống như nhắn từ khung chat.

## Bảo vệ bằng khóa API (tùy chọn)

Nếu máy chủ được cấu hình biến `API_KEY` (bản Node: biến môi trường;
bản Cloudflare: secret/var `API_KEY`), mọi request `POST /api/messages`
phải kèm header `X-API-Key` khớp với khóa đó, nếu không sẽ bị từ chối
với mã `401`. Các endpoint GET không yêu cầu khóa.

```bash
curl -X POST $BASE_URL/api/messages \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: khoa-bi-mat-cua-ban' \
  -d '{"name": "Bot", "text": "Xin chào!"}'
```

Nếu `API_KEY` không được cấu hình, endpoint POST mở cho mọi người gọi.

## Mã lỗi

| Mã | Ý nghĩa |
|----|---------|
| 400 | `text` trống hoặc JSON gửi lên không hợp lệ |
| 401 | Thiếu hoặc sai `X-API-Key` (khi `API_KEY` đã cấu hình) |
| 404 | Endpoint API không tồn tại |
