/**
 * Sanitizing email HTML before it is rendered.
 *
 * Two paths, two policies:
 *
 *   INLINE  the body becomes part of the host application's DOM, so the policy
 *           is an allowlist barely wider than a chat message needs — no styles,
 *           no classes, no media, no attributes but `href`.
 *   FRAME   the body goes into a sandboxed iframe under a `default-src 'none'`
 *           CSP, which is the real boundary. Sanitizing is still done, as the
 *           second lock: the layout has to survive, so styles stay, but every
 *           script, event handler, form and navigation vector goes.
 *
 * The work is DOMPurify's, not this package's. Writing an HTML sanitizer is the
 * canonical example of a thing not to write: it has to be right about mXSS,
 * namespace confusion, mutation after parse, and a decade of browser quirks,
 * and any hand-rolled allowlist walker (this project shipped one) is one
 * unhandled `<svg><style>` away from being decorative.
 *
 * Both entry points FAIL CLOSED. With no DOM — server-side rendering, a Node
 * test — DOMPurify reports `isSupported: false` and its `sanitize` returns the
 * input untouched, so a naive wrapper would hand raw attacker-controlled HTML
 * straight to `dangerouslySetInnerHTML` on the one platform where nobody is
 * watching. Here that case returns an empty string and the bubble shows its
 * "no content" state instead.
 */
import DOMPurify from 'dompurify';

/**
 * The part of DOMPurify this module uses.
 *
 * Declared as an interface so tests can pass a stub for the unsupported case,
 * which is otherwise unreachable — jsdom always has a window.
 */
export interface Purifier {
  readonly isSupported: boolean;
  sanitize(html: string, config: Record<string, unknown>): string;
}

/** Tags the inline path keeps. Anything else is unwrapped, children intact. */
export const INLINE_ALLOWED_TAGS = [
  'p',
  'div',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'a',
  'span',
  'ul',
  'ol',
  'li',
  'code',
  'blockquote',
  // A letter of any length renders inline now (see `ui/body-shape.ts`), and
  // real mail has headings in it. They carry no attributes and no risk; without
  // them `KEEP_CONTENT` flattens a section title into the paragraph under it.
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
];

/** The only attribute the inline path keeps. */
export const INLINE_ALLOWED_ATTR = ['href'];

/**
 * Schemes a link may use.
 *
 * DOMPurify's own configuration knob, so this is their pattern doing their
 * job — not markup parsing done with a regex. `javascript:`, `data:` and
 * everything else fall outside it and the attribute is dropped.
 */
const SAFE_URI_SCHEMES = /^(?:https?|mailto):/i;

const INLINE_CONFIG: Record<string, unknown> = {
  ALLOWED_TAGS: INLINE_ALLOWED_TAGS,
  ALLOWED_ATTR: INLINE_ALLOWED_ATTR,
  ALLOWED_URI_REGEXP: SAFE_URI_SCHEMES,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  // Unknown tags are unwrapped rather than deleted: a `<font>` or an Outlook
  // `<o:p>` around a sentence is not content, but the sentence inside it is,
  // and dropping both is how a message renders as a blank bubble.
  KEEP_CONTENT: true,
  // Belt and braces on top of the allowlist. `style` and `class` in particular
  // would otherwise reach the host's stylesheet cascade.
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'link', 'base'],
  FORBID_ATTR: ['style', 'class', 'id', 'target'],
};

/**
 * Attributes the frame keeps whatever their value, because none of them is
 * ever a URL.
 *
 * DOMPurify checks `ALLOWED_URI_REGEXP` against EVERY attribute it does not
 * already know to be URL-free, not only `href` and `src`. Its own default
 * pattern lets a value with no scheme through, so `width="64"` passes. The
 * frame's pattern cannot do that, because it lists schemes. A value with no
 * scheme is exactly how a protocol-relative `//host/path` link would get past
 * it, and such a link resolves against the host application's own base URL.
 * So the pattern stays strict for the attributes that really are URLs, and
 * this list names the ones that are not.
 *
 * Without the list every one of these is stripped, which is how a Google
 * Sheets range pasted into Gmail used to arrive. The sheet declares
 * `table-layout:fixed;width:0px` and sizes its columns ONLY through
 * `<col width>`. With those attributes gone, the table collapsed to one pixel
 * wide, every row grew thousands of pixels tall, and the bubble read as a
 * screen of blank lines. `colspan`, `rowspan`, `align`, `valign`, `bgcolor`,
 * `cellpadding` and `dir` were lost the same way. `hidden` belongs here too:
 * dropping it SHOWS what the sender hid.
 *
 * Every name is already on DOMPurify's default allowlist, which the tests
 * check. This list only stops the scheme test from vetoing them.
 */
export const FRAME_URI_SAFE_ATTR = [
  'align',
  'bgcolor',
  'border',
  'cellpadding',
  'cellspacing',
  'clear',
  'color',
  'colspan',
  'dir',
  'face',
  'headers',
  'height',
  'hidden',
  'lang',
  'noshade',
  'nowrap',
  'reversed',
  'rowspan',
  'scope',
  'size',
  'span',
  'start',
  'type',
  'valign',
  'width',
];

const FRAME_CONFIG: Record<string, unknown> = {
  // The frame's whole purpose is that the sender's layout survives, so this is
  // a denylist: DOMPurify's defaults keep presentational markup (`style`
  // attributes, `<table>`, `<style>`) and strip the executable surface.
  ADD_TAGS: ['style'],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|cid|data):/i,
  // Without this the pattern above also vetoes `width`, `colspan` and the rest
  // of the layout attributes. See the list's own note.
  ADD_URI_SAFE_ATTR: FRAME_URI_SAFE_ATTR,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: [
    'script',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'base',
    'meta',
    'link',
  ],
  FORBID_ATTR: ['formaction', 'action', 'srcdoc', 'ping'],
};

function sanitizeWith(
  html: string | null | undefined,
  config: Record<string, unknown>,
  purifier: Purifier,
): string {
  const source = (html ?? '').trim();
  if (!source) return '';
  // Fail closed. See the module header: DOMPurify's own no-DOM behaviour is to
  // pass the input through, which would be an XSS sink wearing a sanitizer's
  // name.
  if (!purifier.isSupported) return '';
  return purifier.sanitize(source, config);
}

/** Sanitize a short body for rendering directly inside the host's DOM. */
export function sanitizeInlineHtml(
  html: string | null | undefined,
  purifier: Purifier = DOMPurify as unknown as Purifier,
): string {
  return sanitizeWith(html, INLINE_CONFIG, purifier);
}

/** Sanitize a rich body for injection into the sandboxed frame. */
export function sanitizeFrameHtml(
  html: string | null | undefined,
  purifier: Purifier = DOMPurify as unknown as Purifier,
): string {
  return sanitizeWith(html, FRAME_CONFIG, purifier);
}

/** Whether this environment can sanitize at all. False during SSR. */
export function canSanitize(purifier: Purifier = DOMPurify as unknown as Purifier): boolean {
  return purifier.isSupported;
}
