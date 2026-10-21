import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const root = new URL('../assets/images/', import.meta.url);

function mark(stroke = '#F5F7F6', background = 'none', rounded = false) {
  return `
    <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      ${background === 'none' ? '' : `<rect width="1024" height="1024" rx="${rounded ? 220 : 0}" fill="${background}"/>`}
      <path d="M760 266H404C294 266 238 328 238 408S294 550 404 550H620C730 550 786 612 786 692S730 834 620 834H264" fill="none" stroke="${stroke}" stroke-width="82" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
}

async function write(name, svg, size) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(fileURLToPath(new URL(name, root)));
}

await Promise.all([
  write('icon.png', mark('#F5F7F6', '#090B0C', true), 1024),
  write('splash-icon.png', mark(), 512),
  write('android-icon-foreground.png', mark(), 432),
  write('android-icon-monochrome.png', mark('#FFFFFF'), 432),
]);
