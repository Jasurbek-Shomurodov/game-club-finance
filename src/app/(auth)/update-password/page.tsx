'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { Button, Field, InlineAlert, Input } from '@/components/PresentationFoundation';
import { DASHBOARD_PATH } from '@/lib/routes';
import { AuthLayout } from '../AuthLayout';

const MIN_PASSWORD_LENGTH = 8;

/** Reached from the password-recovery email; the callback has already signed the user in. */
export default function UpdatePasswordPage() {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('passwordTooShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('passwordMismatch'));
      return;
    }
    setError('');
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(t('passwordUpdateError'));
        return;
      }
      setDone(true);
      window.setTimeout(() => {
        router.replace(DASHBOARD_PATH);
        router.refresh();
      }, 1200);
    } catch {
      setError(t('networkError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold tracking-tight text-gray-950">{t('newPasswordTitle')}</h1>
      <p className="mt-1.5 text-sm text-gray-500">{t('newPasswordHelp')}</p>

      {done ? (
        <InlineAlert variant="success" className="mt-7">{t('passwordUpdated')}</InlineAlert>
      ) : (
        <form onSubmit={handleSubmit} className="mt-7 space-y-4">
          <Field label={t('newPassword')} htmlFor="new-password">
            <Input
              id="new-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              autoFocus
            />
          </Field>
          <Field label={t('confirmPassword')} htmlFor="confirm-password">
            <Input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
            />
          </Field>
          {error && <InlineAlert variant="danger">{error}</InlineAlert>}
          <Button type="submit" fullWidth size="lg" className="text-sm" loading={loading} loadingLabel={tc('saving')}>
            {t('savePassword')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
