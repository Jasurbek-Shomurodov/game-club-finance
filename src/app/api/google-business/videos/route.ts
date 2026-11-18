import { createVideo } from '@/lib/googleBusiness/api';
import { isHttpsUrl } from '@/lib/googleBusiness/posts';
import { connectedLocation, errorResponse, googleErrorResponse } from '@/lib/googleBusiness/server';

/**
 * Adds a video to the listing's photos and videos. Google downloads it from
 * `videoUrl`, so it must be public: the page uploads it to the showcase bucket first.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { clubId?: unknown; videoUrl?: unknown } | null;
  if (!body || typeof body.videoUrl !== 'string' || !isHttpsUrl(body.videoUrl)) {
    return errorResponse('INVALID_REQUEST');
  }

  try {
    const location = await connectedLocation(body.clubId);
    if (location instanceof Response) return location;
    const created = await createVideo(location.accessToken, location.path, body.videoUrl);
    return Response.json({ video: { name: created.name ?? null, googleUrl: created.googleUrl ?? null } });
  } catch (error) {
    return googleErrorResponse(error, { clubId: body.clubId, action: 'add_video' });
  }
}
