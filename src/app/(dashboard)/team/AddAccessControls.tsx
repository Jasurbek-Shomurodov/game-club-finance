'use client';

import { useTranslations } from 'next-intl';
import { Building2, ShieldCheck, UserPlus } from 'lucide-react';
import { Button, Select, type ButtonVariant } from '@/components/PresentationFoundation';
import { TEAM_ROLES, type AccessDraft } from '@/lib/team';
import type { Club, UserRole } from '@/types';

interface AddAccessControlsProps {
  availableClubs: ReadonlyArray<Pick<Club, 'id' | 'name'>>;
  draft: AccessDraft;
  saving: boolean;
  /** Whether the caller owns any club at all; picks the "nothing to add" message. */
  ownsAnyClub: boolean;
  buttonLabel: string;
  buttonVariant?: ButtonVariant;
  onDraftChange: (patch: Partial<AccessDraft>) => void;
  onSubmit: () => void;
}

/** Club + role pickers and the grant button, used to approve a request or add a club. */
export function AddAccessControls({
  availableClubs,
  draft,
  saving,
  ownsAnyClub,
  buttonLabel,
  buttonVariant = 'primary',
  onDraftChange,
  onSubmit,
}: AddAccessControlsProps) {
  const t = useTranslations('team');

  if (availableClubs.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-surface px-4 py-3 text-sm font-medium text-gray-500">
        <ShieldCheck size={16} className="text-success-500" aria-hidden="true" />
        {ownsAnyClub ? t('allClubsAdded') : t('noOwnedClubs')}
      </div>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_auto]">
      <Select
        leadingIcon={<Building2 size={16} />}
        aria-label={t('gameClubs')}
        value={draft.clubId}
        disabled={saving}
        onChange={(event) => onDraftChange({ clubId: event.target.value })}
      >
        {availableClubs.map((club) => (
          <option key={club.id} value={club.id}>{club.name}</option>
        ))}
      </Select>
      <Select
        aria-label={t('memberRole')}
        value={draft.role}
        disabled={saving}
        onChange={(event) => onDraftChange({ role: event.target.value as UserRole })}
      >
        {TEAM_ROLES.map((role) => (
          <option key={role} value={role}>{t(`roles.${role}`)}</option>
        ))}
      </Select>
      <Button
        variant={buttonVariant}
        className="px-5"
        loading={saving}
        disabled={!draft.clubId}
        onClick={onSubmit}
        icon={<UserPlus size={16} aria-hidden="true" />}
      >
        {buttonLabel}
      </Button>
    </div>
  );
}
