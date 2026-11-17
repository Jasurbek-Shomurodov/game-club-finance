// Draws the installed-app icons in public/icons from one SVG. Run by hand after
// changing the artwork: `node scripts/generate-app-icons.mjs`. The PNGs are
// committed; nothing runs this at build time.
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const GLYPH = `
  <g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/>
    <line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/>
    <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>
  </g>`;

/**
 * `radius` rounds the corners (0 for icons the system masks itself); `glyph`
 * is the share of the square the gamepad spans: maskable icons keep it inside
 * the central 60% safe zone.
 */
function icon(size, { radius, glyph }) {
  const scale = (size * glyph) / 24;
  const offset = (size - 24 * scale) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b63f0"/><stop offset="1" stop-color="#2440b8"/></linearGradient></defs>
    <rect width="${size}" height="${size}" rx="${size * radius}" fill="url(#g)"/>
    <g transform="translate(${offset} ${offset}) scale(${scale})">${GLYPH}</g>
  </svg>`);
}

const files = [
  ['app-192.png', 192, { radius: 0.22, glyph: 0.6 }],
  ['app-512.png', 512, { radius: 0.22, glyph: 0.6 }],
  ['app-maskable-512.png', 512, { radius: 0, glyph: 0.5 }],
  // iOS rounds the corners itself and shows transparency as black.
  ['apple-touch-icon.png', 180, { radius: 0, glyph: 0.58 }],
];

await mkdir('public/icons', { recursive: true });
for (const [name, size, shape] of files) {
  await sharp(icon(size, shape)).png({ compressionLevel: 9 }).toFile(`public/icons/${name}`);
  console.log(`public/icons/${name}`);
}
