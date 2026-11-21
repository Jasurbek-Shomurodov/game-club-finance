import { JsonLd } from '@/components/showcase/JsonLd';
import { brandPageJsonLd } from '@/lib/seo';
import { brandPath, clubPath, siteOrigin } from '@/lib/seoServer';
import { brandLogoUrl, type PublicBrand } from '@/lib/showcase';

/** The brand, its website and each club as structured data. */
export async function BrandJsonLd({ brand }: { brand: PublicBrand }) {
  const origin = await siteOrigin();
  const absolute = (path: string) => new URL(path, origin).toString();
  return <JsonLd data={brandPageJsonLd(brand, absolute(brandPath(brand.slug)), (slug) => absolute(clubPath(slug)), brandLogoUrl(brand))} />;
}
