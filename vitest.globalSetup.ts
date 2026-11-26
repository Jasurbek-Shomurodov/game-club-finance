// One directory per `vitest run` for the PGlite snapshots in src/lib/supabase/__tests__/snapshotDatabase.ts:
// the workers share it (and so build each database once), and it is deleted when the run ends.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'pglite-snapshots-'));
  process.env.PGLITE_SNAPSHOT_DIR = dir;
  return () => rmSync(dir, { recursive: true, force: true });
}
