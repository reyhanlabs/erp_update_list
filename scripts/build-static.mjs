/**
 * Static build for Vercel — copies app shell into dist/
 * so Output Directory=dist still has index.html, /css, /src.
 * API routes stay at repo root (not copied).
 */
import { cpSync, mkdirSync, existsSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const dist = join(root, 'dist');

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

// Core shell
copy(join(root, 'index.html'), join(dist, 'index.html'));
copy(join(root, 'sw.js'), join(dist, 'sw.js'));
copy(join(root, 'manifest.json'), join(dist, 'manifest.json'));
copy(join(root, 'icon.png'), join(dist, 'icon.png'));
copy(join(root, 'css'), join(dist, 'css'));
copy(join(root, 'src'), join(dist, 'src'));

// public/ overlays (manifest, sw, style fallbacks)
const pub = join(root, 'public');
if (existsSync(pub)) {
  for (const name of ['manifest.json', 'sw.js', 'icon.png']) {
    const p = join(pub, name);
    if (existsSync(p)) copy(p, join(dist, name));
  }
}

// Marker for debugging deploys
writeFileSync(join(dist, 'build-info.txt'), `builtAt=${new Date().toISOString()}\n`, 'utf8');
console.log('Static build OK → dist/');
