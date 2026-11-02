'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useClub } from '@/components/layout/DashboardShell';
import { SegmentedControl } from '@/components/PresentationFoundation';

type ShowcaseTab = '/showcase' | '/showcase/games' | '/showcase/google' | '/showcase/brand';

/** Header tabs shared by the Public page editor, its game library, Google Maps and the owner's brand page. */
export function ShowcaseTabs({ current }: { current: ShowcaseTab }) {
  const t = useTranslations('showcase');
  const router = useRouter();
  const { role } = useClub();
  return (
    <SegmentedControl<ShowcaseTab>
      variant="tabs"
      label={t('title')}
      options={[
        { value: '/showcase', label: t('tabPage') },
        { value: '/showcase/games', label: t('libraryTitle') },
        { value: '/showcase/google', label: t('tabGoogle') },
        ...(role === 'owner' ? [{ value: '/showcase/brand' as const, label: t('brandTitle') }] : []),
      ]}
      value={current}
      onChange={(href) => router.push(href)}
    />
  );
}
