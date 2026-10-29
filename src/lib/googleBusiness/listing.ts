// Pure rules for the editable part of a Google Business Profile listing:
// description, phone, website and opening hours. Shared by the listing form
// and the /api/google-business/listing route.

import { formatPhone } from '@/lib/formatters';

export const WEEK_DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

export const LISTING_FIELDS = ['description', 'phone', 'website', 'hours'] as const;
export type ListingField = (typeof LISTING_FIELDS)[number];

export const DESCRIPTION_MAX = 750;

/** Fields read from Google; `title` is shown but not edited (renaming triggers re-verification). */
export const LISTING_READ_MASK = 'title,profile,phoneNumbers,websiteUri,regularHours';

/** One opening range per day. `close` at or before `open` runs past midnight. */
export interface DayHours {
  closed: boolean;
  allDay: boolean;
  open: string;
  close: string;
}

export interface ListingInfoForm {
  description: string;
  phone: string;
  website: string;
  hours: Record<WeekDay, DayHours>;
}

export interface ListingInfo extends ListingInfoForm {
  title: string;
  /** The listing has several ranges on one day; the form can only keep one. */
  splitHours: boolean;
}

export type ListingError = 'description_too_long' | 'phone_invalid' | 'website_invalid' | 'hours_invalid' | 'nothing_changed';

/** Half-hour steps; `24:00` is only valid as a closing time. */
export const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hours = String(Math.floor(index / 2)).padStart(2, '0');
  return `${hours}:${index % 2 ? '30' : '00'}`;
});

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function emptyDayHours(): DayHours {
  return { closed: true, allDay: false, open: '10:00', close: '22:00' };
}

interface GoogleTime { hours?: number; minutes?: number }
interface GooglePeriod { openDay?: string; openTime?: GoogleTime; closeDay?: string; closeTime?: GoogleTime }
export interface GoogleLocationInfo {
  title?: string;
  profile?: { description?: string };
  phoneNumbers?: { primaryPhone?: string; additionalPhones?: string[] };
  websiteUri?: string;
  regularHours?: { periods?: GooglePeriod[] };
}

const pad = (value: number) => String(value).padStart(2, '0');
const toClock = (time: GoogleTime | undefined) => `${pad(time?.hours ?? 0)}:${pad(time?.minutes ?? 0)}`;

function toGoogleTime(clock: string): GoogleTime {
  const [hours, minutes] = clock.split(':').map(Number);
  // Google rejects explicit zero fields in some periods; omit them.
  return { ...(hours ? { hours } : {}), ...(minutes ? { minutes } : {}) };
}

const nextDay = (day: WeekDay): WeekDay => WEEK_DAYS[(WEEK_DAYS.indexOf(day) + 1) % 7];

export function fromGoogleLocation(location: GoogleLocationInfo): ListingInfo {
  const hours = Object.fromEntries(WEEK_DAYS.map((day) => [day, emptyDayHours()])) as Record<WeekDay, DayHours>;
  const seen = new Set<WeekDay>();
  let splitHours = false;
  for (const period of location.regularHours?.periods ?? []) {
    const day = period.openDay as WeekDay;
    if (!WEEK_DAYS.includes(day)) continue;
    if (seen.has(day)) {
      splitHours = true;
      continue;
    }
    seen.add(day);
    const open = toClock(period.openTime);
    const allDay = open === '00:00' && (period.closeTime?.hours ?? 0) === 24;
    // Google writes a midnight close as 24:00; the form calls it 00:00.
    const close = (period.closeTime?.hours ?? 0) === 24 ? '00:00' : toClock(period.closeTime);
    hours[day] = { closed: false, allDay, open: allDay ? '00:00' : open, close: allDay ? '00:00' : close };
  }
  return {
    title: location.title ?? '',
    description: location.profile?.description ?? '',
    phone: formatPhone(location.phoneNumbers?.primaryPhone),
    website: location.websiteUri ?? '',
    hours,
    splitHours,
  };
}

export function isWebUrl(value: string): boolean {
  try {
    return ['https:', 'http:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function isPhone(value: string): boolean {
  if (!/^\+?[\d\s()-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15;
}

function validDay(day: DayHours) {
  return day.closed || day.allDay || (TIME.test(day.open) && TIME.test(day.close));
}

export function validateListingInfo(form: ListingInfoForm, fields: readonly ListingField[]): ListingError | null {
  if (fields.length === 0) return 'nothing_changed';
  if (fields.includes('description') && form.description.length > DESCRIPTION_MAX) return 'description_too_long';
  if (fields.includes('phone') && form.phone.trim() && !isPhone(form.phone.trim())) return 'phone_invalid';
  if (fields.includes('website') && form.website.trim() && !isWebUrl(form.website.trim())) return 'website_invalid';
  if (fields.includes('hours') && !WEEK_DAYS.every((day) => validDay(form.hours[day]))) return 'hours_invalid';
  return null;
}

/** Accepts an untrusted request body; returns null when its shape is wrong. */
export function parseListingUpdate(value: unknown): { form: ListingInfoForm; fields: ListingField[] } | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as { form?: unknown; fields?: unknown };
  if (!Array.isArray(body.fields) || !body.fields.every((field) => LISTING_FIELDS.includes(field as ListingField))) return null;
  if (!body.form || typeof body.form !== 'object') return null;
  const form = body.form as Record<string, unknown>;
  const text = (key: string) => (typeof form[key] === 'string' ? (form[key] as string) : '');
  const rawHours = (form.hours && typeof form.hours === 'object' ? form.hours : {}) as Record<string, unknown>;
  const hours = {} as Record<WeekDay, DayHours>;
  for (const day of WEEK_DAYS) {
    const raw = rawHours[day] as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== 'object') return null;
    hours[day] = {
      closed: raw.closed === true,
      allDay: raw.allDay === true,
      open: typeof raw.open === 'string' ? raw.open : '',
      close: typeof raw.close === 'string' ? raw.close : '',
    };
  }
  return {
    form: { description: text('description'), phone: text('phone'), website: text('website'), hours },
    fields: [...new Set(body.fields as ListingField[])],
  };
}

export function buildPeriods(hours: Record<WeekDay, DayHours>): GooglePeriod[] {
  return WEEK_DAYS.flatMap((day) => {
    const value = hours[day];
    if (value.closed) return [];
    if (value.allDay) return [{ openDay: day, openTime: {}, closeDay: day, closeTime: { hours: 24 } }];
    // A close at or before the open time is after midnight, on the next day.
    const closeDay = value.close <= value.open ? nextDay(day) : day;
    // Closing at midnight is written as 24:00 of the same day.
    if (value.close === '00:00') return [{ openDay: day, openTime: toGoogleTime(value.open), closeDay: day, closeTime: { hours: 24 } }];
    return [{ openDay: day, openTime: toGoogleTime(value.open), closeDay, closeTime: toGoogleTime(value.close) }];
  });
}

/**
 * The PATCH body and update mask for the changed fields. `additionalPhones`
 * comes from the live listing so replacing `phoneNumbers` keeps them.
 */
export function buildListingPatch(form: ListingInfoForm, fields: readonly ListingField[], additionalPhones: string[] = []) {
  const body: GoogleLocationInfo = {};
  const mask: string[] = [];
  if (fields.includes('description')) {
    body.profile = { description: form.description.trim() };
    mask.push('profile.description');
  }
  if (fields.includes('phone')) {
    body.phoneNumbers = { primaryPhone: form.phone.trim(), ...(additionalPhones.length ? { additionalPhones } : {}) };
    mask.push('phoneNumbers');
  }
  if (fields.includes('website')) {
    body.websiteUri = form.website.trim();
    mask.push('websiteUri');
  }
  if (fields.includes('hours')) {
    body.regularHours = { periods: buildPeriods(form.hours) };
    mask.push('regularHours');
  }
  return { body, updateMask: mask.join(',') };
}

/** Which fields differ between the loaded listing and the edited form. */
export function changedListingFields(original: ListingInfoForm, form: ListingInfoForm): ListingField[] {
  const changed: ListingField[] = [];
  if (original.description !== form.description) changed.push('description');
  if (original.phone !== form.phone) changed.push('phone');
  if (original.website !== form.website) changed.push('website');
  if (JSON.stringify(original.hours) !== JSON.stringify(form.hours)) changed.push('hours');
  return changed;
}
