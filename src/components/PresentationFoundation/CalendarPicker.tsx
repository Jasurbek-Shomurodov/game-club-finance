'use client';

import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from 'date-fns';
import { CalendarDays, CalendarRange, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { formatDatePickerValue, formatYearMonth } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Button } from './Button';
import { isTopModal, trapFocus, useFocusOrigin, useModalLayer } from './Modal';
import { SCRIM_CLASS, backdropMotion, sheetMotion, usePresence } from './motion';

/**
 * Dialog plumbing shared by the date and month pickers: joins the modal stack
 * (so Escape inside a picker opened from a form modal only closes the picker),
 * traps Tab, locks body scroll, focuses the selected cell and restores focus.
 */
function usePickerDialog(open: boolean, onClose: () => void, panelRef: RefObject<HTMLElement | null>) {
  const layerId = useModalLayer(open);
  const focusOrigin = useFocusOrigin(open);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>('[data-picker-selected="true"]:not([disabled])') ??
      panel?.querySelector<HTMLElement>('button:not([disabled])');
    (target ?? panel)?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (!isTopModal(layerId)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      trapFocus(event, panelRef.current);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      focusOrigin?.focus?.({ preventScroll: true });
    };
  }, [focusOrigin, layerId, open, panelRef]);
}

function parseIsoDate(value: string): Date {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function dateToIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateToMonth(date: Date): string {
  return dateToIso(date).slice(0, 7);
}

function clampRange(from: string, to: string) {
  return from <= to ? { from, to } : { from: to, to: from };
}

const weekDayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

interface CalendarDialogProps {
  open: boolean;
  mode: 'single' | 'range';
  from: string;
  to?: string;
  min?: string;
  max?: string;
  onClose: () => void;
  onApply: (from: string, to: string) => void;
}

function CalendarMonth({
  month,
  draftFrom,
  draftTo,
  mode,
  min,
  max,
  onSelect,
  onPrevious,
  onNext,
  previousClassName,
  nextClassName,
}: {
  month: Date;
  draftFrom: string;
  draftTo: string;
  mode: 'single' | 'range';
  min?: string;
  max?: string;
  onSelect: (date: string) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  previousClassName?: string;
  nextClassName?: string;
}) {
  const t = useTranslations('calendar');
  const { locale } = useAppLocale();
  const firstGridDay = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const days = Array.from({ length: 42 }, (_, index) => addDays(firstGridDay, index));
  const monthValue = dateToMonth(month);
  const today = dateToIso(new Date());

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-4 flex h-9 items-center justify-between">
        {onPrevious ? (
          <button
            type="button"
            onClick={onPrevious}
            className={cn('flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900', previousClassName)}
            aria-label={t('previousMonth')}
          >
            <ChevronLeft size={18} />
          </button>
        ) : <span className="h-9 w-9" />}
        <h3 className="text-sm font-extrabold capitalize text-gray-950">
          {formatYearMonth(monthValue, locale)}
        </h3>
        {onNext ? (
          <button
            type="button"
            onClick={onNext}
            className={cn('flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900', nextClassName)}
            aria-label={t('nextMonth')}
          >
            <ChevronRight size={18} />
          </button>
        ) : <span className="h-9 w-9" />}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weekDayKeys.map((key) => (
          <div key={key} className="flex h-8 items-center justify-center text-[11px] font-bold uppercase text-gray-400">
            {t(`weekdays.${key}`)}
          </div>
        ))}
        {days.map((day) => {
          const iso = dateToIso(day);
          const outsideMonth = dateToMonth(day) !== monthValue;
          const disabled = Boolean((min && iso < min) || (max && iso > max));
          const endpoint = iso === draftFrom || (mode === 'range' && Boolean(draftTo) && iso === draftTo);
          const inRange = mode === 'range' && Boolean(draftFrom && draftTo) && iso > draftFrom && iso < draftTo;

          return (
            <button
              key={iso}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(iso)}
              className={cn(
                'relative flex h-10 items-center justify-center rounded-xl text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1',
                outsideMonth ? 'text-gray-300' : 'text-gray-700 hover:bg-primary-50 hover:text-primary-700',
                inRange && 'rounded-none bg-primary-50 text-primary-700 hover:bg-primary-100',
                endpoint && 'bg-primary-600 text-on-accent shadow-sm hover:bg-primary-700 hover:text-on-accent',
                iso === today && !endpoint && 'ring-1 ring-inset ring-primary-300',
                disabled && 'cursor-not-allowed text-gray-200 hover:bg-transparent hover:text-gray-200',
              )}
              aria-label={formatDatePickerValue(iso, locale)}
              aria-pressed={endpoint || inRange}
              data-picker-selected={endpoint || undefined}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CalendarDialog({ open, mode, from, to = '', min, max, onClose, onApply }: CalendarDialogProps) {
  const t = useTranslations('calendar');
  const { locale } = useAppLocale();
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(mode === 'single' ? from : to);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(parseIsoDate(from)));

  useEffect(() => {
    if (!open) return;
    setDraftFrom(from);
    setDraftTo(mode === 'single' ? from : to);
    setViewMonth(startOfMonth(parseIsoDate(from || to)));
  }, [from, mode, open, to]);

  const panelRef = useRef<HTMLElement>(null);
  usePickerDialog(open, onClose, panelRef);
  const { mounted, visible } = usePresence(open);

  const presets = useMemo(() => {
    // Callers cap pickers at the club's business date; "today" presets must not
    // run past it (early morning before the business-day rollover).
    const deviceToday = dateToIso(new Date());
    const todayDate = parseIsoDate(max && max < deviceToday ? max : deviceToday);
    const today = dateToIso(todayDate);
    const yesterday = dateToIso(subDays(todayDate, 1));
    const thisWeekFrom = dateToIso(startOfWeek(todayDate, { weekStartsOn: 1 }));
    const thisWeekTo = dateToIso(endOfWeek(todayDate, { weekStartsOn: 1 }));
    const lastWeekDate = subDays(startOfWeek(todayDate, { weekStartsOn: 1 }), 1);
    const nextWeekDate = addDays(endOfWeek(todayDate, { weekStartsOn: 1 }), 1);
    const currentMonth = startOfMonth(todayDate);
    const previousMonth = subMonths(currentMonth, 1);
    const followingMonth = addMonths(currentMonth, 1);

    return [
      { key: 'today', from: today, to: today },
      { key: 'yesterday', from: yesterday, to: yesterday },
      { key: 'last7Days', from: dateToIso(subDays(todayDate, 6)), to: today },
      {
        key: 'lastWeek',
        from: dateToIso(startOfWeek(lastWeekDate, { weekStartsOn: 1 })),
        to: dateToIso(endOfWeek(lastWeekDate, { weekStartsOn: 1 })),
      },
      { key: 'thisWeek', from: thisWeekFrom, to: thisWeekTo },
      { key: 'thisMonth', from: dateToIso(currentMonth), to: dateToIso(endOfMonth(currentMonth)) },
      { key: 'lastMonth', from: dateToIso(previousMonth), to: dateToIso(endOfMonth(previousMonth)) },
      {
        key: 'nextWeek',
        from: dateToIso(startOfWeek(nextWeekDate, { weekStartsOn: 1 })),
        to: dateToIso(endOfWeek(nextWeekDate, { weekStartsOn: 1 })),
      },
      { key: 'nextMonth', from: dateToIso(followingMonth), to: dateToIso(endOfMonth(followingMonth)) },
    ]
      // Drop presets entirely outside [min, max] and clamp the rest into it.
      .filter((preset) => (!max || preset.from <= max) && (!min || preset.to >= min))
      .map((preset) => ({
        ...preset,
        from: min && preset.from < min ? min : preset.from,
        to: max && preset.to > max ? max : preset.to,
      }));
  }, [max, min]);

  if (!mounted) return null;

  function selectDate(date: string) {
    if (mode === 'single') {
      onApply(date, date);
      onClose();
      return;
    }

    if (!draftFrom || draftTo) {
      setDraftFrom(date);
      setDraftTo('');
      return;
    }

    const range = clampRange(draftFrom, date);
    onApply(range.from, range.to);
    onClose();
  }

  function selectPreset(presetFrom: string, presetTo: string) {
    const range = clampRange(presetFrom, presetTo);
    onApply(range.from, range.to);
    onClose();
  }

  const secondMonth = addMonths(viewMonth, 1);

  return createPortal(
    <div
      className={cn('fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4', !open && 'pointer-events-none')}
      aria-hidden={!open || undefined}
      onMouseDown={() => open && onClose()}
    >
      <div className={cn('absolute inset-0', SCRIM_CLASS, backdropMotion(visible))} aria-hidden="true" />
      <section
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'range' ? t('selectRange') : t('selectDate')}
        className={cn(
          'relative flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-gray-200 bg-surface shadow-2xl outline-none sm:rounded-2xl',
          sheetMotion(visible),
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 border-b border-gray-100 px-4 py-4 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
              {mode === 'range' ? <CalendarRange size={20} /> : <CalendarDays size={20} />}
            </span>
            <div>
              <h2 className="text-base font-extrabold text-gray-950 sm:text-lg">
                {mode === 'range' ? t('selectRange') : t('selectDate')}
              </h2>
              <p className="mt-0.5 text-xs font-medium text-gray-500 sm:text-sm">{t('description')}</p>
            </div>
          </div>

          <div className={cn('mt-4 grid gap-2', mode === 'range' ? 'sm:grid-cols-[1fr_auto_1fr]' : 'sm:max-w-md')}>
            <div className="rounded-xl border border-gray-200 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                {mode === 'range' ? t('from') : t('date')}
              </p>
              <p className="mt-1 text-sm font-extrabold text-gray-900">{formatDatePickerValue(draftFrom, locale)}</p>
            </div>
            {mode === 'range' && (
              <>
                <span className="hidden items-center text-gray-400 sm:flex">→</span>
                <div className="rounded-xl border border-gray-200 px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{t('to')}</p>
                  <p className="mt-1 text-sm font-extrabold text-gray-900">
                    {draftTo ? formatDatePickerValue(draftTo, locale) : t('chooseEndDate')}
                  </p>
                </div>
              </>
            )}
          </div>
        </header>

        <div className={cn('grid min-h-0 flex-1 overflow-y-auto', mode === 'range' ? 'lg:grid-cols-[1fr_190px]' : 'grid-cols-1')}>
          <div className="flex gap-6 p-4 sm:p-5">
            <CalendarMonth
              month={viewMonth}
              draftFrom={draftFrom}
              draftTo={draftTo}
              mode={mode}
              min={min}
              max={max}
              onSelect={selectDate}
              onPrevious={() => setViewMonth((current) => subMonths(current, 1))}
              onNext={() => setViewMonth((current) => addMonths(current, 1))}
              nextClassName="md:hidden"
            />
            <div className="hidden min-w-0 flex-1 border-l border-gray-100 pl-6 md:block">
              <CalendarMonth
                month={secondMonth}
                draftFrom={draftFrom}
                draftTo={draftTo}
                mode={mode}
                min={min}
                max={max}
                onSelect={selectDate}
                onNext={() => setViewMonth((current) => addMonths(current, 1))}
              />
            </div>
          </div>

          {mode === 'range' && (
            <aside className="border-t border-gray-100 p-4 lg:border-l lg:border-t-0">
              <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-gray-400">{t('presetRanges')}</h3>
              <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">
                {presets.map((preset) => {
                  const active = preset.from === draftFrom && preset.to === draftTo;
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => selectPreset(preset.from, preset.to)}
                      className={cn(
                        'rounded-lg px-3 py-2 text-left text-xs font-bold transition',
                        active ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                      )}
                    >
                      {t(`presets.${preset.key}`)}
                    </button>
                  );
                })}
              </div>
            </aside>
          )}
        </div>

        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-gray-100 bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="text-xs font-semibold text-gray-500">
            {formatDatePickerValue(draftFrom, locale)}
            {mode === 'range' && draftTo && ` → ${formatDatePickerValue(draftTo, locale)}`}
          </p>
          <Button variant="outline" size="sm" onClick={onClose} className="sm:flex-none">
            {t('cancel')}
          </Button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  name?: string;
  className?: string;
  buttonClassName?: string;
  ariaLabel?: string;
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  disabled = false,
  name,
  className,
  buttonClassName,
  ariaLabel,
}: DatePickerProps) {
  const { locale } = useAppLocale();
  const t = useTranslations('calendar');
  const [open, setOpen] = useState(false);

  return (
    <div className={cn('min-w-0', className)}>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={ariaLabel ?? t('selectDate')}
        className={cn(
          'flex h-11 w-full items-center gap-3 rounded-lg border border-gray-200 bg-surface px-3 text-left text-sm shadow-sm transition hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400',
          buttonClassName,
        )}
      >
        <CalendarDays size={17} className="shrink-0 text-primary-600" />
        <span className="min-w-0 flex-1 truncate font-bold text-gray-950">{formatDatePickerValue(value, locale)}</span>
        <ChevronDown size={16} className="shrink-0 text-gray-400" />
      </button>
      <CalendarDialog
        open={open}
        mode="single"
        from={value}
        min={min}
        max={max}
        onClose={() => setOpen(false)}
        onApply={(nextValue) => onChange(nextValue)}
      />
    </div>
  );
}

interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  fromLabel?: string;
  toLabel?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
}

export function DateRangePicker({
  from,
  to,
  onChange,
  fromLabel,
  toLabel,
  min,
  max,
  disabled = false,
  className,
}: DateRangePickerProps) {
  const t = useTranslations('calendar');
  const { locale } = useAppLocale();
  const [open, setOpen] = useState(false);

  return (
    <div className={cn('min-w-0', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        data-range-trigger
        className="grid min-h-14 w-full grid-cols-[1fr_auto_1fr_auto] items-center gap-2 rounded-xl border border-gray-200 bg-surface px-3 py-2 text-left shadow-sm transition hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:bg-gray-50"
      >
        <span className="min-w-0">
          <span data-range-label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">{fromLabel ?? t('from')}</span>
          <span className="mt-0.5 block truncate text-sm font-bold text-gray-950">{formatDatePickerValue(from, locale)}</span>
        </span>
        <span className="text-gray-300">→</span>
        <span className="min-w-0">
          <span data-range-label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">{toLabel ?? t('to')}</span>
          <span className="mt-0.5 block truncate text-sm font-bold text-gray-950">{formatDatePickerValue(to, locale)}</span>
        </span>
        <CalendarRange size={18} className="shrink-0 text-primary-600" />
      </button>
      <CalendarDialog
        open={open}
        mode="range"
        from={from}
        to={to}
        min={min}
        max={max}
        onClose={() => setOpen(false)}
        onApply={(nextFrom, nextTo) => onChange(clampRange(nextFrom, nextTo))}
      />
    </div>
  );
}

interface MonthPickerProps {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
}

export function MonthPicker({ value, onChange, min, max, disabled = false, className }: MonthPickerProps) {
  const t = useTranslations('calendar');
  const { locale } = useAppLocale();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(value.slice(0, 4)) || new Date().getFullYear());
  const panelRef = useRef<HTMLElement>(null);
  const closeMonthPicker = useMemo(() => () => setOpen(false), []);
  usePickerDialog(open, closeMonthPicker, panelRef);
  const { mounted, visible } = usePresence(open);

  useEffect(() => {
    if (!open) return;
    setYear(Number(value.slice(0, 4)) || new Date().getFullYear());
  }, [open, value]);

  return (
    <div className={cn('min-w-0', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex h-11 w-full items-center gap-3 rounded-lg border border-gray-200 bg-surface px-3 text-left text-sm shadow-sm transition hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:bg-gray-50"
      >
        <CalendarDays size={17} className="shrink-0 text-primary-600" />
        <span className="min-w-0 flex-1 truncate font-bold capitalize text-gray-950">{formatYearMonth(value, locale)}</span>
        <ChevronDown size={16} className="shrink-0 text-gray-400" />
      </button>

      {mounted && createPortal(
        <div
          className={cn('fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4', !open && 'pointer-events-none')}
          aria-hidden={!open || undefined}
          onMouseDown={() => setOpen(false)}
        >
          <div className={cn('absolute inset-0', SCRIM_CLASS, backdropMotion(visible))} aria-hidden="true" />
          <section
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={t('selectMonth')}
            className={cn(
              'relative flex max-h-[94dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-gray-200 bg-surface shadow-2xl outline-none sm:rounded-2xl',
              sheetMotion(visible),
            )}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex shrink-0 items-center gap-3 border-b border-gray-100 px-4 py-4 sm:px-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600"><CalendarDays size={20} /></span>
              <div>
                <h2 className="text-lg font-extrabold text-gray-950">{t('selectMonth')}</h2>
                <p className="text-sm font-medium text-gray-500">{t('monthDescription')}</p>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setYear((current) => current - 1)} disabled={Boolean(min && `${year - 1}-12` < min)} className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30" aria-label={t('previousYear')}><ChevronLeft size={19} /></button>
                <p className="font-extrabold text-gray-950">{year}</p>
                <button type="button" onClick={() => setYear((current) => current + 1)} disabled={Boolean(max && `${year + 1}-01` > max)} className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30" aria-label={t('nextYear')}><ChevronRight size={19} /></button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`).map((month) => {
                  const unavailable = Boolean((min && month < min) || (max && month > max));
                  return (
                    <button
                      key={month}
                      type="button"
                      disabled={unavailable}
                      aria-pressed={value === month}
                      data-picker-selected={value === month || undefined}
                      onClick={() => {
                        onChange(month);
                        setOpen(false);
                      }}
                      className={cn(
                        'min-h-12 rounded-xl px-3 text-sm font-bold capitalize transition',
                        value === month ? 'bg-primary-600 text-on-accent shadow-sm' : 'bg-gray-50 text-gray-700 hover:bg-primary-50 hover:text-primary-700',
                        unavailable && 'cursor-not-allowed bg-gray-50 text-gray-300 hover:bg-gray-50 hover:text-gray-300',
                      )}
                    >
                      {formatYearMonth(month, locale)}
                    </button>
                  );
                })}
              </div>
            </div>
            <footer className="flex shrink-0 justify-end gap-2 border-t border-gray-100 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>{t('cancel')}</Button>
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}
