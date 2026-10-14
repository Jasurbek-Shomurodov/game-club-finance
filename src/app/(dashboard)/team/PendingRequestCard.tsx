'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { Avatar, Button, Card } from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { formatDateTime } from '@/lib/formatters';
import type { TeamMember } from '@/lib/team';

interface PendingRequestCardProps {
  member: TeamMember;
  /** The approve controls (club, role, approve button). */
  accessControls: ReactNode;
  rejecting: boolean;
  /** Another write is in progress. */
  busy: boolean;
  onReject: () => void;
}

/** A sign-up waiting for club access, with approve and reject actions. */
export function PendingRequestCard({ member, accessControls, rejecting, busy, onReject }: PendingRequestCardProps) {
  const t = useTranslations('team');
  const { locale } = useAppLocale();

  return (
    <Card
      tone="warning"
      padding="sm"
      className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={member.full_name} tone="neutral" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-950">{member.full_name}</p>
          <p className="truncate text-xs text-gray-500">
            {member.email && <span>{member.email} · </span>}
            {t('requestedAt', { date: formatDateTime(member.created_at, locale) })}
          </p>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center lg:shrink-0">
        <div className="min-w-0 lg:w-[460px]">
          {accessControls}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-gray-500 hover:text-danger-600"
          icon={<X size={15} aria-hidden="true" />}
          loading={rejecting}
          disabled={busy && !rejecting}
          onClick={onReject}
        >
          {t('reject')}
        </Button>
      </div>
    </Card>
  );
}
