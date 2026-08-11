'use strict';

/**
 * verify-icons.js — strict validator for the generated PNGs.
 * Run: node scripts/verify-icons.js
 *
 * For each of icons/icon{16,48,128}.png:
 *   - confirm the 8-byte PNG signature
 *   - parse IHDR and print width / height / bit depth / color type
 *   - recompute CRC32 of type+data for every chunk and compare to stored CRC
 *   - inflate IDAT and confirm the raw length equals size * (1 + size*4)
 *   - confirm the stored raw pixel layout (filter byte 0 per scanline)
 *
 * Exits non-zero on any failure.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SIZES = [16, 48, 128];
const ICONS_DIR = path.resolve(__dirname, '..', 'icons');

let failures = 0;

for (const size of SIZES) {
  const file = path.join(ICONS_DIR, `icon${size}.png`);
  const label = path.relative(process.cwd(), file);
  const png = fs.readFileSync(file);

  console.log(`\n=== ${label}  (${png.length} bytes) ===`);

  // 1. Signature
  const sig = png.slice(0, 8);
  if (sig.equals(PNG_SIG)) {
    console.log(`  signature: OK  (89 50 4E 47 0D 0A 1A 0A)`);
  } else {
    console.log(`  signature: FAIL  got ${sig.toString('hex')}`);
    failures++;
  }

  // 2. Walk chunks
  let off = 8;
  let sawIhdr = false,
    sawIdat = false,
    sawIend = false;
  let idatParts = [];
  let parsedW = 0,
    parsedH = 0,
    bitDepth = 0,
    colorType = 0;

  while (off < png.length) {
    if (off + 8 > png.length) {
      console.log(`  FAIL: truncated chunk header at offset ${off}`);
      failures++;
      break;
    }
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > png.length) {
      console.log(`  FAIL: chunk ${type} runs past EOF`);
      failures++;
      break;
    }
    const data = png.slice(dataStart, dataEnd);
    const storedCrc = png.readUInt32BE(dataEnd);
    const calcCrc = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]));
    const crcOk = storedCrc === calcCrc;

    if (type === 'IHDR') {
      sawIhdr = true;
      parsedW = data.readUInt32BE(0);
      parsedH = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      console.log(
        `  IHDR: ${parsedW}x${parsedH}  bitDepth=${bitDepth}  colorType=${colorType}  ` +
          `compression=${data[10]} filter=${data[11]} interlace=${data[12]}  CRC=${crcOk ? 'OK' : 'FAIL'}`
      );
      if (parsedW !== size || parsedH !== size) {
        console.log(`    FAIL: expected ${size}x${size}`);
        failures++;
      }
      if (bitDepth !== 8 || colorType !== 6) {
        console.log(`    FAIL: expected 8-bit RGBA (colorType 6)`);
        failures++;
      }
    } else if (type === 'IDAT') {
      sawIdat = true;
      idatParts.push(data);
      console.log(`  IDAT: ${len} bytes  CRC=${crcOk ? 'OK' : 'FAIL'}`);
    } else if (type === 'IEND') {
      sawIend = true;
      console.log(`  IEND: CRC=${crcOk ? 'OK' : 'FAIL'}`);
    } else {
      console.log(`  ${type}: ${len} bytes  CRC=${crcOk ? 'OK' : 'FAIL'}`);
    }
    if (!crcOk) failures++;
    off = dataEnd + 4;
  }

  if (!(sawIhdr && sawIdat && sawIend)) {
    console.log(`  FAIL: missing required chunk (IHDR=${sawIhdr} IDAT=${sawIdat} IEND=${sawIend})`);
    failures++;
    continue;
  }

  // 3. Inflate IDAT and confirm raw size = size * (1 + size*4)
  const raw = zlib.inflateSync(Buffer.concat(idatParts));
  const expectedRaw = size * (1 + size * 4);
  const sizeOk = raw.length === expectedRaw;
  console.log(`  IDAT inflate: raw=${raw.length}  expected=${expectedRaw}  ${sizeOk ? 'OK' : 'FAIL'}`);
  if (!sizeOk) failures++;

  // 4. Confirm every scanline starts with filter byte 0 and sample a known
  //    blue pixel at the center vs transparent corner.
  const stride = 1 + parsedW * 4;
  const center = (Math.floor(parsedH / 2) * stride) + 1 + (Math.floor(parsedW / 2) * 4);
  const corner = 1; // (0,0)
  const filtersOk = raw.every((_, i) => (i % stride === 0 ? raw[i] === 0 : true));
  console.log(`  scanline filters: ${filtersOk ? 'all 0 (None)' : 'NONZERO FOUND'}`);
  if (!filtersOk) failures++;
  console.log(
    `  center pixel: rgba(${raw[center]},${raw[center + 1]},${raw[center + 2]},${raw[center + 3]})  ` +
      `(expect 26,115,232,255)`
  );
  console.log(`  corner  pixel: alpha=${raw[corner + 3]}  (expect 0 transparent)`);
  if (
    raw[center] !== 26 ||
    raw[center + 1] !== 115 ||
    raw[center + 2] !== 232 ||
    raw[center + 3] !== 255 ||
    raw[corner + 3] !== 0
  ) {
    console.log(`    FAIL: pixel values off`);
    failures++;
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
