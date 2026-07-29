/**
 * Generate the PNG app icons from scratch.
 *
 *   node tools/make-icons.mjs
 *
 * iOS needs a PNG for `apple-touch-icon` (it ignores SVG), and without one the
 * home-screen icon is a screenshot of the page. Rather than pull in a rasterizer
 * we draw the same piano glyph as icon.svg into a pixel buffer and write the PNG
 * by hand — Node's zlib is the only thing required, so this stays dependency free.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode an RGBA pixel buffer (size x size) as a PNG. */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // Filter type 0 on every scanline keeps the encoder trivial; zlib still
  // compresses these flat-colour icons to a few kilobytes.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const s = size / 512; // the SVG is authored on a 512 grid
  const put = (x, y, [r, g, b]) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  };
  const inRoundRect = (x, y, rx, ry, w, h, r) => {
    if (x < rx || y < ry || x >= rx + w || y >= ry + h) return false;
    const cx = Math.min(Math.max(x, rx + r), rx + w - r);
    const cy = Math.min(Math.max(y, ry + r), ry + h - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };

  const WHITE = [253, 251, 246];
  const DARK = [34, 23, 4];
  const SEP = [201, 169, 120];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRoundRect(x, y, 0, 0, size, size, 112 * s)) continue;
      // Background gradient, matching icon.svg's amber ramp.
      const t = (x * 0.4 + y) / (1.4 * size);
      put(x, y, [
        Math.round(247 + (208 - 247) * t),
        Math.round(198 + (130 - 198) * t),
        Math.round(92 + (31 - 92) * t),
      ]);
    }
  }

  const kx = 76 * s, ky = 150 * s, kw = 360 * s, kh = 212 * s;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inRoundRect(x, y, kx, ky, kw, kh, 16 * s)) put(x, y, WHITE);
    }
  }
  for (let i = 1; i <= 6; i++) {
    const x0 = Math.round(kx + (i * kw) / 7);
    for (let y = Math.round(ky + 8 * s); y < ky + kh - 8 * s; y++) {
      for (let x = x0 - Math.round(2.5 * s); x <= x0 + Math.round(2.5 * s); x++) put(x, y, SEP);
    }
  }
  for (const bx of [34, 86, 188]) {
    for (let y = Math.round(ky); y < ky + 126 * s; y++) {
      for (let x = Math.round(kx + bx * s); x < kx + (bx + 35) * s; x++) put(x, y, DARK);
    }
  }
  return px;
}

for (const size of [180, 512]) {
  const file = join(outDir, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, draw(size)));
  console.log("wrote", file);
}
