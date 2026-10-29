# Public domain and admin subdomain

One Vercel deployment serves both sites, split by hostname in `src/proxy.ts`
through `src/lib/publicSite.ts`:

| Host | Shows |
|---|---|
| `pixelgaming.uz`, `www.pixelgaming.uz` | `/` is the brand page (`/brand/<PUBLIC_SITE_BRAND_SLUG>`); `/club/<slug>` and `/brand/<slug>` work; every other path redirects to `ADMIN_SITE_URL`. The public pages show no sign-in link. |
| `admin.pixelgaming.uz` | The admin app. Its root opens `/dashboard`, which sends a signed-out visitor to `/login`. The Supabase daily-report cron (migration 110) calls its `/api/cron/daily-finance-report`. |

## Caching and phone performance

The public pages render on every visit (language comes from the visitor's
cookie), but the database read behind them is cached for 60 seconds per
page address and shared by every visitor and language
(`src/lib/supabase/publicShowcase.ts`). Saving on the admin Public page or
in the game library calls `POST /api/showcase/refresh`, which clears that
cache so the change shows on the next visit. Club name and logo changes made
in Settings appear within the minute.

On phones and tablets (`(hover: none), (max-width: 767px)` in
`src/app/(public)/showcase.css`) the page drops live blurs, blend modes and
animations that repaint every frame. iOS Safari showed blank screens while
scrolling with them on. Write only the standard `backdrop-filter` in that
file: the CSS build adds the `-webkit-` copy, and writing both made it keep
only the prefixed one, which Chrome ignores.

`game-club-finance.vercel.app` is detached from the project and must stay
detached; nothing calls it any more.

## Setup after buying the domain

1. **Vercel → Project → Settings → Domains**: add `pixelgaming.uz`,
   `www.pixelgaming.uz` and `admin.pixelgaming.uz`. Enter the DNS records
   Vercel shows at the registrar (or in Cloudflare) and wait for
   "Valid Configuration" on all three.
2. **Vercel → Settings → Environment Variables** (Production):
   - `PUBLIC_SITE_HOSTS=pixelgaming.uz,www.pixelgaming.uz`
   - `PUBLIC_SITE_BRAND_SLUG=<the brand page address saved on Public page>`
   - `ADMIN_SITE_URL=https://admin.pixelgaming.uz`

   Redeploy so the proxy reads them.
3. **Supabase → Authentication → URL Configuration**: add
   `https://admin.pixelgaming.uz/auth/callback` to the redirect URLs. Google
   sign-in and password reset use the address the page was opened on. Optionally
   set the Site URL to `https://admin.pixelgaming.uz`.
4. Check: `https://pixelgaming.uz` shows the brand page without login,
   `https://pixelgaming.uz/reports` lands on the admin login, and signing in
   at `https://admin.pixelgaming.uz` works with Google and email.

Migration 110 moved the daily-report cron off `game-club-finance.vercel.app`.
Apply it before detaching that address, or the 08:00 report stops.
