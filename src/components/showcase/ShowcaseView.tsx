import type { CSSProperties, ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import {
  ArrowDown,
  Clock,
  Cpu,
  Gamepad2,
  Instagram,
  Keyboard,
  MapPin,
  MemoryStick,
  Monitor,
  MonitorPlay,
  Phone,
  Send,
  Sparkles,
  Zap,
} from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { lowestHourlyPrice, telHref, totalPcCount, type PublicShowcase, type PublicShowcaseZone } from '@/lib/showcase';
import { CountUp } from './CountUp';
import { Reveal } from './Reveal';
import { ShimmerImage } from './ShimmerImage';
import { ShowcaseNav } from './ShowcaseNav';
import { TiltCard } from './TiltCard';

/** Fixed spark positions so the server and client render the same markup. */
const SPARKS = [
  { left: '8%', bottom: '12%', d: '11s', delay: '0s', x: '30px' },
  { left: '18%', bottom: '4%', d: '9s', delay: '2.4s', x: '-20px' },
  { left: '31%', bottom: '18%', d: '13s', delay: '1.1s', x: '40px' },
  { left: '46%', bottom: '6%', d: '10s', delay: '4s', x: '-35px' },
  { left: '58%', bottom: '14%', d: '12s', delay: '0.6s', x: '25px' },
  { left: '69%', bottom: '3%', d: '9.5s', delay: '3.2s', x: '-15px' },
  { left: '81%', bottom: '16%', d: '14s', delay: '1.8s', x: '35px' },
  { left: '92%', bottom: '8%', d: '10.5s', delay: '5s', x: '-30px' },
];

const delay = (seconds: number) => ({ '--delay': `${seconds}s` }) as CSSProperties;

function SectionTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <Reveal className="mx-auto mb-10 max-w-2xl text-center sm:mb-14">
      <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-200/90">
        <Sparkles size={13} aria-hidden="true" />
        {eyebrow}
      </p>
      <h2 className="sc-display text-3xl font-bold text-white sm:text-5xl">
        <span className="sc-gradient-text">{title}</span>
      </h2>
      {description && <p className="mt-4 text-base leading-7 text-white/60">{description}</p>}
    </Reveal>
  );
}

function Spec({ icon, label, value }: { icon: ReactNode; label: string; value: string | null }) {
  if (!value) return null;
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-cyan-300 ring-1 ring-white/10">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-white/40">{label}</span>
        <span className="block break-words text-sm font-medium text-white/90">{value}</span>
      </span>
    </li>
  );
}

function Marquee({ items, reverse = false }: { items: string[]; reverse?: boolean }) {
  // The track holds two copies and slides by half its width, so the loop is seamless.
  const repeated = Array.from({ length: Math.max(2, Math.ceil(12 / items.length)) }, () => items).flat();
  return (
    <div className="sc-marquee overflow-hidden py-2" aria-hidden="true">
      <div className="sc-marquee-track" data-reverse={reverse} style={{ '--duration': `${Math.max(25, repeated.length * 3)}s` } as CSSProperties}>
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 items-center">
            {repeated.map((item, index) => (
              <span key={`${copy}-${index}`} className="sc-display flex items-center whitespace-nowrap px-6 text-2xl font-bold text-white/15 sm:text-4xl">
                {item}
                <Zap size={18} className="ml-12 text-fuchsia-400/40" />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export async function ShowcaseView({ showcase }: { showcase: PublicShowcase }) {
  const t = await getTranslations('publicShowcase');
  const tc = await getTranslations('common');
  const pcCount = totalPcCount(showcase.zones);
  const fromPrice = lowestHourlyPrice(showcase.zones);
  const phoneLink = telHref(showcase.phone);
  const primaryCta = showcase.telegram_url
    ? { href: showcase.telegram_url, label: t('bookTelegram') }
    : phoneLink ? { href: phoneLink, label: t('call') } : null;
  const mapLink = showcase.address
    ? `https://yandex.uz/maps/?text=${encodeURIComponent(`${showcase.club_name}, ${showcase.address}`)}`
    : null;
  const priceText = (price: number) => t('perHour', { price: formatCurrency(price), currency: tc('currency') });

  const navLinks = [
    showcase.games.length > 0 ? { href: '#games', label: t('navGames') } : null,
    showcase.zones.length > 0 ? { href: '#zones', label: t('navZones') } : null,
    { href: '#contacts', label: t('navContacts') },
  ].filter((link): link is { href: string; label: string } => link !== null);

  const stats: Array<{ value: ReactNode; label: string } | null> = [
    pcCount > 0 ? { value: <CountUp value={pcCount} />, label: t('statPcs') } : null,
    showcase.games.length > 0 ? { value: <CountUp value={showcase.games.length} />, label: t('statGames') } : null,
    fromPrice !== null
      ? { value: <><CountUp value={fromPrice} format="grouped" /><span className="ml-1 text-xs font-semibold text-white/50 sm:text-base">{tc('currency')}</span></>, label: t('statFromPrice') }
      : null,
    showcase.opening_hours ? { value: showcase.opening_hours, label: t('statHours') } : null,
  ];
  const shownStats = stats.filter((stat): stat is { value: ReactNode; label: string } => stat !== null);

  const headline = showcase.headline ?? showcase.club_name;
  const specLabels = { gpu: t('gpu'), cpu: t('cpu'), ram: t('ram'), monitor: t('monitor') };

  return (
    <div id="top" className="sc-root relative min-h-screen">
      <ShowcaseNav clubName={showcase.club_name} links={navLinks} cta={primaryCta} />

      {/* ---------- Hero ---------- */}
      <section className="relative isolate flex min-h-[100svh] items-center overflow-hidden pb-20 pt-28">
        {showcase.hero_image_url && (
          <div className="absolute inset-0 -z-10">
            <ShimmerImage src={showcase.hero_image_url} alt="" priority imgClassName="opacity-40" />
            <div className="absolute inset-0 bg-gradient-to-b from-[#05050b]/70 via-[#05050b]/60 to-[#05050b]" />
          </div>
        )}
        <div className="sc-aurora -z-10">
          <div className="sc-blob sc-blob-1" />
          <div className="sc-blob sc-blob-2" />
          <div className="sc-blob sc-blob-3" />
          <div className="sc-grid" />
          {SPARKS.map((spark, index) => (
            <span
              key={index}
              className="sc-spark"
              style={{ left: spark.left, bottom: spark.bottom, '--d': spark.d, '--delay': spark.delay, '--x': spark.x } as CSSProperties}
            />
          ))}
          <div className="sc-noise" />
        </div>

        <div className="mx-auto w-full max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <p className="sc-rise mb-6 inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 text-sm font-medium text-white/80 sc-glass" style={delay(0.05)}>
            <span className="sc-pulse-dot h-2 w-2 rounded-full bg-lime-400" aria-hidden="true" />
            {showcase.opening_hours ? t('openHours', { hours: showcase.opening_hours }) : t('welcome')}
          </p>

          <h1 className="sc-rise sc-display mx-auto max-w-5xl text-[2.6rem] font-black leading-[1.02] text-white sm:text-7xl lg:text-8xl" style={delay(0.15)}>
            <span className="sc-shine-text sc-gradient-text" data-text={headline}>{headline}</span>
          </h1>

          {showcase.headline && (
            <p className="sc-rise sc-display mt-4 text-lg font-semibold uppercase tracking-[0.3em] text-white/50 sm:text-xl" style={delay(0.25)}>
              {showcase.club_name}
            </p>
          )}

          <p className="sc-rise mx-auto mt-6 max-w-2xl text-base leading-7 text-white/70 sm:text-lg sm:leading-8" style={delay(0.35)}>
            {showcase.tagline ?? t('defaultTagline')}
          </p>

          <div className="sc-rise mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center" style={delay(0.45)}>
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

          {shownStats.length > 0 && (
            <dl className={`sc-rise mx-auto mt-14 grid max-w-4xl gap-3 ${shownStats.length >= 4 ? 'grid-cols-2 lg:grid-cols-4' : shownStats.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2'}`} style={delay(0.6)}>
              {shownStats.map((stat) => (
                <div key={stat.label} className="sc-glass flex flex-col rounded-2xl px-4 py-5 text-center">
                  <dt className="order-2 mt-1 text-xs font-medium uppercase tracking-wider text-white/50">{stat.label}</dt>
                  <dd className="sc-display order-1 whitespace-nowrap text-xl font-bold text-white sm:text-3xl">{stat.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <a href={showcase.games.length > 0 ? '#games' : '#contacts'} className="sc-scroll-cue absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full p-2 text-white/50 hover:text-white" aria-label={t('scrollDown')}>
          <ArrowDown size={22} aria-hidden="true" />
        </a>
      </section>

      {/* ---------- Game titles marquee ---------- */}
      {showcase.games.length > 0 && (
        <div className="relative border-y border-white/5 bg-white/[0.015] py-4">
          <Marquee items={showcase.games.map((game) => game.title)} />
        </div>
      )}

      {/* ---------- Games ---------- */}
      {showcase.games.length > 0 && (
        <section id="games" className="relative scroll-mt-16 px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
          <div className="pointer-events-none absolute left-1/2 top-24 -z-0 h-72 w-[40rem] max-w-full -translate-x-1/2 rounded-full bg-violet-600/20 blur-[120px]" aria-hidden="true" />
          <div className="relative mx-auto max-w-7xl">
            <SectionTitle eyebrow={t('gamesEyebrow')} title={t('gamesTitle')} description={t('gamesDescription', { count: showcase.games.length })} />
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4 xl:grid-cols-5">
              {showcase.games.map((game, index) => (
                <Reveal as="li" key={game.id} delay={Math.min(index % 10, 9) * 0.06}>
                  <TiltCard className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-[#0d0d18] ring-1 ring-white/10">
                    <span className="sc-game-media absolute inset-0 block">
                      {game.image_url ? (
                        <ShimmerImage src={game.image_url} alt={game.title} />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-violet-600/40 via-fuchsia-600/20 to-cyan-500/30">
                          <Gamepad2 size={44} className="text-white/60" aria-hidden="true" />
                        </span>
                      )}
                    </span>
                    <span className="absolute inset-x-0 bottom-0 z-[1] block bg-gradient-to-t from-black/95 via-black/60 to-transparent p-4 pt-16">
                      {game.genre && (
                        <span className="mb-1.5 inline-block rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-200 backdrop-blur">
                          {game.genre}
                        </span>
                      )}
                      <span className="sc-display block text-sm font-bold leading-tight text-white sm:text-base">{game.title}</span>
                    </span>
                  </TiltCard>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ---------- PC zones ---------- */}
      {showcase.zones.length > 0 && (
        <section id="zones" className="relative scroll-mt-16 px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
          <div className="pointer-events-none absolute right-0 top-1/3 h-96 w-96 rounded-full bg-cyan-500/10 blur-[120px]" aria-hidden="true" />
          <div className="pointer-events-none absolute left-0 bottom-0 h-96 w-96 rounded-full bg-fuchsia-600/10 blur-[120px]" aria-hidden="true" />
          <div className="relative mx-auto max-w-7xl">
            <SectionTitle eyebrow={t('zonesEyebrow')} title={t('zonesTitle')} description={t('zonesDescription', { count: pcCount })} />
            <ul className={`grid gap-6 ${showcase.zones.length === 1 ? 'mx-auto max-w-xl' : showcase.zones.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3'}`}>
              {showcase.zones.map((zone, index) => (
                <Reveal as="li" key={zone.id} delay={index * 0.1}>
                  <ZoneCard zone={zone} labels={specLabels} countLabel={t('pcCount', { count: zone.pc_count })} priceText={priceText} />
                </Reveal>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ---------- Contacts ---------- */}
      <section id="contacts" className="relative scroll-mt-16 px-4 pb-16 pt-12 sm:px-6 sm:pb-24 lg:px-8">
        <Reveal className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] p-[1px]">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 opacity-60" aria-hidden="true" />
          <div className="relative overflow-hidden rounded-[calc(2rem-1px)] bg-[#0a0a14] px-6 py-12 sm:px-12 sm:py-16">
            <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-fuchsia-600/30 blur-[100px]" aria-hidden="true" />
            <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-violet-600/30 blur-[100px]" aria-hidden="true" />
            <div className="relative grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-center">
              <div>
                <h2 className="sc-display text-3xl font-bold leading-tight text-white sm:text-5xl">
                  {t('contactsTitle')} <span className="sc-gradient-text">{showcase.club_name}</span>
                </h2>
                <p className="mt-4 max-w-lg text-base leading-7 text-white/60">{t('contactsDescription')}</p>
                <div className="mt-8 flex flex-wrap gap-3">
                  {showcase.telegram_url && (
                    <a href={showcase.telegram_url} target="_blank" rel="noopener noreferrer" className="sc-cta inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white">
                      <Send size={16} aria-hidden="true" /> Telegram
                    </a>
                  )}
                  {showcase.instagram_url && (
                    <a href={showcase.instagram_url} target="_blank" rel="noopener noreferrer" className="sc-glass inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10">
                      <Instagram size={16} aria-hidden="true" /> Instagram
                    </a>
                  )}
                  {phoneLink && (
                    <a href={phoneLink} className="sc-glass inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10">
                      <Phone size={16} aria-hidden="true" /> {t('call')}
                    </a>
                  )}
                </div>
              </div>
              <ul className="space-y-3">
                {showcase.address && (
                  <ContactRow icon={<MapPin size={18} aria-hidden="true" />} label={t('address')}>
                    {mapLink ? (
                      <a href={mapLink} target="_blank" rel="noopener noreferrer" className="underline decoration-white/20 underline-offset-4 hover:decoration-white">
                        {showcase.address}
                      </a>
                    ) : showcase.address}
                  </ContactRow>
                )}
                {showcase.opening_hours && (
                  <ContactRow icon={<Clock size={18} aria-hidden="true" />} label={t('hours')}>{showcase.opening_hours}</ContactRow>
                )}
                {showcase.phone && (
                  <ContactRow icon={<Phone size={18} aria-hidden="true" />} label={t('phone')}>
                    {phoneLink ? <a href={phoneLink} className="hover:text-white">{showcase.phone}</a> : showcase.phone}
                  </ContactRow>
                )}
              </ul>
            </div>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-white/5 px-4 py-8 text-center text-xs text-white/35">
        © {new Date().getFullYear()} {showcase.club_name}
      </footer>
    </div>
  );
}

function ContactRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <li className="sc-glass flex items-start gap-4 rounded-2xl p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/30 to-cyan-400/20 text-white ring-1 ring-white/10">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-white/40">{label}</span>
        <span className="block break-words text-sm font-medium text-white/90 sm:text-base">{children}</span>
      </span>
    </li>
  );
}

interface ZoneCardProps {
  zone: PublicShowcaseZone;
  labels: { gpu: string; cpu: string; ram: string; monitor: string };
  countLabel: string;
  priceText: (price: number) => string;
}

function ZoneCard({ zone, labels, countLabel, priceText }: ZoneCardProps) {
  return (
    <article className="sc-zone group h-full rounded-3xl">
      <div className="flex h-full flex-col overflow-hidden rounded-3xl bg-[#0b0b16]/95">
        <div className="relative aspect-[16/9] overflow-hidden">
          {zone.image_url ? (
            <span className="absolute inset-0 block transition-transform duration-700 group-hover:scale-105">
              <ShimmerImage src={zone.image_url} alt={zone.name} />
            </span>
          ) : (
            <span className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(139,92,246,0.45),transparent_60%),radial-gradient(circle_at_80%_80%,rgba(34,211,238,0.35),transparent_55%)]">
              <Monitor size={56} className="text-white/50" aria-hidden="true" />
            </span>
          )}
          <span className="absolute inset-0 bg-gradient-to-t from-[#0b0b16] via-[#0b0b16]/20 to-transparent" />
          <span className="sc-glass absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white">
            <Monitor size={13} aria-hidden="true" />
            {countLabel}
          </span>
        </div>
        <div className="flex flex-1 flex-col p-6">
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
            <h3 className="sc-display text-2xl font-bold text-white">{zone.name}</h3>
            {zone.price_per_hour !== null && (
              <p className="text-right">
                <span className="sc-display sc-gradient-text block whitespace-nowrap text-xl font-bold">{priceText(zone.price_per_hour)}</span>
              </p>
            )}
          </div>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            <Spec icon={<MonitorPlay size={16} aria-hidden="true" />} label={labels.gpu} value={zone.gpu} />
            <Spec icon={<Cpu size={16} aria-hidden="true" />} label={labels.cpu} value={zone.cpu} />
            <Spec icon={<MemoryStick size={16} aria-hidden="true" />} label={labels.ram} value={zone.ram} />
            <Spec icon={<Monitor size={16} aria-hidden="true" />} label={labels.monitor} value={zone.monitor} />
          </ul>
          {zone.peripherals && (
            <p className="mt-5 flex items-start gap-2 border-t border-white/5 pt-5 text-sm leading-6 text-white/60">
              <Keyboard size={16} className="mt-1 shrink-0 text-fuchsia-300" aria-hidden="true" />
              {zone.peripherals}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
