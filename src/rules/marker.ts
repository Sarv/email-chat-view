/**
 * Marker rules — prose boundaries after which everything is quoted history.
 *
 * These are the one family where a pattern is the right tool rather than a
 * fallback: "On <date> <person> wrote:" is not an element, has no class, and
 * exists purely as text a client injected. There is nothing to select.
 *
 * Every pattern is bounded on purpose. `[^\n<]{4,200}` cannot run away; a `.*`
 * in the same position turns one hostile 200KB email into a stalled thread.
 *
 * KNOWN GAP — LOCALIZATION. Every rule here is English. Gmail, Outlook and
 * Apple Mail all localize these strings, so a German, French, Spanish or
 * Japanese reply currently keeps its quoted history in the bubble. This is the
 * single highest-value contribution to this package: add a rule with the right
 * `language` tag and a real captured fixture. It is deliberately NOT
 * hand-guessed here, because a pattern written from memory of what Gmail
 * "probably" emits in German is worse than an honest gap — it would fire on the
 * wrong thing and silently eat content.
 */
import type { MarkerRule } from './types.js';

/**
 * "On <date>, <person> wrote:" — Gmail's attribution, adopted by many clients.
 *
 * Three spellings of one convention: wrapped in a `<div>`, wrapped in a `<p>`,
 * or bare. The wrapped variants match EARLIER in the string (at the opening
 * tag), so earliest-match-wins cuts the tag too rather than orphaning it.
 */
export const wroteAttribution: MarkerRule = {
  name: 'wrote-attribution',
  provider: 'Gmail / multi-client',
  language: 'en',
  patterns: [
    /<div[^>]*>\s*On\s+[^<]{4,200}\s+wrote\s*:/i,
    /<p[^>]*>\s*On\s+[^<]{4,200}\s+wrote\s*:/i,
    /On\s+[^\n<]{4,200}\s+wrote\s*:/i,
  ],
};

/** "---------- Forwarded message ----------" */
export const forwardedMessage: MarkerRule = {
  name: 'forwarded-message',
  provider: 'Gmail / multi-client',
  language: 'en',
  patterns: [/----+\s*Forwarded message\s*----+/i],
};

/** "-----Original Message-----" */
export const originalMessage: MarkerRule = {
  name: 'original-message',
  provider: 'Outlook',
  language: 'en',
  patterns: [/-----\s*Original Message\s*-----/i],
};

/**
 * Outlook's quoted header block: "From: ... Sent: ... To: ... Subject: ...".
 *
 * Three shapes, because the fields may be separated by plain newlines or by
 * markup (`<br>`, `<div>`), which a `[^\n<]` class cannot span:
 *   - a `<div>` opening a From:/.../Subject: run
 *   - From: followed by Sent:/Date: on one line
 *   - From: ... Sent|Date: ... To:, tags allowed between fields
 *
 * The third requires `To:` specifically. Without it, a body that merely writes
 * "From: the team" and later "Date: Friday" would be truncated — demanding the
 * full field triple is what keeps this from eating real prose.
 *
 * The bounds on the tag-spanning variants (`{0,2000}?`, `{0,200}?`) are
 * deliberate. The original of this rule used an unbounded `[\s\S]*?` before
 * `Subject:`, which is superlinear on a large body; 2000 characters is far more
 * than any real header block (long To:/Cc: lists included).
 */
export const outlookHeaderBlock: MarkerRule = {
  name: 'outlook-header-block',
  provider: 'Outlook',
  language: 'en',
  patterns: [
    /<div[^>]*>\s*From:\s*[\s\S]{0,2000}?Subject:\s*/i,
    /From:\s*[^\n<]{2,200}\s*(?:Sent|Date):\s*/i,
    /From:[\s\S]{0,200}?(?:Sent|Date):[\s\S]{0,200}?To:/i,
  ],
};

/**
 * Outlook's long underscore rule, which precedes a quoted "From:/Sent:/On ..."
 * header. The underscores alone are not evidence — a sender may draw a divider
 * — so a header field must follow within a short window.
 */
export const outlookUnderscoreSeparator: MarkerRule = {
  name: 'outlook-underscore-separator',
  provider: 'Outlook',
  language: 'en',
  patterns: [/_{10,}[\s\S]{0,400}?(?:From:|Sent:|Date:|On\s)/i],
};

/** Default marker rule set. */
export const markerRules: MarkerRule[] = [
  wroteAttribution,
  forwardedMessage,
  originalMessage,
  outlookHeaderBlock,
  outlookUnderscoreSeparator,
];
