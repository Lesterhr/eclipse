/**
 * Erzeugt die App-Icons ohne Bildbibliothek: PNG von Hand, zlib bringt Node schon mit.
 *
 * Motiv: verdeckte Sonne — heller Kreis, aus dem ein dunkler Kreis eine Sichel schneidet.
 *
 * Aufruf: node tools/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'icons');
mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {(x:number,y:number)=>[number,number,number,number]} shader */
function writePNG(path, size, shader) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // Filtertyp "none"
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = shader(x, y);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
      raw[p++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  return png.length;
}

/** Weiche Kante über einen halben Pixel, damit die Kreise nicht ausfransen */
const smooth = (d, r) => Math.max(0, Math.min(1, r + 0.7 - d));

function shader(size) {
  const c = size / 2;
  const rSun = size * 0.3;
  const rMoon = size * 0.29;
  // Mond von oben rechts hereingeschoben: 88 % Bedeckung, wie an diesem Abend
  const mx = c + size * 0.115;
  const my = c - size * 0.085;
  return (x, y) => {
    const px = x + 0.5;
    const py = y + 0.5;
    const dSun = Math.hypot(px - c, py - c);
    const dMoon = Math.hypot(px - mx, py - my);

    // Hintergrund
    let r = 13;
    let g = 17;
    let b = 23;

    // Schwacher Hof um die Sonne
    const glow = Math.max(0, 1 - dSun / (rSun * 2.1)) ** 2.2;
    r += glow * 70;
    g += glow * 52;
    b += glow * 14;

    // Sonnenscheibe
    const inSun = smooth(dSun, rSun);
    r = r * (1 - inSun) + 255 * inSun;
    g = g * (1 - inSun) + 204 * inSun;
    b = b * (1 - inSun) + 85 * inSun;

    // Mond davor
    const inMoon = smooth(dMoon, rMoon);
    r = r * (1 - inMoon) + 13 * inMoon;
    g = g * (1 - inMoon) + 17 * inMoon;
    b = b * (1 - inMoon) + 23 * inMoon;

    return [Math.round(r), Math.round(g), Math.round(b), 255];
  };
}

for (const size of [192, 512]) {
  const bytes = writePNG(join(outDir, `icon-${size}.png`), size, shader(size));
  console.log(`icons/icon-${size}.png  ${(bytes / 1024).toFixed(1)} kB`);
}
