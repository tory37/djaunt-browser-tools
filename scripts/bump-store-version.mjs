// Bumps an extension's manifest.json version (patch by default) and rebuilds both
// its zips, so a Chrome Web Store update is a single command instead of a manual
// edit-then-remember-to-rebuild dance. Usage:
//
//   node scripts/bump-store-version.mjs host-swap           # 2.0.1 -> 2.0.2
//   node scripts/bump-store-version.mjs host-swap minor      # 2.0.1 -> 2.1.0
//   node scripts/bump-store-version.mjs host-swap major      # 2.0.1 -> 3.0.0
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const [, , ext, part = 'patch'] = process.argv;
if (!ext) {
  console.error('Usage: node scripts/bump-store-version.mjs <extension> [patch|minor|major]');
  process.exit(1);
}
if (!['patch', 'minor', 'major'].includes(part)) {
  console.error(`Unknown version part "${part}" — use patch, minor, or major.`);
  process.exit(1);
}

const manifestPath = path.join(root, ext, 'manifest.json');
const raw = await readFile(manifestPath, 'utf8');
const manifest = JSON.parse(raw);

const [major, minor, patch] = manifest.version.split('.').map(Number);
const next =
  part === 'major' ? `${major + 1}.0.0`
  : part === 'minor' ? `${major}.${minor + 1}.0`
  : `${major}.${minor}.${patch + 1}`;

manifest.version = next;
// Preserve key order and trailing newline rather than re-serializing from scratch.
const updated = raw.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${next}"`);
await writeFile(manifestPath, updated);
console.log(`${ext}: ${major}.${minor}.${patch} -> ${next}`);

execFileSync(path.join(root, 'scripts', 'build-zips.sh'), [], { stdio: 'inherit' });
execFileSync(path.join(root, 'scripts', 'build-store-zips.sh'), [], { stdio: 'inherit' });

console.log(`\nDone. Upload store-zips/${ext}-${next}.zip to the ${ext} listing's Package tab.`);
