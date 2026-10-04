// Builds dist/goonscroller-<version>.zip with only the files the extension needs, ready to upload
// to the Chrome Web Store / Edge Add-ons. No dependencies: writes the zip format directly.
//   npm run package
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const INCLUDE = ['manifest.json', 'src', 'popup', 'icons'];

const files = [];
const walk = (rel) => {
  const abs = path.join(root, rel);
  if (statSync(abs).isDirectory()) for (const name of readdirSync(abs).sort()) walk(path.posix.join(rel, name));
  else files.push(rel);
};
INCLUDE.forEach(walk);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const locals = [];
const centrals = [];
let offset = 0;
for (const name of files) {
  const data = readFileSync(path.join(root, name));
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const nameBuf = Buffer.from(name);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4); // version needed
  head.writeUInt16LE(8, 8); // deflate
  head.writeUInt16LE(0x21, 12); // date: 1980-01-01, keeps builds reproducible
  head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(packed.length, 18);
  head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(nameBuf.length, 26);
  locals.push(head, nameBuf, packed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0x21, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);
  offset += head.length + nameBuf.length + packed.length;
}
const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

const { version } = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join('dist', `goonscroller-${version}.zip`);
writeFileSync(path.join(root, out), Buffer.concat([...locals, ...centrals, end]));
console.log(`${out}: ${files.length} files`);
