// Shown for an unknown or unpublished /club/<slug> or /brand/<slug>, in the
// public site's own look: a visitor is never sent to the admin sign-in.

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, Compass } from 'lucide-react';

export default async function PublicNotFound() {
  const t = await getTranslations('publicShowcase');
  return (
    <main className="sc-root flex min-h-screen items-center justify-center px-4 py-16">
      <div className="sc-glass w-full max-w-md rounded-3xl px-6 py-10 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-white">
          <Compass size={26} aria-hidden="true" />
        </span>
        <h1 className="sc-display mt-6 text-2xl font-bold text-white">{t('notFoundTitle')}</h1>
        <p className="mt-3 text-sm leading-6 text-white/70">{t('notFoundDescription')}</p>
        <Link href="/" className="sc-cta mt-8 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white">
          <ArrowLeft size={16} aria-hidden="true" />
          {t('backHome')}
        </Link>
      </div>
    </main>
  );
}
