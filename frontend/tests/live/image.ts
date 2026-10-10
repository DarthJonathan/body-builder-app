import { deflateSync } from 'node:zlib';

/** Valid test pixels, generated locally so byte validation reaches the provider stub. */
export function tinyPNG(): Buffer {
  function chunk(type: string, data: Buffer): Buffer {
    const typeBytes = Buffer.from(type, 'ascii');
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([typeBytes, data])) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, typeBytes, data, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 64, 128, 192, 255]))),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
