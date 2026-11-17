import { authorizeClub, errorResponse, isClubId } from '@/lib/googleBusiness/server';
import type { ReviewReplyRecord } from '@/lib/googleBusiness/reviews';
import { createServiceClient } from '@/lib/supabase/service';

const RECENT_LIMIT = 20;

/** Whether auto replies are on and the latest replies posted for the club (showcase feature). */
export async function GET(request: Request) {
  const clubId = new URL(request.url).searchParams.get('clubId');
  if (!isClubId(clubId)) return errorResponse('INVALID_REQUEST');
  const access = await authorizeClub(clubId, 'showcase');
  if (access instanceof Response) return access;

  const supabase = createServiceClient();
  const [connection, replies] = await Promise.all([
    supabase.from('google_business_connections').select('review_auto_reply').eq('club_id', clubId).maybeSingle(),
    supabase
      .from('google_review_replies')
      .select('review_name, reviewer_name, star_rating, review_comment, reply_comment, replied_at')
      .eq('club_id', clubId)
      .order('replied_at', { ascending: false })
      .limit(RECENT_LIMIT),
  ]);
  if (connection.error || replies.error) {
    console.error('[google-business] review replies read failed', { clubId, error: (connection.error ?? replies.error)?.message });
    return errorResponse('SERVER_ERROR');
  }
  if (!connection.data) return errorResponse('NOT_CONNECTED');

  const recent: ReviewReplyRecord[] = (replies.data ?? []).map((row) => ({
    reviewName: row.review_name,
    reviewerName: row.reviewer_name,
    starRating: row.star_rating,
    reviewComment: row.review_comment,
    replyComment: row.reply_comment,
    repliedAt: row.replied_at,
  }));
  return Response.json({ autoReply: connection.data.review_auto_reply === true, replies: recent });
}

/** Turns the daily auto replies on or off (owner only). */
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null) as { clubId?: unknown; autoReply?: unknown } | null;
  if (!body || !isClubId(body.clubId) || typeof body.autoReply !== 'boolean') return errorResponse('INVALID_REQUEST');
  const access = await authorizeClub(body.clubId, 'owner');
  if (access instanceof Response) return access;

  const { data, error } = await createServiceClient()
    .from('google_business_connections')
    .update({ review_auto_reply: body.autoReply, updated_at: new Date().toISOString() })
    .eq('club_id', body.clubId)
    .select('review_auto_reply')
    .maybeSingle();
  if (error) {
    console.error('[google-business] auto reply update failed', { clubId: body.clubId, error: error.message });
    return errorResponse('SERVER_ERROR');
  }
  if (!data) return errorResponse('NOT_CONNECTED');
  return Response.json({ autoReply: data.review_auto_reply === true });
}
