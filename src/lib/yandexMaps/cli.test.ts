import { describe, expect, it } from 'vitest';
import { parseYandexSyncArgs } from './cli';

const CLUB = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('parseYandexSyncArgs', () => {
  it('reads the command and a club', () => {
    expect(parseYandexSyncArgs(['plan'])).toEqual({ ok: true, args: { command: 'plan', clubId: null, dryRun: false, confirmSend: false, resend: false } });
    expect(parseYandexSyncArgs(['replies', '--club', CLUB.toUpperCase()])).toMatchObject({ ok: true, args: { command: 'replies', clubId: CLUB } });
  });

  it('only sends a report when asked to', () => {
    expect(parseYandexSyncArgs(['report']).ok).toBe(false);
    expect(parseYandexSyncArgs(['report', '--dry-run'])).toMatchObject({ ok: true, args: { dryRun: true, confirmSend: false } });
    expect(parseYandexSyncArgs(['report', '--confirm-send'])).toMatchObject({ ok: true, args: { dryRun: false, confirmSend: true, resend: false } });
    expect(parseYandexSyncArgs(['report', '--confirm-send', '--resend'])).toMatchObject({ ok: true, args: { confirmSend: true, resend: true } });
    expect(parseYandexSyncArgs(['report', '--dry-run', '--resend']).ok).toBe(false);
    expect(parseYandexSyncArgs(['report', '--dry-run', '--confirm-send']).ok).toBe(false);
    expect(parseYandexSyncArgs(['plan', '--resend']).ok).toBe(false);
  });

  it('rejects unknown commands and options', () => {
    expect(parseYandexSyncArgs([]).ok).toBe(false);
    expect(parseYandexSyncArgs(['upload']).ok).toBe(false);
    expect(parseYandexSyncArgs(['plan', '--force']).ok).toBe(false);
    expect(parseYandexSyncArgs(['plan', '--club']).ok).toBe(false);
    expect(parseYandexSyncArgs(['plan', '--club', 'pixel']).ok).toBe(false);
    expect(parseYandexSyncArgs(['plan', '--dry-run']).ok).toBe(false);
  });
});
