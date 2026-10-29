// Route: /privacy — the public privacy policy, linked from the site footer and
// from the Google OAuth consent screen (docs/runbooks/google-business-profile.md).

import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { formatDateOnly } from '@/lib/formatters';

/** Bump when the policy text changes. */
const UPDATED_ON = '2026-10-29';
const SECTIONS = ['visitors', 'admin', 'google', 'storage', 'removal', 'contact'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('privacy');
  return { title: t('metaTitle'), description: t('intro') };
}

export default async function PrivacyPage() {
  const [t, locale] = await Promise.all([getTranslations('privacy'), getLocale()]);
  return (
    <main className="sc-root min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-white/60 transition-colors hover:text-white">
          <ArrowLeft size={16} aria-hidden="true" />
          {t('back')}
        </Link>
        <h1 className="sc-display mt-8 text-3xl font-black uppercase tracking-tight sm:text-4xl">{t('title')}</h1>
        <p className="mt-3 text-sm text-white/45">{t('updated', { date: formatDateOnly(UPDATED_ON, locale) })}</p>
        <p className="mt-8 leading-7 text-white/75">{t('intro')}</p>
        {SECTIONS.map((section) => (
          <section key={section} className="mt-10">
            <h2 className="sc-display text-lg font-bold text-white">{t(`sections.${section}.title`)}</h2>
            <p className="mt-3 leading-7 text-white/70">{t(`sections.${section}.body`)}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
