import type { SupabaseClient } from '@supabase/supabase-js';

/** A name is trusted this long before it is read again; people are renamed a few times a year. */
const PROFILE_NAME_TTL_MS = 10 * 60_000;

interface CachedName {
  name: string | null;
  expiresAt: number;
}

type ProfileReader = Pick<SupabaseClient, 'from'>;

/**
 * Per client, so the browser singleton shares names across screens while a
 * server request (or a test) with its own client starts empty.
 */
const cachesByClient = new WeakMap<object, Map<string, CachedName>>();

/**
 * Display names for these user ids, as `profiles.full_name` stores them.
 *
 * Ledger rows name their author by id, so most screens follow their main read
 * with a second request for the same handful of names. Names already read by
 * this client are answered from memory: only ids not seen yet reach the
 * database, and a screen whose authors are all known makes no request at all.
 * An id without a readable profile is absent from the result and asked again
 * next time. Throws the Supabase error of a failed read.
 */
export async function fetchProfileNames(
  supabase: ProfileReader,
  ids: Iterable<string | null | undefined>,
  now: () => number = Date.now,
): Promise<Map<string, string | null>> {
  const wanted = Array.from(new Set(Array.from(ids).filter((id): id is string => Boolean(id))));
  const names = new Map<string, string | null>();
  if (wanted.length === 0) return names;

  let cache = cachesByClient.get(supabase);
  if (!cache) {
    cache = new Map();
    cachesByClient.set(supabase, cache);
  }

  const timestamp = now();
  const unknown: string[] = [];
  for (const id of wanted) {
    const cached = cache.get(id);
    if (cached && cached.expiresAt > timestamp) names.set(id, cached.name);
    else unknown.push(id);
  }
  if (unknown.length === 0) return names;

  const { data, error } = await supabase.from('profiles').select('id,full_name').in('id', unknown);
  if (error) throw error;
  for (const profile of (data ?? []) as Array<{ id: string; full_name: string | null }>) {
    cache.set(profile.id, { name: profile.full_name, expiresAt: now() + PROFILE_NAME_TTL_MS });
    names.set(profile.id, profile.full_name);
  }
  return names;
}
