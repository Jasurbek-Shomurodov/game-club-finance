'use client';

import { useRef, useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
  Badge, Button, CardBody, CardHeader, InlineAlert, SectionHeading, SegmentedControl, StatTile, type BadgeVariant,
} from '@/components/PresentationFoundation';
import { createClient } from '@/lib/supabase/client';
import {
  loadMigrationHealth, loadProbeResults, migrationStatuses,
  type HealthResult, type ManifestEntry, type MigrationStatus, type ProbeResult,
} from '@/lib/supabase/migrationHealth';

const STATUS_BADGE: Record<MigrationStatus, BadgeVariant> = {
  applied: 'success', likely: 'success', partial: 'warning', notApplied: 'danger', unknown: 'neutral',
};
const NEEDS_ATTENTION: ReadonlySet<MigrationStatus> = new Set(['partial', 'notApplied', 'unknown']);

type Filter = 'attention' | 'all';
interface CheckResult { health: HealthResult; probes: ProbeResult; manifest: ManifestEntry[] }

/**
 * Read-only database health check for owners. Renders as the header + body of
 * the settings card it lives in, so the parent supplies the surface.
 */
export function MigrationHealthPanel({ clubId }: { clubId: string }) {
  const t = useTranslations('settings.migrationHealth');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>('attention');
  const requestId = useRef(0);

  useEffect(() => () => { requestId.current += 1; }, []);

  async function check() {
    const request = ++requestId.current;
    setLoading(true);
    setResult(null);
    // The probe manifest is large and only needed here, so it stays out of the Settings bundle.
    const { default: manifest } = await import('@/lib/supabase/migrationManifest.json');
    const client = createClient();
    const [health, probes] = await Promise.all([
      loadMigrationHealth(client, clubId),
      loadProbeResults(client, clubId, manifest),
    ]);
    if (request !== requestId.current) return;
    setResult({ health, probes, manifest });
    setFilter('attention');
    setLoading(false);
  }

  const health = result?.health;
  const data = health?.status === 'ready' ? health.data : null;
  const allChecksPass = Boolean(data && data.checks.every((check) => check.status === 'matching'));
  const probeResults = result?.probes.status === 'ready' ? result.probes.results : null;
  const statuses = result && (data || probeResults)
    ? migrationStatuses(result.manifest, data?.recordedVersions ?? [], probeResults)
    : [];
  const count = (...wanted: MigrationStatus[]) => statuses.filter((s) => wanted.includes(s.status)).length;
  const attention = statuses.filter((s) => NEEDS_ATTENTION.has(s.status));
  const shown = filter === 'attention' ? attention : statuses;

  return (
    <div aria-busy={loading}>
      <CardHeader>
        <SectionHeading
          title={t('title')}
          description={t('description')}
          action={<Button variant="outline" loading={loading} loadingLabel={t('checking')} onClick={check}>{t('check')}</Button>}
        />
      </CardHeader>
      {result && (
        <CardBody aria-live="polite" className="space-y-5 text-sm">
          {health?.status === 'unavailable' && <InlineAlert variant="warning">{t('unavailable')}</InlineAlert>}
          {health?.status === 'error' && <InlineAlert variant="danger">{t('error')}</InlineAlert>}
          {result.probes.status === 'unavailable' && <InlineAlert variant="warning">{t('probesUnavailable')}</InlineAlert>}
          {result.probes.status === 'error' && <InlineAlert variant="danger">{t('probesError')}</InlineAlert>}

          {statuses.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-950">{t('migrations')}</h3>
              <p className="mt-1 text-xs leading-5 text-gray-500">{t('migrationsNote')}</p>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <StatTile variant="soft" size="sm" tone="success" label={t('appliedCount')} value={count('applied', 'likely')} />
                <StatTile variant="soft" size="sm" tone={count('notApplied', 'partial') ? 'danger' : 'muted'} label={t('notAppliedCount')} value={count('notApplied', 'partial')} />
                <StatTile variant="soft" size="sm" tone="muted" label={t('unknownCount')} value={count('unknown')} />
              </div>
              {attention.length === 0 && probeResults && (
                <InlineAlert variant="success" className="mt-3">{t('allApplied', { count: statuses.length })}</InlineAlert>
              )}
              <SegmentedControl
                className="mt-3"
                variant="chips"
                size="sm"
                label={t('filter')}
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'attention', label: t('filterAttention', { count: attention.length }) },
                  { value: 'all', label: t('filterAll', { count: statuses.length }) },
                ]}
              />
              {shown.length > 0 && (
                <ul className="mt-2 max-h-96 divide-y divide-gray-100 overflow-auto rounded-xl border border-gray-200">
                  {shown.map(({ file, status }) => (
                    <li key={file} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0 break-all font-mono text-xs text-gray-700">{file}</span>
                      <Badge variant={STATUS_BADGE[status]} size="sm">{t(`status.${status}`)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              {count('likely', 'unknown') > 0 && <p className="mt-2 text-xs leading-5 text-gray-500">{t('likelyNote')}</p>}
            </div>
          )}

          {data && (
            <div>
              <h3 className="text-sm font-semibold text-gray-950">{t('featureChecks')}</h3>
              <p className="mt-1 text-xs leading-5 text-gray-500">{t('checksNote')}</p>
              {allChecksPass && <InlineAlert variant="success" className="mt-2">{t('checksPassed')}</InlineAlert>}
              <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
                {data.checks.map((check) => (
                  <li key={check.name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0 break-all font-mono text-xs text-gray-700">{check.version} · {check.name}</span>
                    <Badge size="sm" variant={check.status === 'matching' ? 'success' : 'warning'}>{t(check.status)}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(!allChecksPass || attention.length > 0) && <p className="text-xs leading-5 text-gray-500">{t('nextSteps')}</p>}
        </CardBody>
      )}
    </div>
  );
}
