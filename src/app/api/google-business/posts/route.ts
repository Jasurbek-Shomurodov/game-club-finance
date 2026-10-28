import { createLocalPost, listLocalPosts } from '@/lib/googleBusiness/api';
import { buildLocalPost, parseGooglePostForm, summarizeLocalPost, validateGooglePost, type GooglePostSummary } from '@/lib/googleBusiness/posts';
import { connectedLocation, errorResponse, googleErrorResponse } from '@/lib/googleBusiness/server';

/** The listing's latest posts, newest first, as Google returns them. */
export async function GET(request: Request) {
  const clubId = new URL(request.url).searchParams.get('clubId');
  try {
    const location = await connectedLocation(clubId);
    if (location instanceof Response) return location;
    const posts = (await listLocalPosts(location.accessToken, location.path))
      .map(summarizeLocalPost)
      .filter((post): post is GooglePostSummary => post !== null);
    return Response.json({ posts });
  } catch (error) {
    return googleErrorResponse(error, { clubId, action: 'list_posts' });
  }
}

/** Publishes an update, event or offer to the club's listing (showcase feature). */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { clubId?: unknown; post?: unknown } | null;
  const form = parseGooglePostForm(body?.post);
  if (!body || !form) return errorResponse('INVALID_REQUEST');
  const validation = validateGooglePost(form);
  if (validation) return Response.json({ code: 'INVALID_REQUEST', validation }, { status: 400 });

  try {
    const location = await connectedLocation(body.clubId);
    if (location instanceof Response) return location;
    const created = await createLocalPost(location.accessToken, location.path, buildLocalPost(form));
    return Response.json({ post: summarizeLocalPost(created) });
  } catch (error) {
    return googleErrorResponse(error, { clubId: body.clubId, action: 'create_post', kind: form.kind });
  }
}
