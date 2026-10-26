import { getTranslations } from 'next-intl/server';
import { ArrowUpRight, BadgePercent, Clock, Cpu, Gamepad2, Layers, MapPin, Monitor, MonitorPlay, Navigation, Phone, Wallet, Zap } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { brandInsights, clubInsights, mapLinks, openStatus, telHref, type PublicBrand, type PublicShowcase } from '@/lib/showcase';
import { ClubTabs } from './ClubTabs';
import { CountUp } from './CountUp';
import { MapChooser } from './MapChooser';
import { ShimmerImage } from './ShimmerImage';
import { ContactButtons, ContactList, GameGrid, HeroBackdrop, Marquee, OfferGrid, SectionTitle, ZoneGrid, riseDelay, type Stat } from './ShowcaseParts';
import { ShowcaseFooter } from './ShowcaseFooter';
import { ShowcaseNav } from './ShowcaseNav';

const CLUBS_ANCHOR = 'clubs';

/** The public page of a chain of clubs: one overall experience and a tab per club. */
export async function BrandView({ brand }: { brand: PublicBrand }) {
  const t = await getTranslations('publicShowcase');
  const tc = await getTranslations('common');
  const totals = brandInsights(brand);
  const allTitles = [...new Map(brand.clubs.flatMap((club) => club.games).map((game) => [game.title.trim().toLowerCase(), game.title])).values()];

  const stats = ([
    { value: <CountUp value={totals.clubCount} />, label: t('statClubs') },
    totals.pcCount > 0 ? { value: <CountUp value={totals.pcCount} />, label: t('statPcs') } : null,
    totals.consoleCount > 0 ? { value: <CountUp value={totals.consoleCount} />, label: t('statConsoles') } : null,
    totals.gameCount > 0 ? { value: <CountUp value={totals.gameCount} />, label: t('statGames') } : null,
    totals.minPrice !== null
      ? { value: <><CountUp value={totals.minPrice} format="grouped" /><span className="ml-1 text-xs font-semibold text-white/50 sm:text-base">{tc('currency')}</span></>, label: t('statFromPrice') }
      : null,
  ] as Array<Stat | null>).filter((stat): stat is Stat => stat !== null);

  const navLinks = [
    { href: '#locations', label: t('navLocations') },
    { href: `#${CLUBS_ANCHOR}`, label: t('navClubs') },
  ];
  const cta = brand.telegram_url ? { href: brand.telegram_url, label: t('bookTelegram') } : null;
  // Rendered per request, so "open now" reflects the visit.
  const now = new Date();

  return (
    <div id="top" className="sc-root relative min-h-screen">
      <ShowcaseNav clubName={brand.name} links={navLinks} cta={cta} />

      {/* ---------- First screen: who we are, then every club with what visitors need ---------- */}
      <section className="relative isolate overflow-hidden pb-14 pt-24 sm:pt-28">
        <HeroBackdrop imageUrl={brand.hero_image_url ?? brand.clubs.find((club) => club.hero_image_url)?.hero_image_url ?? null} />
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="sc-rise sc-glass mb-4 inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 text-sm font-medium text-white/80" style={riseDelay(0.05)}>
                <span className="sc-pulse-dot h-2 w-2 rounded-full bg-lime-400" aria-hidden="true" />
                {t('clubsAcrossCity', { count: totals.clubCount })}
              </p>
              <h1 className="sc-rise sc-display text-[2.4rem] font-black leading-[1.02] text-white sm:text-6xl lg:text-7xl" style={riseDelay(0.12)}>
                <span className="sc-shine-text sc-gradient-text" data-text={brand.name}>{brand.name}</span>
              </h1>
              <p className="sc-rise mt-4 line-clamp-3 max-w-2xl text-base leading-7 text-white/70 sm:line-clamp-none" style={riseDelay(0.22)}>
                {brand.tagline ?? t('defaultTagline')}
              </p>
            </div>
            <dl className="sc-rise -mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 lg:max-w-md lg:justify-end" style={riseDelay(0.3)}>
              {stats.map((stat) => (
                <div key={stat.label} className="sc-glass flex shrink-0 flex-col rounded-2xl px-4 py-2.5">
                  <dt className="order-2 text-[10px] font-semibold uppercase tracking-wider text-white/50">{stat.label}</dt>
                  <dd className="sc-display order-1 whitespace-nowrap text-lg font-bold text-white">{stat.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <ul id="locations" className={`mt-8 grid scroll-mt-20 gap-4 ${brand.clubs.length === 1 ? 'max-w-xl' : brand.clubs.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3'}`}>
            {brand.clubs.map((club, index) => (
              <li key={club.slug} className="sc-rise" style={riseDelay(0.38 + index * 0.08)}>
                <QuickClubCard club={club} now={now} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Marquee items={allTitles} />

      {/* ---------- One club at a time ---------- */}
      <section id={CLUBS_ANCHOR} className="relative scroll-mt-16 px-4 pb-24 pt-8 sm:px-6 lg:px-8">
        <div className="relative mx-auto max-w-7xl">
          <SectionTitle eyebrow={t('clubsEyebrow')} title={t('clubsTitle')} description={t('clubsDescription')} />
          <ClubTabs
            anchorId={CLUBS_ANCHOR}
            tabs={brand.clubs.map((club) => ({
              id: club.slug,
              label: club.club_name,
              meta: club.address ?? undefined,
            }))}
          >
            {brand.clubs.map((club) => <ClubPanel key={club.slug} club={club} />)}
          </ClubTabs>
        </div>
      </section>

      <ShowcaseFooter
        name={brand.name}
        logoUrl={brand.clubs.find((club) => club.logo_url)?.logo_url ?? null}
        description={brand.tagline}
        hours={brand.opening_hours}
        phone={brand.phone ?? brand.clubs.find((club) => club.phone)?.phone ?? null}
        email={brand.email}
        socials={{ telegram: brand.telegram_url, instagram: brand.instagram_url, youtube: brand.youtube_url }}
        pages={[
          { href: '#top', label: t('footerHome') },
          { href: '#locations', label: t('navLocations') },
          { href: `#${CLUBS_ANCHOR}`, label: t('navClubs') },
        ]}
        help={[
          { href: '#locations', label: t('howToFind') },
          ...(brand.telegram_url ? [{ href: brand.telegram_url, label: t('bookTelegram'), external: true }] : []),
          { href: '/login', label: t('footerStaffLogin') },
        ]}
        locations={brand.clubs.flatMap((club) => (club.address ? [{ label: club.club_name, clubName: club.club_name, address: club.address }] : []))}
      />
    </div>
  );
}

async function QuickClubCard({ club, now }: { club: PublicShowcase; now: Date }) {
  const t = await getTranslations('publicShowcase');
  const tc = await getTranslations('common');
  const insights = clubInsights(club);
  const status = openStatus(club.opening_hours, now);
  const maps = mapLinks(club);
  const phone = telHref(club.phone);
  const image = club.hero_image_url ?? club.zones.find((zone) => zone.image_url)?.image_url ?? null;
  const chip = 'inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-semibold text-white/80 ring-1 ring-white/10';
  const action = 'sc-glass inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300';

  return (
    <article className="sc-location flex h-full flex-col overflow-hidden rounded-3xl bg-[#0b0b16]/90 ring-1 ring-white/10 backdrop-blur">
      <div className="relative h-32 overflow-hidden sm:h-40">
        <span className="sc-location-media absolute inset-0 block">
          {image ? (
            <ShimmerImage src={image} alt="" priority />
          ) : (
            <span className="absolute inset-0 block bg-[radial-gradient(circle_at_25%_25%,rgba(139,92,246,0.55),transparent_60%),radial-gradient(circle_at_80%_75%,rgba(34,211,238,0.4),transparent_55%)]" />
          )}
        </span>
        <span className="absolute inset-0 bg-gradient-to-t from-[#0b0b16] via-[#0b0b16]/30 to-transparent" />
        {club.logo_url && (
          // Owner-supplied links may point at any host, so next/image's allow-list does not fit.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={club.logo_url} alt="" className="absolute bottom-3 left-4 h-12 w-12 rounded-full object-cover ring-2 ring-white/20" />
        )}
        {status && (
          <span className={`absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold backdrop-blur ${status === 'open' ? 'bg-lime-400/15 text-lime-200 ring-1 ring-lime-300/40' : 'bg-black/40 text-white/70 ring-1 ring-white/15'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${status === 'open' ? 'sc-pulse-dot bg-lime-400' : 'bg-white/50'}`} aria-hidden="true" />
            {status === 'open' ? t('openNow') : t('closedNow')}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5 pt-3">
        <h2 className="sc-display text-xl font-bold text-white sm:text-2xl">{club.club_name}</h2>
        <div className="space-y-1.5 text-sm text-white/75">
          {club.address && (
            <p className="flex items-start gap-2">
              <MapPin size={15} className="mt-0.5 shrink-0 text-fuchsia-300" aria-hidden="true" />
              {maps ? (
                <MapChooser address={club.address} links={maps} labels={{ title: t('mapChooserTitle'), yandex: t('mapYandex'), google: t('mapGoogle') }} />
              ) : club.address}
            </p>
          )}
          {club.opening_hours && (
            <p className="flex items-center gap-2">
              <Clock size={15} className="shrink-0 text-cyan-300" aria-hidden="true" /> {club.opening_hours}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {insights.minPrice !== null && (
            <span className={chip}><Wallet size={13} aria-hidden="true" /> {t('fromPrice', { price: `${formatCurrency(insights.minPrice)} ${tc('currency')}` })}</span>
          )}
          {insights.pcCount > 0 && <span className={chip}><Monitor size={13} aria-hidden="true" /> {t('pcCount', { count: insights.pcCount })}</span>}
          {insights.consoleCount > 0 && <span className={chip}><Gamepad2 size={13} aria-hidden="true" /> {t('consoleCount', { count: insights.consoleCount })}</span>}
        </div>
        <div className="mt-auto flex gap-2 pt-2">
          <a href={`#club-${club.slug}`} className="sc-cta inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-white">
            {t('details')} <ArrowUpRight size={15} aria-hidden="true" />
          </a>
          {club.address && maps && (
            <span className="flex flex-1">
              <MapChooser
                address={club.address}
                links={maps}
                labels={{ title: t('mapChooserTitle'), yandex: t('mapYandex'), google: t('mapGoogle') }}
                triggerClassName={`${action} w-full`}
                trigger={<><Navigation size={15} aria-hidden="true" /> {t('route')}</>}
              />
            </span>
          )}
          {phone && (
            <a href={phone} className={action} aria-label={`${t('call')}: ${club.phone}`}>
              <Phone size={15} aria-hidden="true" /> <span className="hidden sm:inline">{t('call')}</span>
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

function Insight({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="sc-glass flex items-center gap-3 rounded-2xl p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/35 to-cyan-400/20 text-white ring-1 ring-white/10">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-white/45">{label}</span>
        <span className="sc-display block truncate text-base font-bold text-white sm:text-lg">{value}</span>
      </span>
    </div>
  );
}

async function ClubPanel({ club }: { club: PublicShowcase }) {
  const t = await getTranslations('publicShowcase');
  const tc = await getTranslations('common');
  const insights = clubInsights(club);
  const money = (amount: number) => `${formatCurrency(amount)} ${tc('currency')}`;
  const priceRange = insights.minPrice === null || insights.maxPrice === null
    ? null
    : insights.minPrice === insights.maxPrice ? money(insights.minPrice) : `${formatCurrency(insights.minPrice)} – ${money(insights.maxPrice)}`;

  return (
    <div className="space-y-16 pt-6">
      {/* Banner */}
      <div className="relative overflow-hidden rounded-[2rem] ring-1 ring-white/10">
        <div className="absolute inset-0">
          {club.hero_image_url ? (
            <ShimmerImage src={club.hero_image_url} alt="" imgClassName="opacity-50" />
          ) : (
            <span className="absolute inset-0 block bg-[radial-gradient(circle_at_15%_20%,rgba(124,58,237,0.55),transparent_55%),radial-gradient(circle_at_85%_80%,rgba(8,145,178,0.45),transparent_55%)]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-[#05050b] via-[#05050b]/80 to-[#05050b]/30" />
        </div>
        <div className="relative grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.3fr_1fr] lg:items-end">
          <div>
            <h3 className="sc-display text-3xl font-black text-white sm:text-5xl">{club.club_name}</h3>
            {club.headline && <p className="sc-display sc-gradient-text mt-2 text-lg font-bold sm:text-xl">{club.headline}</p>}
            <p className="mt-4 max-w-xl text-base leading-7 text-white/70">{club.tagline ?? t('defaultTagline')}</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <ContactButtons club={club} compact />
              <a href={`/club/${club.slug}`} className="inline-flex items-center gap-1 rounded-xl px-3 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:text-white">
                {t('fullPage')} <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>
          </div>
          <ContactList club={club} />
        </div>
      </div>

      {/* Insights */}
      <div>
        <h4 className="sc-display mb-5 flex items-center gap-2 text-xl font-bold text-white">
          <Zap size={18} className="text-fuchsia-300" aria-hidden="true" /> {t('insightsTitle')}
        </h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Insight icon={<Monitor size={18} aria-hidden="true" />} label={t('statPcs')} value={<CountUp value={insights.pcCount} />} />
          {insights.consoleCount > 0 && (
            <Insight icon={<Gamepad2 size={18} aria-hidden="true" />} label={t('statConsoles')} value={<CountUp value={insights.consoleCount} />} />
          )}
          <Insight icon={<Layers size={18} aria-hidden="true" />} label={t('insightZones')} value={<CountUp value={insights.zoneCount} />} />
          <Insight icon={<Gamepad2 size={18} aria-hidden="true" />} label={t('statGames')} value={<CountUp value={insights.gameCount} />} />
          {priceRange && <Insight icon={<Wallet size={18} aria-hidden="true" />} label={t('insightPrice')} value={priceRange} />}
          {insights.topGpu && <Insight icon={<MonitorPlay size={18} aria-hidden="true" />} label={t('insightTopGpu')} value={insights.topGpu} />}
          {insights.maxRefreshHz && <Insight icon={<Cpu size={18} aria-hidden="true" />} label={t('insightRefresh')} value={t('hertz', { value: insights.maxRefreshHz })} />}
        </div>
      </div>

      {club.offers.length > 0 && (
        <div>
          <h4 className="sc-display mb-6 flex items-center gap-2 text-xl font-bold text-white">
            <BadgePercent size={18} className="text-lime-300" aria-hidden="true" /> {t('offersTitle')}
          </h4>
          <OfferGrid offers={club.offers} />
        </div>
      )}

      {club.zones.some((zone) => zone.kind === 'pc') && (
        <div>
          <h4 className="sc-display mb-6 flex items-center gap-2 text-xl font-bold text-white">
            <Monitor size={18} className="text-cyan-300" aria-hidden="true" /> {t('zonesTitle')}
          </h4>
          <ZoneGrid zones={club.zones.filter((zone) => zone.kind === 'pc')} />
        </div>
      )}

      {club.zones.some((zone) => zone.kind === 'playstation') && (
        <div>
          <h4 className="sc-display mb-6 flex items-center gap-2 text-xl font-bold text-white">
            <Gamepad2 size={18} className="text-blue-300" aria-hidden="true" /> {t('playstationTitle')}
          </h4>
          <ZoneGrid zones={club.zones.filter((zone) => zone.kind === 'playstation')} />
        </div>
      )}

      {club.games.length > 0 && (
        <div>
          <h4 className="sc-display mb-6 flex items-center gap-2 text-xl font-bold text-white">
            <Gamepad2 size={18} className="text-fuchsia-300" aria-hidden="true" /> {t('gamesTitle')}
          </h4>
          <GameGrid games={club.games} />
        </div>
      )}
    </div>
  );
}
