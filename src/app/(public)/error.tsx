'use client';

// Error boundary of the public site, in its own look, with a way to retry.

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { RotateCw, TriangleAlert } from 'lucide-react';

export default function PublicError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('publicShowcase');

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="sc-root flex min-h-screen items-center justify-center px-4 py-16">
      <div className="sc-glass w-full max-w-md rounded-3xl px-6 py-10 text-center" role="alert">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-white">
          <TriangleAlert size={26} aria-hidden="true" />
        </span>
        <h1 className="sc-display mt-6 text-2xl font-bold text-white">{t('errorTitle')}</h1>
        <p className="mt-3 text-sm leading-6 text-white/70">{t('errorDescription')}</p>
        {/* The public site has its own look; the admin Button would bring the dashboard theme with it. */}
        <button
          type="button"
          onClick={reset}
          className="sc-cta mt-8 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
        >
          <RotateCw size={16} aria-hidden="true" />
          {t('errorRetry')}
        </button>
      </div>
    </main>
  );
}
