/**
 * Module graph sanity check (runs before the static build).
 * Bundles src/main.js in memory with esbuild to catch, before deploy:
 *   - imports of names a module does not export
 *   - missing / misspelled module paths
 *   - assignments to imported bindings (must go through the owning module)
 * Output is discarded; the site itself is still served as plain ES modules.
 */
let esbuild;
try {
  esbuild = await import('esbuild');
} catch (_) {
  console.warn('⚠ esbuild not installed — skipping module check (run npm install)');
  process.exit(0);
}

try {
  await esbuild.build({
    entryPoints: ['src/main.js'],
    bundle: true,
    write: false,
    format: 'esm',
    logLevel: 'silent'
  });
  console.log('✓ module graph OK');
} catch (err) {
  console.error('✗ module graph check failed:');
  for (const e of err.errors || []) {
    const loc = e.location ? `${e.location.file}:${e.location.line}:${e.location.column} ` : '';
    console.error(`  ${loc}${e.text}`);
  }
  process.exit(1);
}
