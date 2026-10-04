/**
 * Static build for Vercel — copies the app shell into dist/.
 * API routes stay at repo root (Vercel serves /api separately).
 *
 * Single source of truth for the version: src/config.js → APP_VERSION.
 * The build stamps it into:
 *   - dist/sw.js            (CACHE_NAME → old caches are dropped on deploy)
 *   - dist/index.html etc.  (?v= on the stylesheet link → no stale CSS)
 */
import { cpSync, mkdirSync, existsSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const dist = join(root, 'dist');

const configSrc = readFileSync(join(root, 'src', 'config.js'), 'utf8');
const m = configSrc.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!m) {
  console.error('Could not read APP_VERSION from src/config.js');
  process.exit(1);
}
const VERSION = m[1];

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (pkg.version !== VERSION) {
  console.warn(`⚠ package.json version (${pkg.version}) ≠ APP_VERSION (${VERSION}) — update package.json`);
}

if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

function copy(src, dest) {
  if (!existsSync(src)) {
    console.warn('skip missing', src);
    return;
  }
  cpSync(src, dest, { recursive: true });
  console.log('copy', src, '→', dest);
}

for (const f of [
  'index.html', 'share.html', 'sw.js', 'manifest.json',
  'icon.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'
]) {
  copy(join(root, f), join(dist, f));
}
copy(join(root, 'css'), join(dist, 'css'));
copy(join(root, 'src'), join(dist, 'src'));

// Stamp version into the service worker
const swPath = join(dist, 'sw.js');
const sw = readFileSync(swPath, 'utf8');
if (!sw.includes('__APP_VERSION__')) {
  console.error('sw.js is missing the __APP_VERSION__ placeholder');
  process.exit(1);
}
writeFileSync(swPath, sw.replaceAll('__APP_VERSION__', VERSION), 'utf8');

// Cache-bust stylesheet links
for (const page of ['index.html', 'share.html']) {
  const p = join(dist, page);
  if (!existsSync(p)) continue;
  const html = readFileSync(p, 'utf8')
    .replace(/href="\/css\/style\.css(\?v=[^"]*)?"/g, `href="/css/style.css?v=${VERSION}"`);
  writeFileSync(p, html, 'utf8');
}

writeFileSync(join(dist, 'build-info.txt'), `version=${VERSION}\nbuiltAt=${new Date().toISOString()}\n`, 'utf8');
console.log(`Static build OK → dist/ (v${VERSION})`);
