// Shared date and business-day utilities.

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DEFAULT_BUSINESS_DAY_START_HOUR = 0;

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeBusinessDayStartHour(value: unknown): number {
  const hour = Number(value);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_BUSINESS_DAY_START_HOUR;
}

export function businessDayDate(date = new Date(), businessDayStartHour = DEFAULT_BUSINESS_DAY_START_HOUR): Date {
  const d = new Date(date);
  const startHour = normalizeBusinessDayStartHour(businessDayStartHour);

  if (d.getHours() < startHour) {
    d.setDate(d.getDate() - 1);
  }

  return d;
}

export function todayIso(date = new Date(), businessDayStartHour = DEFAULT_BUSINESS_DAY_START_HOUR): string {
  return isoDate(businessDayDate(date, businessDayStartHour));
}

/** The clubs operate in Uzbekistan; see docs/agents/architecture.md (Localization). */
export const APP_TIME_ZONE = 'Asia/Tashkent';

/**
 * Business date for server code. Servers run in UTC, so `todayIso` (which uses
 * the process's local clock) would disagree with a browser in Tashkent for
 * several hours every day. This reads the wall clock in APP_TIME_ZONE instead,
 * then applies the same business-day rollback.
 */
export function serverTodayIso(
  date = new Date(),
  businessDayStartHour = DEFAULT_BUSINESS_DAY_START_HOUR,
  timeZone = APP_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  // Build a timezone-free local date from the zone's wall-clock fields.
  const wallClock = new Date(part('year'), part('month') - 1, part('day'), part('hour'));
  return todayIso(wallClock, businessDayStartHour);
}

export function calendarTodayIso(date = new Date()): string {
  return isoDate(date);
}

export function currentYearMonth(date = new Date(), businessDayStartHour = DEFAULT_BUSINESS_DAY_START_HOUR): string {
  const d = businessDayDate(date, businessDayStartHour);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** The calendar month after a YYYY-MM month, as YYYY-MM. */
export function nextYearMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

export function monthRange(yearMonth: string): { from: string; to: string } {
  const [year, month] = yearMonth.split('-').map(Number);
  const fromDate = new Date(year, month - 1, 1);
  const toDate = new Date(year, month, 0);
  const from = isoDate(fromDate);
  const to = isoDate(toDate);
  return { from, to };
}
