/**
 * Quoted-history rules — the containers mail clients wrap a reply's history in.
 *
 * These are element rules. The prose boundaries ("On ... wrote:") live in
 * `marker.ts`, because they exist only as text and need a different engine.
 */
import type { DomRule } from './types.js';

/**
 * Gmail.
 *
 * `.gmail_quote` is the quote itself, `.gmail_quote_container` the newer
 * wrapper, `.gmail_attr` the "On <date> <person> wrote:" attribution line, and
 * `.gmail_extra` the outer block holding attribution plus quote together.
 *
 * `.gmail_extra` was historically grouped with the signature rules, which
 * happened to work because both passes run — but it is a quote wrapper, and it
 * belongs here so the `applied` report tells the truth about what removed what.
 */
export const gmailQuote: DomRule = {
  name: 'gmail',
  provider: 'Gmail',
  selectors: [
    'blockquote.gmail_quote',
    'div.gmail_quote',
    '.gmail_quote_container',
    '.gmail_attr',
    '.gmail_extra',
  ],
};

/**
 * `blockquote[type="cite"]` — Apple Mail's convention, also emitted by several
 * other clients that followed it. A `type` attribute on a blockquote is never
 * something a human types, so this is unambiguous.
 */
export const citeQuote: DomRule = {
  name: 'cite-attribute',
  provider: 'Apple Mail / multi-client',
  selectors: ['blockquote[type="cite"]'],
};

/** Thunderbird / Mozilla prefix the quote with the attribution line. */
export const thunderbirdQuote: DomRule = {
  name: 'thunderbird',
  provider: 'Thunderbird / Mozilla',
  selectors: ['div.moz-cite-prefix'],
};

/** Outlook desktop's classic reply scaffolding. */
export const outlookClassicQuote: DomRule = {
  name: 'outlook-classic',
  provider: 'Outlook (classic)',
  selectors: ['div.OutlookMessageHeader', 'div#OLK_SRC_BODY_SECTION'],
};

/**
 * New Outlook / OWA reply scaffolding.
 *
 * `divRplyFwdMsg` is the "From: ... Sent: ... To: ..." reply header block;
 * `appendonsend` is the empty marker div the composer leaves where it split new
 * content from quoted history. When such a body is itself quoted inside ANOTHER
 * email, Outlook sanitizes the ids to an `x_` prefix, and it sometimes appends
 * numeric suffixes — hence the attribute-prefix (`^=`) selectors and both
 * spellings.
 *
 * These rules were previously present in only ONE of the two hand-rolled quote
 * strippers, so bodies that went through the other path kept their Outlook
 * reply scaffolding visible in the message. Consolidating the rule sets is what
 * fixes that.
 *
 * `boundary: true` is essential here and is what the container-only rules got
 * wrong. Neither of these divs CONTAINS the quoted thread — the header block is
 * a sibling of the body it introduces, and `appendonsend` is empty. Removing
 * just the elements deletes the "From:" header and leaves the entire quoted
 * conversation on screen, which looks like the stripper ran and worked.
 */
export const outlookModernQuote: DomRule = {
  name: 'outlook-modern',
  provider: 'Outlook (new) / OWA',
  selectors: [
    '[id^="divRplyFwdMsg"]',
    '[id^="x_divRplyFwdMsg"]',
    '[id^="appendonsend"]',
    '[id^="x_appendonsend"]',
  ],
  boundary: true,
};

/**
 * A webmail composer's quoted-history container.
 *
 * Kept as its own rule rather than folded into another provider's because the
 * originating client for this id is not confirmed — if you know which webmail
 * emits it, a PR correcting `provider` is welcome.
 */
export const webmailReferenceQuote: DomRule = {
  name: 'webmail-reference-container',
  provider: 'Webmail (unconfirmed vendor)',
  selectors: ['div#mail-editor-reference-message-container'],
};

/**
 * Bare `<blockquote>` with no distinguishing class or attribute.
 *
 * The loosest rule in the set, and last for that reason. Outlook and several
 * other clients quote with a plain `<blockquote>`, so in practice a classless
 * blockquote in an email body is quoted history far more often than it is
 * someone quoting a poem. It is still a heuristic: a consumer whose corpus is
 * full of genuine pull-quotes should compose a rule set without it rather than
 * live with the false positives.
 */
export const bareBlockquote: DomRule = {
  name: 'bare-blockquote',
  provider: 'Common / multi-client',
  selectors: ['blockquote'],
};

/** Default quote rule set — vendor-specific first, catch-all last. */
export const quoteRules: DomRule[] = [
  gmailQuote,
  citeQuote,
  thunderbirdQuote,
  outlookClassicQuote,
  outlookModernQuote,
  webmailReferenceQuote,
  bareBlockquote,
];
