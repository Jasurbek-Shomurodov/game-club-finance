'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SegmentedControl } from '@/components/PresentationFoundation';

type ShowcaseTab = '/showcase' | '/showcase/games' | '/showcase/google';

/** Header tabs shared by the Public page editor, its game library and Google Maps. */
export function ShowcaseTabs({ current }: { current: ShowcaseTab }) {
  const t = useTranslations('showcase');
  const router = useRouter();
  return (
    <SegmentedControl<ShowcaseTab>
      variant="tabs"
      label={t('title')}
      options={[
        { value: '/showcase', label: t('tabPage') },
        { value: '/showcase/games', label: t('libraryTitle') },
        { value: '/showcase/google', label: t('tabGoogle') },
      ]}
      value={current}
      onChange={(href) => router.push(href)}
    />
  );
}
