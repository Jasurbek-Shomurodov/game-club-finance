import { revalidateTag } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { PUBLIC_SHOWCASE_TAG } from '@/lib/supabase/publicShowcase';

/**
 * Clears the cached public page reads after an owner saves a showcase or brand
 * page, so the public site shows the change on the next visit instead of
 * within the cache's minute. Clearing is harmless, so any signed-in user may.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  revalidateTag(PUBLIC_SHOWCASE_TAG, { expire: 0 });
  return new Response(null, { status: 204 });
}
