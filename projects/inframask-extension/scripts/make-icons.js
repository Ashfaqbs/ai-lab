// Generates the toolbar icon as real PNGs with no external deps (no image library, no
// pre-made art asset) - a blue circle with a white padlock, drawn pixel-by-pixel from plain
// geometry so the same formula scales cleanly across all three required sizes.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// pixelAt(x, y, size) -> [r, g, b, a] (a = 0 for transparent)
function makePng(size, pixelAt) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowLen = size * 4;
  const raw = Buffer.alloc((rowLen + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (rowLen + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y, size);
      const off = rowStart + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BRAND_BLUE = [37, 99, 235, 255]; // #2563eb
const WHITE = [255, 255, 255, 255];
const TRANSPARENT = [0, 0, 0, 0];

function lockIconPixel(x, y, size) {
  const cx = size / 2;
  const cy = size / 2;

  // Outer badge: filled circle, brand blue. Anything outside it is transparent so the
  // icon reads cleanly against any browser toolbar theme (light or dark).
  const dx = x - cx;
  const dy = y - cy;
  const outerRadius = size * 0.48;
  if (dx * dx + dy * dy > outerRadius * outerRadius) return TRANSPARENT;

  // Padlock body: a white rounded rectangle in the lower half of the badge.
  const bodyHalfW = size * 0.17;
  const bodyTop = size * 0.52;
  const bodyBottom = size * 0.80;
  const inBody = x >= cx - bodyHalfW && x <= cx + bodyHalfW && y >= bodyTop && y <= bodyBottom;

  // Shackle: the upper half of a ring (an arc), sitting just above the body - the classic
  // padlock silhouette, drawn as an annulus (ring) clipped to its top half.
  const shackleCy = bodyTop;
  const shackleOuter = size * 0.18;
  const shackleInner = size * 0.105;
  const sdx = x - cx;
  const sdy = y - shackleCy;
  const dist = Math.sqrt(sdx * sdx + sdy * sdy);
  const inShackle = dist <= shackleOuter && dist >= shackleInner && sdy <= size * 0.02;

  return inBody || inShackle ? WHITE : BRAND_BLUE;
}

const outDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

[16, 48, 128].forEach((size) => {
  const buf = makePng(size, lockIconPixel);
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), buf);
  console.log(`wrote icon${size}.png (${buf.length} bytes)`);
});
