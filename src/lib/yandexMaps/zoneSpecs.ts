// The zone's hardware as one Russian sentence for the Yandex Maps price item
// descriptions ("Intel Core i5-12400F, GeForce GTX 1660 Super, 16 GB RAM,
// монитор 25″ MSI 300 Гц."), the way the best-kept club cards name it in every
// item. Only the zone's own fields are used; an empty field is left out, never
// filled in. Pure, so the script and the public card route describe alike.

import type { ShowcasePcZone } from '@/types';

/** Yandex shows a short description; the whole text (offer text + specs) stays within this. */
export const YANDEX_DESCRIPTION_MAX_LENGTH = 250;

export type YandexZoneSpecs = Partial<Pick<
  ShowcasePcZone,
  'kind' | 'console' | 'controllers' | 'cpu' | 'gpu' | 'ram' | 'monitor' | 'monitor_size_inches' | 'monitor_refresh_hz' | 'mouse' | 'keyboard' | 'headset' | 'chair'
>>;

/** The spec field names, for loaders that copy them from a row or payload. */
export const YANDEX_ZONE_SPEC_TEXT_FIELDS = ['console', 'cpu', 'gpu', 'ram', 'monitor', 'mouse', 'keyboard', 'headset', 'chair'] as const;
export const YANDEX_ZONE_SPEC_NUMBER_FIELDS = ['controllers', 'monitor_size_inches', 'monitor_refresh_hz'] as const;

/** A field as written: spaces collapsed, trailing punctuation dropped; null when empty. */
const clean = (value: string | null | undefined) => {
  const text = (value ?? '').replace(/\s+/g, ' ').trim().replace(/[\s.,;:]+$/, '');
  return text || null;
};

const positive = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

/** 1 геймпад, 2 геймпада, 5 геймпадов, 21 геймпад. */
function gamepads(count: number): string {
  const n = Math.abs(Math.trunc(count));
  const lastTwo = n % 100;
  const last = n % 10;
  const word = last === 1 && lastTwo !== 11 ? 'геймпад' : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'геймпада' : 'геймпадов';
  return `${n} ${word}`;
}

const HAS_SIZE = /\d+(?:[.,]\d+)?\s*(?:″|"|”|''|дюйм|inch)/i;
const HAS_REFRESH = /\d+\s*(?:гц|hz)/i;
const NAMES_MONITOR = /монитор|monitor/i;
const NAMES_RAM = /\b(?:ram)\b|озу|оператив/i;

/** "монитор 25″ MSI 300 Гц": the size and refresh rate only when the model text does not already say them. */
function monitorPart(zone: YandexZoneSpecs): string | null {
  const text = clean(zone.monitor);
  const inches = positive(zone.monitor_size_inches);
  const hz = positive(zone.monitor_refresh_hz);
  const size = inches && !(text && HAS_SIZE.test(text)) ? `${String(inches).replace('.', ',')}″` : null;
  const refresh = hz && !(text && HAS_REFRESH.test(text)) ? `${Math.round(hz)} Гц` : null;
  if (!text && !size && !refresh) return null;
  if (text && NAMES_MONITOR.test(text)) return [text, size, refresh].filter(Boolean).join(' ');
  return ['монитор', size, text, refresh].filter(Boolean).join(' ');
}

/**
 * The zone's spec parts in the order they are written: the machine first
 * (`core`), then the peripherals, which go first when the text is too long.
 * A PlayStation zone is its console and gamepads.
 */
export function zoneSpecParts(zone: YandexZoneSpecs): { core: string[]; peripherals: string[] } {
  if (zone.kind === 'playstation') {
    const controllers = positive(zone.controllers);
    return { core: [clean(zone.console), controllers ? gamepads(controllers) : null].filter((part): part is string => Boolean(part)), peripherals: [] };
  }
  const ram = clean(zone.ram);
  const core = [clean(zone.cpu), clean(zone.gpu), ram && !NAMES_RAM.test(ram) ? `${ram} RAM` : ram, monitorPart(zone)];
  const labelled = (label: string, value: string | null | undefined) => {
    const text = clean(value);
    return text ? `${label} ${text}` : null;
  };
  const peripherals = [labelled('мышь', zone.mouse), labelled('клавиатура', zone.keyboard), labelled('гарнитура', zone.headset), labelled('кресло', zone.chair)];
  const present = (parts: Array<string | null>) => parts.filter((part): part is string => Boolean(part));
  return { core: present(core), peripherals: present(peripherals) };
}

/** Parts as one sentence: first letter capitalised, a full stop at the end. */
function sentence(parts: readonly string[]): string {
  const text = parts.join(', ');
  return `${text.charAt(0).toLocaleUpperCase('ru')}${text.slice(1)}.`;
}

/** "Час игры" → "Час игры.", so the spec sentence follows a finished one. */
const finished = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

/**
 * A price item's description: its own text (or none) followed by the zone's
 * spec sentence, within `maxLength`. When it does not fit, peripherals are
 * dropped first, then machine parts from the end. With no spec fields, or
 * when not even one part fits, the text is returned unchanged.
 */
export function describeWithZoneSpecs(text: string | null, zone: YandexZoneSpecs | null | undefined, maxLength = YANDEX_DESCRIPTION_MAX_LENGTH): string | null {
  if (!zone) return text;
  const { core, peripherals } = zoneSpecParts(zone);
  const parts = [...core, ...peripherals];
  const lead = text?.trim() ? finished(text.trim()) : null;
  while (parts.length) {
    const description = [lead, sentence(parts)].filter(Boolean).join(' ');
    if (description.length <= maxLength) return description;
    parts.pop();
  }
  return text;
}
