'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Save } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  InlineAlert,
  Input,
  PageSkeleton,
  SectionHeading,
  Select,
  Textarea,
} from '@/components/PresentationFoundation';
import {
  DESCRIPTION_MAX,
  TIME_OPTIONS,
  WEEK_DAYS,
  changedListingFields,
  validateListingInfo,
  type DayHours,
  type ListingInfo,
  type ListingInfoForm,
  type WeekDay,
} from '@/lib/googleBusiness/listing';
import { useClubQuery } from '@/lib/useClubQuery';
import { errorMessageKey, googleBusinessApi } from './googleBusinessApi';

interface GoogleListingCardProps {
  clubId: string;
  isOwner: boolean;
  onSaved: () => void;
}

/** Edits the listing's description, phone, website and opening hours on Google Maps. */
export function GoogleListingCard({ clubId, isOwner, onSaved }: GoogleListingCardProps) {
  const t = useTranslations('googleBusiness');
  const load = useCallback(async (): Promise<{ listing: ListingInfo | null; failed: string | null }> => {
    try {
      return { ...(await googleBusinessApi.listing(clubId)), failed: null };
    } catch (error) {
      return { listing: null, failed: errorMessageKey(error) };
    }
  }, [clubId]);
  const query = useClubQuery(load, { listing: null, failed: null });
  const original = query.data.listing;

  const [form, setForm] = useState<ListingInfoForm | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(original ? { description: original.description, phone: original.phone, website: original.website, hours: original.hours } : null);
    setError('');
  }, [original]);

  function setField<K extends keyof ListingInfoForm>(field: K, value: ListingInfoForm[K]) {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  function setDay(day: WeekDay, patch: Partial<DayHours>) {
    setForm((prev) => (prev ? { ...prev, hours: { ...prev.hours, [day]: { ...prev.hours[day], ...patch } } } : prev));
  }

  function copyToAll(day: WeekDay) {
    setForm((prev) => (prev ? { ...prev, hours: Object.fromEntries(WEEK_DAYS.map((name) => [name, { ...prev.hours[day] }])) as ListingInfoForm['hours'] } : prev));
  }

  const changed = original && form ? changedListingFields(original, form) : [];

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    const validation = validateListingInfo(form, changed);
    if (validation) {
      setError(t(`error_${validation}`));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await googleBusinessApi.saveListing(clubId, form, changed);
      onSaved();
      await query.reload({ silent: true });
    } catch (failure) {
      setError(t(errorMessageKey(failure)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <SectionHeading title={t('listingTitle')} description={original?.title ? t('listingDescription', { title: original.title }) : undefined} />
      </CardHeader>
      <CardBody>
        {query.loading ? (
          <PageSkeleton />
        ) : query.data.failed || !form ? (
          <InlineAlert variant="warning">{t(query.data.failed ?? 'error_generic')}</InlineAlert>
        ) : (
          <form className="space-y-5" onSubmit={save} noValidate>
            {!isOwner && <InlineAlert variant="info">{t('listingOwnerOnly')}</InlineAlert>}
            <fieldset disabled={!isOwner || saving} className="space-y-5">
              <Field label={t('listingAbout')} htmlFor="google-listing-description" hint={t('listingAboutHint')}>
                <Textarea
                  id="google-listing-description"
                  rows={5}
                  showCount
                  maxLength={DESCRIPTION_MAX}
                  value={form.description}
                  onChange={(event) => setField('description', event.target.value)}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('listingPhone')} htmlFor="google-listing-phone">
                  <Input
                    id="google-listing-phone"
                    type="tel"
                    inputMode="tel"
                    placeholder="+998 90 123 45 67"
                    value={form.phone}
                    onChange={(event) => setField('phone', event.target.value)}
                  />
                </Field>
                <Field label={t('listingWebsite')} htmlFor="google-listing-website">
                  <Input
                    id="google-listing-website"
                    type="url"
                    inputMode="url"
                    placeholder="https://"
                    value={form.website}
                    onChange={(event) => setField('website', event.target.value)}
                  />
                </Field>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-gray-800">{t('listingHours')}</p>
                  <p className="text-xs text-gray-500">{t('listingHoursHint')}</p>
                </div>
                {original?.splitHours && <InlineAlert variant="warning">{t('listingSplitHours')}</InlineAlert>}
                <ul className="divide-y divide-gray-100">
                  {WEEK_DAYS.map((day) => {
                    const value = form.hours[day];
                    const showTimes = !value.closed && !value.allDay;
                    return (
                      <li key={day} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
                        <span className="w-28 shrink-0 text-sm font-medium text-gray-900">{t(`day_${day}`)}</span>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <Checkbox label={t('listingOpen')} checked={!value.closed} onChange={(event) => setDay(day, { closed: !event.target.checked })} />
                          {!value.closed && (
                            <Checkbox label={t('listingAllDay')} checked={value.allDay} onChange={(event) => setDay(day, { allDay: event.target.checked })} />
                          )}
                        </div>
                        {showTimes && (
                          <div className="flex items-center gap-2">
                            <Select aria-label={t('listingOpensAt')} value={value.open} onChange={(event) => setDay(day, { open: event.target.value })}>
                              {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
                            </Select>
                            <span className="text-gray-500" aria-hidden="true">–</span>
                            <Select aria-label={t('listingClosesAt')} value={value.close} onChange={(event) => setDay(day, { close: event.target.value })}>
                              {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
                            </Select>
                          </div>
                        )}
                        {isOwner && (
                          <Button type="button" variant="ghost" size="sm" className="sm:ml-auto" onClick={() => copyToAll(day)}>
                            {t('listingCopyToAll')}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </fieldset>

            {error && <InlineAlert variant="danger">{error}</InlineAlert>}

            {isOwner && (
              <div className="flex justify-end">
                <Button type="submit" loading={saving} loadingLabel={t('listingSaving')} disabled={changed.length === 0} icon={<Save size={15} aria-hidden="true" />}>
                  {t('listingSave')}
                </Button>
              </div>
            )}
          </form>
        )}
      </CardBody>
    </Card>
  );
}
