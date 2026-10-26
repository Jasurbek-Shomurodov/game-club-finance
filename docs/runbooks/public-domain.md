# Public domain and admin subdomain

One Vercel deployment serves both sites, split by hostname in `src/proxy.ts`
through `src/lib/publicSite.ts`:

| Host | Shows |
|---|---|
| `pixelgaming.uz`, `www.pixelgaming.uz` | `/` is the brand page (`/brand/<PUBLIC_SITE_BRAND_SLUG>`); `/club/<slug>` and `/brand/<slug>` work; every other path redirects to `ADMIN_SITE_URL`. |
| `admin.pixelgaming.uz` | The admin app. Its root also shows the landing page; the dashboard is `/dashboard`. |
| `game-club-finance.vercel.app` | Also the admin app. Keep it attached: the Supabase daily-report cron (migrations 041/073) calls its `/api/cron/daily-finance-report`. |

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

Moving the daily-report cron off `game-club-finance.vercel.app` needs a new
migration that re-schedules it with the new URL; it is not required while
that address stays attached.
