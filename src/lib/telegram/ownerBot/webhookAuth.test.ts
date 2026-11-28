import { describe, expect, it } from 'vitest';
import { isValidOwnerBotWebhookSecret, OWNER_BOT_SECRET_HEADER, ownerBotWebhookAuthStatus } from './webhookAuth';

const SECRET = 'test-owner-bot-secret_0123456789';
const request = (secret?: string) => new Request('https://example.test/api/telegram/owner-bot', {
  method: 'POST',
  headers: secret === undefined ? {} : { [OWNER_BOT_SECRET_HEADER]: secret },
});

describe('owner bot webhook secret', () => {
  it('accepts the configured secret only', () => {
    expect(ownerBotWebhookAuthStatus(request(SECRET), SECRET)).toBe('authorized');
    expect(ownerBotWebhookAuthStatus(request(`${SECRET}x`), SECRET)).toBe('unauthorized');
    expect(ownerBotWebhookAuthStatus(request(SECRET.toUpperCase()), SECRET)).toBe('unauthorized');
    expect(ownerBotWebhookAuthStatus(request(''), SECRET)).toBe('unauthorized');
    expect(ownerBotWebhookAuthStatus(request(), SECRET)).toBe('unauthorized');
  });

  it('treats a missing, short or malformed secret as not configured', () => {
    expect(ownerBotWebhookAuthStatus(request(SECRET), undefined)).toBe('invalid_configuration');
    expect(ownerBotWebhookAuthStatus(request('short'), 'short')).toBe('invalid_configuration');
    expect(isValidOwnerBotWebhookSecret('has spaces in the secret value')).toBe(false);
    expect(isValidOwnerBotWebhookSecret('a'.repeat(257))).toBe(false);
    expect(isValidOwnerBotWebhookSecret('a'.repeat(16))).toBe(true);
  });
});
