import { createPhoto } from '@/lib/googleBusiness/api';
import { PHOTO_CATEGORIES, isHttpsUrl, type GooglePhotoCategory } from '@/lib/googleBusiness/posts';
import { connectedLocation, errorResponse, googleErrorResponse } from '@/lib/googleBusiness/server';

/**
 * Adds a photo to the listing's gallery. Google downloads it from `photoUrl`,
 * so it must be public: the page uploads it to the showcase bucket first.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { clubId?: unknown; photoUrl?: unknown; category?: unknown } | null;
  if (
    !body
    || typeof body.photoUrl !== 'string'
    || !isHttpsUrl(body.photoUrl)
    || !PHOTO_CATEGORIES.includes(body.category as GooglePhotoCategory)
  ) {
    return errorResponse('INVALID_REQUEST');
  }

  try {
    const location = await connectedLocation(body.clubId);
    if (location instanceof Response) return location;
    const created = await createPhoto(location.accessToken, location.path, body.photoUrl, body.category as GooglePhotoCategory);
    return Response.json({ photo: { name: created.name ?? null, googleUrl: created.googleUrl ?? null } });
  } catch (error) {
    return googleErrorResponse(error, { clubId: body.clubId, action: 'add_photo' });
  }
}
