import { describe, expect, it } from 'vitest';
import { sitemapXml } from './sitemapXml';

describe('sitemapXml', () => {
  it('links the browser stylesheet and escapes hreflang URLs', () => {
    const xml = sitemapXml([
      { url: 'https://www.pixelgaming.uz/', changeFrequency: 'weekly', priority: 1, alternates: { uz: 'https://www.pixelgaming.uz/?lang=uz&x=1' } },
    ]);
    expect(xml).toMatch(/^<\?xml [^\n]*\?>\n<\?xml-stylesheet type="text\/xsl" href="\/sitemap\.xsl"\?>\n<urlset /);
    expect(xml).toContain('<loc>https://www.pixelgaming.uz/</loc>');
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="uz" href="https://www.pixelgaming.uz/?lang=uz&amp;x=1" />');
    expect(xml).toContain('<changefreq>weekly</changefreq>');
    expect(xml).toContain('<priority>1</priority>');
  });

  it('is a valid empty urlset when there are no pages', () => {
    expect(sitemapXml([])).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n</urlset>');
  });
});
