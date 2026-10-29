import type { CSSProperties, ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Armchair, BadgePercent, Clock, Gamepad, Tv, Cpu, Gamepad2, HardDrive, Headphones, Instagram, Keyboard, MapPin, MemoryStick, Monitor, MonitorPlay, Mouse, NotebookPen, Phone, Send, Sparkles, Zap } from 'lucide-react';
import { formatCurrency, formatPhone } from '@/lib/formatters';
import { mapLinks, telHref, type PublicShowcase, type PublicShowcaseGame, type PublicShowcaseOffer, type PublicShowcaseZone } from '@/lib/showcase';
import { MapChooser } from './MapChooser';
import { Reveal } from './Reveal';
import { ShimmerImage } from './ShimmerImage';
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

export const riseDelay = (seconds: number) => ({ '--delay': `${seconds}s` }) as CSSProperties;

/** Hero background: optional photo under drifting aurora blobs, a moving grid floor and sparks. */
export function HeroBackdrop({ imageUrl }: { imageUrl: string | null }) {
  return (
    <>
      {imageUrl && (
        <div className="absolute inset-0 -z-10">
          <ShimmerImage src={imageUrl} alt="" priority imgClassName="opacity-40" />
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
    </>
  );
}

export interface Stat {
  value: ReactNode;
  label: string;
}

/** Glass tiles of headline numbers. */
export function StatGrid({ stats, className, style }: { stats: Stat[]; className?: string; style?: CSSProperties }) {
  if (stats.length === 0) return null;
  const columns = stats.length >= 5
    ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
    : stats.length === 4 ? 'grid-cols-2 lg:grid-cols-4' : stats.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2';
  return (
    <dl className={`grid gap-3 ${columns} ${stats.length >= 5 ? 'max-w-5xl' : ''} ${className ?? ''}`} style={style}>
      {stats.map((stat) => (
        <div key={stat.label} className="sc-glass flex flex-col rounded-2xl px-4 py-5 text-center">
          <dt className="order-2 mt-1 text-xs font-medium uppercase tracking-wider text-white/50">{stat.label}</dt>
          <dd className="sc-display order-1 whitespace-nowrap text-xl font-bold text-white sm:text-3xl">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
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

export function Marquee({ items, reverse = false }: { items: string[]; reverse?: boolean }) {
  if (items.length === 0) return null;
  // The track holds two copies and slides by half its width, so the loop is seamless.
  const repeated = Array.from({ length: Math.max(2, Math.ceil(12 / items.length)) }, () => items).flat();
  return (
    <div className="relative border-y border-white/5 bg-white/[0.015] py-4">
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
    </div>
  );
}

export function GameGrid({ games }: { games: PublicShowcaseGame[] }) {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4 xl:grid-cols-5">
      {games.map((game, index) => (
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

export async function ZoneGrid({ zones }: { zones: PublicShowcaseZone[] }) {
  const t = await getTranslations('publicShowcase');
  const tc = await getTranslations('common');
  // "27″ · 240 Hz" with the model below it; older zones only have the model text.
  const monitorText = (zone: PublicShowcaseZone) => {
    const size = [
      zone.monitor_size_inches ? `${zone.monitor_size_inches}″` : null,
      zone.monitor_refresh_hz ? t('hertz', { value: zone.monitor_refresh_hz }) : null,
    ].filter(Boolean).join(' · ');
    return [size, zone.monitor].filter(Boolean).join(' — ') || null;
  };
  const columns = zones.length === 1 ? 'mx-auto max-w-xl' : zones.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3';
  return (
    <ul className={`grid gap-6 ${columns}`}>
      {zones.map((zone, index) => (
        <Reveal as="li" key={zone.id} delay={index * 0.1}>
          <article className="sc-zone group h-full rounded-3xl">
            <div className="flex h-full flex-col overflow-hidden rounded-3xl bg-[#0b0b16]/95">
              <div className="relative aspect-[16/9] overflow-hidden">
                {zone.image_url ? (
                  <span className="absolute inset-0 block transition-transform duration-700 group-hover:scale-105">
                    <ShimmerImage src={zone.image_url} alt={zone.name} />
                  </span>
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(139,92,246,0.45),transparent_60%),radial-gradient(circle_at_80%_80%,rgba(34,211,238,0.35),transparent_55%)]">
                    {zone.kind === 'playstation'
                      ? <Gamepad2 size={56} className="text-white/50" aria-hidden="true" />
                      : <Monitor size={56} className="text-white/50" aria-hidden="true" />}
                  </span>
                )}
                <span className="absolute inset-0 bg-gradient-to-t from-[#0b0b16] via-[#0b0b16]/20 to-transparent" />
                <span className="absolute left-4 top-4 flex flex-wrap gap-2">
                  <span className="sc-glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white">
                    {zone.kind === 'playstation' ? <Gamepad2 size={13} aria-hidden="true" /> : <Monitor size={13} aria-hidden="true" />}
                    {zone.kind === 'playstation' ? t('consoleCount', { count: zone.pc_count }) : t('pcCount', { count: zone.pc_count })}
                  </span>
                  {zone.monitor_refresh_hz && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-fuchsia-600/80 to-cyan-500/80 px-3 py-1 text-xs font-bold text-white shadow-[0_0_20px_rgba(217,70,239,0.45)]">
                      <Zap size={12} aria-hidden="true" />
                      {t('hertz', { value: zone.monitor_refresh_hz })}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex flex-1 flex-col p-6">
                <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
                  <h3 className="sc-display text-2xl font-bold text-white">{zone.name}</h3>
                  {zone.price_per_hour !== null && (
                    <p className="sc-display sc-gradient-text whitespace-nowrap text-xl font-bold">
                      {t('perHour', { price: formatCurrency(zone.price_per_hour), currency: tc('currency') })}
                    </p>
                  )}
                </div>
                {zone.kind === 'playstation' ? (
                  <ul className="mt-6 grid gap-4 sm:grid-cols-2">
                    <Spec icon={<Gamepad2 size={16} aria-hidden="true" />} label={t('console')} value={zone.console} />
                    <Spec
                      icon={<Gamepad size={16} aria-hidden="true" />}
                      label={t('controllers')}
                      value={zone.controllers ? t('controllersPerConsole', { count: zone.controllers }) : null}
                    />
                    <Spec icon={<Tv size={16} aria-hidden="true" />} label={t('tv')} value={monitorText(zone)} />
                  </ul>
                ) : (
                  <ul className="mt-6 grid gap-4 sm:grid-cols-2">
                    <Spec icon={<MonitorPlay size={16} aria-hidden="true" />} label={t('gpu')} value={zone.gpu} />
                    <Spec icon={<Cpu size={16} aria-hidden="true" />} label={t('cpu')} value={zone.cpu} />
                    <Spec icon={<MemoryStick size={16} aria-hidden="true" />} label={t('ram')} value={zone.ram} />
                    <Spec icon={<HardDrive size={16} aria-hidden="true" />} label={t('storage')} value={zone.storage} />
                    <Spec icon={<Monitor size={16} aria-hidden="true" />} label={t('monitor')} value={monitorText(zone)} />
                  </ul>
                )}
                {[zone.mouse, zone.keyboard, zone.headset, zone.chair].some(Boolean) && (
                  <ul className="mt-5 grid gap-4 border-t border-white/5 pt-5 sm:grid-cols-2">
                    <Spec icon={<Mouse size={16} aria-hidden="true" />} label={t('mouse')} value={zone.mouse} />
                    <Spec icon={<Keyboard size={16} aria-hidden="true" />} label={t('keyboard')} value={zone.keyboard} />
                    <Spec icon={<Headphones size={16} aria-hidden="true" />} label={t('headset')} value={zone.headset} />
                    <Spec icon={<Armchair size={16} aria-hidden="true" />} label={zone.kind === 'playstation' ? t('seating') : t('chair')} value={zone.chair} />
                  </ul>
                )}
                {zone.peripherals && (
                  <p className="mt-5 flex items-start gap-2 border-t border-white/5 pt-5 text-sm leading-6 text-white/60">
                    <NotebookPen size={16} className="mt-1 shrink-0 text-fuchsia-300" aria-hidden="true" />
                    {zone.peripherals}
                  </p>
                )}
              </div>
            </div>
          </article>
        </Reveal>
      ))}
    </ul>
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

/** Social and call buttons for one club. */
export async function ContactButtons({ club, compact = false }: { club: PublicShowcase; compact?: boolean }) {
  const t = await getTranslations('publicShowcase');
  const phoneLink = telHref(club.phone);
  const size = compact ? 'px-4 py-2.5 text-sm' : 'px-5 py-3 text-sm';
  return (
    <div className="flex flex-wrap gap-3">
      {club.telegram_url && (
        <a href={club.telegram_url} target="_blank" rel="noopener noreferrer" className={`sc-cta inline-flex items-center gap-2 rounded-xl font-semibold text-white ${size}`}>
          <Send size={16} aria-hidden="true" /> Telegram
        </a>
      )}
      {club.instagram_url && (
        <a href={club.instagram_url} target="_blank" rel="noopener noreferrer" className={`sc-glass inline-flex items-center gap-2 rounded-xl font-semibold text-white transition-colors hover:bg-white/10 ${size}`}>
          <Instagram size={16} aria-hidden="true" /> Instagram
        </a>
      )}
      {phoneLink && (
        <a href={phoneLink} className={`sc-glass inline-flex items-center gap-2 rounded-xl font-semibold text-white transition-colors hover:bg-white/10 ${size}`}>
          <Phone size={16} aria-hidden="true" /> {t('call')}
        </a>
      )}
    </div>
  );
}

/** Address (with a map link), hours and phone of one club. */
export async function ContactList({ club }: { club: PublicShowcase }) {
  const t = await getTranslations('publicShowcase');
  const phoneLink = telHref(club.phone);
  const maps = mapLinks(club);
  return (
    <ul className="space-y-3">
      {club.address && (
        <ContactRow icon={<MapPin size={18} aria-hidden="true" />} label={t('address')}>
          {maps ? (
            <MapChooser
              address={club.address}
              links={maps}
              labels={{ title: t('mapChooserTitle'), yandex: t('mapYandex'), google: t('mapGoogle') }}
            />
          ) : club.address}
        </ContactRow>
      )}
      {club.opening_hours && (
        <ContactRow icon={<Clock size={18} aria-hidden="true" />} label={t('hours')}>{club.opening_hours}</ContactRow>
      )}
      {club.phone && (
        <ContactRow icon={<Phone size={18} aria-hidden="true" />} label={t('phone')}>
          {phoneLink ? <a href={phoneLink} className="hover:text-white">{formatPhone(club.phone)}</a> : club.phone}
        </ContactRow>
      )}
    </ul>
  );
}

/** Gradient-bordered panel: an invitation with buttons beside the contact list. */
export async function ContactPanel({ club, id }: { club: PublicShowcase; id?: string }) {
  const t = await getTranslations('publicShowcase');
  return (
    <section id={id} className="relative scroll-mt-16 px-4 pb-16 pt-12 sm:px-6 sm:pb-24 lg:px-8">
      <Reveal className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] p-[1px]">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 opacity-60" aria-hidden="true" />
        <div className="relative overflow-hidden rounded-[calc(2rem-1px)] bg-[#0a0a14] px-6 py-12 sm:px-12 sm:py-16">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-fuchsia-600/30 blur-[100px]" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-violet-600/30 blur-[100px]" aria-hidden="true" />
          <div className="relative grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-center">
            <div>
              <h2 className="sc-display text-3xl font-bold leading-tight text-white sm:text-5xl">
                {t('contactsTitle')} <span className="sc-gradient-text">{club.club_name}</span>
              </h2>
              <p className="mt-4 max-w-lg text-base leading-7 text-white/60">{t('contactsDescription')}</p>
              <div className="mt-8">
                <ContactButtons club={club} />
              </div>
            </div>
            <ContactList club={club} />
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/** Ticket-style cards for packages and offers ("2+1", night packages). */
export async function OfferGrid({ offers }: { offers: PublicShowcaseOffer[] }) {
  const tc = await getTranslations('common');
  const columns = offers.length === 1 ? 'mx-auto max-w-xl' : offers.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3';
  return (
    <ul className={`grid gap-6 ${columns}`}>
      {offers.map((offer, index) => (
        <Reveal as="li" key={offer.id} delay={index * 0.08}>
          <article className="sc-offer group relative h-full overflow-hidden rounded-3xl p-[1px]">
            <div className="relative flex h-full flex-col overflow-hidden rounded-[calc(1.5rem-1px)] bg-[#0b0b16] p-6">
              <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-fuchsia-600/25 blur-[60px] transition-opacity duration-500 group-hover:opacity-100" aria-hidden="true" />
              <div className="relative flex flex-wrap items-start justify-between gap-3">
                <span className={`sc-display sc-gradient-text min-w-0 break-all font-black leading-none ${(offer.badge?.length ?? 0) > 4 ? 'text-4xl sm:text-5xl' : 'text-5xl sm:text-6xl'}`}>
                  {offer.badge ?? <BadgePercent size={48} className="text-fuchsia-300" aria-hidden="true" />}
                </span>
                {offer.time_window && (
                  <span className="sc-glass ml-auto inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white/85">
                    <Clock size={13} className="shrink-0" aria-hidden="true" /> <span className="truncate">{offer.time_window}</span>
                  </span>
                )}
              </div>
              <h3 className="sc-display relative mt-5 text-xl font-bold text-white">{offer.title}</h3>
              {offer.description && <p className="relative mt-2 text-sm leading-6 text-white/60">{offer.description}</p>}
              {offer.price !== null && (
                <div className="relative mt-auto pt-6">
                  <div className="sc-offer-cut mb-5" aria-hidden="true" />
                  <p className="sc-display text-2xl font-bold text-white">
                    {formatCurrency(offer.price)} <span className="text-sm font-semibold text-white/50">{tc('currency')}</span>
                  </p>
                </div>
              )}
            </div>
          </article>
        </Reveal>
      ))}
    </ul>
  );
}
