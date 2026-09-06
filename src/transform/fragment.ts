/**
 * Cleaning ONE fragment — the slice of a body that belongs to a single message.
 *
 * {@link cleanReplyBody} answers "what did the sender of THIS email write?" by
 * throwing quoted history away. A thread splitter asks the opposite question: it
 * has already carved the body into segments, one per message, and now every
 * segment is somebody's real words. Deleting a `<blockquote>` here would delete
 * a message.
 *
 * So the structural passes here UNWRAP where the reply cleaner REMOVES:
 *
 *   - a quote wrapper is peeled off and its contents kept, because after the
 *     split those contents ARE the segment;
 *   - an indent bar — the bare `<div style="border-left:…">` Outlook, Apple and
 *     Gmail draw down the side of quoted text — is peeled for the same reason,
 *     and because a bubble that is already visually a quote does not need a
 *     second rule drawn inside it;
 *   - the attribution line ("On Mon, Alice wrote:") is removed outright, since
 *     the splitter consumed it as the boundary and turned it into the bubble's
 *     sender and timestamp. Left in place it renders twice.
 *
 * Everything after that is the ordinary strip chain, and it runs PER SEGMENT
 * rather than once over the whole body. That ordering is not a detail: a sweep
 * before the split deletes the quoted headers the splitter navigates by, and the
 * thread collapses back into two bubbles.
 */
import { bannerRules as defaultBannerRules } from '../rules/banner.js';
import { lineRules as defaultLineRules } from '../rules/line.js';
import { signatureRules as defaultSignatureRules } from '../rules/signature.js';
import type { DomRule, LineRule, StripResult } from '../rules/types.js';

import { applyDomRules } from './apply-dom-rules.js';
import { applyLineRules } from './apply-line-rules.js';
import {
  collapseExcessBlankSpace,
  isEmptyElement,
  trimEdgeEmpties,
  trimEmptyEdges,
} from './html-space.js';
import { safeQueryAll } from './node-utils.js';
import { cutSignOff } from './sign-off.js';

/**
 * Containers whose CONTENT is the segment's own text.
 *
 * Deliberately narrower than the quote RULES in `src/rules/quote.ts`. Those
 * decide what to delete from a reply and can afford to be broad; this list
 * decides what to peel, and peeling the wrong element only costs an indent
 * level, while missing one leaves the message nested three quotes deep and
 * squeezed into a column.
 */
export const QUOTE_WRAPPER_SELECTORS = ['blockquote', '.gmail_quote', '.gmail_quote_container'];

/** The bare `<div>` clients use to draw a left rule down quoted text. */
export const INDENT_BAR_SELECTOR = 'div[style*="border-left"]';

/**
 * A left border explicitly turned OFF.
 *
 * `border-left` appears in the style attribute of any element that RESETS it —
 * `border-left: none` on a table cell is as common as a real indent bar — and
 * unwrapping those would flatten a table's structure for nothing. Matching the
 * declaration rather than parsing the whole style string is deliberate: this
 * question has exactly one property and one pair of answers, and a CSS parser
 * for it would cost more than it explains.
 */
const BORDER_LEFT_OFF = /border-left\s*:\s*(?:none|0)/i;

/**
 * Whether a style attribute actually DRAWS a left border.
 *
 * Takes the raw attribute — `null` included — rather than a defaulted string,
 * so the "no style at all" answer is a value this function returns rather than
 * a coalesce at the call site that nothing can exercise.
 */
export function drawsLeftBorder(style: string | null): boolean {
  return style !== null && !BORDER_LEFT_OFF.test(style);
}

/**
 * Attribution lines a splitter has already consumed as a boundary.
 *
 * Each is a client's marker for the "On <date>, <name> wrote:" line itself, not
 * for the quote below it. `.original-sender-line` is Sarv's; the rest are
 * Gmail's, Thunderbird's and Outlook's. Contributing a client means adding its
 * marker here AND to the boundary detector, so the same line that ends one
 * segment is the one removed from the next.
 */
export const ATTRIBUTION_LINE_SELECTORS = [
  '.gmail_attr',
  '.moz-cite-prefix',
  '.OutlookMessageHeader',
  '.original-sender-line',
];

/**
 * Replace an element with its own children.
 *
 * Returns false when the element has already been detached by an earlier
 * unwrap — nested wrappers are the normal case, not an error, and a caller
 * counting what it changed should not count a node twice.
 */
export function unwrapElement(element: Element): boolean {
  const parent = element.parentNode;
  if (!parent) return false;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  element.remove();
  return true;
}

/** Peel every quote wrapper in the fragment, keeping its contents. Returns the count. */
export function unwrapQuoteWrappers(root: Element): number {
  const wrappers = safeQueryAll(root, QUOTE_WRAPPER_SELECTORS.join(','));
  // Collected up front, then mutated — the list is static, and unwrapping an
  // outer wrapper leaves an inner one still attached and still unwrappable.
  return wrappers.filter(unwrapElement).length;
}

/** Peel every indent bar whose border is actually drawn. Returns the count. */
export function unwrapIndentBars(root: Element): number {
  const bars = safeQueryAll(root, INDENT_BAR_SELECTOR).filter((element) =>
    drawsLeftBorder(element.getAttribute('style')),
  );
  return bars.filter(unwrapElement).length;
}

/** Remove the boundary attribution lines. Returns the count. */
export function removeAttributionLines(root: Element): number {
  const lines = safeQueryAll(root, ATTRIBUTION_LINE_SELECTORS.join(','));
  let removed = 0;
  for (const line of lines) {
    if (!root.contains(line)) continue; // taken along with an ancestor
    line.remove();
    removed += 1;
  }
  return removed;
}

/**
 * Remove INTERNAL blank blocks — the empty `<p>`/`<div>` (usually `<p><br></p>`)
 * senders stack between lines. Returns the count.
 *
 * Broader than the string-level {@link collapseExcessBlankSpace}, which spares
 * any block carrying a `style` attribute because it also runs over designed
 * templates, where a styled empty `<div>` is a deliberate spacer. A fragment is
 * by definition a slice of somebody's typed reply, and there `<p style="margin:0">
 * <br></p>` is exactly the blankness to drop — it is what Outlook emits for the
 * Enter key. Do not run this over a designed body; see {@link cleanFragment}'s
 * `keepStructure` note.
 */
export function removeEmptyBlocks(root: Element): number {
  const blocks = safeQueryAll(root, 'p, div');
  let removed = 0;
  for (const block of blocks) {
    if (!root.contains(block)) continue; // taken along with an empty ancestor
    if (!isEmptyElement(block)) continue;
    block.remove();
    removed += 1;
  }
  return removed;
}

/** Rule sets and switches for {@link cleanFragment}. */
export interface CleanFragmentOptions {
  signatureRules?: readonly DomRule[];
  bannerRules?: readonly DomRule[];
  lineRules?: readonly LineRule[];
  /** Leave a trailing sign-off in place. See {@link cleanReplyBody}'s note. */
  keepSignOff?: boolean;
  /**
   * Leave the document's STRUCTURE untouched: no unwrapping, no attribution
   * removal, no internal blank-block removal. Only the marker-driven rules and
   * the edge trim run.
   *
   * Set this for a body that was never split — a standalone email with no
   * quoted history inside it. The whole body IS the one message, so there is no
   * boundary to clean around, and the structural passes can only do harm: a
   * designed notification whose content sits in an inline-styled blockquote
   * comes out unwrapped and truncated. Pair it with `bannerRules: []` and a
   * reduced `lineRules` (see `minimalLineRules`) so only rules requiring hard
   * evidence — a known wrapper class, a contact card with both a phone and a
   * site, an RFC 3676 rule line, a "Sent from my …" footer — can fire.
   */
  keepStructure?: boolean;
}

/**
 * Clean one fragment IN PLACE and return its HTML.
 *
 * Mutates `root` rather than taking and returning a string, because the caller
 * that needs this already holds a node: a splitter has just cloned a range into
 * a container, and serializing it only to reparse it here would double the DOM
 * work on every segment of every message in a thread.
 *
 * A fragment that cleans away to nothing is returned as the empty string, not
 * guarded against. The caller knows what to do with it — a thread splitter
 * drops the segment, a single-body caller falls back to the original — and this
 * function has no way to tell those apart.
 */
export function cleanFragment(root: Element, options?: CleanFragmentOptions): StripResult {
  const applied: string[] = [];

  if (!options?.keepStructure) {
    const attributions = removeAttributionLines(root);
    if (attributions) applied.push('remove:attribution');
    if (unwrapQuoteWrappers(root)) applied.push('unwrap:quote-wrapper');
    if (unwrapIndentBars(root)) applied.push('unwrap:indent-bar');
  }

  for (const name of applyDomRules(root, options?.signatureRules ?? defaultSignatureRules)) {
    applied.push(`signature:${name}`);
  }
  for (const name of applyDomRules(root, options?.bannerRules ?? defaultBannerRules)) {
    applied.push(`banner:${name}`);
  }
  for (const name of applyLineRules(root, options?.lineRules ?? defaultLineRules)) {
    applied.push(`line:${name}`);
  }
  if (!options?.keepSignOff && cutSignOff(root)) applied.push('sign-off');

  if (!options?.keepStructure && removeEmptyBlocks(root)) applied.push('remove:empty-block');
  trimEdgeEmpties(root);

  return { html: collapseExcessBlankSpace(trimEmptyEdges(root.innerHTML)), applied };
}
