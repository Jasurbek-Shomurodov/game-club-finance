'use client';

import { useTranslations } from 'next-intl';
import { UserPlus } from 'lucide-react';
import { Button, Select, type ButtonVariant } from '@/components/PresentationFoundation';
import { TEAM_ROLES } from '@/lib/team';
import type { UserRole } from '@/types';

interface AddAccessControlsProps {
  role: UserRole;
  saving: boolean;
  buttonLabel: string;
  buttonVariant?: ButtonVariant;
  onRoleChange: (role: UserRole) => void;
  onSubmit: () => void;
}

/** Role picker and the grant button for the selected club, used to approve a request or add a member. */
export function AddAccessControls({
  role,
  saving,
  buttonLabel,
  buttonVariant = 'primary',
  onRoleChange,
  onSubmit,
}: AddAccessControlsProps) {
  const t = useTranslations('team');

  return (
    <div className="grid gap-2 sm:grid-cols-[140px_auto]">
      <Select
        aria-label={t('memberRole')}
        value={role}
        disabled={saving}
        onChange={(event) => onRoleChange(event.target.value as UserRole)}
      >
        {TEAM_ROLES.map((item) => (
          <option key={item} value={item}>{t(`roles.${item}`)}</option>
        ))}
      </Select>
      <Button
        variant={buttonVariant}
        className="px-5"
        loading={saving}
        onClick={onSubmit}
        icon={<UserPlus size={16} aria-hidden="true" />}
      >
        {buttonLabel}
      </Button>
    </div>
  );
}
