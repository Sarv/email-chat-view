/**
 * Line rules — conventions that exist as a standalone visual line.
 *
 * Each is exported individually so a consumer can compose their own set, and
 * the default array is every rule in a sensible order. Order does not change
 * behaviour (the engine takes the earliest cut, whichever rule found it); it
 * only decides which name gets the credit when two rules match the same line.
 *
 * ADDING A CONVENTION: export a rule below, add it to `lineRules`, and add both
 * a positive and a NEGATIVE fixture — the negative one matters more here than
 * anywhere else in this package, because `action: 'cut'` deletes everything
 * after the match. See CONTRIBUTING.md.
 */
import { BANNER_LINE_MAX_CHARS, bannerPattern } from './banner.js';
import type { LineRule } from './types.js';

/**
 * The RFC 3676 signature delimiter, plus the long rules clients draw instead.
 *
 * The whole line must be delimiter characters — a message containing a dash is
 * untouched, only one that IS a dash matches. That is why the length cap can be
 * as generous as 200: a sixty-underscore Outlook separator is still a
 * delimiter, and nothing else looks remotely like one.
 */
export const signatureDelimiterLine: LineRule = {
  name: 'rfc3676-delimiter',
  provider: 'RFC 3676 / common',
  pattern: /^(--|_{5,}|—{2,}|-{5,})\s*$/,
  maxLineLength: 200,
  action: 'cut',
};

/**
 * "Sent from my iPhone", "Get Outlook for Android".
 *
 * The 60-character cap is doing real work: "Sent from my phone, sorry for the
 * typos — I could not reach you earlier…" opens with the same words and is the
 * message. A footer is short.
 */
export const mobileFooterLine: LineRule = {
  name: 'mobile-footer',
  provider: 'Common / mobile clients',
  pattern: /^(sent from my |get outlook for |sent via |sent from )/i,
  maxLineLength: 60,
  action: 'cut',
};

/**
 * Trailing Teams / Webex join plumbing. Everything from the first line of the
 * join block to the end is dial-in details, not conversation.
 */
export const meetingBoilerplateLine: LineRule = {
  name: 'meeting-boilerplate',
  provider: 'Microsoft Teams / Webex',
  pattern:
    /^(microsoft teams meeting|join on a video conferencing device|join the meeting now|meeting id:|_{5,}\s*(microsoft teams|join))/i,
  maxLineLength: 80,
  action: 'cut',
};

/**
 * `-----Original Message-----` and `-----Original Appointment-----`.
 *
 * `'line'`, NOT `'cut'`, and the distinction is the point. Outlook writes this
 * separator above content that has already been split into its own bubble by
 * the time this runs, so cutting here would delete a message that belongs to
 * somebody. Removing just the separator leaves the content where it is.
 */
export const forwardMarkerLine: LineRule = {
  name: 'forward-marker',
  provider: 'Outlook',
  pattern: /^\s*-{2,}\s*original (message|appointment)\s*-{2,}\s*$/i,
  maxLineLength: 60,
  action: 'line',
};

/**
 * Gateway-injected warning banners and short confidentiality notices sitting as
 * a bare text line.
 *
 * The third of the three shapes a banner arrives in, and the one with no
 * element of its own — a naked text node between `<br>`s, which the element
 * rules in `banner.ts` cannot see. All three share {@link bannerPattern}, so a
 * gateway's wording is added in exactly one place.
 *
 * A LEADING banner as often as a trailing one — "External Email: use caution"
 * is prepended above the message — which is why this is `'line'`. The length
 * cap keeps it off a real sentence that merely mentions confidentiality; the
 * long multi-sentence version of this text is a disclaimer and is handled by
 * the disclaimer rules, which reason about the trailing edge and require
 * corroborating signals.
 */
export const bannerLine: LineRule = {
  name: 'warning-banner',
  provider: 'Mail gateways / Exchange',
  pattern: bannerPattern,
  maxLineLength: BANNER_LINE_MAX_CHARS,
  action: 'line',
};

/**
 * A wall of encoded junk — a base64 part, key or token that leaked into the
 * body as text.
 *
 * The match must be a whole whitespace-delimited TOKEN, not a run found
 * anywhere in the line, and that boundary is the only thing keeping this rule
 * off real content. `/` is a base64 character, so a bare
 * `[A-Za-z0-9+/=]{60,}` happily matches the middle of
 * `https://example.com/a/long/path/…` — every character after the scheme is in
 * the class — and deletes the one thing the message was sent to deliver.
 * Anchored to a token boundary, the URL fails on the `:` in its scheme, as do
 * JWTs on their dots.
 *
 * Real prose is safe by construction: it has a space within 60 characters, so
 * no token is ever long enough.
 *
 * The length cap is effectively off, which no other rule here does. A blob line
 * is arbitrarily long BY DEFINITION — capping it would mean only short walls
 * get cleaned — and unlike every other rule the pattern describes a token
 * rather than the whole line, so line length carries no signal about whether
 * the match is right.
 */
export const gibberishBlobLine: LineRule = {
  name: 'encoded-blob',
  provider: 'Common / malformed MIME',
  pattern: /(?:^|\s)[A-Z0-9+/=]{60,}(?:\s|$)/i,
  maxLineLength: Number.MAX_SAFE_INTEGER,
  action: 'line',
};

/**
 * Default line rule set.
 *
 * Specific conventions first, loosest last, so `applied` names the precise
 * convention when one matched rather than crediting the generic banner rule.
 */
export const lineRules: LineRule[] = [
  signatureDelimiterLine,
  mobileFooterLine,
  meetingBoilerplateLine,
  forwardMarkerLine,
  bannerLine,
  gibberishBlobLine,
];

/**
 * The two line rules whose marker is UNAMBIGUOUS.
 *
 * An RFC 3676 delimiter and "Sent from my …" are conventions with a fixed
 * spelling; nobody types either by accident. The other four read meaning out of
 * prose — banner phrasing, meeting boilerplate, a base64-looking run — and each
 * can be wrong about a real sentence.
 *
 * That distinction matters for exactly one caller: a body that was never split,
 * where the whole thing is one message and no quoted history sits below a
 * mis-fire to absorb it. Pass this as `lineRules` alongside `bannerRules: []`
 * and `keepStructure` (see `cleanFragment`) to take the sender's signature
 * without risking the message around it.
 */
export const minimalLineRules: LineRule[] = [signatureDelimiterLine, mobileFooterLine];
