import type { ReactNode } from 'react';
import { SectionHeading } from '@/components/PresentationFoundation';

/** A titled group of settings: a small heading, with an optional action beside it, above its own card. */
export function SettingsSection({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex min-h-8 items-center justify-between gap-3 px-1">
        <SectionHeading as="h2" size="sm" title={title} />
        {aside}
      </div>
      {children}
    </section>
  );
}
