// Where the browser tests find the app and the test Supabase, and the accounts they sign in with. The accounts exist
// only inside e2e/fake-supabase.mjs for the length of a run; none is a real account. Ports differ from finance-app's
// (5155 / 54329) so both suites can run on one machine.
export const appUrl = process.env.E2E_APP_URL ?? 'http://localhost:5156';
export const supabaseUrl = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54330';
export const anonKey = 'e2e-anon-key';
export const serviceKey = 'sb_secret_e2e_only';

export const accounts = {
  owner: { id: '00000000-0000-4000-8000-0000000000a1', email: 'owner@example.test', password: 'e2e-owner-password', name: 'E2E Owner' },
  admin: { id: '00000000-0000-4000-8000-0000000000a2', email: 'admin@example.test', password: 'e2e-admin-password', name: 'E2E Admin' },
  viewer: { id: '00000000-0000-4000-8000-0000000000a3', email: 'viewer@example.test', password: 'e2e-viewer-password', name: 'E2E Viewer' },
};

/** The saved browser session of one role, written by global-setup.mjs. */
export const storageStatePath = (role) => `e2e/.auth/${role}.json`;
