import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { ArrowDown, ArrowUpRight, Camera, Clock, Gamepad2, ListChecks, MapPin, Milestone, Monitor, MonitorPlay, Navigation, Phone, Send, Wallet, Zap } from 'lucide-react';
import { formatCurrency, formatPhone } from '@/lib/formatters';
import { brandInsights, brandLogoUrl, clubInsights, clubLabel, mapLinks, openStatus, telHref, type PublicBrand, type PublicShowcase } from '@/lib/showcase';
import { localizedHref } from '@/lib/seoServer';
import { brandFaqFacts } from '@/lib/showcaseFaq';
import { ShowcaseFaq } from './ShowcaseFaq';
import { BookingButton, type BookingClub } from './BookingButton';
import { ClubTabs } from './ClubTabs';
import { GameBrowser } from './GameBrowser';
import { MapChooser } from './MapChooser';
import { PhotoGallery } from './PhotoGallery';
import { ShimmerImage } from './ShimmerImage';
import { ShowcaseActionBar } from './ShowcaseActionBar';
import { HeroBackdrop, ZoneGrid, riseDelay } from './ShowcaseParts';
import { AmenityList, FindUs, PriceTable, RatingBadge, bookingClubs, hasPrices } from './ShowcaseInfo';
import { ShowcaseFooter } from './ShowcaseFooter';
import { ShowcaseNav } from './ShowcaseNav';

const CLUBS_ANCHOR = 'clubs';

/**
 * The public page of a chain of clubs. The first screen names the brand and
 * puts every club within one tap of booking, a route or a call. Below, a club
 * switch decides whose prices, hardware, games, photos and map are shown.
 */
export async function BrandView({ brand }: { brand: PublicBrand }) {
  const t = await getTranslations('publicShowcase');
  const tc = await getTranslations('common');
  const totals = brandInsights(brand);
  const booking = bookingClubs(brand.clubs, brand.name);
  const hasFaq = brandFaqFacts(brand).length > 0;
  // Rendered per request, so "open now" reflects the visit.
  const now = new Date();

  const facts = [
    totals.pcCount > 0 ? t('pcCount', { count: totals.pcCount }) : null,
    totals.consoleCount > 0 ? t('consoleCount', { count: totals.consoleCount }) : null,
    totals.gameCount > 0 ? t('gameCount', { count: totals.gameCount }) : null,
    totals.minPrice !== null ? t('fromPrice', { price: `${formatCurrency(totals.minPrice)} ${tc('currency')}` }) : null,
  ].filter((fact): fact is string => fact !== null);

  const sections = [
    brand.clubs.some(hasPrices) ? { href: '#sec-prices', label: t('navPrices') } : null,
    brand.clubs.some((club) => club.zones.length > 0) ? { href: '#sec-zones', label: t('navZones') } : null,
    brand.clubs.some((club) => club.games.length > 0) ? { href: '#sec-games', label: t('navGames') } : null,
    brand.clubs.some((club) => club.address) ? { href: '#sec-find', label: t('navFind') } : null,
  ].filter((link): link is { href: string; label: string } => link !== null);
  const navLinks = [...sections, ...(hasFaq ? [{ href: '#faq', label: t('faq.nav') }] : [])];

  return (
    <div id="top" className="sc-root relative min-h-screen pb-24 sm:pb-0">
      <ShowcaseNav
        clubName={brand.name}
        links={navLinks}
        action={booking.length > 0 ? (
          <BookingButton clubs={booking} className="sc-cta inline-flex min-h-10 items-center rounded-xl px-4 text-sm font-semibold text-white">
            {t('bookTelegram')}
          </BookingButton>
        ) : undefined}
      />

      {/* ---------- First screen: who we are, then every club with what a visitor needs ---------- */}
      <section className="relative isolate overflow-hidden pb-12 pt-24 sm:pb-16 sm:pt-28">
        <HeroBackdrop imageUrl={brand.hero_image_url ?? brand.clubs.find((club) => club.hero_image_url)?.hero_image_url ?? null} />
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="sc-rise mb-4 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-black/40 px-4 py-1.5 text-sm font-medium text-white/85" style={riseDelay(0.05)}>
            <span className="sc-pulse-dot h-2 w-2 rounded-full bg-lime-400" aria-hidden="true" />
            {t('clubsAcrossCity', { count: totals.clubCount })}
          </p>
          <h1 className="sc-rise sc-display text-[2.5rem] font-black leading-[1.02] sm:text-6xl lg:text-7xl" style={riseDelay(0.12)}>
            <span className="sc-gradient-text">{brand.name}</span>
          </h1>
          <p className="sc-rise mt-4 max-w-2xl text-base leading-7 text-white/80 sm:text-lg" style={riseDelay(0.2)}>
            {brand.tagline ?? t('defaultTagline')}
          </p>
          {facts.length > 0 && (
            <ul className="sc-rise sc-num mt-5 flex flex-wrap gap-x-5 gap-y-1.5 text-sm font-semibold text-white sm:text-base" style={riseDelay(0.26)}>
              {facts.map((fact) => (
                <li key={fact} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-400" aria-hidden="true" /> {fact}
                </li>
              ))}
            </ul>
          )}

          <ul id="locations" className={`mt-8 grid scroll-mt-20 gap-4 ${brand.clubs.length === 1 ? 'max-w-xl' : brand.clubs.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3'}`}>
            {brand.clubs.map((club, index) => (
              <li key={club.slug} className="sc-rise" style={riseDelay(0.32 + index * 0.08)}>
                <QuickClubCard club={club} now={now} booking={booking} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------- One club at a time: prices, hardware, games, photos, map ---------- */}
      <section id={CLUBS_ANCHOR} className="relative scroll-mt-16 pb-20">
        <h2 className="sr-only">{t('clubsTitle')}</h2>
        <ClubTabs
          anchorId={CLUBS_ANCHOR}
          label={t('clubSwitch')}
          tabs={brand.clubs.map((club) => ({ id: club.slug, label: clubLabel(club), meta: [club.address, club.opening_hours].filter(Boolean).join(' · ') || undefined }))}
        >
          {brand.clubs.map((club) => <ClubPanel key={club.slug} club={club} booking={booking} now={now} />)}
        </ClubTabs>
      </section>

      <ShowcaseFaq brand={brand} id="faq" />

      <ShowcaseFooter
        name={brand.name}
        logoUrl={brandLogoUrl(brand)}
        description={brand.tagline}
        hours={null}
        phone={null}
        email={brand.email}
        socials={{
          telegram: null,
          telegramChannel: brand.telegram_channel_url,
          telegramGroup: brand.telegram_group_url,
          instagram: brand.instagram_url,
          youtube: brand.youtube_url,
        }}
        pages={[{ href: '#top', label: t('footerHome') }, { href: '#locations', label: t('navLocations') }, ...sections]}
        help={[
          ...(hasFaq ? [{ href: '#faq', label: t('faq.nav') }] : []),
          ...brand.clubs.flatMap((club) => (club.telegram_url ? [{ href: club.telegram_url, label: t('bookTelegramClub', { club: clubLabel(club) }), external: true }] : [])),
        ]}
        locations={brand.clubs.flatMap((club) => (club.address
          ? [{ label: clubLabel(club), clubName: club.club_name, address: club.address, yandexMapsUrl: club.yandex_maps_url, phone: club.phone, hours: club.opening_hours }]
          : []))}
      />
    </div>
  );
}

/** One club on the first screen: where it is, whether it is open, what an hour costs, and the three ways to act. */
async function QuickClubCard({ club, now, booking }: { club: PublicShowcase; now: Date; booking: BookingClub[] }) {
  const t = await getTranslations('publicShowcase');
  const tc = await getTranslations('common');
  const insights = clubInsights(club);
  const status = openStatus(club.opening_hours, now);
  const maps = mapLinks(club);
  const phone = telHref(club.phone);
  const image = club.hero_image_url ?? club.gallery[0] ?? club.zones.find((zone) => zone.image_url)?.image_url ?? null;
  const canBook = booking.some((entry) => entry.slug === club.slug);
  const chip = 'sc-num inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 text-xs font-semibold text-white/85 ring-1 ring-white/10';
  const priceChip = 'sc-num inline-flex items-center gap-1.5 rounded-full bg-lime-300/10 px-2.5 py-1 text-xs font-semibold text-lime-200 ring-1 ring-lime-300/30';
  const action = 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300';

  return (
    <article className="sc-location flex h-full flex-col overflow-hidden rounded-3xl bg-[#0b0b16]/95 ring-1 ring-white/10">
      <div className="relative h-36 overflow-hidden sm:h-44">
        <span className="sc-location-media absolute inset-0 block">
          {image ? (
            <ShimmerImage src={image} alt="" priority />
          ) : (
            <span className="absolute inset-0 block bg-[radial-gradient(circle_at_25%_25%,rgba(139,92,246,0.55),transparent_60%),radial-gradient(circle_at_80%_75%,rgba(79,70,229,0.4),transparent_55%)]" />
          )}
        </span>
        <span className="absolute inset-0 bg-gradient-to-t from-[#0b0b16] via-[#0b0b16]/25 to-transparent" />
        <span className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          <RatingBadge club={club} />
          {status && (
            <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${status === 'open' ? 'bg-black/55 text-lime-200 ring-1 ring-lime-300/50' : 'bg-black/55 text-white/75 ring-1 ring-white/15'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${status === 'open' ? 'sc-pulse-dot bg-lime-400' : 'bg-white/50'}`} aria-hidden="true" />
              {status === 'open' ? t('openNow') : t('closedNow')}
            </span>
          )}
        </span>
        {club.logo_url && (
          // Owner-supplied links may point at any host, so next/image's allow-list does not fit.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={club.logo_url} alt="" className="absolute bottom-3 left-4 h-12 w-12 rounded-full object-cover ring-2 ring-white/20" />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5 pt-3">
        <div>
          {club.branch_name && <p className="text-xs font-semibold uppercase tracking-wider text-violet-200">{club.club_name}</p>}
          <h2 className="sc-display text-2xl font-bold text-white sm:text-3xl">{clubLabel(club)}</h2>
        </div>

        <div className="space-y-2 text-sm leading-6 text-white/85">
          {club.address && (
            <p className="flex items-start gap-2">
              <MapPin size={16} className="mt-1 shrink-0 text-violet-300" aria-hidden="true" />
              {maps ? (
                <MapChooser address={club.address} links={maps} labels={{ title: t('mapChooserTitle'), yandex: t('mapYandex'), google: t('mapGoogle') }} />
              ) : club.address}
            </p>
          )}
          {club.landmark && (
            <p className="flex items-start gap-2 text-white/70">
              <Milestone size={16} className="mt-1 shrink-0 text-violet-300" aria-hidden="true" /> {club.landmark}
            </p>
          )}
          {club.opening_hours && (
            <p className="flex items-center gap-2 text-white/70">
              <Clock size={16} className="shrink-0 text-violet-300" aria-hidden="true" /> {club.opening_hours}
            </p>
          )}
        </div>

        <ul className="flex flex-wrap gap-2">
          {insights.minPrice !== null && (
            <li className={priceChip}><Wallet size={13} aria-hidden="true" /> {t('fromPrice', { price: `${formatCurrency(insights.minPrice)} ${tc('currency')}` })}</li>
          )}
          {insights.pcCount > 0 && <li className={chip}><Monitor size={13} aria-hidden="true" /> {t('pcCount', { count: insights.pcCount })}</li>}
          {insights.consoleCount > 0 && <li className={chip}><Gamepad2 size={13} aria-hidden="true" /> {t('consoleCount', { count: insights.consoleCount })}</li>}
          {insights.topGpu && <li className={chip}><MonitorPlay size={13} aria-hidden="true" /> {insights.topGpu}</li>}
          {insights.maxRefreshHz && <li className={chip}><Zap size={13} aria-hidden="true" /> {t('hertz', { value: insights.maxRefreshHz })}</li>}
        </ul>

        <div className="mt-auto grid grid-cols-2 gap-2 pt-1 sm:flex">
          {canBook && (
            <BookingButton
              clubs={booking}
              initialSlug={club.slug}
              ariaLabel={`${t('bookTelegram')}: ${clubLabel(club)}`}
              className="sc-cta col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white sm:flex-[1.5]"
            >
              <Send size={16} aria-hidden="true" /> {t('bookTelegram')}
            </BookingButton>
          )}
          {club.address && maps && (
            <span className="sm:flex-1 [&>span]:block">
              <MapChooser
                address={club.address}
                links={maps}
                labels={{ title: t('mapChooserTitle'), yandex: t('mapYandex'), google: t('mapGoogle') }}
                triggerClassName={action}
                trigger={<><Navigation size={16} aria-hidden="true" /> {t('route')}</>}
              />
            </span>
          )}
          {phone && (
            <a href={phone} className={`${action} sm:flex-1`} aria-label={`${t('call')}: ${formatPhone(club.phone)}`}>
              <Phone size={16} aria-hidden="true" /> {t('call')}
            </a>
          )}
        </div>
        <a href={`#club-${club.slug}`} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-violet-200 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
          {t('pricesAndDetails')} <ArrowDown size={15} aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}

/** A titled part of a club panel; "#sec-<name>" links scroll here (below the top bar and the club switch). */
function PanelSection({ name, icon, title, description, children }: { name: string; icon: ReactNode; title: string; description?: string; children: ReactNode }) {
  return (
    <section data-section={name} className="scroll-mt-36">
      <div className="mb-6">
        <h3 className="sc-display flex items-center gap-2.5 text-2xl font-bold text-white sm:text-3xl">
          <span className="text-violet-300">{icon}</span> {title}
        </h3>
        {description && <p className="mt-2 max-w-2xl text-base leading-7 text-white/70">{description}</p>}
      </div>
      {children}
    </section>
  );
}

async function ClubPanel({ club, booking, now }: { club: PublicShowcase; booking: BookingClub[]; now: Date }) {
  const clubHref = await localizedHref(`/club/${club.slug}`);
  const t = await getTranslations('publicShowcase');
  const insights = clubInsights(club);
  const status = openStatus(club.opening_hours, now);
  const maps = mapLinks(club);

  return (
    <div className="mx-auto max-w-7xl space-y-16 px-4 pt-10 sm:space-y-20 sm:px-6 sm:pt-12 lg:px-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-white/75">
            {club.branch_name && <span className="uppercase tracking-wider text-violet-200">{club.club_name}</span>}
            {status && (
              <span className={`inline-flex items-center gap-1.5 ${status === 'open' ? 'text-lime-200' : 'text-white/70'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${status === 'open' ? 'bg-lime-400' : 'bg-white/50'}`} aria-hidden="true" />
                {status === 'open' ? t('openNow') : t('closedNow')}
              </span>
            )}
          </p>
          <p className="sc-display mt-1 text-3xl font-black text-white sm:text-5xl">{clubLabel(club)}</p>
          {club.headline && <p className="mt-2 text-base font-medium text-white/80 sm:text-lg">{club.headline}</p>}
        </div>
        <a href={clubHref} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 self-start rounded-xl text-sm font-semibold text-violet-200 transition-colors hover:text-white sm:self-auto">
          {t('fullPage')} <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </header>

      {hasPrices(club) && (
        <PanelSection name="prices" icon={<Wallet size={24} aria-hidden="true" />} title={t('pricesTitle')} description={t('pricesDescription')}>
          <PriceTable club={club} />
        </PanelSection>
      )}

      {club.zones.length > 0 && (
        <PanelSection
          name="zones"
          icon={<Monitor size={24} aria-hidden="true" />}
          title={t('hardwareTitle')}
          description={insights.pcCount > 0 ? t('zonesDescription', { count: insights.pcCount }) : undefined}
        >
          <ZoneGrid zones={club.zones} heading="h4" />
        </PanelSection>
      )}

      {club.games.length > 0 && (
        <PanelSection name="games" icon={<Gamepad2 size={24} aria-hidden="true" />} title={t('gamesTitle')}>
          <GameBrowser games={club.games} />
        </PanelSection>
      )}

      {club.gallery.length > 0 && (
        <PanelSection name="photos" icon={<Camera size={24} aria-hidden="true" />} title={t('galleryTitle')}>
          <PhotoGallery photos={club.gallery} clubName={club.club_name} />
        </PanelSection>
      )}

      {club.amenities.length > 0 && (
        <PanelSection name="amenities" icon={<ListChecks size={24} aria-hidden="true" />} title={t('amenitiesTitle')}>
          <AmenityList amenities={club.amenities} />
        </PanelSection>
      )}

      {(club.address || club.phone) && (
        <PanelSection name="find" icon={<MapPin size={24} aria-hidden="true" />} title={t('findTitle')}>
          <FindUs club={club} booking={booking} />
        </PanelSection>
      )}

      <ShowcaseActionBar booking={booking} clubSlug={club.slug} directionsHref={maps?.yandex ?? null} phoneHref={telHref(club.phone)} />
    </div>
  );
}
