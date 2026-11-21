'use client';

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { Button, ButtonLink, Field, InlineAlert, Input } from '@/components/PresentationFoundation';
import { LOGIN_NEXT_COOKIE } from '@/lib/validation';
import { AuthLayout } from '../AuthLayout';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      // The recovery link returns through /auth/callback, which sends the
      // user on to the page named in this cookie. An hour covers the usual
      // gap between requesting the email and opening it.
      document.cookie = `${LOGIN_NEXT_COOKIE}=${encodeURIComponent('/update-password')}; path=/; max-age=3600; samesite=lax`;
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback`,
      });
      if (resetError) {
        setError(t('resetError'));
        return;
      }
      setSentTo(email.trim());
    } catch {
      setError(t('networkError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold tracking-tight text-gray-950">{t('resetTitle')}</h1>
      <p className="mt-1.5 text-sm text-gray-500">{t('resetHelp')}</p>

      {sentTo ? (
        <InlineAlert variant="success" className="mt-7">{t('resetSent', { email: sentTo })}</InlineAlert>
      ) : (
        <form onSubmit={handleSubmit} className="mt-7 space-y-4">
          <Field label={t('email')} htmlFor="reset-email">
            <Input
              id="reset-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              autoFocus
            />
          </Field>
          {error && <InlineAlert variant="danger">{error}</InlineAlert>}
          <Button type="submit" fullWidth size="lg" loading={loading} loadingLabel={tc('loading')}>
            {t('sendResetLink')}
          </Button>
        </form>
      )}

      <ButtonLink href="/login" variant="ghost" className="mt-4" icon={<ArrowLeft size={16} aria-hidden="true" />}>
        {t('backToLogin')}
      </ButtonLink>
    </AuthLayout>
  );
}
