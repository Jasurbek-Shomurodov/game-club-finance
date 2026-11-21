'use client';

import { SectionTabs } from '@/components/layout/SectionTabs';

type ShowcaseTab = '/showcase' | '/showcase/games' | '/showcase/google' | '/showcase/brand';

/**
 * Header tabs shared by the Public page editor, its game library, Google Maps
 * and the owner's brand page: the `showcase` section of `SECTION_TABS`
 * (`src/lib/navigation.ts`).
 */
export function ShowcaseTabs({ current }: { current: ShowcaseTab }) {
  return <SectionTabs section="showcase" active={current} />;
}
