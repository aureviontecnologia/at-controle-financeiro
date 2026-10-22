import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const assets = new URL('../assets/images/', import.meta.url);
for (const name of ['android-icon-foreground.png', 'android-icon-monochrome.png']) {
  const { data, info } = await sharp(fileURLToPath(new URL(name, assets))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 432);
  assert.equal(info.height, 432);
  let visible = 0;
  let minX = 432, minY = 432, maxX = 0, maxY = 0;
  for (let y = 0; y < 432; y++) for (let x = 0; x < 432; x++) {
    if (data[(y * 432 + x) * 4 + 3] < 8) continue;
    visible++;
    // Android's central 66 dp safe circle, in a 108 dp adaptive layer.
    assert.ok(Math.hypot(x + 0.5 - 216, y + 0.5 - 216) < 132, `${name}: stroke outside safe circle`);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  assert.ok(visible > 1000, `${name}: empty icon`);
  assert.ok(Math.abs((minX + maxX + 1) / 2 - 216) < 2, `${name}: horizontally off-center`);
  assert.ok(Math.abs((minY + maxY + 1) / 2 - 216) < 2, `${name}: vertically off-center`);
}
console.log('Adaptive icons: centered and contained in the 66 dp safe circle.');

if (process.argv[2]) {
  // Preview only: simulate a round launcher mask, never bake it into the asset.
  const foreground = await sharp(fileURLToPath(new URL('android-icon-foreground.png', assets))).resize(512, 512).toBuffer();
  const round = Buffer.from('<svg width="512" height="512"><circle cx="256" cy="256" r="252" fill="white"/></svg>');
  const composite = await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0C1117' } }).composite([{ input: foreground }]).png().toBuffer();
  await sharp(composite).composite([{ input: round, blend: 'dest-in' }]).png().toFile(process.argv[2]);
}
