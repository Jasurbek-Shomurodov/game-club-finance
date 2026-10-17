// Regenerates src/lib/supabase/migrationManifest.json from migrations/.
// Run after adding a migration: npm run migrations:manifest
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMigrationManifest } from '../src/lib/supabase/migrationProbes';

const dir = resolve(__dirname, '../migrations');
const sources = readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()
  .map((file) => ({ file, sql: readFileSync(resolve(dir, file), 'utf8') }));
const manifest = buildMigrationManifest(sources);
writeFileSync(resolve(__dirname, '../src/lib/supabase/migrationManifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${manifest.length} migrations, ${manifest.reduce((n, m) => n + m.probes.length, 0)} probes.`);
