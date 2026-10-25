'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { fetchIsDateCollected } from '@/lib/supabase/dailyCashCollections';

/**
 * Whether the picked date is closed because its money was collected (097), so
 * a form can say so before saving. A failed check returns false: the database
 * still refuses the write.
 */
export function useCollectedDay(clubId: string | null | undefined, date: string | null | undefined): boolean {
  const [closed, setClosed] = useState<{ key: string; value: boolean } | null>(null);
  const key = clubId && date ? `${clubId}:${date}` : null;

  useEffect(() => {
    if (!clubId || !date) return;
    let current = true;
    fetchIsDateCollected(createClient(), clubId, date)
      .then((value) => { if (current) setClosed({ key: `${clubId}:${date}`, value }); })
      .catch(() => { if (current) setClosed({ key: `${clubId}:${date}`, value: false }); });
    return () => { current = false; };
  }, [clubId, date]);

  return key !== null && closed?.key === key && closed.value;
}
