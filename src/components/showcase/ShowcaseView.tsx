import { getTranslations } from 'next-intl/server';
import { ArrowDown, MonitorPlay, Phone, Send } from 'lucide-react';
import { lowestHourlyPrice, telHref, totalPcCount, type PublicShowcase } from '@/lib/showcase';
import { CountUp } from './CountUp';
import { ContactPanel, GameGrid, HeroBackdrop, Marquee, OfferGrid, SectionTitle, StatGrid, ZoneGrid, riseDelay, type Stat } from './ShowcaseParts';
import { ShowcaseNav } from './ShowcaseNav';

/** The public page of one club: /club/<slug>. */
export async function ShowcaseView({ showcase }: { showcase: PublicShowcase }) {
  const t = await getTranslations('publicShowcase');
  const tc = await getTranslations('common');
  const pcCount = totalPcCount(showcase.zones);
  const fromPrice = lowestHourlyPrice(showcase.zones);
  const phoneLink = telHref(showcase.phone);
  const primaryCta = showcase.telegram_url
    ? { href: showcase.telegram_url, label: t('bookTelegram') }
    : phoneLink ? { href: phoneLink, label: t('call') } : null;

  const navLinks = [
    showcase.games.length > 0 ? { href: '#games', label: t('navGames') } : null,
    showcase.zones.length > 0 ? { href: '#zones', label: t('navZones') } : null,
    showcase.offers.length > 0 ? { href: '#offers', label: t('navOffers') } : null,
    { href: '#contacts', label: t('navContacts') },
  ].filter((link): link is { href: string; label: string } => link !== null);

  const stats = ([
    pcCount > 0 ? { value: <CountUp value={pcCount} />, label: t('statPcs') } : null,
    showcase.games.length > 0 ? { value: <CountUp value={showcase.games.length} />, label: t('statGames') } : null,
    fromPrice !== null
      ? { value: <><CountUp value={fromPrice} format="grouped" /><span className="ml-1 text-xs font-semibold text-white/50 sm:text-base">{tc('currency')}</span></>, label: t('statFromPrice') }
      : null,
    showcase.opening_hours ? { value: showcase.opening_hours, label: t('statHours') } : null,
  ] as Array<Stat | null>).filter((stat): stat is Stat => stat !== null);

  const headline = showcase.headline ?? showcase.club_name;

  return (
    <div id="top" className="sc-root relative min-h-screen">
      <ShowcaseNav clubName={showcase.club_name} links={navLinks} cta={primaryCta} />

      <section className="relative isolate flex min-h-[100svh] items-center overflow-hidden pb-20 pt-28">
        <HeroBackdrop imageUrl={showcase.hero_image_url} />

        <div className="mx-auto w-full max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <p className="sc-rise sc-glass mb-6 inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 text-sm font-medium text-white/80" style={riseDelay(0.05)}>
            <span className="sc-pulse-dot h-2 w-2 rounded-full bg-lime-400" aria-hidden="true" />
            {showcase.opening_hours ? t('openHours', { hours: showcase.opening_hours }) : t('welcome')}
          </p>

          <h1 className="sc-rise sc-display mx-auto max-w-5xl text-[2.6rem] font-black leading-[1.02] text-white sm:text-7xl lg:text-8xl" style={riseDelay(0.15)}>
            <span className="sc-shine-text sc-gradient-text" data-text={headline}>{headline}</span>
          </h1>

          {showcase.headline && (
            <p className="sc-rise sc-display mt-4 text-lg font-semibold uppercase tracking-[0.3em] text-white/50 sm:text-xl" style={riseDelay(0.25)}>
              {showcase.club_name}
            </p>
          )}

          <p className="sc-rise mx-auto mt-6 max-w-2xl text-base leading-7 text-white/70 sm:text-lg sm:leading-8" style={riseDelay(0.35)}>
            {showcase.tagline ?? t('defaultTagline')}
          </p>

          <div className="sc-rise mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center" style={riseDelay(0.45)}>
            {primaryCta && (
              <a href={primaryCta.href} target="_blank" rel="noopener noreferrer" className="sc-cta inline-flex items-center justify-center gap-2 rounded-2xl px-7 py-4 text-base font-semibold text-white">
                {showcase.telegram_url ? <Send size={18} aria-hidden="true" /> : <Phone size={18} aria-hidden="true" />}
                {primaryCta.label}
              </a>
            )}
            <a
              href={showcase.zones.length > 0 ? '#zones' : '#contacts'}
              className="sc-glass inline-flex items-center justify-center gap-2 rounded-2xl px-7 py-4 text-base font-semibold text-white transition-colors hover:bg-white/10"
            >
              <MonitorPlay size={18} aria-hidden="true" />
              {showcase.zones.length > 0 ? t('seePcs') : t('howToFind')}
            </a>
          </div>

          <StatGrid stats={stats} className="sc-rise mx-auto mt-14 max-w-4xl" style={riseDelay(0.6)} />
        </div>

        <a href={showcase.games.length > 0 ? '#games' : '#contacts'} className="sc-scroll-cue absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full p-2 text-white/50 hover:text-white" aria-label={t('scrollDown')}>
          <ArrowDown size={22} aria-hidden="true" />
        </a>
      </section>

      <Marquee items={showcase.games.map((game) => game.title)} />

      {showcase.games.length > 0 && (
        <section id="games" className="relative scroll-mt-16 px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
          <div className="pointer-events-none absolute left-1/2 top-24 h-72 w-[40rem] max-w-full -translate-x-1/2 rounded-full bg-violet-600/20 blur-[120px]" aria-hidden="true" />
          <div className="relative mx-auto max-w-7xl">
            <SectionTitle eyebrow={t('gamesEyebrow')} title={t('gamesTitle')} description={t('gamesDescription', { count: showcase.games.length })} />
            <GameGrid games={showcase.games} />
          </div>
        </section>
      )}

      {showcase.zones.length > 0 && (
        <section id="zones" className="relative scroll-mt-16 px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
          <div className="pointer-events-none absolute right-0 top-1/3 h-96 w-96 rounded-full bg-cyan-500/10 blur-[120px]" aria-hidden="true" />
          <div className="pointer-events-none absolute bottom-0 left-0 h-96 w-96 rounded-full bg-fuchsia-600/10 blur-[120px]" aria-hidden="true" />
          <div className="relative mx-auto max-w-7xl">
            <SectionTitle eyebrow={t('zonesEyebrow')} title={t('zonesTitle')} description={t('zonesDescription', { count: pcCount })} />
            <ZoneGrid zones={showcase.zones} />
          </div>
        </section>
      )}

      {showcase.offers.length > 0 && (
        <section id="offers" className="relative scroll-mt-16 px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
          <div className="pointer-events-none absolute left-1/2 top-24 h-72 w-[40rem] max-w-full -translate-x-1/2 rounded-full bg-fuchsia-600/15 blur-[120px]" aria-hidden="true" />
          <div className="relative mx-auto max-w-7xl">
            <SectionTitle eyebrow={t('offersEyebrow')} title={t('offersTitle')} description={t('offersDescription')} />
            <OfferGrid offers={showcase.offers} />
          </div>
        </section>
      )}

      <ContactPanel club={showcase} id="contacts" />

      <footer className="border-t border-white/5 px-4 py-8 text-center text-xs text-white/35">
        © {new Date().getFullYear()} {showcase.club_name}
      </footer>
    </div>
  );
}
