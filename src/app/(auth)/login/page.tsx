'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useTranslations } from 'next-intl';
import { Button, Field, InlineAlert, Input, Skeleton } from '@/components/PresentationFoundation';
import { LOGIN_NEXT_COOKIE, safeRedirectPath } from '@/lib/validation';
import { AuthLayout } from '../AuthLayout';
import { DASHBOARD_PATH } from '@/lib/routes';

function GoogleIcon() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function LoginForm() {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Provider error text is untrusted and untranslated: only its presence matters.
  const [error, setError] = useState(() => (searchParams.get('error') ? t('oauthError') : ''));
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const next = safeRedirectPath(searchParams.get('next'));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

      if (authError) {
        setError(t('loginError'));
        setLoading(false);
        return;
      }

      // Keep the button busy while the dashboard loads.
      router.replace(next ?? DASHBOARD_PATH);
      router.refresh();
    } catch {
      setError(t('networkError'));
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setError('');
    setGoogleLoading(true);
    try {
      // Carry the deep link through the provider round trip; the callback re-validates it.
      document.cookie = next
        ? `${LOGIN_NEXT_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=600; samesite=lax`
        : `${LOGIN_NEXT_COOKIE}=; path=/; max-age=0; samesite=lax`;
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          skipBrowserRedirect: true,
        },
      });
      if (authError || !data?.url) {
        setError(t('loginError'));
        setGoogleLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError(t('loginError'));
      setGoogleLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-gray-950">{t('title')}</h1>
      <p className="mt-1.5 text-sm text-gray-500">{t('subtitle')}</p>

      <Button
        variant="outline"
        fullWidth
        size="lg"
        className="mt-7 text-sm"
        onClick={handleGoogleLogin}
        loading={googleLoading}
        loadingLabel={tc('loading')}
        disabled={loading}
        icon={<GoogleIcon />}
      >
        {t('loginWithGoogle')}
      </Button>

      <div className="my-5 flex items-center gap-3" aria-hidden="true">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-xs text-gray-400">{t('orWithEmail')}</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label={t('email')} htmlFor="login-email">
          <Input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="you@club.uz"
          />
        </Field>
        <Field
          label={t('password')}
          htmlFor="login-password"
          labelAddon={(
            <Link href="/forgot-password" className="ml-auto text-[13px] font-medium text-primary-600 hover:text-primary-700">
              {t('forgotPassword')}
            </Link>
          )}
        >
          <Input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </Field>

        {error && <InlineAlert variant="danger">{error}</InlineAlert>}

        <Button type="submit" fullWidth size="lg" className="text-sm" loading={loading} loadingLabel={tc('loading')} disabled={googleLoading}>
          {t('login')}
        </Button>
      </form>

      <div className="mt-6 rounded-xl bg-primary-50 px-4 py-3 text-[13px] leading-5">
        <p className="font-semibold text-primary-700">{t('noAccessTitle')}</p>
        <p className="mt-0.5 text-gray-600">{t('noAccessHelp')}</p>
      </div>
    </div>
  );
}

function LoginFallback() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-4 w-64 max-w-full bg-gray-100" />
      <Skeleton className="mt-7 h-12 w-full rounded-xl" />
      <Skeleton className="h-11 w-full rounded-xl bg-gray-100" />
      <Skeleton className="h-11 w-full rounded-xl bg-gray-100" />
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <AuthLayout>
      <Suspense fallback={<LoginFallback />}>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}
