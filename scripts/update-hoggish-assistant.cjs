// Installs the newest tagged release of hoggish-assistant before every build
// (the `prebuild` script). package.json declares it as `#semver:*`, but the
// lockfile pins one commit, so a plain install would keep the old release.
// A network failure only warns: the build continues with the installed copy.
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const name = 'hoggish-assistant';

function installedVersion() {
  try {
    return JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

const spec = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies[name];
const before = installedVersion();

try {
  execFileSync(
    'npm',
    ['install', `${name}@${spec}`, '--no-save', '--no-audit', '--no-fund', '--ignore-scripts'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const after = installedVersion();
  console.log(`[${name}] ${before === after ? `up to date at ${after}` : `updated ${before ?? 'none'} -> ${after}`}`);
} catch {
  console.warn(`[${name}] could not fetch the latest release; building with ${before ?? 'no installed copy'}`);
}
