# Nightly database backup

A GitHub Actions workflow (`.github/workflows/db-backup.yml`) dumps the Supabase
`public` and `auth` schemas every morning at 01:00 UTC (06:00 Asia/Tashkent),
encrypts the dump with [age](https://github.com/FiloSottile/age), uploads it to a
Cloudflare R2 bucket under `game-club-finance/db-backups/`, and keeps only the
newest 14 dumps in that prefix (`BACKUP_KEEP`), deleting older ones. Manual runs
count toward the 14. GitHub may start scheduled runs a few minutes late.

The first successful dump of each UTC month is also stored under
`game-club-finance/db-backups/monthly/`, and the newest 24 monthly copies are
kept (`BACKUP_KEEP_MONTHLY`). Daily pruning never deletes monthly copies, so a
mistake noticed after two weeks can still be undone from an earlier month.

The job is pinned to `ubuntu-24.04` rather than `ubuntu-latest`: it installs
`pg_dump` 17 from the PostgreSQL apt repository by Ubuntu codename, which may
not support a new Ubuntu release right away. Move the pin only after confirming
apt.postgresql.org publishes packages for the newer codename.

## One-time setup

1. **age key pair.** Run `age-keygen -o age-key.txt`. The public key (`age1...`)
   goes into GitHub; keep `age-key.txt` in a password manager and nowhere else.
   Without it the backups cannot be read. Reusing the personal-finance key pair
   is fine.
2. **R2 bucket.** Create a private bucket (or reuse an existing one; the
   `game-club-finance/` prefix keeps dumps and pruning separate), then an R2 API
   token with Object Read & Write limited to that bucket. Note the account ID.
3. **Supabase connection string.** Project Settings → Database → Connection
   string → Session pooler (the direct host is IPv6-only and GitHub runners
   cannot reach it). Use this club project's string, not another app's.
4. **GitHub secrets** (Repo → Settings → Secrets and variables → Actions):
   `SUPABASE_DB_URL`, `AGE_PUBLIC_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Optional failure alerts:
   `TELEGRAM_BOT_TOKEN` and `BACKUP_ALERT_CHAT_ID`.
5. Run the workflow once from the Actions tab (Run workflow) and confirm a file
   appears in the bucket.

The dump keeps grants and revokes so a restore cannot reopen access the
migrations closed. Never commit these values or copy them into `.env.example`, fixtures, or logs.

## What a backup contains

| Included | Not included (recreate after a restore) |
|---|---|
| Every `public` table, row, function, policy, trigger, and grant | Supabase Cron jobs (`scripts/restore-cron-jobs.sql`) |
| Sign-in accounts: `auth.users` and `auth.identities` | Vault secrets, API keys, Auth settings, Vercel variables |
| | Active sessions: everyone signs in again with the same email and password |

## Restore after losing the database

Restore into a **new, empty** Supabase project. `db-restore.sh` refuses a target
that already has tables in `public` or users in `auth`, so it cannot overwrite a
live database. You need the age private key, the Cloudflare account, and Vercel.

1. **New project.** Create a Supabase project (same region and Postgres 17).
   In Database → Extensions, enable `pg_cron` and `pg_net`.
2. **Download** the newest file from R2: your bucket →
   `game-club-finance/db-backups/` (older months are under `monthly/`).
3. **Restore** (needs `age` and Postgres 17 client tools, `brew install age postgresql@17`).
   Use the new project's Session pooler string:

   ```bash
   AGE_IDENTITY_FILE=age-key.txt scripts/db-restore.sh db-2026-10-02T010000Z.dump.age "postgresql://new-project-url"
   ```

   It loads accounts first, then all club data, policies, functions, grants, and
   the sign-up trigger, each step all-or-nothing. Supabase's default grants are
   paused during the load so revoked access stays revoked.
4. **Check** the result when the old database is still reachable:

   ```bash
   scripts/db-compare.sh "postgresql://old-url" "postgresql://new-project-url"
   ```

   It prints only counts and schema metadata. Row-count differences are expected
   for tables written after the backup ran; grant, policy, or trigger differences
   are not.
5. **Cron and Vault.** Create the Vault secret from the
   [Telegram report runbook](telegram-report.md), then run
   `scripts/restore-cron-jobs.sql` in the SQL editor.
6. **Auth settings.** Set the Site URL, redirect URLs, and any sign-in providers
   and email templates to match the old project.
7. **Point the app at it.** In Vercel, update `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`, then
   redeploy. Update the `SUPABASE_DB_URL` GitHub secret so backups follow.

## Practice restore

Run steps 1–4 against a throwaway project after any change to these scripts and
at least once a year, then delete the project. Steps 5–7 are only for a real
recovery. A local rehearsal against a Supabase-shaped Postgres 17 with every
migration applied restored all tables, functions, policies, grants, and the
`auth.users` trigger with no differences.

## Notes

- GitHub pauses scheduled workflows in public repositories after 60 days without
  repository activity. The workflow's `keepalive` job re-enables itself on every
  run to reset that timer. If the Actions tab ever shows the workflow disabled,
  enable it there and run it once manually.
- Storage buckets are not included. Only the public `showcase` bucket (098) holds
  files: the club page's cover images, which owners can upload again.
- Rotating the age key does not re-encrypt old dumps; keep old private keys.
- Dumps made before 2026-10-01 omitted grants; do not restore those.
