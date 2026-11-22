<?xml version="1.0" encoding="UTF-8"?>
<!-- Renders /sitemap.xml as a readable table when opened in a browser.
     Search engines ignore it and read the XML as before. -->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  exclude-result-prefixes="s xhtml">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="robots" content="noindex"/>
        <title>XML Sitemap</title>
        <style>
          :root { color-scheme: light dark; --bg: #ffffff; --fg: #1a1a1a; --muted: #6b6b6b; --line: #e5e5e5; --row: #fafafa; --link: #0b5cd6; }
          @media (prefers-color-scheme: dark) { :root { --bg: #121212; --fg: #ececec; --muted: #9a9a9a; --line: #2a2a2a; --row: #181818; --link: #7fb0ff; } }
          * { box-sizing: border-box; }
          body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
          main { max-width: 1100px; margin: 0 auto; padding: 32px 16px 48px; }
          h1 { font-size: 22px; margin: 0 0 4px; }
          p { margin: 0 0 24px; color: var(--muted); }
          .wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
          th { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
          tr:last-child td { border-bottom: 0; }
          tbody tr:nth-child(even) { background: var(--row); }
          td.num { white-space: nowrap; color: var(--muted); font-variant-numeric: tabular-nums; }
          a { color: var(--link); text-decoration: none; word-break: break-all; }
          a:hover { text-decoration: underline; }
          .alt { display: inline-block; margin: 4px 6px 0 0; font-size: 12px; }
        </style>
      </head>
      <body>
        <main>
          <h1>XML Sitemap</h1>
          <p><xsl:value-of select="count(s:urlset/s:url)"/> URLs. This page is for people; search engines read the XML.</p>
          <div class="wrap">
            <table>
              <thead>
                <tr><th>URL</th><th>Last modified</th><th>Change</th><th>Priority</th></tr>
              </thead>
              <tbody>
                <xsl:for-each select="s:urlset/s:url">
                  <tr>
                    <td>
                      <a href="{s:loc}"><xsl:value-of select="s:loc"/></a>
                      <xsl:if test="xhtml:link">
                        <div>
                          <xsl:for-each select="xhtml:link">
                            <a class="alt" href="{@href}"><xsl:value-of select="@hreflang"/></a>
                          </xsl:for-each>
                        </div>
                      </xsl:if>
                    </td>
                    <td class="num"><xsl:value-of select="substring(s:lastmod, 1, 10)"/></td>
                    <td class="num"><xsl:value-of select="s:changefreq"/></td>
                    <td class="num"><xsl:value-of select="s:priority"/></td>
                  </tr>
                </xsl:for-each>
              </tbody>
            </table>
          </div>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
