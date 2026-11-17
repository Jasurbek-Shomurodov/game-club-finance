import 'server-only';
import { timingSafeEqual } from 'node:crypto';

const MIN_CRON_SECRET_LENGTH = 16;
const CRON_SECRET_PATTERN = /^[A-Za-z0-9._~-]+$/;

function bearerMatches(authorization: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization ?? '');
  // timingSafeEqual requires equal lengths; compare against itself on a
  // mismatch so the rejection costs the same as a full comparison.
  if (actual.length !== expected.length) {
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(actual, expected);
}

/** Checks a scheduled request's `Authorization: Bearer <CRON_SECRET>` header. */
export function cronAuthorizationStatus(
  request: Request,
  cronSecret = process.env.CRON_SECRET,
): 'authorized' | 'unauthorized' | 'invalid_configuration' {
  if (
    !cronSecret
    || cronSecret.length < MIN_CRON_SECRET_LENGTH
    || !CRON_SECRET_PATTERN.test(cronSecret)
  ) {
    return 'invalid_configuration';
  }

  return bearerMatches(request.headers.get('authorization'), cronSecret)
    ? 'authorized'
    : 'unauthorized';
}
