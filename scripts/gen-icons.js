'use strict';

/**
 * gen-icons.js — build-time PNG icon generator for the Help Desk Auto-Refresh
 * Chrome/Edge (Manifest V3) extension.
 *
 * Produces three valid PNG files at icons/icon{16,48,128}.png — a solid blue
 * circle (#1a73e8, RGB 26,115,232) centered on a transparent RGBA canvas.
 *
 * Self-contained: uses only Node built-ins (zlib + Buffer). No npm deps, no
 * ImageMagick. Committed so the icons are reproducible from source.
 *
 * Run:  node scripts/gen-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BRAND_BLUE = { r: 26, g: 115, b: 232 }; // #1a73e8
const SIZES = [16, 48, 128];

const ICONS_DIR = path.resolve(__dirname, '..', 'icons');

// ---------------------------------------------------------------------------
// CRC32 — standard zlib CRC (poly 0xEDB88320, init 0xFFFFFFFF, final XOR 0xFFFFFFFF)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// PNG chunk helper: length(4 BE) + type(4) + data + crc(4 BE)
// CRC covers type + data.
// ---------------------------------------------------------------------------
function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// ---------------------------------------------------------------------------
// Build a raw (pre-deflate) RGBA pixel buffer for a solid blue circle on
// transparent background. Each scanline is prefixed by filter byte 0 (None).
// ---------------------------------------------------------------------------
function buildRawPixels(size) {
  const stride = 1 + size * 4; // filter byte + RGBA * size
  const raw = Buffer.alloc(stride * size);

  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const r = (size - 1) / 2;
  const r2 = r * r;

  for (let y = 0; y < size; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const inside = dx * dx + dy * dy <= r2;
      if (inside) {
        raw[px] = BRAND_BLUE.r;
        raw[px + 1] = BRAND_BLUE.g;
        raw[px + 2] = BRAND_BLUE.b;
        raw[px + 3] = 255; // opaque
      } else {
        raw[px] = 0;
        raw[px + 1] = 0;
        raw[px + 2] = 0;
        raw[px + 3] = 0; // transparent
      }
    }
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Assemble a complete PNG (signature + IHDR + IDAT + IEND) for the given size.
// ---------------------------------------------------------------------------
function buildPng(size) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR: width(4) height(4) bitDepth(1) colorType(1) compression(1) filter(1) interlace(1)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type 6 = RGBA
  ihdr[10] = 0; // compression method 0 (deflate)
  ihdr[11] = 0; // filter method 0
  ihdr[12] = 0; // interlace 0 (none)

  const raw = buildRawPixels(size);
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
  }

  for (const size of SIZES) {
    const png = buildPng(size);
    const file = path.join(ICONS_DIR, `icon${size}.png`);
    fs.writeFileSync(file, png);
    const bluePixels = countBluePixels(png, size);
    console.log(
      `wrote ${path.relative(process.cwd(), file)}  ` +
        `${png.length} bytes  ${size}x${size}  blue=${bluePixels}px`
    );
  }
  console.log('done.');
}

// Optional coverage stat (cheap re-parse) — purely informational.
function countBluePixels(png, size) {
  // Reparse IHDR to find IDAT start and inflate.
  let off = 8; // skip signature
  let width = 0,
    height = 0;
  let idatData = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    const data = png.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'IDAT') {
      idatData.push(data);
    }
    off += 12 + len; // len(4)+type(4)+data+crc(4)
  }
  const raw = zlib.inflateSync(Buffer.concat(idatData));
  const stride = 1 + width * 4;
  let blue = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * stride + 1 + x * 4;
      if (raw[p + 3] === 255) blue++;
    }
  }
  // Sanity: confirm inflate round-trip to expected raw size for this size.
  const expectedRaw = size * (1 + size * 4);
  if (raw.length !== expectedRaw) {
    throw new Error(`IDAT inflate mismatch for size ${size}: got ${raw.length}, expected ${expectedRaw}`);
  }
  return blue;
}

main();
