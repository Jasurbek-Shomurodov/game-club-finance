'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm, useToast } from '@/components/PresentationFoundation';
import { useClub } from '@/components/layout/DashboardShell';
import { createClient, invalidateReadCache } from '@/lib/supabase/client';
import {
  createOwnerTelegramLinkCode,
  fetchOwnTelegramLink,
  unlinkOwnTelegram,
  type OwnTelegramLinkResult,
  type OwnerTelegramLinkCode,
} from '@/lib/supabase/ownerTelegram';
import { OWNER_BOT_USERNAME, ownsAnyClub } from '@/lib/ownerTelegramLink';
import { useClubQuery } from '@/lib/useClubQuery';
import { OwnerTelegramCard, type OwnerTelegramBusy } from './OwnerTelegramCard';

/** Settings → Telegram, for owners of any club once the owner bot is configured. */
export function OwnerTelegramSection() {
  const { account, memberships } = useClub();
  if (!OWNER_BOT_USERNAME || !account.userId || !ownsAnyClub(memberships)) return null;
  return <OwnerTelegramLinkCard botUsername={OWNER_BOT_USERNAME} userId={account.userId} />;
}

function OwnerTelegramLinkCard({ botUsername, userId }: { botUsername: string; userId: string }) {
  const t = useTranslations('settings.ownerTelegram');
  const { confirm, confirmDialog } = useConfirm();
  const { showToast, toastElement } = useToast();
  const [code, setCode] = useState<OwnerTelegramLinkCode | null>(null);
  const [busy, setBusy] = useState<OwnerTelegramBusy>(null);
  const [notLinkedYet, setNotLinkedYet] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => fetchOwnTelegramLink(createClient(), userId), [userId]);
  const query = useClubQuery<OwnTelegramLinkResult | null>(load, null);

  // Before migration 190 there is nothing to link to.
  if (query.data && !query.data.available) return null;

  const link = query.data?.link ?? null;
  const status = query.error ? 'error' : query.data ? 'ready' : 'loading';

  async function getCode() {
    setBusy('code');
    setError('');
    setNotLinkedYet(false);
    try {
      setCode(await createOwnerTelegramLinkCode(createClient()));
    } catch (codeError) {
      console.error('Failed to create a Telegram link code', codeError);
      setError(t('saveError'));
    } finally {
      setBusy(null);
    }
  }

  async function check() {
    setBusy('check');
    setError('');
    // The bot writes the link, outside this browser's cached reads.
    invalidateReadCache();
    try {
      const result = await fetchOwnTelegramLink(createClient(), userId);
      query.setData(result);
      if (result.link) {
        setCode(null);
        setNotLinkedYet(false);
        showToast(t('linked'));
      } else {
        setNotLinkedYet(true);
      }
    } catch (checkError) {
      console.error('Failed to check the Telegram link', checkError);
      setError(t('loadError'));
    } finally {
      setBusy(null);
    }
  }

  async function unlink() {
    const confirmed = await confirm({
      title: t('unlinkTitle'),
      description: t('unlinkDescription'),
      confirmLabel: t('unlink'),
      tone: 'danger',
    });
    if (!confirmed) return;
    setBusy('unlink');
    setError('');
    try {
      await unlinkOwnTelegram(createClient(), userId);
      setCode(null);
      setNotLinkedYet(false);
      showToast(t('unlinked'));
      await query.reload({ silent: true });
    } catch (unlinkError) {
      console.error('Failed to unlink Telegram', unlinkError);
      setError(t('saveError'));
    } finally {
      setBusy(null);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('copied'));
    } catch {
      // Clipboard blocked: the command stays on screen to select by hand.
    }
  }

  return (
    <>
      <OwnerTelegramCard
        botUsername={botUsername}
        status={status}
        link={link}
        code={code}
        busy={busy}
        notLinkedYet={notLinkedYet}
        error={error}
        onGetCode={() => void getCode()}
        onCheck={() => void check()}
        onCopy={(text) => void copy(text)}
        onUnlink={() => void unlink()}
        onRetry={() => void query.reload()}
      />
      {confirmDialog}
      {toastElement}
    </>
  );
}
