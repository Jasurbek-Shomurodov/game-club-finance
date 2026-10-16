// A production build for the browser tests. NEXT_PUBLIC_* values are inlined at build time, so the build itself
// must point at the test Supabase; `next build` is called directly so the `prebuild` script (an npm install of
// hoggish-assistant) does not run. Every key from the local env files is blanked so no real service is reached.
import { spawnSync } from 'node:child_process';
import { blankedEnv } from './env.mjs';
import { anonKey, supabaseUrl } from './settings.mjs';

const result = spawnSync('npx', ['next', 'build', '--webpack'], {
  stdio: 'inherit',
  env: { ...process.env, ...blankedEnv(), NEXT_PUBLIC_SUPABASE_URL: supabaseUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey },
});
process.exit(result.status ?? 1);
