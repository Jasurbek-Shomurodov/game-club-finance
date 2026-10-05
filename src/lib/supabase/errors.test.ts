import { describe, expect, it } from 'vitest';
import { isMissingDatabaseColumn, isMissingDatabaseFunction, isMissingDatabaseTable } from './errors';

describe('isMissingDatabaseFunction', () => {
  it('recognizes PostgREST missing-function errors', () => {
    expect(isMissingDatabaseFunction({ code: 'PGRST202' }, 'get_dashboard_snapshot')).toBe(true);
    expect(isMissingDatabaseFunction(
      { message: 'Could not find the public.get_dashboard_snapshot function in the schema cache' },
      'get_dashboard_snapshot',
    )).toBe(true);
  });

  it('does not hide unrelated database errors', () => {
    expect(isMissingDatabaseFunction({ code: '42501', message: 'permission denied' }, 'get_dashboard_snapshot')).toBe(false);
    expect(isMissingDatabaseFunction(
      { code: '42501', message: 'permission denied for function get_dashboard_snapshot' },
      'get_dashboard_snapshot',
    )).toBe(false);
    expect(isMissingDatabaseFunction(
      { message: 'permission denied for function get_dashboard_snapshot' },
      'get_dashboard_snapshot',
    )).toBe(false);
    expect(isMissingDatabaseFunction(
      { code: '57014', message: 'function get_dashboard_snapshot: statement timeout' },
      'get_dashboard_snapshot',
    )).toBe(false);
  });

  it('recognizes a missing database column without hiding other query failures', () => {
    expect(isMissingDatabaseColumn(
      { code: '42703', message: 'column club_memberships.feature_access does not exist' },
      'feature_access',
    )).toBe(true);
    expect(isMissingDatabaseColumn(
      { code: '42501', message: 'permission denied for feature_access' },
      'feature_access',
    )).toBe(false);
  });
});

describe('isMissingDatabaseTable', () => {
  it('recognizes a missing table without hiding other query failures', () => {
    expect(isMissingDatabaseTable({ code: 'PGRST205' }, 'owner_profit_carryovers')).toBe(true);
    expect(isMissingDatabaseTable({ code: '42P01' }, 'owner_profit_carryovers')).toBe(true);
    expect(isMissingDatabaseTable(
      { message: "Could not find the table 'public.owner_profit_carryovers' in the schema cache" },
      'owner_profit_carryovers',
    )).toBe(true);
    expect(isMissingDatabaseTable({ code: '42501', message: 'permission denied for table owner_profit_carryovers' }, 'owner_profit_carryovers')).toBe(false);
    expect(isMissingDatabaseTable(null, 'owner_profit_carryovers')).toBe(false);
  });
});
