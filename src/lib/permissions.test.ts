import { describe, expect, it } from 'vitest';
import {
  canAccessPath,
  canAccessFeature,
  defaultPathForAccess,
  featureAccessForMembership,
  featureForPath,
  normalizeFeatureAccess,
  updateFeatureAccessSelection,
} from './permissions';

describe('feature permissions', () => {
  it('keeps current role defaults until an owner saves an explicit list', () => {
    expect(featureAccessForMembership('admin', null)).toContain('expenses');
    expect(featureAccessForMembership('viewer', null)).not.toContain('expenses');
    expect(featureAccessForMembership('admin', [])).toEqual([]);
  });

  it('normalizes unknown and duplicate feature keys', () => {
    expect(normalizeFeatureAccess(['reports', 'unknown', 'reports', 'dashboard'])).toEqual([
      'dashboard',
      'reports',
    ]);
  });

  it('updates an explicit selection in stable display order', () => {
    expect(updateFeatureAccessSelection(['reports'], 'dashboard', true)).toEqual(['dashboard', 'reports']);
    expect(updateFeatureAccessSelection(['dashboard', 'reports'], 'dashboard', false)).toEqual(['reports']);
  });

  it('maps detail and retired redirect routes to their destination feature', () => {
    expect(featureForPath('/game-club-money-details')).toBe('dashboard');
    expect(featureForPath('/financial-analysis')).toBe('dashboard');
    expect(featureForPath('/monthly-report')).toBe('reports');
    expect(featureForPath('/expense')).toBe('expenses');
    expect(featureForPath('/balance')).toBe('expenses');
    expect(featureForPath('/income')).toBe('daily_cash');
  });

  it('keeps the entry history owner-only, even with every feature granted', () => {
    expect(featureForPath('/history')).toBe('team');
    expect(canAccessPath('owner', null, '/history')).toBe(true);
    expect(canAccessPath('admin', ['team', 'reports', 'expenses'], '/history')).toBe(false);
    expect(canAccessPath('viewer', null, '/history')).toBe(false);
  });

  it('guards paths and picks the first allowed destination', () => {
    expect(canAccessPath('admin', ['reports'], '/expenses')).toBe(false);
    expect(canAccessPath('admin', ['reports'], '/reports')).toBe(true);
    expect(canAccessPath('admin', ['expenses'], '/reports')).toBe(true);
    expect(canAccessPath('admin', ['expenses'], '/income')).toBe(false);
    expect(canAccessPath('admin', ['daily_cash'], '/income')).toBe(true);
    expect(canAccessPath('admin', ['expenses'], '/balance')).toBe(true);
    expect(defaultPathForAccess('admin', ['reports'])).toBe('/reports');
    expect(defaultPathForAccess('admin', ['expenses'])).toBe('/reports');
    // Collection has no page; a collector lands on the next page they can open.
    expect(defaultPathForAccess('admin', ['collection', 'reports'])).toBe('/reports');
    expect(defaultPathForAccess('admin', ['collection'])).toBe('/salaries');
    expect(canAccessFeature('admin', null, 'collection')).toBe(false);
  });

  it('always gives owners full access and keeps Team owner-only', () => {
    expect(canAccessPath('owner', [], '/expenses')).toBe(true);
    expect(canAccessPath('admin', ['team'], '/team')).toBe(false);
    expect(canAccessPath('owner', [], '/showcase')).toBe(true);
    expect(canAccessPath('viewer', null, '/dashboard')).toBe(true);
    expect(canAccessPath('admin', ['reports'], '/dashboard')).toBe(false);
    expect(canAccessPath('owner', [], '/salaries')).toBe(true);
    expect(canAccessPath('admin', [], '/salaries')).toBe(true);
    expect(canAccessPath('viewer', [], '/salaries')).toBe(true);
  });
  it('opens the public page editor only with an explicit grant for nonowners', () => {
    expect(canAccessPath('admin', null, '/showcase')).toBe(false);
    expect(canAccessPath('admin', ['team'], '/showcase')).toBe(false);
    expect(canAccessPath('admin', ['showcase'], '/showcase')).toBe(true);
    expect(canAccessFeature('viewer', ['showcase'], 'showcase')).toBe(true);
  });
  it('requires an explicit salary editing grant for nonowners', () => {
    for (const role of ['admin', 'viewer'] as const) {
      expect(canAccessFeature(role, null, 'salaries')).toBe(false);
      expect(canAccessFeature(role, [], 'salaries')).toBe(false);
      expect(canAccessFeature(role, ['salaries'], 'salaries')).toBe(true);
      expect(defaultPathForAccess(role, [])).toBe('/salaries');
    }
    expect(canAccessFeature('owner', [], 'salaries')).toBe(true);
  });

});
