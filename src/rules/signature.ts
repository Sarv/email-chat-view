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
import { isContactCard, isLogoStrip } from '../transform/block-shapes.js';

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

/**
 * Apple Mail (macOS and iOS) tags its signature block with a dedicated marker.
 *
 * Matched without a tag qualifier, unlike a bare `div.` form: iOS builds emit
 * the marker as an id and some templates carry it on a `<table>`, so pinning it
 * to `div` would quietly match less than the convention actually covers. The
 * name is specific enough that nothing else uses it.
 */
export const appleMailSignature: DomRule = {
  name: 'apple-mail',
  provider: 'Apple Mail',
  selectors: ['.AppleMailSignature', '#AppleMailSignature'],
};

/**
 * Thunderbird / Mozilla clients. Emitted as a `<div>` normally and a `<table>`
 * when the user's signature is itself HTML with a table layout — so the class
 * is matched on its own rather than through a list of tags that will always be
 * one short.
 */
export const thunderbirdSignature: DomRule = {
  name: 'thunderbird',
  provider: 'Thunderbird / Mozilla',
  selectors: ['.moz-signature'],
};

/** Outlook for iOS / Android appends a fixed-id block for "Sent from Outlook". */
export const outlookMobileSignature: DomRule = {
  name: 'outlook-mobile',
  provider: 'Outlook Mobile',
  selectors: ['#ms-outlook-mobile-signature', '#outlook-signature'],
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
 * Sarv webmail.
 *
 * Guarded, where the app this was extracted from treated both ids as always-safe
 * — because `#clean-html` reads like "the cleaned body", and a public package
 * cannot know that no other producer uses that id for exactly that. A real
 * signature is short, so the guard costs the convention nothing and removes the
 * one way this rule could eat somebody's message.
 */
export const sarvSignature: DomRule = {
  name: 'sarv',
  provider: 'Sarv',
  selectors: ['#signature-block', '#clean-html'],
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
 * Last resort: any `<div>` whose CLASS merely contains "signature".
 *
 * `msg-signature-wrapper`, `x_Signature`, `user_signature` — the shapes no
 * vendor rule predicted. Guarded, and ordered dead last among the selector
 * rules, both for the same reason: a substring match on a class is the loosest
 * thing in this file, so it must neither claim a match a named rule would have
 * attributed properly nor be trusted on a block long enough to be a message.
 *
 * Three spellings of one selector because the `i` attribute flag is not
 * supported by every server-side DOM implementation — without the explicit
 * cased pair, this rule would quietly match less in Node than in a browser.
 */
export const looseSignatureClass: DomRule = {
  name: 'signature-class',
  provider: 'Common / multi-client',
  selectors: ['div[class*="signature" i]', 'div[class*="signature"]', 'div[class*="Signature"]'],
  maxTextLength: 500,
};

/**
 * A phone number: at least nine digits, allowing the spacing, brackets, dashes
 * and leading `+` every country writes one with.
 */
export const CONTACT_PHONE_RE = /\+?\d[\d ().-]{7,}\d/;

/**
 * A website or email address.
 *
 * No `\b` anchors, deliberately. Table cells concatenate without a space when
 * the layout is flattened to text — `…8623-14www.sarv.com` — so a word boundary
 * before `www` or before the local part would fail on exactly the markup this
 * rule exists for.
 */
export const CONTACT_WEB_RE =
  /www\.[a-z0-9-]+\.[a-z]{2,}|https?:\/\/|[\w.%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/**
 * Text budget for a block to still be signature furniture rather than a
 * message. Four hundred characters is a generous card and a very short email.
 */
export const CARD_MAX_CHARS = 400;

/** Text budget for a logo strip, which is images with a caption at most. */
export const LOGO_STRIP_MAX_CHARS = 48;

/** How many images make a row of brand logos rather than one shared picture. */
export const LOGO_STRIP_MIN_IMAGES = 2;

/**
 * The graphical contact card a rich signature editor emits: a logo, a table of
 * name / title / phone / website, and no class on any of it.
 *
 * `innermost` is mandatory here and this is the rule that proved why. Shape is
 * inherited upwards: the wrapper `<div>` around a short message plus its card
 * contains a phone and a website and is under the length cap just as the card
 * is, so removing every match deleted the message along with the signature.
 * Keeping only the deepest match leaves exactly the card.
 */
export const contactCard: DomRule = {
  name: 'contact-card',
  provider: 'Common / rich signature editors',
  selectors: ['table', 'div'],
  innermost: true,
  test: isContactCard(CONTACT_PHONE_RE, CONTACT_WEB_RE, CARD_MAX_CHARS),
};

/**
 * The row of brand logos that follows a contact card.
 *
 * Also `innermost`, for the same reason and with a second one on top: the cell
 * holding the logos and the table holding the cell both match, and crediting
 * the removal to the outer one would take whatever else that table contains.
 */
export const logoStrip: DomRule = {
  name: 'logo-strip',
  provider: 'Common / rich signature editors',
  selectors: ['table', 'div', 'p'],
  innermost: true,
  test: isLogoStrip(LOGO_STRIP_MIN_IMAGES, LOGO_STRIP_MAX_CHARS),
};

/**
 * Default signature rule set.
 *
 * Ordered vendor-specific first, loosest last, so that the `applied` report
 * names the precise provider when one matched rather than crediting `generic`
 * for a Gmail signature. The two shape rules run last of all: they are the only
 * ones that infer rather than read a marker, so anything a vendor rule can claim
 * should already be gone before they look.
 */
export const signatureRules: DomRule[] = [
  gmailSignature,
  appleMailSignature,
  thunderbirdSignature,
  outlookMobileSignature,
  outlookDesktopSignature,
  sarvSignature,
  genericSignature,
  looseSignatureClass,
  contactCard,
  logoStrip,
];
