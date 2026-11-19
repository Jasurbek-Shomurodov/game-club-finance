// Route: GET /api/logo-icon?src=<showcase logo url> — public, no sign-in.
// Redraws a club logo as a round PNG with transparent corners so it reads as
// a logo, not a dark square, in a browser tab. Only logos in the public
// showcase bucket are accepted, so this cannot proxy arbitrary images.

import { ImageResponse } from 'next/og';
import { isShowcaseLogoUrl } from '@/lib/logoIcon';

const SIZE = 96;

export async function GET(request: Request) {
  const src = new URL(request.url).searchParams.get('src');
  if (!src || !isShowcaseLogoUrl(src, process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    return new Response('Not found', { status: 404 });
  }

  const logo = await fetch(src);
  const type = logo.headers.get('content-type') ?? '';
  if (!logo.ok || !type.startsWith('image/')) return new Response('Not found', { status: 404 });
  const dataUrl = `data:${type};base64,${Buffer.from(await logo.arrayBuffer()).toString('base64')}`;

  return new ImageResponse(
    (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={dataUrl} width={SIZE} height={SIZE} alt="" style={{ width: SIZE, height: SIZE, borderRadius: '50%', objectFit: 'cover' }} />
    ),
    {
      width: SIZE,
      height: SIZE,
      // Logo uploads get a new file name, so a URL's image never changes.
      headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=31536000, immutable' },
    },
  );
}
