// Giải mã toàn bộ ảnh PNG (nền văn phòng + sprite nhân vật/biểu cảm/dáng
// và khung hình bước đi) từ assets-base64.json ra public/assets/. Chạy ở
// (build command: "node decode-assets.js"), vì file nhị phân PNG không
// được commit lên GitHub qua kênh đẩy text-only của Muse.
// Chạy local: node decode-assets.js

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(root, 'public', 'assets');
const bundlePath = join(root, 'assets-base64.json');

const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
mkdirSync(assetsDir, { recursive: true });

let decoded = 0;
for (const [name, b64] of Object.entries(bundle)) {
  const target = join(assetsDir, name);
  if (!existsSync(target)) {
    writeFileSync(target, Buffer.from(b64, 'base64'));
    decoded++;
    console.log('Đã giải mã ảnh:', name);
  }
}
console.log(`Xong: ${decoded} ảnh mới, tổng ${Object.keys(bundle).length} ảnh trong bundle.`);
