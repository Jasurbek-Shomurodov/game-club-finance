// Pure rules for Google Business Profile posts and photos, shared by the
// composer page and the /api/google-business routes.

export const POST_KINDS = ['update', 'event', 'offer'] as const;
export type GooglePostKind = (typeof POST_KINDS)[number];

export const CTA_TYPES = ['NONE', 'BOOK', 'CALL', 'LEARN_MORE', 'SIGN_UP', 'ORDER', 'SHOP'] as const;
export type GoogleCtaType = (typeof CTA_TYPES)[number];

export const PHOTO_CATEGORIES = ['INTERIOR', 'EXTERIOR', 'AT_WORK', 'TEAMS', 'PRODUCT', 'ADDITIONAL', 'COVER', 'LOGO'] as const;
export type GooglePhotoCategory = (typeof PHOTO_CATEGORIES)[number];

export const POST_LANGUAGES = ['uz', 'ru', 'en'] as const;
export type GooglePostLanguage = (typeof POST_LANGUAGES)[number];

export const SUMMARY_MAX = 1500;
export const TITLE_MAX = 58;
export const COUPON_MAX = 58;

export interface GooglePostForm {
  kind: GooglePostKind;
  language: GooglePostLanguage;
  summary: string;
  photoUrl: string;
  ctaType: GoogleCtaType;
  ctaUrl: string;
  title: string;
  startDate: string;
  endDate: string;
  couponCode: string;
  terms: string;
}

export type GooglePostError =
  | 'summary_required'
  | 'summary_too_long'
  | 'photo_invalid'
  | 'cta_url_invalid'
  | 'title_required'
  | 'title_too_long'
  | 'dates_required'
  | 'dates_order'
  | 'coupon_too_long'
  | 'kind_invalid';

export function emptyGooglePostForm(language: GooglePostLanguage = 'uz'): GooglePostForm {
  return {
    kind: 'update',
    language,
    summary: '',
    photoUrl: '',
    ctaType: 'NONE',
    ctaUrl: '',
    title: '',
    startDate: '',
    endDate: '',
    couponCode: '',
    terms: '',
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Accepts an untrusted request body; returns null when its shape is wrong. */
export function parseGooglePostForm(value: unknown): GooglePostForm | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  const text = (key: keyof GooglePostForm) => (typeof body[key] === 'string' ? (body[key] as string) : '');
  const kind = text('kind') as GooglePostKind;
  const language = text('language') as GooglePostLanguage;
  const ctaType = (text('ctaType') || 'NONE') as GoogleCtaType;
  if (!POST_KINDS.includes(kind) || !POST_LANGUAGES.includes(language) || !CTA_TYPES.includes(ctaType)) return null;
  return {
    kind,
    language,
    ctaType,
    summary: text('summary'),
    photoUrl: text('photoUrl'),
    ctaUrl: text('ctaUrl'),
    title: text('title'),
    startDate: text('startDate'),
    endDate: text('endDate'),
    couponCode: text('couponCode'),
    terms: text('terms'),
  };
}

export function validateGooglePost(form: GooglePostForm): GooglePostError | null {
  if (!POST_KINDS.includes(form.kind)) return 'kind_invalid';
  const summary = form.summary.trim();
  // Events and offers may rely on their title; a plain update needs text.
  if (form.kind === 'update' && !summary) return 'summary_required';
  if (summary.length > SUMMARY_MAX) return 'summary_too_long';
  if (form.photoUrl.trim() && !isHttpsUrl(form.photoUrl.trim())) return 'photo_invalid';
  if (form.ctaType !== 'NONE' && form.ctaType !== 'CALL' && !isHttpsUrl(form.ctaUrl.trim())) return 'cta_url_invalid';
  if (form.kind !== 'update') {
    const title = form.title.trim();
    if (!title) return 'title_required';
    if (title.length > TITLE_MAX) return 'title_too_long';
    if (!ISO_DATE.test(form.startDate) || !ISO_DATE.test(form.endDate)) return 'dates_required';
    if (form.endDate < form.startDate) return 'dates_order';
  }
  if (form.kind === 'offer' && form.couponCode.trim().length > COUPON_MAX) return 'coupon_too_long';
  return null;
}

function googleDate(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

const TOPIC = { update: 'STANDARD', event: 'EVENT', offer: 'OFFER' } as const;

/** The LocalPost body for `accounts/*\/locations/*\/localPosts` (Business Profile API v4). */
export function buildLocalPost(form: GooglePostForm) {
  const summary = form.summary.trim();
  const photoUrl = form.photoUrl.trim();
  return {
    languageCode: form.language,
    topicType: TOPIC[form.kind],
    ...(summary ? { summary } : {}),
    ...(photoUrl ? { media: [{ mediaFormat: 'PHOTO', sourceUrl: photoUrl }] } : {}),
    ...(form.ctaType !== 'NONE' && form.kind !== 'offer'
      ? { callToAction: form.ctaType === 'CALL' ? { actionType: 'CALL' } : { actionType: form.ctaType, url: form.ctaUrl.trim() } }
      : {}),
    ...(form.kind !== 'update'
      ? { event: { title: form.title.trim(), schedule: { startDate: googleDate(form.startDate), endDate: googleDate(form.endDate) } } }
      : {}),
    ...(form.kind === 'offer'
      ? {
        offer: {
          ...(form.couponCode.trim() ? { couponCode: form.couponCode.trim() } : {}),
          ...(form.ctaType !== 'NONE' && form.ctaType !== 'CALL' ? { redeemOnlineUrl: form.ctaUrl.trim() } : {}),
          ...(form.terms.trim() ? { termsConditions: form.terms.trim() } : {}),
        },
      }
      : {}),
  };
}

export interface GooglePostSummary {
  name: string;
  kind: GooglePostKind;
  summary: string;
  title: string | null;
  state: string;
  createTime: string | null;
  searchUrl: string | null;
  photoUrl: string | null;
}

const KIND_BY_TOPIC: Record<string, GooglePostKind> = { STANDARD: 'update', EVENT: 'event', OFFER: 'offer' };

/** Reduces Google's LocalPost to what the composer lists. */
export function summarizeLocalPost(raw: unknown): GooglePostSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const post = raw as Record<string, unknown>;
  if (typeof post.name !== 'string') return null;
  const media = Array.isArray(post.media) ? (post.media[0] as Record<string, unknown> | undefined) : undefined;
  const event = post.event as Record<string, unknown> | undefined;
  const str = (value: unknown) => (typeof value === 'string' && value ? value : null);
  return {
    name: post.name,
    kind: KIND_BY_TOPIC[String(post.topicType)] ?? 'update',
    summary: str(post.summary) ?? '',
    title: str(event?.title),
    state: str(post.state) ?? 'LIVE',
    createTime: str(post.createTime),
    searchUrl: str(post.searchUrl),
    photoUrl: str(media?.googleUrl) ?? str(media?.sourceUrl),
  };
}

export interface GoogleLocationOption {
  accountName: string;
  locationName: string;
  title: string;
  address: string;
}
