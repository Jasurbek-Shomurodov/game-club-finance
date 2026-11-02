'use client';

// Route: /showcase/brand

import { useTranslations } from 'next-intl';
import { Store } from 'lucide-react';
import { useClub } from '@/components/layout/DashboardShell';
import { Card, EmptyState, PageHeader, useToast } from '@/components/PresentationFoundation';
import { BrandSettingsCard } from '../BrandSettingsCard';
import { ShowcaseTabs } from '../ShowcaseTabs';

export default function BrandPage() {
  const t = useTranslations('showcase');
  const { selectedClubId, role, account } = useClub();
  const { showToast, toastElement } = useToast();

  return (
    <div className="w-full space-y-5">
      <PageHeader title={t('title')} tabs={<ShowcaseTabs current="/showcase/brand" />} />

      {/* The brand page belongs to the owner's account, not to the club. */}
      {role === 'owner' ? (
        <BrandSettingsCard userId={account.userId} clubId={selectedClubId} onSaved={showToast} />
      ) : (
        <Card>
          <EmptyState icon={Store} title={t('brandOwnerOnly')} />
        </Card>
      )}

      {toastElement}
    </div>
  );
}
