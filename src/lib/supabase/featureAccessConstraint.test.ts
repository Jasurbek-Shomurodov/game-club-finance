import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURE_DEFINITIONS } from '@/lib/permissions';

const MIGRATIONS = join(process.cwd(), 'migrations');

describe('club_memberships_feature_access_valid', () => {
  it('allows exactly the feature keys the app can grant', () => {
    const latest = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
      .filter((sql) => sql.includes('add constraint club_memberships_feature_access_valid'))
      .at(-1);

    const list = /feature_access <@ array\[([\s\S]*?)\]::text\[\]/.exec(latest ?? '')?.[1] ?? '';
    const allowed = [...list.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort();

    expect(allowed).toEqual(FEATURE_DEFINITIONS.map((feature) => feature.key).sort());
  });
});
