'use client';

import { useTranslations } from 'next-intl';
import { Cpu, Gamepad2, Monitor, Mouse } from 'lucide-react';
import { Card, CurrencyInput, Field, Input, SectionHeading, SegmentedControl } from '@/components/PresentationFoundation';
import { PLAYSTATION_MODELS, applyPlaystationModel, playstationModel, switchZoneKind, type PlaystationModel, type ShowcasePcZoneForm } from '@/lib/showcase';
import type { ShowcaseZoneKind } from '@/types';
import { LocalizedTextField } from './LocalizedTextField';
import { ShowcaseImageField } from './ShowcaseImageField';

interface ZoneEditorProps {
  form: ShowcasePcZoneForm;
  /** Takes an updater, so a change that arrives late (an upload finishing) never overwrites newer typing. */
  onChange: (update: (form: ShowcasePcZoneForm) => ShowcasePcZoneForm) => void;
  /** Club folder for the uploaded image. */
  clubId: string;
  onUploadingChange: (uploading: boolean) => void;
}

/** The fields of one computer or PlayStation zone: kind, name, count, price, specs and photo. */
export function ZoneEditor({ form, onChange, clubId, onUploadingChange }: ZoneEditorProps) {
  const t = useTranslations('showcase');
  const tc = useTranslations('common');
  const set = <K extends keyof ShowcasePcZoneForm>(field: K, value: ShowcasePcZoneForm[K]) => onChange((prev) => ({ ...prev, [field]: value }));

  return (
    <>
      <SegmentedControl<ShowcaseZoneKind>
        label={t('zoneKind')}
        variant="soft"
        value={form.kind}
        onChange={(kind) => onChange((prev) => switchZoneKind(prev, kind))}
        options={[
          { value: 'pc', label: t('zoneKindPc'), icon: <Monitor size={15} aria-hidden="true" /> },
          { value: 'playstation', label: t('zoneKindPlaystation'), icon: <Gamepad2 size={15} aria-hidden="true" /> },
        ]}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <LocalizedTextField
            id="zone-name"
            label={t('zoneName')}
            maxLength={60}
            placeholder={form.kind === 'playstation' ? t('playstationZoneNamePlaceholder') : t('zoneNamePlaceholder')}
            hint={t('zoneNameHint')}
            value={form.name}
            onChange={(value) => set('name', value)}
          />
        </div>
        <Field label={form.kind === 'playstation' ? t('consoleCount') : t('pcCount')} htmlFor="zone-count" required>
          <Input id="zone-count" inputMode="numeric" value={form.pc_count} onChange={(e) => set('pc_count', e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label={t('pricePerHour')} htmlFor="zone-price" className="sm:col-span-2">
          <CurrencyInput id="zone-price" value={form.price_per_hour} onValueChange={(value) => set('price_per_hour', value)} trailingAddon={tc('currency')} />
        </Field>
        <Field label={t('sortOrder')} htmlFor="zone-sort">
          <Input id="zone-sort" inputMode="numeric" value={form.sort_order} onChange={(e) => set('sort_order', e.target.value.replace(/[^\d-]/g, ''))} />
        </Field>
      </div>
      <LocalizedTextField
        id="zone-description"
        label={t('zoneDescription')}
        hint={t('zoneDescriptionHint')}
        multiline
        rows={2}
        maxLength={240}
        placeholder={t('zoneDescriptionPlaceholder')}
        value={form.peripherals}
        onChange={(value) => set('peripherals', value)}
      />
      {form.kind === 'playstation' ? (
        <Card tone="muted" padding="sm" className="space-y-3">
          <SectionHeading as="h3" size="sm" title={t('specsConsole')} icon={<Gamepad2 size={16} aria-hidden="true" />} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
            <Field label={t('console')} required>
              <SegmentedControl<PlaystationModel | ''>
                label={t('console')}
                variant="soft"
                value={playstationModel(form.console) ?? ''}
                onChange={(model) => model && onChange((prev) => applyPlaystationModel(prev, model))}
                options={PLAYSTATION_MODELS.map((model) => ({ value: model, label: model.toUpperCase() }))}
              />
            </Field>
            <Field label={t('controllers')} htmlFor="zone-controllers" hint={t('controllersHint')}>
              <Input id="zone-controllers" inputMode="numeric" value={form.controllers} placeholder="2" onChange={(e) => set('controllers', e.target.value.replace(/\D/g, ''))} />
            </Field>
          </div>
        </Card>
      ) : (
      <Card tone="muted" padding="sm" className="space-y-3">
        <SectionHeading as="h3" size="sm" title={t('specsComputer')} icon={<Cpu size={16} aria-hidden="true" />} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('cpu')} htmlFor="zone-cpu">
            <Input id="zone-cpu" value={form.cpu} maxLength={80} placeholder="Intel Core i7-14700K" onChange={(e) => set('cpu', e.target.value)} />
          </Field>
          <Field label={t('gpu')} htmlFor="zone-gpu">
            <Input id="zone-gpu" value={form.gpu} maxLength={80} placeholder="RTX 4070 Super" onChange={(e) => set('gpu', e.target.value)} />
          </Field>
          <Field label={t('ram')} htmlFor="zone-ram" className="sm:col-span-2">
            <Input id="zone-ram" value={form.ram} maxLength={80} placeholder="32 GB DDR5" onChange={(e) => set('ram', e.target.value)} />
          </Field>
        </div>
      </Card>
      )}
      <Card tone="muted" padding="sm" className="space-y-3">
        <SectionHeading as="h3" size="sm" title={form.kind === 'playstation' ? t('specsTv') : t('specsMonitor')} icon={<Monitor size={16} aria-hidden="true" />} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem_8rem]">
          <Field label={form.kind === 'playstation' ? t('tvModel') : t('monitorModel')} htmlFor="zone-monitor">
            <Input id="zone-monitor" value={form.monitor} maxLength={80} placeholder={form.kind === 'playstation' ? 'Samsung QLED 4K' : 'ASUS ROG Swift'} onChange={(e) => set('monitor', e.target.value)} />
          </Field>
          <Field label={t('monitorSize')} htmlFor="zone-monitor-size">
            <Input id="zone-monitor-size" inputMode="decimal" value={form.monitor_size_inches} placeholder="27" trailingAddon={t('inchUnit')} onChange={(e) => set('monitor_size_inches', e.target.value.replace(/[^\d.,]/g, ''))} />
          </Field>
          <Field label={t('monitorRefresh')} htmlFor="zone-monitor-hz">
            <Input id="zone-monitor-hz" inputMode="numeric" value={form.monitor_refresh_hz} placeholder="240" trailingAddon={t('hzUnit')} onChange={(e) => set('monitor_refresh_hz', e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
      </Card>
      {form.kind === 'pc' && (
        <Card tone="muted" padding="sm" className="space-y-3">
          <SectionHeading as="h3" size="sm" title={t('specsPeripherals')} icon={<Mouse size={16} aria-hidden="true" />} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('mouse')} htmlFor="zone-mouse">
              <Input id="zone-mouse" value={form.mouse} maxLength={80} placeholder="Logitech G Pro X Superlight" onChange={(e) => set('mouse', e.target.value)} />
            </Field>
            <Field label={t('keyboard')} htmlFor="zone-keyboard">
              <Input id="zone-keyboard" value={form.keyboard} maxLength={80} placeholder="SteelSeries Apex Pro" onChange={(e) => set('keyboard', e.target.value)} />
            </Field>
            <Field label={t('headset')} htmlFor="zone-headset">
              <Input id="zone-headset" value={form.headset} maxLength={80} placeholder="HyperX Cloud II" onChange={(e) => set('headset', e.target.value)} />
            </Field>
            <Field label={t('chair')} htmlFor="zone-chair">
              <Input id="zone-chair" value={form.chair} maxLength={80} placeholder="DXRacer" onChange={(e) => set('chair', e.target.value)} />
            </Field>
          </div>
        </Card>
      )}
      <ShowcaseImageField
        label={t('zoneImage')}
        clubId={clubId}
        kind="zone"
        aspect="wide"
        value={form.image_url}
        onChange={(url) => set('image_url', url)}
        onUploadingChange={onUploadingChange}
      />
    </>
  );
}
