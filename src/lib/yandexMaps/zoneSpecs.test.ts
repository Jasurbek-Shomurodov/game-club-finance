import { describe, expect, it } from 'vitest';
import { describeWithZoneSpecs, YANDEX_DESCRIPTION_MAX_LENGTH, zoneSpecParts, type YandexZoneSpecs } from './zoneSpecs';

const PC: YandexZoneSpecs = {
  kind: 'pc',
  cpu: 'Intel Core i5-12400F',
  gpu: 'GeForce GTX 1660 Super',
  ram: '16 GB',
  monitor: 'MSI',
  monitor_size_inches: 25,
  monitor_refresh_hz: 300,
};

describe('zoneSpecParts', () => {
  it('writes the machine in order: processor, graphics, memory, monitor', () => {
    expect(zoneSpecParts(PC)).toEqual({
      core: ['Intel Core i5-12400F', 'GeForce GTX 1660 Super', '16 GB RAM', 'монитор 25″ MSI 300 Гц'],
      peripherals: [],
    });
  });

  it('builds the monitor from its size and refresh rate when the model text is empty', () => {
    expect(zoneSpecParts({ monitor: null, monitor_size_inches: 24.5, monitor_refresh_hz: 240 }).core).toEqual(['монитор 24,5″ 240 Гц']);
    expect(zoneSpecParts({ monitor: '  ', monitor_refresh_hz: 165 }).core).toEqual(['монитор 165 Гц']);
  });

  it('does not repeat a size or refresh rate the model text already says', () => {
    expect(zoneSpecParts({ monitor: 'ASUS 27" 180Hz', monitor_size_inches: 27, monitor_refresh_hz: 180 }).core).toEqual(['монитор ASUS 27" 180Hz']);
    expect(zoneSpecParts({ monitor: 'Монитор Samsung', monitor_size_inches: 27 }).core).toEqual(['Монитор Samsung 27″']);
  });

  it('adds "RAM" only when the memory text does not name it', () => {
    expect(zoneSpecParts({ ram: '32 GB DDR5 RAM' }).core).toEqual(['32 GB DDR5 RAM']);
    expect(zoneSpecParts({ ram: '16 ГБ ОЗУ' }).core).toEqual(['16 ГБ ОЗУ']);
    expect(zoneSpecParts({ ram: '16 GB DDR4' }).core).toEqual(['16 GB DDR4 RAM']);
  });

  it('labels the peripherals after the machine', () => {
    expect(zoneSpecParts({ cpu: 'Ryzen 5 5600', mouse: 'Logitech G102', keyboard: null, headset: 'HyperX Cloud II', chair: 'DXRacer' })).toEqual({
      core: ['Ryzen 5 5600'],
      peripherals: ['мышь Logitech G102', 'гарнитура HyperX Cloud II', 'кресло DXRacer'],
    });
  });

  it('describes a PlayStation zone by its console and gamepads only', () => {
    const ps = { kind: 'playstation' as const, console: 'PlayStation 5', cpu: 'ignored', monitor: 'Samsung QLED' };
    expect(zoneSpecParts({ ...ps, controllers: 2 }).core).toEqual(['PlayStation 5', '2 геймпада']);
    expect(zoneSpecParts({ ...ps, controllers: 1 }).core).toEqual(['PlayStation 5', '1 геймпад']);
    expect(zoneSpecParts({ ...ps, controllers: 5 }).core).toEqual(['PlayStation 5', '5 геймпадов']);
    expect(zoneSpecParts({ ...ps, controllers: 12 }).core).toEqual(['PlayStation 5', '12 геймпадов']);
    expect(zoneSpecParts({ ...ps, controllers: 22 }).core).toEqual(['PlayStation 5', '22 геймпада']);
    expect(zoneSpecParts({ kind: 'playstation', console: null, controllers: 0 })).toEqual({ core: [], peripherals: [] });
  });

  it('skips empty parts and invents nothing', () => {
    expect(zoneSpecParts({ cpu: ' ', gpu: null, ram: '', monitor: null, monitor_size_inches: 0, monitor_refresh_hz: null })).toEqual({ core: [], peripherals: [] });
    expect(zoneSpecParts({})).toEqual({ core: [], peripherals: [] });
  });
});

describe('describeWithZoneSpecs', () => {
  it('follows the offer text with one spec sentence', () => {
    expect(describeWithZoneSpecs('Плати за 2 часа — играй 3', PC)).toBe(
      'Плати за 2 часа — играй 3. Intel Core i5-12400F, GeForce GTX 1660 Super, 16 GB RAM, монитор 25″ MSI 300 Гц.',
    );
    expect(describeWithZoneSpecs('Час игры в VIP зоне.', { kind: 'playstation', console: 'PlayStation 5', controllers: 2 })).toBe('Час игры в VIP зоне. PlayStation 5, 2 геймпада.');
  });

  it('is the spec sentence alone when there is no text, capitalised', () => {
    expect(describeWithZoneSpecs(null, PC)).toBe('Intel Core i5-12400F, GeForce GTX 1660 Super, 16 GB RAM, монитор 25″ MSI 300 Гц.');
    expect(describeWithZoneSpecs('  ', { monitor_refresh_hz: 144 })).toBe('Монитор 144 Гц.');
  });

  it('leaves the description unchanged without spec fields or a zone', () => {
    expect(describeWithZoneSpecs('Ночной пакет', {})).toBe('Ночной пакет');
    expect(describeWithZoneSpecs(null, { kind: 'pc' })).toBeNull();
    expect(describeWithZoneSpecs('Текст', null)).toBe('Текст');
  });

  it('stays within 250 characters, dropping peripherals first', () => {
    const zone: YandexZoneSpecs = { ...PC, mouse: 'Logitech G Pro X Superlight', keyboard: 'SteelSeries Apex Pro TKL', headset: 'HyperX Cloud II Wireless', chair: 'DXRacer Formula' };
    const text = 'Плати за 3 часа — играй 5, выгодный пакет для долгой игры с друзьями';
    const full = describeWithZoneSpecs(text, zone, 1000)!;
    expect(full).toContain('кресло DXRacer Formula.');
    const fitted = describeWithZoneSpecs(text, zone)!;
    expect(fitted.length).toBeLessThanOrEqual(YANDEX_DESCRIPTION_MAX_LENGTH);
    expect(fitted).toContain('монитор 25″ MSI 300 Гц');
    expect(fitted).not.toContain('кресло');
    expect(fitted.endsWith('.')).toBe(true);
  });

  it('drops machine parts from the end only once the peripherals are gone, and keeps the text when nothing fits', () => {
    expect(describeWithZoneSpecs('A'.repeat(200), PC)).toBe(`${'A'.repeat(200)}. Intel Core i5-12400F, GeForce GTX 1660 Super.`);
    expect(describeWithZoneSpecs('A'.repeat(240), PC)).toBe('A'.repeat(240));
  });
});
