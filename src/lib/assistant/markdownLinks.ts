/**
 * Links in assistant replies. Replies are model output, so a link is trusted
 * only by its shape, never by the prompt that asked for it.
 */

export type LinkTarget =
  /** A page of this app, opened in place. */
  | { kind: 'internal'; href: string }
  /** An https link: shown as the Markdown the model wrote, never made clickable. */
  | { kind: 'external' }
  /** Anything else (protocol-relative, javascript:, data:, odd spacing): its label as plain text. */
  | { kind: 'text' };

// Whitespace, control and invisible format characters, and backslashes: never part of a link the app builds.
const UNSAFE_CHARACTERS = /[\s\p{Cc}\p{Cf}\\]/u;

/**
 * The only pages a reply may link to: the admin pages the assistant's own
 * link builder (links.ts) produces, which filters its links through
 * internalHref so the two cannot drift. API routes, sign-in handlers and
 * every other path stay plain text.
 */
export const ASSISTANT_LINK_PATHS: ReadonlySet<string> = new Set([
  '/financial-analysis',
  '/reports',
  '/game-club-money-details',
  '/bar-money-details',
  '/daily-report',
  '/money-taken',
  '/products',
  '/debts',
]);

/** The path of an href, without its query and fragment. */
export function hrefPath(href: string): string {
  return href.split(/[?#]/, 1)[0];
}

/**
 * An href of this app: exactly one `/` followed by a character that is not
 * another slash or a backslash, so the browser cannot read it as another host
 * (`//host`, `/\host`). The path is also checked once decoded, so an encoded
 * slash or backslash (`/%2F%2Fhost`, `/%5Chost`) cannot turn into one later.
 */
export function internalHref(href: string): string | null {
  if (UNSAFE_CHARACTERS.test(href)) return null;
  if (!/^\/[^/\\]/.test(href)) return null;
  const path = hrefPath(href);
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (decoded.startsWith('//') || UNSAFE_CHARACTERS.test(decoded)) return null;
  // The destination must be one of the pages above, compared exactly (no prefixes, no dot segments).
  if (!ASSISTANT_LINK_PATHS.has(path)) return null;
  return href;
}

/** Whether the member may open a page path; without it every listed page is allowed. */
export type CanOpenPath = (path: string) => boolean;

export function linkTarget(href: string, canOpen?: CanOpenPath): LinkTarget {
  const internal = internalHref(href);
  if (internal) return !canOpen || canOpen(hrefPath(internal)) ? { kind: 'internal', href: internal } : { kind: 'text' };
  if (href.startsWith('https:')) return { kind: 'external' };
  return { kind: 'text' };
}

export type LinkSegment =
  | { type: 'text'; text: string }
  | { type: 'link'; label: string; href: string };

/** `[label](href)` with a non-empty label and an href without spaces or parentheses. */
const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^()\s]*)\)/g;

/**
 * Splits text into plain text and internal links to pages the member may
 * open. An https link stays as the Markdown the model wrote; any other link,
 * or one to a page the member may not open, keeps only its label.
 */
export function splitMarkdownLinks(text: string, canOpen?: CanOpenPath): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let buffer = '';
  let last = 0;
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const [whole, label, href] = match;
    buffer += text.slice(last, match.index);
    last = match.index + whole.length;
    const target = linkTarget(href, canOpen);
    if (target.kind === 'external') {
      buffer += whole;
    } else if (target.kind === 'text') {
      buffer += label;
    } else {
      if (buffer) segments.push({ type: 'text', text: buffer });
      buffer = '';
      segments.push({ type: 'link', label, href: target.href });
    }
  }
  buffer += text.slice(last);
  if (buffer) segments.push({ type: 'text', text: buffer });
  return segments;
}
