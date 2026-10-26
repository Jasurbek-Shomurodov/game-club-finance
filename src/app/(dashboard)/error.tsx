'use client';

import { useEffect } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, ButtonLink, Card, EmptyState } from '@/components/PresentationFoundation';
import { DASHBOARD_PATH } from '@/lib/routes';

/** Route-level error boundary: keeps the shell and navigation usable. */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const tc = useTranslations('common');

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card className="mx-auto mt-6 max-w-xl">
      <EmptyState
        icon={TriangleAlert}
        title={tc('pageErrorTitle')}
        description={tc('pageErrorDescription')}
        action={(
          <>
            <Button onClick={reset}>{tc('retry')}</Button>
            <ButtonLink href={DASHBOARD_PATH} variant="outline">{tc('backToDashboard')}</ButtonLink>
          </>
        )}
      />
    </Card>
  );
}
