# Web Chat Chung — Văn phòng công ty 2,5D

Web chat nhóm realtime: nhiều người cùng vào một văn phòng pixel-art nhìn từ
trên xuống, chọn tạo hình nhân vật chibi, trò chuyện trên một kênh công ty
chung và hỗ trợ nhau làm việc.

## Chạy local

```bash
npm install
node server.js
```

Mở http://localhost:3000 — gửi link cho người khác cùng mạng là vào chat chung
được ngay. Cổng mặc định `3000`, đổi bằng biến môi trường `PORT`.

## Tính năng

- **Màn hình vào**: nhập tên hiển thị, chọn 1 trong 8 tạo hình chibi
  pixel-art: Tifa, Aerith, Yuna, Cloud, Squall, Lightning, Noctis, Sakura.
- **Văn phòng 2,5D**: khu làm việc (sàn gỗ, 2 dãy bàn PC, kệ sách), khu ăn
  uống (máy bán đồ ăn, cây nước, tủ lạnh, đồng hồ, bàn ăn tròn), phòng họp
  (thảm xanh, bàn họp dài, laptop, tranh, góc sofa). Cảnh văn phòng là trung
  tâm, khung chat và danh sách người thu gọn bên cạnh.
- **Một kênh chat công ty chung** cho tất cả mọi người, realtime qua
  WebSocket. Tin nhắn mới nhất hiện thành bong bóng thoại trên đầu nhân vật.
- **Nhân vật sống động**: bấm vào cảnh để nhân vật bước tới với dáng đi nhìn
  ngang, chân bước xen kẽ; làm việc thì ngồi lên ghế quay lưng lại, màn hình
  PC sáng lên; pha cafe thì ra máy/cây nước cầm cốc bốc hơi; trò chuyện, nghỉ
  sofa — mỗi hành động có huy hiệu biểu cảm riêng. Sprite nhỏ cân đối với
  đồ đạc trong văn phòng.
- **Điều khiển tay + tự động**: nút Làm việc / Pha cafe / Trò chuyện /
  Nghỉ ngơi cho nhân vật của mình; bật "Tifa tự điều khiển khi bạn vắng" thì
  sau 60 giây không thao tác nhân vật sẽ tự sinh hoạt (làm việc → pha cafe →
  nghỉ sofa → ghé phòng họp), và nhường quyền điều khiển ngay khi bạn tương
  tác. Danh sách mọi người hiển thị rõ ai đang Tự động hay Thủ công.
- **Hướng dẫn trong trang**: nút Hướng dẫn, hướng dẫn nhanh ở màn hình vào,
  và mục "Mẹo của Tifa" xoay vòng.
- **Hiện diện**: heartbeat WebSocket, người mất kết nối sẽ rời khỏi danh sách;
  hiển thị số người online.

## Dữ liệu

Lịch sử chat (tối đa 200 tin) và vị trí/hành động gần nhất của từng người
được lưu vào `data.json` (cùng thư mục với `server.js`) nên khởi động lại
máy chủ vẫn còn lịch sử. Đổi vị trí file bằng biến `DATA_FILE`.

## Ảnh tài sản

9 ảnh PNG (nền văn phòng + 8 sprite) được lưu kèm dưới dạng base64 trong
`assets-base64.json`, vì kênh đẩy lên GitHub của Muse chỉ nhận file text.
Lần chạy đầu tiên trên máy mới, `server.js` tự giải mã chúng ra
`public/assets/`; các lần sau file đã có sẵn thì bỏ qua.

## Deploy lên Render (gói free)

1. Đẩy thư mục này lên một repo GitHub.
2. Trên [Render Dashboard](https://dashboard.render.com) → **New +** →
   **Web Service** → chọn repo. Render tự nhận `render.yaml`:
   `npm install` rồi `node server.js`.
3. Gói **Free** là đủ để chạy thử. Lưu ý của gói free:
   - Service sẽ "ngủ" sau một thời gian không có truy cập và mất ~1 phút để
     tỉnh dậy khi có người vào lại.
   - Ổ đĩa là tạm thời: `data.json` (lịch sử chat) có thể mất khi Render
     khởi động lại hoặc deploy lại service. Muốn giữ lịch sử bền vững thì
     gắn thêm Persistent Disk (gói trả phí) hoặc chuyển sang cơ sở dữ liệu
     ngoài.

## Cấu trúc

```
server.js            Máy chủ Express + WebSocket, lưu trữ data.json
public/
  index.html         Màn hình vào + khung văn phòng + chat
  style.css          Giao diện + animation nhân vật
  app.js             Logic client: di chuyển, hành động, autopilot, chat
  assets/
    office.png       Nền văn phòng pixel-art nhìn từ trên xuống
    tifa.png ...     8 sprite nhân vật (nền trong suốt)
render.yaml          Cấu hình deploy Render
```

## Công nghệ

Node.js 24 + Express + `ws`, không cần bước build. Giao diện tiếng Việt.
