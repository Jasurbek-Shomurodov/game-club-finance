@AGENTS.md

# How work flows in this repo

The main session runs **Fable 5.2 (medium effort)** and acts as the **orchestrator**: it analyses every request, researches, designs, and hands the actual work to subagents. It does not write feature code itself except for trivial changes.

| Role | Agent | Model | Does |
|---|---|---|---|
| Orchestrator | main session | Fable 5.2 | Analysis, research, placement and design, plans, delegation, final report |
| Builder | `builder` | Opus 5.5 | Writes code, tests, translations and migration files from a plan. Never commits, pushes or touches a database |
| Reviewer | `reviewer` | Opus 5.5 | Reads the diff cold and reports bugs. Never edits |
| Shipper | `shipper` | Haiku 5.5 | Checks migrations, commits, pushes to `main` (the hooks run the gate and apply migrations), watches CI |
| Operator | `operator` | Sonnet 5.5 | Works outside the repo: Vercel, the Supabase dashboard, DNS, Telegram, Google Business Profile, the live site, through APIs, CLIs or Chrome. Never edits code or applies migrations |

## 1. Triage first

Decide the size of the request before doing anything:

- **Question / explanation / read-only** → answer directly. No subagents.
- **Trivial change** (copy fix, one-line bug, config tweak, ≤ ~20 lines in 1–2 files, no schema change) → make it yourself, then hand to `shipper`.
- **Feature or multi-file change** → full pipeline below.
- **Club data change** (prices, offers, zones) → a migration written by `builder`, shipped by `shipper`. Never by clicking through the admin UI.
- **Setup or a check outside the repo** (Vercel, Supabase dashboard, DNS, Telegram, Google, "is production up?") → `operator`. A single lookup you can do in one or two tool calls, do yourself.
- **`cr`, `qa`, `dr`** → the project skills in `.claude/skills/`; they are reviews of their own and do not go through this pipeline.

Don't run the full pipeline for something a few tool calls settle.

## 2. Full pipeline

1. **Research** (only what the task needs). Read the guide the "Read by task" table in `AGENTS.md` names for the area. For product features, look at how strong real-world apps solve it, then fit it to this app: one club owner on a phone, uz/ru/en, UZS, the club's business date.
2. **Place it.** Decide where the feature lives with `docs/agents/system-design.md` section 2 before designing anything else. A feature attached to the wrong page is the most expensive mistake in this app.
3. **Write the plan** to `docs/plans/<feature-slug>.md`. It must contain:
   - Goal and user flow
   - Placement: area, page, section, and what other pages link to it
   - Architecture: routes and API, components, where state lives, which `src/lib/calculations` functions are new or reused
   - Data model: tables, columns, constraints, RLS policies, indexes, RPCs, the migration(s) needed
   - Design rules: components from `PresentationFoundation`, tones, tappable targets (`detailLinks.ts`), skeletons, the three locales
   - Tests: which unit tests, and which `e2e/` specs change
   - A numbered list of **slices**: each slice is independently buildable, shippable, and leaves `main` working
   - Risks and open questions (ask the user about anything that changes the design before building)
4. **Per slice:**
   1. `builder` — prompt it with the plan path and the slice number. Don't retype the plan.
   2. `reviewer` — always for slices touching financial formulas, club scoping/RLS, migrations, auth, owner money, salaries, debts or the Telegram report. Otherwise use judgment. Give it the slice description only, not your reasoning.
   3. If the reviewer finds real issues → back to `builder` with the findings.
   4. `shipper` — tell it which slice, whether there is a migration, and the commit message summary.
   5. `operator` — only when the slice needs something outside the repo (an environment variable, a cron, a dashboard setting) or a check of production after the push.
5. **Report** to the user: what shipped (commits), what migrations ran, the CI result, what's left.

One writer at a time: never run two `builder`s on overlapping files, and never start a `builder` while a `shipper` is committing.

## 3. Hard rules (all agents)

- `AGENTS.md` is the law for code: the non-negotiable invariants, the implementation conventions and the verification section apply to every agent.
- Everything lands on `main`. No feature branches, no worktrees. Pushing to `main` deploys to **production** (`admin.pixelgaming.uz` and the public site).
- **Gate.** The builder runs `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` before handing back. The git hooks then run it again on exactly what is committed and pushed (`pre-commit`: typecheck, lint, coverage; `pre-push`: dependency audit, pending migrations, the browser suite). Never skip them with `--no-verify`. After every push `npm run ci:watch` must end green; a red "Project checks" run on `main` is fixed before anything else.
- **Migrations** are `migrations/NNN_snake_name.sql`, next number in sequence, written by `builder` together with the regenerated manifest (`npm run migrations:manifest`). They are applied only by `shipper`, and only through the push: the `pre-push` hook runs `scripts/db-migrate.sh` against production before the code goes out.
  - Non-destructive (new tables/columns/indexes/policies/functions, additive changes, inserts of new rows): ship.
  - Destructive (`DROP`, `TRUNCATE`, `DELETE`/`UPDATE` of existing rows, column type changes, renames, `NOT NULL` on existing columns, disabling RLS, replacing a financial RPC): **stop and ask the user** before the push. Because the hook applies migrations automatically, this check happens before `git push`, not after.
- Never commit secrets (`.env*` except `.env.example`), and never print one.
- **Secrets are entered by the user, never by an agent.** No agent types, pastes or echoes a password, API key, token or secret into a dashboard, CLI, URL or chat. When a secret is needed somewhere, stop and tell the user exactly where to put it.
- **Addresses:** production is `pixelgaming.uz` and `admin.pixelgaming.uz`; local is `http://localhost:3000` (admin at `/dashboard`). Local checks never call production.
- **Browser:** Google Chrome through the Claude in Chrome tools only, local or live. Never the built-in browser pane.
- **Git identity:** `origin` is `git@github-dangerhoggish:Jasurbek-Shomurodov/game-club-finance.git`, commits are authored with the repo's own `user.email`. If either has changed, restore it instead of pushing.
- **Outside-the-repo actions that cost money or cannot be undone** (buying, plan upgrades, deleting a project, domain or data, rotating keys) need the user's explicit yes first.
- Commit messages: imperative, describe the change (match existing history).
