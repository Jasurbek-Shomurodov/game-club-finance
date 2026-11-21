import { serializeJsonLd } from '@/lib/seo';

/** schema.org structured data for search engines; renders nothing visible. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
