'use client';

import { useTranslations } from 'next-intl';
import { Copy, ExternalLink, KeyRound, RefreshCw, Unlink } from 'lucide-react';
import {
  Button,
  ButtonLink,
  Card,
  IconButton,
  InlineAlert,
  LoadErrorAlert,
  Skeleton,
} from '@/components/PresentationFoundation';
import { SkeletonCard } from '@/components/charts/ChartSkeletons';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { formatDateOnly, formatTime } from '@/lib/formatters';
import { ownerBotLinkCommand, ownerBotUrl, telegramAccountName } from '@/lib/ownerTelegramLink';
import type { OwnerTelegramLinkCode } from '@/lib/supabase/ownerTelegram';
import type { OwnerTelegramLink } from '@/types';
import { SettingsSection } from './SettingsSection';

export type OwnerTelegramBusy = 'code' | 'check' | 'unlink' | null;

export interface OwnerTelegramCardProps {
  /** The owner bot's username, without "@". */
  botUsername: string;
  status: 'loading' | 'error' | 'ready';
  link: OwnerTelegramLink | null;
  /** The code just made for /link, until the account is linked. */
  code: OwnerTelegramLinkCode | null;
  busy: OwnerTelegramBusy;
  /** A check found no link yet. */
  notLinkedYet?: boolean;
  error?: string;
  onGetCode: () => void;
  onCheck: () => void;
  onCopy: (text: string) => void;
  onUnlink: () => void;
  onRetry: () => void;
}

/** The skeleton of this card: the section heading and one setting row. */
export function OwnerTelegramCardSkeleton() {
  return (
    <div className="space-y-2.5" aria-hidden="true">
      <div className="flex min-h-8 items-center px-1">
        <Skeleton className="h-3 w-24" />
      </div>
      <SkeletonCard padded={false} className="overflow-hidden">
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2 sm:flex-1">
            <Skeleton className="h-4 w-32 max-w-full" />
            <Skeleton className="h-3 w-72 max-w-full bg-gray-100" />
          </div>
          <Skeleton className="h-11 w-full rounded-lg bg-gray-100 sm:w-40" />
        </div>
      </SkeletonCard>
    </div>
  );
}

/**
 * Settings → Telegram: links the signed-in owner to the owner money bot with a
 * one-time code (docs/plans/owner-money-bot.md, slice 1), or shows the linked
 * account with a way to unlink it.
 */
export function OwnerTelegramCard({
  botUsername,
  status,
  link,
  code,
  busy,
  notLinkedYet = false,
  error,
  onGetCode,
  onCheck,
  onCopy,
  onUnlink,
  onRetry,
}: OwnerTelegramCardProps) {
  const t = useTranslations('settings.ownerTelegram');
  const { locale } = useAppLocale();
  const bot = `@${botUsername}`;

  if (status === 'loading') return <OwnerTelegramCardSkeleton />;

  const command = code ? ownerBotLinkCommand(code.code) : '';

  return (
    <SettingsSection title={t('title')}>
      <Card padding="none" className="divide-y divide-gray-100 overflow-hidden">
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
          <div className="min-w-0">
            <p id="setting-owner-telegram" className="text-sm font-semibold text-gray-950">{t('rowTitle')}</p>
            <p className="mt-0.5 max-w-md text-xs leading-5 text-gray-500">
              {link
                ? t('linkedTo', { account: telegramAccountName(link.telegram_username) ?? t('linkedAccount'), date: formatDateOnly(link.linked_at, locale) })
                : t('help', { bot })}
            </p>
          </div>
          {status === 'ready' && (
            <div className="shrink-0">
              {link ? (
                <Button
                  variant="outline"
                  icon={<Unlink size={16} aria-hidden="true" />}
                  loading={busy === 'unlink'}
                  disabled={busy !== null}
                  onClick={onUnlink}
                  className="w-full sm:w-auto"
                >
                  {t('unlink')}
                </Button>
              ) : (
                <Button
                  variant={code ? 'outline' : 'primary'}
                  icon={<KeyRound size={16} aria-hidden="true" />}
                  loading={busy === 'code'}
                  disabled={busy !== null}
                  onClick={onGetCode}
                  className="w-full sm:w-auto"
                >
                  {code ? t('newCode') : t('getCode')}
                </Button>
              )}
            </div>
          )}
        </div>

        {status === 'error' && (
          <div className="px-5 py-4">
            <LoadErrorAlert onRetry={onRetry}>{t('loadError')}</LoadErrorAlert>
          </div>
        )}

        {status === 'ready' && !link && code && (
          <div className="space-y-3 px-5 py-4" aria-labelledby="setting-owner-telegram">
            <p className="text-sm text-gray-700">{t('sendCommand', { bot })}</p>
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 select-all truncate rounded-lg bg-gray-50 px-4 py-3 font-mono text-lg font-semibold tracking-wider text-gray-950">
                {command}
              </p>
              <IconButton label={t('copy')} icon={<Copy size={16} aria-hidden="true" />} onClick={() => onCopy(command)} />
            </div>
            <p className="text-xs text-gray-500">{t('expires', { time: formatTime(code.expiresAt, locale) })}</p>
            {notLinkedYet && <InlineAlert variant="info" size="sm">{t('notLinkedYet')}</InlineAlert>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <ButtonLink
                href={ownerBotUrl(botUsername)}
                target="_blank"
                variant="primary"
                icon={<ExternalLink size={16} aria-hidden="true" />}
              >
                {t('openBot', { bot })}
              </ButtonLink>
              <Button
                variant="outline"
                icon={<RefreshCw size={16} aria-hidden="true" />}
                loading={busy === 'check'}
                disabled={busy !== null}
                onClick={onCheck}
              >
                {t('check')}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-gray-50/60 px-5 py-3">
            <InlineAlert variant="danger" hideIcon size="sm">{error}</InlineAlert>
          </div>
        )}
      </Card>
    </SettingsSection>
  );
}
