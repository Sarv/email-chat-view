/**
 * Banner rules — the warnings a gateway injects around somebody's message.
 *
 * "External Email: use caution", "You don't often get email from…", "TCS
 * Confidential". Nobody wrote these; an Exchange transport rule or a security
 * gateway stapled them on, and in a chat bubble they are pure noise — the same
 * banner repeating above every message in the thread.
 *
 * They arrive in three shapes and each needs its own treatment:
 *
 *   1. a styled BOX, an anonymous `<table>` or `<div>` containing nothing but
 *      the warning                              → {@link bannerBox}
 *   2. a single `<p>`/`<span>`/`<font>` LINE inside an otherwise real block
 *                                               → {@link bannerLineBlock}
 *   3. a bare TEXT line between `<br>`s, with no element of its own
 *                                               → `bannerLine` in `line.ts`
 *
 * All three share {@link bannerPattern}, which is the point: one phrasing list,
 * so adding a gateway's wording teaches every shape at once.
 *
 * ADDING A GATEWAY: extend {@link bannerPattern} and add BOTH a positive
 * fixture and a negative one — a real sentence containing the new phrase that
 * must survive. See CONTRIBUTING.md.
 */
import { isBannerLineBlock, isPureBannerBlock } from '../transform/block-shapes.js';

import type { DomRule } from './types.js';

/**
 * Gateway warning and legal-notice phrasing.
 *
 * Every alternative is a phrase a MACHINE writes, and each one has to stay that
 * way, because the block rules apply this to as much as 600 characters at a
 * time. `intended solely for the addressee` and `notify the sender` are
 * boilerplate nobody composes by hand; `this message is confidential` is a
 * fixed opener rather than a claim about a document.
 *
 * Both spellings of the apostrophe, always. Outlook writes "you don’t often get
 * email from…" with U+2019, and a rule that only knows the ASCII form matches
 * the banner nobody actually sends.
 *
 * A bare `\bconfidential\b` was here and has been REMOVED. It matched "the
 * pricing is confidential until Friday" — somebody's actual sentence, under
 * every length cap this package has, in its own `<div>` like any other line.
 * That deleted the message. Where the word is genuine evidence it still counts,
 * in `disclaimer.ts`, which requires a boilerplate opening AND a second
 * corroborating signal before it removes anything.
 *
 * What replaced it is the LAST alternative, and it is the only anchored one:
 * a classification stamp is a whole line that says nothing but "Confidential",
 * "TCS Confidential", "Company Confidential and Proprietary". Anchoring is what
 * separates the stamp from the word — every rule using this pattern feeds it
 * one trimmed visual line or one leaf's whole text, so `^…$` means exactly
 * "this line is the stamp and contains nothing else".
 */
export const bannerPattern =
  /(external e-?mail|external sender|originated from outside|outside (of )?(the |your )?organi[sz]ation|caution\b|be cautious|do not (click|open)|unless you recognize the sender|you don['’]?t often get email from|some people who received this message don['’]?t often get|learn why this is important|this (e-?mail|message)\b.{1,80}\b(confidential|intended|privileged)|confidentiality notice|\bdisclaimer\b|intended (solely |only )?for the (use|addressee)|notify the sender|delete (it|this e-?mail)|^[a-z&. ]{0,20}confidential(\s*(?:[&-]\s*)?(and\s+)?(proprietary|internal|restricted))?$)/i;

/**
 * Length cap for a WHOLE BLOCK proven to be nothing but banner text.
 *
 * Six hundred where the line-level cap is eighty, and the gap is deliberate. A
 * block whose every leaf is banner phrasing is unambiguous however long it runs
 * — a legal notice takes several sentences to say nothing. A single line inside
 * real content is never unambiguous, which is why that shape stays short.
 */
export const BANNER_BLOCK_MAX_CHARS = 600;

/** Length cap for a single banner LINE sitting among real content. */
export const BANNER_LINE_MAX_CHARS = 80;

/**
 * A whole warning BOX: an anonymous table or div containing only banner text.
 *
 * `innermost` is off on purpose, unlike the shape rules in `signature.ts`. The
 * predicate already requires that EVERY leaf be banner text, so an outer match
 * means the outer block is banner too — taking it is right, and it removes the
 * gateway's styled wrapper along with the words.
 */
export const bannerBox: DomRule = {
  name: 'warning-banner-box',
  provider: 'Mail gateways / Exchange',
  selectors: ['table', 'div'],
  test: isPureBannerBlock(bannerPattern, BANNER_BLOCK_MAX_CHARS),
};

/**
 * A standalone banner LINE inside an otherwise real block.
 *
 * `blockquote` is NOT in the selector list, unlike the leaf list this was
 * ported from. A blockquote holding one short line has no block children, so it
 * is a leaf by the shape module's definition, and matching it here would delete
 * a quoted message as though it were a gateway warning. The code this came from
 * got away with it only because its quote wrappers were unwrapped before this
 * pass ran; a package whose passes are individually callable cannot assume that.
 */
export const bannerLineBlock: DomRule = {
  name: 'warning-banner-line',
  provider: 'Mail gateways / Exchange',
  selectors: ['p', 'div', 'td', 'span', 'font'],
  test: isBannerLineBlock(bannerPattern, BANNER_LINE_MAX_CHARS),
};

/**
 * Default banner rule set.
 *
 * Box first. Once the box is gone its lines are gone with it, and the report
 * names the shape that was actually there rather than crediting the line rule
 * for each cell of a table.
 */
export const bannerRules: DomRule[] = [bannerBox, bannerLineBlock];
