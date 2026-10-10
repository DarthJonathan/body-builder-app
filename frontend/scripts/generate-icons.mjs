import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

// Rasterize the app's code-defined dumbbell mark without remote assets.
const shapes = [[157, 233, 198, 46, 12], [132, 180, 45, 152, 13], [97, 204, 28, 104, 9], [335, 180, 45, 152, 13], [387, 204, 28, 104, 9]];
const angle = 40 * Math.PI / 180;
const cos = Math.cos(angle), sin = Math.sin(angle);
const table = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, name, data, checksum]);
}

function inside(x, y, [left, top, width, height, radius]) {
  const dx = Math.max(left + radius - x, 0, x - (left + width - radius));
  const dy = Math.max(top + radius - y, 0, y - (top + height - radius));
  return dx * dx + dy * dy <= radius * radius;
}

function render(size) {
  const pixels = Buffer.alloc((size * 3 + 1) * size);
  const dark = [16, 21, 27], blue = [87, 154, 255];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let coverage = 0;
      for (const sy of [.25, .75]) for (const sx of [.25, .75]) {
        const dx = (x + sx) * 512 / size - 256, dy = (y + sy) * 512 / size - 256;
        const rx = cos * dx - sin * dy + 256, ry = sin * dx + cos * dy + 256;
        if (shapes.some(shape => inside(rx, ry, shape))) coverage += .25;
      }
      const start = y * (size * 3 + 1) + 1 + x * 3;
      for (let c = 0; c < 3; c++) pixels[start + c] = Math.round(dark[c] + (blue[c] - dark[c]) * coverage);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(new URL(`../static/${name}`, import.meta.url), render(size));
}
