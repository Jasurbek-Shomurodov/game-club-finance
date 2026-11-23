import type { CSSProperties, ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Armchair, Gamepad, Tv, Cpu, Gamepad2, Headphones, Keyboard, MemoryStick, Monitor, MonitorPlay, Mouse, Sparkles, Zap } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import type { PublicShowcaseZone } from '@/lib/showcase';
import { Reveal } from './Reveal';
import { ShimmerImage } from './ShimmerImage';

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

/** Heading level of a card title: h3 under a page section, h5 inside a club panel of the brand page. */
export type CardHeading = 'h3' | 'h4' | 'h5';

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
          <dt className="order-2 mt-1 text-xs font-medium uppercase tracking-wider text-white/60">{stat.label}</dt>
          <dd className="sc-display order-1 whitespace-nowrap text-xl font-bold text-white sm:text-3xl">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <Reveal className="mx-auto mb-10 max-w-2xl text-center sm:mb-14">
      <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-violet-200/90">
        <Sparkles size={13} aria-hidden="true" />
        {eyebrow}
      </p>
      <h2 className="sc-display text-3xl font-bold text-white sm:text-4xl">{title}</h2>
      {description && <p className="mt-4 text-base leading-7 text-white/70">{description}</p>}
    </Reveal>
  );
}

/** Titles in the scrolling strip; more only widen an already off-screen track. */
const MARQUEE_LIMIT = 12;

export function Marquee({ items, reverse = false }: { items: string[]; reverse?: boolean }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, MARQUEE_LIMIT);
  // The track holds two copies and slides by half its width, so the loop is seamless.
  const repeated = Array.from({ length: Math.ceil(MARQUEE_LIMIT / shown.length) }, () => shown).flat();
  return (
    <div className="relative border-y border-white/5 bg-white/[0.015] py-4">
      <div className="sc-marquee overflow-hidden py-2" aria-hidden="true">
        <div className="sc-marquee-track" data-reverse={reverse} style={{ '--duration': `${Math.max(25, repeated.length * 3)}s` } as CSSProperties}>
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0 items-center">
              {repeated.map((item, index) => (
                <span key={`${copy}-${index}`} className="sc-display sc-marquee-item flex items-center whitespace-nowrap px-6 text-2xl font-bold text-white/15 sm:text-4xl">
                  {item}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Spec({ icon, label, value }: { icon: ReactNode; label: string; value: string | null }) {
  if (!value) return null;
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-violet-300 ring-1 ring-white/10">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold uppercase tracking-wider text-white/70">{label}</span>
        <span className="block break-words text-sm font-medium text-white/90">{value}</span>
      </span>
    </li>
  );
}

export async function ZoneGrid({ zones, heading: Heading = 'h3' }: { zones: PublicShowcaseZone[]; heading?: CardHeading }) {
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
  // One zone lies flat across the page on a wide screen: photo beside its specs, no empty margins.
  const single = zones.length === 1;
  const columns = single ? '' : zones.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3';
  return (
    <ul className={`grid gap-6 ${columns}`}>
      {zones.map((zone, index) => (
        <Reveal as="li" key={zone.id} delay={index * 0.1}>
          <article className="sc-zone group h-full rounded-3xl">
            <div className={`flex h-full flex-col overflow-hidden rounded-3xl bg-[#0b0b16]/95 ${single ? 'lg:flex-row' : ''}`}>
              <div className={`relative aspect-[16/9] overflow-hidden ${single ? 'lg:aspect-auto lg:min-h-[20rem] lg:w-1/2' : ''}`}>
                {zone.image_url ? (
                  <span className="absolute inset-0 block transition-transform duration-700 group-hover:scale-105">
                    <ShimmerImage src={zone.image_url} alt={zone.name} />
                  </span>
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(139,92,246,0.45),transparent_60%),radial-gradient(circle_at_80%_80%,rgba(139,92,246,0.35),transparent_55%)]">
                    {zone.kind === 'playstation'
                      ? <Gamepad2 size={56} className="text-white/60" aria-hidden="true" />
                      : <Monitor size={56} className="text-white/60" aria-hidden="true" />}
                  </span>
                )}
                <span className="absolute inset-0 bg-gradient-to-t from-[#0b0b16] via-[#0b0b16]/20 to-transparent" />
                <span className="absolute left-4 top-4 flex flex-wrap gap-2">
                  <span className="sc-glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white">
                    {zone.kind === 'playstation' ? <Gamepad2 size={13} aria-hidden="true" /> : <Monitor size={13} aria-hidden="true" />}
                    {zone.kind === 'playstation' ? t('consoleCount', { count: zone.pc_count }) : t('pcCount', { count: zone.pc_count })}
                  </span>
                  {zone.monitor_refresh_hz && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-600/90 px-3 py-1 text-xs font-bold text-white">
                      <Zap size={12} aria-hidden="true" />
                      {t('hertz', { value: zone.monitor_refresh_hz })}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex flex-1 flex-col p-6">
                <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
                  <Heading className="sc-display text-2xl font-bold text-white">{zone.name}</Heading>
                  {zone.price_per_hour !== null && (
                    <p className="sc-display sc-num whitespace-nowrap text-xl font-bold text-lime-300">
                      {t('perHour', { price: formatCurrency(zone.price_per_hour), currency: tc('currency') })}
                    </p>
                  )}
                </div>
                {zone.peripherals && <p className="mt-2 text-sm leading-6 text-white/75">{zone.peripherals}</p>}
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
                    <Spec icon={<Monitor size={16} aria-hidden="true" />} label={t('monitor')} value={monitorText(zone)} />
                  </ul>
                )}
                {zone.kind !== 'playstation' && [zone.mouse, zone.keyboard, zone.headset, zone.chair].some(Boolean) && (
                  <ul className="mt-5 grid gap-4 border-t border-white/5 pt-5 sm:grid-cols-2">
                    <Spec icon={<Mouse size={16} aria-hidden="true" />} label={t('mouse')} value={zone.mouse} />
                    <Spec icon={<Keyboard size={16} aria-hidden="true" />} label={t('keyboard')} value={zone.keyboard} />
                    <Spec icon={<Headphones size={16} aria-hidden="true" />} label={t('headset')} value={zone.headset} />
                    <Spec icon={<Armchair size={16} aria-hidden="true" />} label={t('chair')} value={zone.chair} />
                  </ul>
                )}
              </div>
            </div>
          </article>
        </Reveal>
      ))}
    </ul>
  );
}
