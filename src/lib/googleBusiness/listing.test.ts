import { describe, expect, it } from 'vitest';
import {
  WEEK_DAYS,
  buildListingPatch,
  buildPeriods,
  changedListingFields,
  emptyDayHours,
  fromGoogleLocation,
  parseListingUpdate,
  validateListingInfo,
  type DayHours,
  type ListingInfoForm,
  type WeekDay,
} from './listing';

function week(day: Partial<DayHours> = {}): Record<WeekDay, DayHours> {
  return Object.fromEntries(WEEK_DAYS.map((name) => [name, { ...emptyDayHours(), ...day }])) as Record<WeekDay, DayHours>;
}

function form(patch: Partial<ListingInfoForm> = {}): ListingInfoForm {
  return { description: 'Gaming club', phone: '+998 90 123 45 67', website: 'https://pixelgaming.uz', hours: week(), ...patch };
}

describe('fromGoogleLocation', () => {
  it('reads description, phone, website and hours', () => {
    const info = fromGoogleLocation({
      title: 'Pixel Gaming',
      profile: { description: 'PCs and consoles' },
      phoneNumbers: { primaryPhone: '+998901234567' },
      websiteUri: 'https://pixelgaming.uz',
      regularHours: {
        periods: [
          { openDay: 'MONDAY', openTime: { hours: 10 }, closeDay: 'TUESDAY', closeTime: { hours: 2, minutes: 30 } },
          { openDay: 'SATURDAY', openTime: {}, closeDay: 'SATURDAY', closeTime: { hours: 24 } },
          { openDay: 'SUNDAY', openTime: { hours: 12 }, closeDay: 'SUNDAY', closeTime: { hours: 24 } },
        ],
      },
    });
    expect(info).toMatchObject({ title: 'Pixel Gaming', description: 'PCs and consoles', phone: '+998 90 123 45 67', splitHours: false });
    expect(info.hours.MONDAY).toEqual({ closed: false, allDay: false, open: '10:00', close: '02:30' });
    expect(info.hours.SATURDAY).toMatchObject({ closed: false, allDay: true });
    expect(info.hours.SUNDAY).toEqual({ closed: false, allDay: false, open: '12:00', close: '00:00' });
    expect(info.hours.TUESDAY.closed).toBe(true);
  });

  it('flags a day with several ranges', () => {
    const info = fromGoogleLocation({
      regularHours: {
        periods: [
          { openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 13 } },
          { openDay: 'MONDAY', openTime: { hours: 14 }, closeDay: 'MONDAY', closeTime: { hours: 20 } },
        ],
      },
    });
    expect(info.splitHours).toBe(true);
  });
});

describe('buildPeriods', () => {
  it('writes past-midnight, midnight and all-day ranges as Google expects', () => {
    const hours = week();
    hours.MONDAY = { closed: false, allDay: false, open: '10:00', close: '02:00' };
    hours.TUESDAY = { closed: false, allDay: false, open: '10:30', close: '00:00' };
    hours.SUNDAY = { closed: false, allDay: true, open: '00:00', close: '00:00' };
    expect(buildPeriods(hours)).toEqual([
      { openDay: 'MONDAY', openTime: { hours: 10 }, closeDay: 'TUESDAY', closeTime: { hours: 2 } },
      { openDay: 'TUESDAY', openTime: { hours: 10, minutes: 30 }, closeDay: 'TUESDAY', closeTime: { hours: 24 } },
      { openDay: 'SUNDAY', openTime: {}, closeDay: 'SUNDAY', closeTime: { hours: 24 } },
    ]);
  });

  it('round-trips through fromGoogleLocation', () => {
    const hours = week({ closed: false, open: '11:00', close: '03:00' });
    expect(fromGoogleLocation({ regularHours: { periods: buildPeriods(hours) } }).hours).toEqual(hours);
  });
});

describe('buildListingPatch', () => {
  it('sends only the changed fields and keeps other phone numbers', () => {
    expect(buildListingPatch(form(), ['description', 'phone'], ['+998711112233'])).toEqual({
      body: { profile: { description: 'Gaming club' }, phoneNumbers: { primaryPhone: '+998 90 123 45 67', additionalPhones: ['+998711112233'] } },
      updateMask: 'profile.description,phoneNumbers',
    });
    expect(buildListingPatch(form(), ['website']).updateMask).toBe('websiteUri');
  });
});

describe('validateListingInfo', () => {
  it('checks only the changed fields', () => {
    expect(validateListingInfo(form(), [])).toBe('nothing_changed');
    expect(validateListingInfo(form({ description: 'x'.repeat(751) }), ['description'])).toBe('description_too_long');
    expect(validateListingInfo(form({ phone: 'call me' }), ['phone'])).toBe('phone_invalid');
    expect(validateListingInfo(form({ phone: 'call me' }), ['website'])).toBeNull();
    expect(validateListingInfo(form({ website: 'pixelgaming' }), ['website'])).toBe('website_invalid');
    expect(validateListingInfo(form({ hours: week({ closed: false, open: '25:00' }) }), ['hours'])).toBe('hours_invalid');
    expect(validateListingInfo(form({ phone: '', website: '' }), ['phone', 'website'])).toBeNull();
  });
});

describe('parseListingUpdate and changedListingFields', () => {
  it('rejects unknown fields and missing days', () => {
    expect(parseListingUpdate({ form: form(), fields: ['title'] })).toBeNull();
    expect(parseListingUpdate({ form: { ...form(), hours: {} }, fields: ['hours'] })).toBeNull();
    expect(parseListingUpdate({ form: form(), fields: ['phone', 'phone'] })?.fields).toEqual(['phone']);
  });

  it('lists what the form changed', () => {
    const hours = week();
    hours.FRIDAY = { closed: false, allDay: true, open: '00:00', close: '00:00' };
    expect(changedListingFields(form(), form({ website: '', hours }))).toEqual(['website', 'hours']);
  });
});
