import { describe, expect, it } from 'vitest';
import {
  describeWebhookInfo,
  OWNER_BOT_DEFAULT_WEBHOOK_URL,
  parseOwnerBotWebhookArgs,
  redactSecrets,
  setWebhookBody,
} from './webhookSetup';

describe('owner bot webhook setup', () => {
  it('reads the command, URL and drop flag', () => {
    expect(parseOwnerBotWebhookArgs(['set'])).toEqual({ command: 'set', url: OWNER_BOT_DEFAULT_WEBHOOK_URL, dropPending: false });
    expect(parseOwnerBotWebhookArgs(['set', '--url', 'https://staging.example.test/api/telegram/owner-bot', '--drop-pending']))
      .toEqual({ command: 'set', url: 'https://staging.example.test/api/telegram/owner-bot', dropPending: true });
    expect(parseOwnerBotWebhookArgs(['info']).command).toBe('info');
  });

  it('refuses unknown commands and unsafe URLs', () => {
    expect(() => parseOwnerBotWebhookArgs([])).toThrow(/Usage/);
    expect(() => parseOwnerBotWebhookArgs(['delete'])).toThrow(/Usage/);
    expect(() => parseOwnerBotWebhookArgs(['set', '--url'])).toThrow(/Usage/);
    expect(() => parseOwnerBotWebhookArgs(['set', '--url', 'http://example.test/hook'])).toThrow(/https/);
    expect(() => parseOwnerBotWebhookArgs(['set', '--url', 'https://user:pass@example.test/hook'])).toThrow(/credentials/);
    expect(() => parseOwnerBotWebhookArgs(['set', '--url', 'not a url'])).toThrow(/Not a URL/);
  });

  it('asks Telegram for messages and button presses, with the secret', () => {
    expect(setWebhookBody({ url: OWNER_BOT_DEFAULT_WEBHOOK_URL, secret: 'a'.repeat(32), dropPending: false })).toEqual({
      url: OWNER_BOT_DEFAULT_WEBHOOK_URL,
      secret_token: 'a'.repeat(32),
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
    expect(() => setWebhookBody({ url: OWNER_BOT_DEFAULT_WEBHOOK_URL, secret: 'short', dropPending: false })).toThrow(/16–256/);
  });

  it('blanks out secrets in printed text', () => {
    expect(redactSecrets('bot123456:ABCDEF failed for bot123456:ABCDEF', ['123456:ABCDEF', undefined, 'tiny']))
      .toBe('bot[redacted] failed for bot[redacted]');
  });

  it('prints the webhook state without anything secret', () => {
    expect(describeWebhookInfo({
      url: OWNER_BOT_DEFAULT_WEBHOOK_URL,
      pending_update_count: 2,
      allowed_updates: ['message', 'callback_query'],
      last_error_date: 1_764_300_000,
      last_error_message: 'Wrong response from the webhook: 401 Unauthorized',
    })).toEqual([
      `url: ${OWNER_BOT_DEFAULT_WEBHOOK_URL}`,
      'pending updates: 2',
      'allowed updates: message, callback_query',
      'last error: 2025-11-28T03:20:00.000Z Wrong response from the webhook: 401 Unauthorized',
    ]);
    expect(describeWebhookInfo(null)).toEqual(['url: (not set)', 'pending updates: 0', 'allowed updates: (all but chat_member)', 'last error: none']);
  });
});
