'use client';

import { useRef, useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, CardBody, CardHeader, InlineAlert, SectionHeading } from '@/components/PresentationFoundation';
import { createClient } from '@/lib/supabase/client';
import { loadMigrationHealth, unrecordedMigrations, type HealthResult } from '@/lib/supabase/migrationHealth';
import migrations from '@/lib/supabase/migrationManifest.json';

/**
 * Read-only database health check for owners. Renders as the header + body of
 * the settings card it lives in, so the parent supplies the surface.
 */
export function MigrationHealthPanel({ clubId }: { clubId: string }) {
  const t = useTranslations('settings.migrationHealth');
  const [result, setResult] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  useEffect(() => () => { requestId.current += 1; }, []);

  async function check() {
    const request = ++requestId.current;
    setLoading(true);
    setResult(null);
    const next = await loadMigrationHealth(createClient(), clubId);
    if (request !== requestId.current) return;
    setResult(next);
    setLoading(false);
  }

  const data = result?.status === 'ready' ? result.data : null;
  const allChecksPass = Boolean(data && data.checks.every((check) => check.status === 'matching'));
  // Only migrations with no history record are worth the owner's attention.
  const unrecorded = data ? unrecordedMigrations(migrations, data.recordedVersions) : [];

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
        <CardBody aria-live="polite" className="space-y-4 text-sm">
          {result.status === 'unavailable' && <InlineAlert variant="warning">{t('unavailable')}</InlineAlert>}
          {result.status === 'error' && <InlineAlert variant="danger">{t('error')}</InlineAlert>}
          {data && (
            <>
              {allChecksPass && <InlineAlert variant="success">{t('checksPassed')}</InlineAlert>}
              <div>
                <h3 className="text-sm font-semibold text-gray-950">{t('featureChecks')}</h3>
                <p className="mt-1 text-xs leading-5 text-gray-500">{t('checksNote')}</p>
                <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
                  {data.checks.map((check) => (
                    <li key={check.name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0 break-all font-mono text-xs text-gray-700">{check.version} · {check.name}</span>
                      <Badge size="sm" variant={check.status === 'matching' ? 'success' : 'warning'}>{t(check.status)}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-950">
                  {data.historyAvailable ? t('pendingMigrations', { count: unrecorded.length }) : t('migrationRecords')}
                </h3>
                {!data.historyAvailable ? (
                  <p className="mt-1 text-xs leading-5 text-gray-500">{t('noHistory')}</p>
                ) : unrecorded.length === 0 ? (
                  <InlineAlert variant="success" className="mt-2">{t('allRecorded', { count: migrations.length })}</InlineAlert>
                ) : (
                  <>
                    <p className="mt-1 text-xs leading-5 text-gray-500">{t('historyNote')}</p>
                    <ul className="mt-2 max-h-96 divide-y divide-gray-100 overflow-auto rounded-xl border border-gray-200">
                      {unrecorded.map((file) => (
                        <li key={file} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                          <span className="min-w-0 break-all font-mono text-xs text-gray-700">{file}</span>
                          <Badge variant="warning" size="sm">{t('unconfirmed')}</Badge>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              {!allChecksPass && <p className="text-xs leading-5 text-gray-500">{t('nextSteps')}</p>}
            </>
          )}
        </CardBody>
      )}
    </div>
  );
}
