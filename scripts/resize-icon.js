'use strict';

/**
 * resize-icon.js — redimensiona icons/icon.png para os tamanhos 16/48/128.
 *
 * icon.png pode ter qualquer dimensão; fazemos CROP CENTRAL quadrado (menor
 * dimensão) e depois downscale por box-average (média de pixels) para cada
 * tamanho alvo. Mantém aspect ratio sem distorcer.
 *
 * Self-contained: só Node built-ins (fs, zlib, Buffer). Sem npm deps, sem
 * ImageMagick. Decoder PNG próprio (signature + IHDR + IDAT inflate + unfilter).
 *
 * Uso:  node scripts/resize-icon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC = path.resolve(__dirname, '..', 'icons', 'icon.png');
const SIZES = [16, 48, 128];

// ---------------------------------------------------------------------------
// CRC32 — mesma tabela do gen-icons.js
// ---------------------------------------------------------------------------
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
function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// ---------------------------------------------------------------------------
// PNG DECODE
// ---------------------------------------------------------------------------
function decodePng(buf) {
  // signature
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('not a PNG');

  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  let idat = Buffer.alloc(0);
  let hasPlte = false, plte = null, hasTrns = false, trns = null;

  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); off += 4;
    const type = buf.toString('ascii', off, off + 4); off += 4;
    const data = buf.subarray(off, off + len); off += len;
    off += 4; // CRC

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'PLTE') { hasPlte = true; plte = data; }
    else if (type === 'tRNS') { hasTrns = true; trns = data; }
    else if (type === 'IDAT') { idat = Buffer.concat([idat, data]); }
    else if (type === 'IEND') break;
  }

  if (bitDepth !== 8) throw new Error('only 8-bit depth supported, got ' + bitDepth);
  // Suporta RGBA (6), RGB (2), grayscale+alpha (4), grayscale (0), indexed (3).
  let channels, hasAlpha;
  if (colorType === 6) { channels = 4; hasAlpha = true; }
  else if (colorType === 2) { channels = 3; hasAlpha = false; }
  else if (colorType === 4) { channels = 2; hasAlpha = true; }
  else if (colorType === 0) { channels = 1; hasAlpha = false; }
  else if (colorType === 3) { channels = 1; hasAlpha = !!trns; }
  else throw new Error('unsupported color type ' + colorType);

  const raw = zlib.inflateSync(idat);
  const stride = 1 + width * channels;
  if (raw.length !== stride * height) throw new Error('IDAT size mismatch');

  // Unfilter (PNG spec: 5 filter types). out = RGBA Buffer, length w*h*4.
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride); // linha anterior (zeros p/ y=0)
  const cur = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    const ftype = raw[rowStart];
    const fb = raw.subarray(rowStart + 1, rowStart + stride);

    for (let x = 0; x < stride - 1; x++) {
      const Raw = fb[x];
      const Left = x >= channels ? cur[x - channels] : 0;
      const Up = prev[x];
      const UpLeft = x >= channels ? prev[x - channels] : 0;
      let v;
      switch (ftype) {
        case 0: v = Raw; break;                          // None
        case 1: v = (Raw + Left) & 0xff; break;          // Sub
        case 2: v = (Raw + Up) & 0xff; break;            // Up
        case 3: v = (Raw + ((Left + Up) >> 1)) & 0xff; break; // Average
        case 4: v = (Raw + paeth(Left, Up, UpLeft)) & 0xff; break; // Paeth
        default: throw new Error('bad filter type ' + ftype);
      }
      cur[x] = v;
    }

    // copia cur (sem filter byte) p/ out, normalizando p/ RGBA
    for (let x = 0; x < width; x++) {
      const si = x * channels;
      const di = (y * width + x) * 4;
      let r, g, b, a;
      if (colorType === 6) { r = cur[si]; g = cur[si+1]; b = cur[si+2]; a = cur[si+3]; }
      else if (colorType === 2) { r = cur[si]; g = cur[si+1]; b = cur[si+2]; a = 255; }
      else if (colorType === 4) { r = cur[si]; g = cur[si]; b = cur[si]; a = cur[si+1]; }
      else if (colorType === 0) { r = cur[si]; g = cur[si]; b = cur[si]; a = 255; }
      else { // indexed (3)
        const idx = cur[si];
        r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2];
        a = trns && idx < trns.length ? trns[idx] : 255;
      }
      out[di] = r; out[di+1] = g; out[di+2] = b; out[di+3] = a;
    }
    prev.set(cur);
  }
  return { width, height, data: out }; // data = RGBA, length w*h*4
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// ---------------------------------------------------------------------------
// CROP central quadrado
// ---------------------------------------------------------------------------
function cropSquare({ width, height, data }) {
  const side = Math.min(width, height);
  const ox = Math.floor((width - side) / 2);
  const oy = Math.floor((height - side) / 2);
  const out = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const si = ((oy + y) * width + (ox + x)) * 4;
      const di = (y * side + x) * 4;
      out[di] = data[si]; out[di+1] = data[si+1]; out[di+2] = data[si+2]; out[di+3] = data[si+3];
    }
  }
  return { width: side, height: side, data: out };
}

// ---------------------------------------------------------------------------
// Downscale por box-average (com pesos por alpha para transparência correta).
// src é quadrado (side×side). Pré-multiplica RGB pelo alpha p/ bordas suaves.
// ---------------------------------------------------------------------------
function downscale(src, size) {
  const side = src.width;
  const out = Buffer.alloc(size * size * 4);
  const ratio = side / size; // cada pixel de saída cobre 'ratio×ratio' pixels de entrada

  for (let oy = 0; oy < size; oy++) {
    for (let ox = 0; ox < size; ox++) {
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      const y0 = Math.floor(oy * ratio);
      const y1 = Math.floor((oy + 1) * ratio);
      const x0 = Math.floor(ox * ratio);
      const x1 = Math.floor((ox + 1) * ratio);
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const si = (sy * side + sx) * 4;
          const wa = src.data[si + 3];
          r += src.data[si] * wa;
          g += src.data[si + 1] * wa;
          b += src.data[si + 2] * wa;
          a += wa;
          wsum += wa;
        }
      }
      const di = (oy * size + ox) * 4;
      if (wsum > 0) {
        out[di]   = Math.round(r / wsum);
        out[di+1] = Math.round(g / wsum);
        out[di+2] = Math.round(b / wsum);
        out[di+3] = Math.round(a / ((y1 - y0) * (x1 - x0)));
      } else {
        out[di] = 0; out[di+1] = 0; out[di+2] = 0; out[di+3] = 0;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// PNG ENCODE (RGBA, color type 6)
// ---------------------------------------------------------------------------
function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = 1 + size * 4;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter None
    rgba.subarray(y * size * 4, (y + 1) * size * 4).copy(raw, y * stride + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
function main() {
  if (!fs.existsSync(SRC)) {
    console.error('source not found:', SRC);
    process.exit(1);
  }
  const src = decodePng(fs.readFileSync(SRC));
  console.log('source: %dx%d', src.width, src.height);

  const square = cropSquare(src);
  console.log('cropped to square: %dx%d', square.width, square.height);

  const dir = path.dirname(SRC);
  for (const size of SIZES) {
    const rgba = downscale(square, size);
    const png = encodePng(size, rgba);
    const out = path.join(dir, `icon${size}.png`);
    fs.writeFileSync(out, png);
    console.log('wrote %s (%d bytes)', out, png.length);
  }
  console.log('done.');
}

main();
