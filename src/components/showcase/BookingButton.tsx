'use client';

import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Minus, Plus, Send } from 'lucide-react';
import { formatDateShort } from '@/lib/formatters';
import { bookingTimeSlots, telegramDraftUrl } from '@/lib/showcase';
import { calendarTodayIso } from '@/lib/utils';
import { ShowcaseDialog } from './ShowcaseDialog';

export interface BookingClub {
  slug: string;
  /** The club on its choice chip: "Chilanzar". */
  label: string;
  /** The club as the request names it: "Pixel Gaming — Chilanzar". */
  messageName: string;
  telegramUrl: string;
  zones: string[];
}

interface BookingButtonProps {
  clubs: BookingClub[];
  /** The club the button belongs to; the first one otherwise. */
  initialSlug?: string;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}

type Day = 'today' | 'tomorrow';
const DURATIONS = [1, 2, 3, 5, 7];
const MAX_PEOPLE = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Book a seat": asks where, when, for how long and for how many, then opens
 * the club's Telegram with the request already written. The admin still
 * confirms in the chat; nothing is reserved by this form.
 */
export function BookingButton({ clubs, initialSlug, className, ariaLabel, children }: BookingButtonProps) {
  const t = useTranslations('publicShowcase.booking');
  const locale = useLocale();
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [opened, setOpened] = useState<Date | null>(null);
  const [slug, setSlug] = useState(initialSlug ?? clubs[0]?.slug ?? '');
  const [zone, setZone] = useState<string | null>(null);
  const [day, setDay] = useState<Day>('today');
  const [time, setTime] = useState('');
  const [hours, setHours] = useState(2);
  const [people, setPeople] = useState(1);
  const close = useCallback(() => setOpened(null), []);

  const club = clubs.find((entry) => entry.slug === slug) ?? clubs[0];
  const slots = useMemo(() => (opened ? bookingTimeSlots(opened, day) : []), [opened, day]);
  if (!club) return null;

  function open() {
    const now = new Date();
    // Late in the evening there is no hour left today.
    const firstDay: Day = bookingTimeSlots(now, 'today').length > 0 ? 'today' : 'tomorrow';
    setDay(firstDay);
    setTime(bookingTimeSlots(now, firstDay)[0] ?? '');
    setSlug(initialSlug ?? slug);
    setOpened(now);
  }

  function pickDay(next: Day) {
    setDay(next);
    if (opened) setTime(bookingTimeSlots(opened, next)[0] ?? '');
  }

  function pickClub(next: string) {
    setSlug(next);
    setZone(null);
  }

  const date = opened ? formatDateShort(calendarTodayIso(new Date(opened.getTime() + (day === 'tomorrow' ? DAY_MS : 0))), locale) : '';
  const message = [
    t('messageGreeting', { club: club.messageName }),
    zone ? t('messageZone', { zone }) : null,
    t('messageWhen', { day: t(day), date, time }),
    t('messageHours', { count: hours }),
    t('messagePeople', { count: people }),
  ].filter(Boolean).join('\n');

  const groupLabel = 'mb-2 block text-xs font-semibold uppercase tracking-wider text-white/70';
  const chip = 'sc-chip inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold';
  const stepper = 'flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300';

  return (
    <>
      <button ref={triggerRef} type="button" onClick={open} aria-haspopup="dialog" aria-label={ariaLabel} className={className}>
        {children}
      </button>
      <ShowcaseDialog open={opened !== null} onClose={close} label={t('title')} closeLabel={t('close')} triggerRef={triggerRef}>
        <div className="overflow-y-auto p-5 sm:p-7">
          <h2 className="sc-display pr-12 text-xl font-bold text-white sm:text-2xl">{t('title')}</h2>
          <p className="mt-2 text-sm leading-6 text-white/70">{t('description')}</p>

          <div className="mt-6 space-y-5">
            {clubs.length > 1 && (
              <div role="radiogroup" aria-labelledby={`${id}-club`}>
                <span id={`${id}-club`} className={groupLabel}>{t('club')}</span>
                <div className="flex flex-wrap gap-2">
                  {clubs.map((entry) => (
                    <button key={entry.slug} type="button" role="radio" aria-checked={entry.slug === club.slug} onClick={() => pickClub(entry.slug)} className={chip}>
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {club.zones.length > 0 && (
              <div role="radiogroup" aria-labelledby={`${id}-zone`}>
                <span id={`${id}-zone`} className={groupLabel}>{t('zone')}</span>
                <div className="flex flex-wrap gap-2">
                  <button type="button" role="radio" aria-checked={zone === null} onClick={() => setZone(null)} className={chip}>{t('anyZone')}</button>
                  {club.zones.map((name) => (
                    <button key={name} type="button" role="radio" aria-checked={zone === name} onClick={() => setZone(name)} className={chip}>{name}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <div role="radiogroup" aria-labelledby={`${id}-day`}>
                <span id={`${id}-day`} className={groupLabel}>{t('when')}</span>
                <div className="flex flex-wrap gap-2">
                  {(['today', 'tomorrow'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={day === value}
                      disabled={value === 'today' && opened !== null && bookingTimeSlots(opened, 'today').length === 0}
                      onClick={() => pickDay(value)}
                      className={`${chip} disabled:opacity-40`}
                    >
                      {t(value)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor={`${id}-time`} className={groupLabel}>{t('time')}</label>
                <select
                  id={`${id}-time`}
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  className="sc-num h-11 rounded-xl border border-white/10 bg-[#161624] px-3 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                >
                  {slots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                </select>
              </div>
            </div>

            <div role="radiogroup" aria-labelledby={`${id}-hours`}>
              <span id={`${id}-hours`} className={groupLabel}>{t('duration')}</span>
              <div className="flex flex-wrap gap-2">
                {DURATIONS.map((value) => (
                  <button key={value} type="button" role="radio" aria-checked={hours === value} onClick={() => setHours(value)} className={`${chip} sc-num`}>
                    {t('hoursShort', { count: value })}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span id={`${id}-people`} className={groupLabel}>{t('people')}</span>
              <div className="flex items-center gap-3" role="group" aria-labelledby={`${id}-people`}>
                <button type="button" aria-label={t('fewerPeople')} disabled={people <= 1} onClick={() => setPeople((value) => Math.max(1, value - 1))} className={stepper}>
                  <Minus size={18} aria-hidden="true" />
                </button>
                <output aria-live="polite" className="sc-display sc-num w-8 text-center text-xl font-bold text-white">{people}</output>
                <button type="button" aria-label={t('morePeople')} disabled={people >= MAX_PEOPLE} onClick={() => setPeople((value) => Math.min(MAX_PEOPLE, value + 1))} className={stepper}>
                  <Plus size={18} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div>
              <span className={groupLabel}>{t('preview')}</span>
              <p className="whitespace-pre-line rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-6 text-white/85">{message}</p>
            </div>
          </div>

          <a
            href={telegramDraftUrl(club.telegramUrl, message)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              // A link that is not a personal account opens without the draft, so the text is on the clipboard too.
              void navigator.clipboard?.writeText(message).catch(() => undefined);
              close();
            }}
            className="sc-cta mt-6 flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold text-white"
          >
            <Send size={18} aria-hidden="true" /> {t('send')}
          </a>
          <p className="mt-3 text-center text-xs leading-5 text-white/60">{t('sendHint')}</p>
        </div>
      </ShowcaseDialog>
    </>
  );
}
