/**
 * Signature rules — one entry per mail client convention.
 *
 * Each rule is exported individually so a consumer can compose their own set
 * (drop one that misbehaves on their corpus, reorder, or extend), and the
 * default array is just every rule in a sensible order.
 *
 * ADDING A PROVIDER: export a new rule below, add it to `signatureRules`, and
 * add a row to the `stripSignature` table in `test/strip.test.ts` — plus a
 * negative case proving the selector is narrow enough to leave a real message
 * alone. Test it against markup the client actually emitted, not markup you
 * typed; see CONTRIBUTING.md.
 */
import type { DomRule } from './types.js';

/**
 * Gmail wraps the signature in `.gmail_signature` (a `<div>` on web, a
 * `<table>` on some mobile builds — the class selector catches both).
 *
 * `.gmail_signature_prefix` is the `-- ` delimiter span, and it rides OUTSIDE
 * the signature container, so removing only `.gmail_signature` leaves a stray
 * "--" dangling at the end of the bubble.
 */
export const gmailSignature: DomRule = {
  name: 'gmail',
  provider: 'Gmail',
  selectors: ['.gmail_signature', '[data-smartmail="gmail_signature"]', '.gmail_signature_prefix'],
};

/** Apple Mail (macOS and iOS) tags its signature block with a dedicated class. */
export const appleMailSignature: DomRule = {
  name: 'apple-mail',
  provider: 'Apple Mail',
  selectors: ['div.AppleMailSignature'],
};

/**
 * Thunderbird / Mozilla clients. Emitted as a `<div>` normally and a `<table>`
 * when the user's signature is itself HTML with a table layout.
 */
export const thunderbirdSignature: DomRule = {
  name: 'thunderbird',
  provider: 'Thunderbird / Mozilla',
  selectors: ['div.moz-signature', 'table.moz-signature'],
};

/** Outlook for iOS / Android appends a fixed-id block for "Sent from Outlook". */
export const outlookMobileSignature: DomRule = {
  name: 'outlook-mobile',
  provider: 'Outlook Mobile',
  selectors: ['div#ms-outlook-mobile-signature'],
};

/**
 * Outlook desktop / OWA.
 *
 * Size-guarded, and the guard is the whole point: Outlook reuses these ids and
 * classes as ordinary BODY wrappers, so an unguarded strip here deletes the
 * entire message. A real signature is short; 500 characters is comfortably
 * above any genuine one and well below a reply worth reading.
 *
 * The `[id*=...]` forms also catch the `x_`-prefixed ids Outlook rewrites to
 * when such a body ends up quoted inside another email (`x_Signature`). Both
 * cased spellings are listed alongside the case-insensitive `i` form because
 * the `i` attribute flag is not supported by every server-side DOM
 * implementation — without the explicit pair, this rule would quietly match
 * less in Node than in a browser.
 */
export const outlookDesktopSignature: DomRule = {
  name: 'outlook-desktop',
  provider: 'Outlook / OWA',
  selectors: [
    '#Signature',
    '#signature',
    'div[id*="signature" i]',
    'div[id*="signature"]',
    'div[id*="Signature"]',
    'div.signature',
  ],
  maxTextLength: 500,
};

/**
 * Conventions used by several clients and web mailers rather than one vendor.
 *
 * NOTE: `.sig` is deliberately unguarded here because that matches the
 * behaviour these rules were consolidated from. It is the loosest selector in
 * the set — a template using `class="sig"` on a large block would lose it. If a
 * real fixture ever shows that happening, the fix is a `maxTextLength` guard,
 * not removal of the rule.
 */
export const genericSignature: DomRule = {
  name: 'generic',
  provider: 'Common / multi-client',
  selectors: ['div.email-signature', 'table.signature', '.sig'],
};

/**
 * Default signature rule set.
 *
 * Ordered vendor-specific first, loosest last, so that the `applied` report
 * names the precise provider when one matched rather than crediting `generic`
 * for a Gmail signature.
 */
export const signatureRules: DomRule[] = [
  gmailSignature,
  appleMailSignature,
  thunderbirdSignature,
  outlookMobileSignature,
  outlookDesktopSignature,
  genericSignature,
];
