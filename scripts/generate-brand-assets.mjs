import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../assets/images/', import.meta.url);
const publicRoot = new URL('../public/', import.meta.url);

function mark(stroke = '#79E2B3', secondary = '#82B5FF', background = 'none', rounded = false) {
  return `
    <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      ${background === 'none' ? '' : `<rect width="1024" height="1024" rx="${rounded ? 220 : 0}" fill="${background}"/>`}
      <path d="M172 768L355 280L538 768" fill="none" stroke="${stroke}" stroke-width="90" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M585 305H850M718 305V768" fill="none" stroke="${secondary}" stroke-width="90" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M262 586H493" fill="none" stroke="${stroke}" stroke-width="90" stroke-linecap="round"/>
      <path d="M493 586H718" fill="none" stroke="${secondary}" stroke-width="90" stroke-linecap="round"/>
    </svg>`;
}

async function write(name, svg, size) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(fileURLToPath(new URL(name, root)));
}

async function writePublic(name, svg, size) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(fileURLToPath(new URL(name, publicRoot)));
}

await mkdir(fileURLToPath(publicRoot), { recursive: true });

await Promise.all([
  write('icon.png', mark('#79E2B3', '#82B5FF', '#070A0C', true), 1024),
  write('splash-icon.png', mark(), 512),
  write('favicon.png', mark('#79E2B3', '#82B5FF', '#070A0C', true), 64),
  write('android-icon-foreground.png', mark(), 432),
  write('android-icon-monochrome.png', mark('#FFFFFF', '#FFFFFF'), 432),
  writePublic('pwa-192.png', mark('#79E2B3', '#82B5FF', '#070A0C', true), 192),
  writePublic('pwa-512.png', mark('#79E2B3', '#82B5FF', '#070A0C', true), 512),
  writePublic('pwa-maskable-512.png', mark('#79E2B3', '#82B5FF', '#070A0C'), 512),
  writePublic('apple-touch-icon.png', mark('#79E2B3', '#82B5FF', '#070A0C'), 180),
]);
