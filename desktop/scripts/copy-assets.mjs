import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const app = resolve(root, 'webapp');
const out = resolve(root, 'desktop/src-tauri/dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const item of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons']) {
  await cp(resolve(app, item), resolve(out, item), { recursive: true });
}
console.log(`Prepared offline assets in ${out}`);
