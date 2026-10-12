'use client';

import type { ReactNode } from 'react';
import { Gamepad2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LanguageSwitcher, ThemeToggle } from '@/components/PresentationFoundation';

/**
 * Split sign-in layout: a dark brand panel on the left (hidden on phones) and
 * the form on the right. Shared by login and the password-reset pages.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('auth');
  const tn = useTranslations('nav');

  return (
    <div className="grid min-h-dvh bg-surface lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#0b1018] p-10 text-white lg:flex xl:p-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-primary-600/40 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 -left-24 h-[24rem] w-[24rem] rounded-full bg-primary-400/20 blur-3xl"
        />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600 text-white">
            <Gamepad2 size={20} aria-hidden="true" />
          </span>
          <span className="text-base font-semibold">{tn('appName')} · {tn('appSubtitle')}</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold leading-tight tracking-tight xl:text-4xl">{t('heroTitle')}</h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">{t('heroSubtitle')}</p>
        </div>
        <p className="relative text-xs text-white/40">RU · UZ · EN</p>
      </aside>

      <main className="flex flex-col px-5 py-6 sm:px-10 lg:px-16 xl:px-24">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 lg:invisible">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-950 text-gray-50">
              <Gamepad2 size={18} aria-hidden="true" />
            </span>
            <span className="text-sm font-semibold text-gray-950">{tn('appName')}</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageSwitcher />
          </div>
        </div>
        <div className="flex flex-1 items-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
    </div>
  );
}
