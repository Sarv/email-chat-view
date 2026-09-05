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
  'p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'a', 'span',
  'ul', 'ol', 'li', 'code', 'blockquote',
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

const FRAME_CONFIG: Record<string, unknown> = {
  // The frame's whole purpose is that the sender's layout survives, so this is
  // a denylist: DOMPurify's defaults keep presentational markup (`style`
  // attributes, `<table>`, `<style>`) and strip the executable surface.
  ADD_TAGS: ['style'],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|cid|data):/i,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'base', 'meta', 'link'],
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
