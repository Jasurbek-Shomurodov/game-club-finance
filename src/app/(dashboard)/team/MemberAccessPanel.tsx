'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, Lock, Trash2, UserPlus, X } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  Field,
  IconButton,
  SectionHeading,
  Select,
} from '@/components/PresentationFoundation';
import { FEATURE_DEFINITIONS, featureAccessForMembership, type FeatureKey } from '@/lib/permissions';
import { TEAM_ROLES, type TeamMember, type TeamMembership } from '@/lib/team';
import type { UserRole } from '@/types';

interface MemberAccessPanelProps {
  member: TeamMember;
  membership: TeamMembership;
  isCurrentUser: boolean;
  canManage: boolean;
  /** The caller themself or a club's only owner: role and removal are locked. */
  protectedOwner: boolean;
  saving: boolean;
  savingFeatures: boolean;
  featureAccessAvailable: boolean;
  hasAvailableClubs: boolean;
  addAccessExpanded: boolean;
  addAccessControls: ReactNode;
  onSelectClub: (clubId: string) => void;
  onRoleChange: (role: UserRole) => void;
  onToggleAddAccess: () => void;
  onFeatureChange: (featureKey: FeatureKey, enabled: boolean) => void;
  onRemove: () => void;
  onClose: () => void;
}

/** The expanded access settings of one member in one club. */
export function MemberAccessPanel({
  member,
  membership,
  isCurrentUser,
  canManage,
  protectedOwner,
  saving,
  savingFeatures,
  featureAccessAvailable,
  hasAvailableClubs,
  addAccessExpanded,
  addAccessControls,
  onSelectClub,
  onRoleChange,
  onToggleAddAccess,
  onFeatureChange,
  onRemove,
  onClose,
}: MemberAccessPanelProps) {
  const t = useTranslations('team');
  const featureAccess = featureAccessForMembership(membership.role, membership.featureAccess);

  return (
    <div id={`member-access-${member.id}`} className="border-t border-gray-100 bg-gray-50/60 px-5 py-5">
      <SectionHeading
        as="h3"
        size="sm"
        className="mb-5"
        title={t('accessSettings')}
        description={canManage ? t('autoSave') : t('notClubOwner')}
        action={<IconButton variant="ghost" size="sm" label={t('hideAccess')} icon={<X size={17} />} onClick={onClose} />}
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <Field label={t('gameClubs')} htmlFor={`member-club-${member.id}`}>
          <Select
            id={`member-club-${member.id}`}
            className="font-medium"
            value={membership.clubId}
            disabled={saving}
            onChange={(event) => onSelectClub(event.target.value)}
          >
            {member.memberships.map((item) => <option key={item.clubId} value={item.clubId}>{item.clubName}</option>)}
          </Select>
        </Field>
        <Field
          label={t('memberRole')}
          htmlFor={`member-role-${member.id}`}
          hint={!canManage ? t('notClubOwner') : protectedOwner ? (isCurrentUser ? t('selfDemoteBlocked') : t('lastOwnerBlocked')) : undefined}
        >
          <Select
            id={`member-role-${member.id}`}
            className="font-medium"
            value={membership.role}
            disabled={saving || protectedOwner || !canManage}
            onChange={(event) => onRoleChange(event.target.value as UserRole)}
          >
            {TEAM_ROLES.map((role) => <option key={role} value={role}>{t(`roles.${role}`)}</option>)}
          </Select>
        </Field>
        {hasAvailableClubs && (
          <Button
            variant="outline"
            disabled={saving}
            onClick={onToggleAddAccess}
            aria-expanded={addAccessExpanded}
            aria-controls={`add-access-${member.id}`}
            icon={<UserPlus size={16} aria-hidden="true" />}
          >
            {t('addAccess')}
          </Button>
        )}
      </div>
      {addAccessExpanded && (
        <div id={`add-access-${member.id}`} className="mb-5 rounded-xl border border-gray-200 bg-surface p-4">
          <p className="mb-3 text-sm font-medium text-gray-800">{t('addAccessHelp')}</p>
          {addAccessControls}
        </div>
      )}
      {featureAccessAvailable && (
        <div className="border-t border-gray-200/70 pt-5">
          <SectionHeading
            as="h3"
            size="sm"
            title={t('pageAccess')}
            description={membership.role === 'owner' ? t('ownerFeatureAccessHelp') : t('featureAccessHelp')}
            action={<Badge variant="outline" icon={<Building2 size={13} aria-hidden="true" />}>{membership.clubName}</Badge>}
          />

          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {FEATURE_DEFINITIONS.map((feature) => {
              const ownerOnly = 'ownerOnly' in feature && feature.ownerOnly;
              const disabled = savingFeatures || saving || membership.role === 'owner' || ownerOnly || !canManage;
              const checked = membership.role === 'owner'
                ? true
                : !ownerOnly && featureAccess.includes(feature.key);

              return (
                <Checkbox
                  key={feature.key}
                  variant="card"
                  className="min-h-[76px]"
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) => onFeatureChange(feature.key, event.target.checked)}
                  label={t(`features.${feature.labelKey}`)}
                  description={(
                    <>
                      {t(`features.${feature.descriptionKey}`)}
                      {ownerOnly && membership.role !== 'owner' && (
                        <span className="mt-1 flex items-center gap-1 font-medium text-gray-600">
                          <Lock size={12} aria-hidden="true" />
                          {t('ownerOnlyFeature')}
                        </span>
                      )}
                    </>
                  )}
                />
              );
            })}
          </div>
        </div>
      )}
      <div className="mt-5 flex flex-col gap-3 border-t border-gray-200/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-gray-500">
          {!canManage ? t('notClubOwner') : isCurrentUser ? t('selfRemoveBlocked') : protectedOwner ? t('lastOwnerBlocked') : t('removeAccessHelp', { club: membership.clubName })}
        </p>
        <Button
          variant="dangerOutline"
          size="sm"
          className="shrink-0"
          disabled={saving || isCurrentUser || protectedOwner || !canManage}
          onClick={onRemove}
          aria-label={t('removeClubAccess', { club: membership.clubName })}
          icon={<Trash2 size={15} aria-hidden="true" />}
        >
          {t('removeAccess')}
        </Button>
      </div>
    </div>
  );
}
