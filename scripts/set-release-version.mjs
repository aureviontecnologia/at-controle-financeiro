import { readFile, writeFile } from 'node:fs/promises';

const version = String(process.argv[2] ?? '').replace(/^v/i, '');
const versionCode = Number.parseInt(process.argv[3] ?? '', 10);

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Versão inválida: ${version || '(vazia)'}. Use x.y.z.`);
}
if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2_100_000_000) {
  throw new Error(`versionCode inválido: ${process.argv[3] ?? '(vazio)'}.`);
}

const path = new URL('../app.json', import.meta.url);
const config = JSON.parse(await readFile(path, 'utf8'));
config.expo.version = version;
config.expo.android.versionCode = versionCode;
await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);

console.log(`Preparado A&T ${version} (${versionCode}).`);
