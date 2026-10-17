import { z } from 'zod';
import { isMissingDatabaseFunction } from './errors';

const healthSchema = z.object({
  historyAvailable: z.boolean(),
  recordedVersions: z.array(z.string()),
  checks: z.array(z.object({
    version: z.string(),
    name: z.string(),
    status: z.enum(['missing', 'different', 'matching']),
  })),
});
export type MigrationHealth = z.infer<typeof healthSchema>;
export type HealthResult =
  | { status: 'ready'; data: MigrationHealth }
  | { status: 'unavailable' | 'error' };

interface HealthClient {
  rpc(name: string, args: { p_club_id: string }): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}

export async function loadMigrationHealth(client: HealthClient, clubId: string): Promise<HealthResult> {
  try {
    const { data, error } = await client.rpc('get_migration_health', { p_club_id: clubId });
    if (error) {
      return { status: isMissingDatabaseFunction(error, 'get_migration_health') ? 'unavailable' : 'error' };
    }
    const parsed = healthSchema.safeParse(data);
    return parsed.success ? { status: 'ready', data: parsed.data } : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

/** Committed migration files whose numeric version has no history record. Unrecorded is unconfirmed, not missing. */
export function unrecordedMigrations(files: readonly string[], recordedVersions: readonly string[]): string[] {
  const recorded = new Set(recordedVersions);
  return files.filter((file) => !recorded.has(file.split('_')[0]));
}
