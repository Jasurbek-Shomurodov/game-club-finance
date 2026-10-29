import { getLocationInfo, updateLocationInfo } from '@/lib/googleBusiness/api';
import {
  LISTING_READ_MASK,
  buildListingPatch,
  fromGoogleLocation,
  parseListingUpdate,
  validateListingInfo,
} from '@/lib/googleBusiness/listing';
import { connectedLocation, errorResponse, googleErrorResponse } from '@/lib/googleBusiness/server';

/** The listing's description, phone, website and hours as Google has them. */
export async function GET(request: Request) {
  const clubId = new URL(request.url).searchParams.get('clubId');
  try {
    const location = await connectedLocation(clubId);
    if (location instanceof Response) return location;
    const info = await getLocationInfo(location.accessToken, location.locationName, LISTING_READ_MASK);
    return Response.json({ listing: fromGoogleLocation(info) });
  } catch (error) {
    return googleErrorResponse(error, { clubId, action: 'get_listing' });
  }
}

/** Saves the changed fields to Google (owners only: this is the club's public identity). */
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null) as { clubId?: unknown } | null;
  const update = parseListingUpdate(body);
  if (!body || !update) return errorResponse('INVALID_REQUEST');
  const validation = validateListingInfo(update.form, update.fields);
  if (validation) return Response.json({ code: 'INVALID_REQUEST', validation }, { status: 400 });

  try {
    const location = await connectedLocation(body.clubId, 'owner');
    if (location instanceof Response) return location;
    // Replacing phoneNumbers would drop the listing's other numbers; carry them over.
    const additionalPhones = update.fields.includes('phone')
      ? (await getLocationInfo(location.accessToken, location.locationName, 'phoneNumbers')).phoneNumbers?.additionalPhones ?? []
      : [];
    const patch = buildListingPatch(update.form, update.fields, additionalPhones);
    const saved = await updateLocationInfo(location.accessToken, location.locationName, patch.body, patch.updateMask);
    const fresh = await getLocationInfo(location.accessToken, location.locationName, LISTING_READ_MASK).catch(() => saved);
    return Response.json({ listing: fromGoogleLocation(fresh) });
  } catch (error) {
    return googleErrorResponse(error, { clubId: body.clubId, action: 'update_listing', fields: update.fields });
  }
}
