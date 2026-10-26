import { getTranslations } from 'next-intl/server';
import { ArrowDown, ArrowUpRight, BadgePercent, Clock, Cpu, Gamepad2, Layers, MapPin, Monitor, MonitorPlay, Send, Wallet, Zap } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { brandInsights, clubInsights, type PublicBrand, type PublicShowcase } from '@/lib/showcase';
import { ClubTabs } from './ClubTabs';
import { CountUp } from './CountUp';
import { Reveal } from './Reveal';
import { ShimmerImage } from './ShimmerImage';
import { ContactButtons, ContactList, GameGrid, HeroBackdrop, Marquee, OfferGrid, SectionTitle, StatGrid, ZoneGrid, riseDelay, type Stat } from './ShowcaseParts';
import { ShowcaseNav } from './ShowcaseNav';

const CLUBS_ANCHOR = 'clubs';

/** The public page of a chain of clubs: one overall experience and a tab per club. */
export async function BrandView({ brand }: { brand: PublicBrand }) {
  const t = await getTranslations('publicShowcase');
  const tc = await getTranslations('common');
  const totals = brandInsights(brand);
  const money = (amount: number) => `${formatCurrency(amount)} ${tc('currency')}`;
  const allTitles = [...new Map(brand.clubs.flatMap((club) => club.games).map((game) => [game.title.trim().toLowerCase(), game.title])).values()];

  const stats = ([
    { value: <CountUp value={totals.clubCount} />, label: t('statClubs') },
    totals.pcCount > 0 ? { value: <CountUp value={totals.pcCount} />, label: t('statPcs') } : null,
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

  return (
    <div id="top" className="sc-root relative min-h-screen">
      <ShowcaseNav clubName={brand.name} links={navLinks} cta={cta} loginLabel={t('login')} />

      {/* ---------- Overall experience ---------- */}
      <section className="relative isolate flex min-h-[100svh] items-center overflow-hidden pb-20 pt-28">
        <HeroBackdrop imageUrl={brand.hero_image_url ?? brand.clubs.find((club) => club.hero_image_url)?.hero_image_url ?? null} />
        <div className="mx-auto w-full max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <p className="sc-rise sc-glass mb-6 inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 text-sm font-medium text-white/80" style={riseDelay(0.05)}>
            <span className="sc-pulse-dot h-2 w-2 rounded-full bg-lime-400" aria-hidden="true" />
            {t('clubsAcrossCity', { count: totals.clubCount })}
          </p>
          <h1 className="sc-rise sc-display mx-auto max-w-5xl text-[2.6rem] font-black leading-[1.02] text-white sm:text-7xl lg:text-8xl" style={riseDelay(0.15)}>
            <span className="sc-shine-text sc-gradient-text" data-text={brand.name}>{brand.name}</span>
          </h1>
          <p className="sc-rise mx-auto mt-6 max-w-2xl text-base leading-7 text-white/70 sm:text-lg sm:leading-8" style={riseDelay(0.3)}>
            {brand.tagline ?? t('defaultTagline')}
          </p>
          <div className="sc-rise mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center" style={riseDelay(0.42)}>
            <a href="#locations" className="sc-cta inline-flex items-center justify-center gap-2 rounded-2xl px-7 py-4 text-base font-semibold text-white">
              <MapPin size={18} aria-hidden="true" />
              {t('chooseClub')}
            </a>
            {brand.telegram_url && (
              <a href={brand.telegram_url} target="_blank" rel="noopener noreferrer" className="sc-glass inline-flex items-center justify-center gap-2 rounded-2xl px-7 py-4 text-base font-semibold text-white transition-colors hover:bg-white/10">
                <Send size={18} aria-hidden="true" />
                {t('bookTelegram')}
              </a>
            )}
          </div>
          <StatGrid stats={stats} className="sc-rise mx-auto mt-14 max-w-4xl" style={riseDelay(0.55)} />
        </div>
        <a href="#locations" className="sc-scroll-cue absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full p-2 text-white/50 hover:text-white" aria-label={t('scrollDown')}>
          <ArrowDown size={22} aria-hidden="true" />
        </a>
      </section>

      <Marquee items={allTitles} />

      {/* ---------- Locations ---------- */}
      <section id="locations" className="relative scroll-mt-16 px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        <div className="pointer-events-none absolute left-1/2 top-24 h-72 w-[40rem] max-w-full -translate-x-1/2 rounded-full bg-violet-600/20 blur-[120px]" aria-hidden="true" />
        <div className="relative mx-auto max-w-7xl">
          <SectionTitle eyebrow={t('locationsEyebrow')} title={t('locationsTitle')} description={t('locationsDescription')} />
          <ul className={`grid gap-6 ${brand.clubs.length === 1 ? 'mx-auto max-w-xl' : brand.clubs.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3'}`}>
            {brand.clubs.map((club, index) => (
              <Reveal as="li" key={club.slug} delay={index * 0.1}>
                <LocationCard club={club} openLabel={t('openClub')} pcsLabel={t('pcCount', { count: clubInsights(club).pcCount })} fromLabel={(price) => t('fromPrice', { price: money(price) })} />
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

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

      <footer className="border-t border-white/5 px-4 py-8 text-center text-xs text-white/35">
        © {new Date().getFullYear()} {brand.name}
      </footer>
    </div>
  );
}

function LocationCard({ club, openLabel, pcsLabel, fromLabel }: { club: PublicShowcase; openLabel: string; pcsLabel: string; fromLabel: (price: number) => string }) {
  const insights = clubInsights(club);
  const image = club.hero_image_url ?? club.zones.find((zone) => zone.image_url)?.image_url ?? null;
  return (
    <a href={`#club-${club.slug}`} className="sc-location group block h-full overflow-hidden rounded-3xl bg-[#0b0b16] ring-1 ring-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300">
      <span className="relative block aspect-[16/10] overflow-hidden">
        <span className="sc-location-media absolute inset-0 block">
          {image ? (
            <ShimmerImage src={image} alt="" />
          ) : (
            <span className="absolute inset-0 block bg-[radial-gradient(circle_at_25%_25%,rgba(139,92,246,0.55),transparent_60%),radial-gradient(circle_at_80%_75%,rgba(34,211,238,0.4),transparent_55%)]" />
          )}
        </span>
        <span className="absolute inset-0 bg-gradient-to-t from-[#0b0b16] via-[#0b0b16]/30 to-transparent" />
        <span className="absolute inset-x-5 bottom-4 block">
          <span className="sc-display block text-2xl font-bold text-white">{club.club_name}</span>
          {club.address && (
            <span className="mt-1 flex items-center gap-1.5 text-sm text-white/70">
              <MapPin size={14} aria-hidden="true" /> <span className="truncate">{club.address}</span>
            </span>
          )}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2 p-5">
        {insights.pcCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1 text-xs font-semibold text-white/80 ring-1 ring-white/10">
            <Monitor size={13} aria-hidden="true" /> {pcsLabel}
          </span>
        )}
        {insights.minPrice !== null && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1 text-xs font-semibold text-white/80 ring-1 ring-white/10">
            <Wallet size={13} aria-hidden="true" /> {fromLabel(insights.minPrice)}
          </span>
        )}
        {club.opening_hours && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1 text-xs font-semibold text-white/80 ring-1 ring-white/10">
            <Clock size={13} aria-hidden="true" /> {club.opening_hours}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-fuchsia-200 transition-transform group-hover:translate-x-0.5">
          {openLabel} <ArrowUpRight size={16} aria-hidden="true" />
        </span>
      </span>
    </a>
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

      {club.zones.length > 0 && (
        <div>
          <h4 className="sc-display mb-6 flex items-center gap-2 text-xl font-bold text-white">
            <Monitor size={18} className="text-cyan-300" aria-hidden="true" /> {t('zonesTitle')}
          </h4>
          <ZoneGrid zones={club.zones} />
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
