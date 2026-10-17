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
  rpc(name: string, args: { p_club_id: string; p_probes?: unknown }): PromiseLike<{
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

/** A generated entry of migrationManifest.json: a migration file and the schema objects that prove it ran. */
export interface ManifestEntry {
  file: string;
  probes: readonly unknown[];
}

export type ProbeResult =
  | { status: 'ready'; results: boolean[] }
  | { status: 'unavailable' | 'error' };

/** Asks the database (migration 085) which manifest probes exist, in manifest order. */
export async function loadProbeResults(
  client: HealthClient,
  clubId: string,
  manifest: readonly ManifestEntry[],
): Promise<ProbeResult> {
  const probes = manifest.flatMap((entry) => entry.probes);
  try {
    const { data, error } = await client.rpc('get_migration_probe_results', { p_club_id: clubId, p_probes: probes });
    if (error) {
      return { status: isMissingDatabaseFunction(error, 'get_migration_probe_results') ? 'unavailable' : 'error' };
    }
    const parsed = z.array(z.boolean()).length(probes.length).safeParse(data);
    return parsed.success ? { status: 'ready', results: parsed.data } : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

/**
 * applied: every probe exists, or (with nothing to probe) the history records it.
 * likely: nothing to probe or record, but a later migration (fully or partly) is applied.
 * partial / notApplied: some / none of its probes exist.
 * unknown: nothing to probe, unrecorded, and no later migration is applied.
 */
export type MigrationStatus = 'applied' | 'likely' | 'partial' | 'notApplied' | 'unknown';

/**
 * Per-migration status from the probe results (null when migration 085 is not installed)
 * and the recorded history versions, matched by the numeric filename prefix.
 */
export function migrationStatuses(
  manifest: readonly ManifestEntry[],
  recordedVersions: readonly string[],
  results: readonly boolean[] | null,
): { file: string; status: MigrationStatus }[] {
  const recorded = new Set(recordedVersions);
  let offset = 0;
  const statuses: MigrationStatus[] = manifest.map(({ file, probes }) => {
    const found = results?.slice(offset, offset + probes.length) ?? [];
    offset += probes.length;
    if (results && probes.length > 0) {
      const present = found.filter(Boolean).length;
      return present === probes.length ? 'applied' : present === 0 ? 'notApplied' : 'partial';
    }
    return recorded.has(file.split('_')[0]) ? 'applied' : 'unknown';
  });
  let laterApplied = false;
  for (let i = statuses.length - 1; i >= 0; i--) {
    if (statuses[i] === 'unknown' && laterApplied && results) statuses[i] = 'likely';
    if (statuses[i] === 'applied' || statuses[i] === 'partial') laterApplied = true;
  }
  return manifest.map(({ file }, i) => ({ file, status: statuses[i] }));
}
