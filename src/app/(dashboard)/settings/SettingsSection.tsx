import type { ReactNode } from 'react';

/** A titled group of settings: a small heading above its own card. */
export function SettingsSection({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex min-h-8 items-center justify-between gap-3 px-1">
        <h2 className="text-[13px] font-semibold text-gray-500">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
