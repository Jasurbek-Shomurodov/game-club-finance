import { describe, expect, it } from 'vitest';
import {
  CALLBACK_DATA_MAX_BYTES,
  OWNER_BOT_CALLBACK_ACTIONS,
  buildOwnerBotCallbackData,
  parseOwnerBotCallbackData,
} from './callbackData';

const ID = '3f2a7c1e-9b4d-4e8a-a1c2-0d5e6f708192';

describe('owner bot callback data', () => {
  it('round-trips every action within Telegram\'s 64 bytes', () => {
    for (const action of OWNER_BOT_CALLBACK_ACTIONS) {
      const data = buildOwnerBotCallbackData(action, ID);
      expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(CALLBACK_DATA_MAX_BYTES);
      expect(parseOwnerBotCallbackData(data)).toEqual({ action, id: ID });
    }
    expect(buildOwnerBotCallbackData('undo', ID.toUpperCase())).toBe(`v1:undo:${ID}`);
  });

  it('carries only a row id, never an amount or a club', () => {
    expect(() => buildOwnerBotCallbackData('yes', '1200000')).toThrow(/row id/);
    expect(() => buildOwnerBotCallbackData('yes', `${ID}:1200000`)).toThrow(/row id/);
  });

  it('ignores data it did not make', () => {
    for (const data of [
      undefined, 42, '', 'v1', `v2:yes:${ID}`, `v1:pay:${ID}`, 'v1:yes:not-an-id', `v1:yes:${ID}:1200000`,
      `v1:yes:${ID.toUpperCase()}`, `v1:yes:${ID}${'x'.repeat(64)}`,
    ]) {
      expect(parseOwnerBotCallbackData(data), String(data)).toBeNull();
    }
  });
});
