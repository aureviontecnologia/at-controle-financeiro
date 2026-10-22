import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const root = new URL('../assets/images/', import.meta.url);

// Adaptive foregrounds use Android's 108 dp layer. The entire stroke stays
// inside the central 66 dp safe circle, including Samsung's circular mask.
function mark(stroke = '#EDF1F5', background = 'none', adaptive = false) {
  return `
    <svg width="1024" height="1024" viewBox="0 0 108 108" xmlns="http://www.w3.org/2000/svg">
      ${background === 'none' ? '' : `<rect width="108" height="108" fill="${background}"/>`}
      <g transform="translate(54 54) scale(${adaptive ? 1.8 : 2.2}) translate(-24 -24)">
        <path d="M31 13H22a5.5 5.5 0 0 0 0 11h4a5.5 5.5 0 0 1 0 11H17" fill="none" stroke="${stroke}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
    </svg>`;
}

async function write(name, svg, size) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(fileURLToPath(new URL(name, root)));
}

await Promise.all([
  write('icon.png', mark('#EDF1F5', '#0C1117'), 1024),
  write('splash-icon.png', mark(), 512),
  write('android-icon-foreground.png', mark('#EDF1F5', 'none', true), 432),
  write('android-icon-monochrome.png', mark('#FFFFFF', 'none', true), 432),
]);
