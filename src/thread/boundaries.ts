/**
 * Finding the quote boundaries inside ONE email body.
 *
 * A reply carries the whole conversation with it. Somewhere in that body, over
 * and over, is the line where one message ends and the one it quotes begins:
 *
 *     On Mon, 1 Sep 2026 at 10:04, Alice <alice@example.com> wrote:
 *     From: Alice <alice@example.com>
 *     Sent: Monday, 1 September 2026 10:04
 *
 * Everything the splitter does rests on locating those lines. Get it wrong in
 * one direction and a thread of nine messages renders as one enormous bubble;
 * get it wrong in the other and a sentence that happens to start with "On" cuts
 * somebody's paragraph in half.
 *
 * Detection runs at LINE precision, not element precision, and that is the
 * whole design. An attribution is its own element often enough — Gmail's
 * `.gmail_attr`, an Outlook header block — but just as often it is a bare run
 * of text between two `<br>`s, sharing a `<div>` with the sign-off above it and
 * the quoted reply below it:
 *
 *     Pankaj Kumar<br>On 27/04/26, Ruby &lt;ruby@…&gt; wrote:<br>Sure, …
 *
 * An element-only model cannot express that boundary at all: there is no
 * element to point at. So a boundary is a PAIR of node positions bracketing the
 * attribution line, which works for both shapes and excludes the line itself
 * from the message above it and the message below it.
 */
import { comparePaths, isPathPrefix, pathTo } from '../transform/dom-slice.js';
import { isBlockElement } from '../transform/dom-text.js';
import { ATTRIBUTION_LINE_SELECTORS } from '../transform/fragment.js';
import { normalizedText, safeQueryAll, visibleText } from '../transform/node-utils.js';

import { parseAttribution, type ParsedAttribution } from './attribution.js';

const NODE_TYPE_TEXT = 3;

/**
 * An attribution line, in either of its two spellings.
 *
 * `from:` followed within 400 characters by `sent:` or `date:` is the Outlook
 * and Word header block; `on … wrote:` is everybody else. Both are anchored,
 * because an attribution always OPENS its line — the same words in the middle
 * of a sentence are somebody writing about an email, not an email quoting one.
 *
 * The bounded `{0,400}` and `{1,220}` spans are the ReDoS guard as well as the
 * plausibility guard: unbounded `[\s\S]*?` between two required literals is the
 * classic backtracking trap, and it runs here on every candidate line of every
 * message in a thread.
 */
export const HEADER_PATTERN =
  /^\s*(?:from:[\s\S]{0,400}?(?:sent|date):|on\b[\s\S]{1,220}?wrote\s*:)/i;

/**
 * The label opening a forwarded/calendar header line.
 *
 * An "On … wrote:" attribution is one line. An Outlook header is SEVERAL —
 * From:, Sent:, To:, Subject:, and for a meeting invitation When: and Where: —
 * each on its own `<br>`-separated line. They have to be collected into one
 * logical line so the whole block is consumed as the boundary; otherwise the
 * four lines the boundary did not swallow render as a bubble of their own.
 */
export const HEADER_LABEL_PATTERN =
  /^(from|to|cc|bcc|sent|date|subject|reply-to|importance|when|where)\s*:/i;

/**
 * Class markers clients put on an attribution line.
 *
 * These are boundaries even with no "wrote:" anywhere in them: Zoho's
 * `.original-sender-line` and Apple's `.moz-cite-prefix` render "On <date>
 * <name> <email>" and stop, which {@link HEADER_PATTERN} alone would miss —
 * leaving the entire quoted history in one bubble.
 *
 * Deliberately the SAME list the fragment cleaner removes. A marker that ends
 * one segment has to be the marker removed from the next, or the attribution
 * line renders inside the bubble it labels.
 */
export const ATTRIBUTION_MARKER_SELECTOR = ATTRIBUTION_LINE_SELECTORS.join(',');

/** Shortest and longest a line may be and still be an attribution. */
const MIN_LINE_CHARS = 8;
const MAX_LINE_CHARS = 2000;

/**
 * Longest a "no wrote:" attribution may be.
 *
 * Such a line is identified by what it PARSES to rather than by a keyword, so
 * it needs a size guard the keyword forms do not: a long paragraph opening with
 * "On Tuesday" that happens to contain an address would otherwise qualify.
 */
const MAX_DATELINE_CHARS = 160;

/**
 * Longest an element may be and still be treated as an attribution WHOLE.
 *
 * The last detection pass takes an element whose text OPENS with the header
 * pattern, which catches attributions fragmented across nested children by
 * mangled markup. Bounded, because an element that also wraps the quoted reply
 * matches just as well — and consuming that as the boundary would delete the
 * message it introduces. Line detection handles that shape correctly.
 */
const MAX_WHOLE_ELEMENT_CHARS = 240;

/**
 * A quote boundary, described by positions rather than by an element.
 *
 * `endBefore` and `startAfter` bracket the attribution line: the message above
 * ends before the first, the quoted message begins after the second. When the
 * attribution IS an element both are that element; when it is a `<br>`-
 * delimited line they are the line's first node and its terminating `<br>`.
 */
export interface Boundary {
  /** The previous segment ends immediately before this node. */
  endBefore: Node;
  /** The quoted segment starts immediately after this node. */
  startAfter: Node;
  /** Position used for ordering and overlap removal. Always equals `endBefore`. */
  ref: Node;
  /** Who wrote the quoted message, and when, as read off the line. */
  attribution: ParsedAttribution | null;
}

/** One visual line, gathered from a starting node. */
export interface InlineLine {
  /** The line's raw text, uncollapsed. */
  text: string;
  /** The last node the line covers. */
  last: Node;
  /** The `<br>` that ended it, or null when a block boundary did. */
  terminator: Node | null;
}

/**
 * The first child carrying visible content, skipping BLANK TEXT ONLY.
 *
 * Not `meaningfulChildren`, and the difference matters: that helper also skips
 * `<br>` and empty elements, which is right when asking "does this block hold
 * anything?" and wrong here. This asks "where does the first visual line of
 * this block START?", and a leading `<br>` is a line — an empty one — whose
 * position the collector below needs to see.
 */
export function firstNonBlankChild(element: Element): Node | null {
  let child = element.firstChild;
  while (child && child.nodeType === NODE_TYPE_TEXT && !visibleText(child)) {
    child = child.nextSibling;
  }
  return child;
}

/**
 * From a line-start node, gather the rest of that visual LINE.
 *
 * Walks following siblings accumulating text, stopping at the first `<br>` —
 * its terminator — or at a block element, which starts a line of its own. The
 * start node itself is never treated as a block boundary; it is where this line
 * begins.
 */
export function collectInlineLine(start: Node): InlineLine {
  let text = '';
  let last = start;
  let node: Node | null = start;

  while (node) {
    if (node.nodeName === 'BR') return { text, last, terminator: node };
    if (node !== start && isBlockElement(node)) break;
    text += node.textContent ?? '';
    last = node;
    node = node.nextSibling;
  }
  return { text, last, terminator: null };
}

/** The next non-blank sibling after a node, or null. */
function nextNonBlankSibling(node: Node): Node | null {
  let next = node.nextSibling;
  while (next && next.nodeType === NODE_TYPE_TEXT && !visibleText(next)) next = next.nextSibling;
  return next;
}

/**
 * Gather the full attribution line beginning at `start`, folding a multi-line
 * Outlook header block into one logical line.
 *
 * An "On … wrote:" line ends at its first `<br>`. A header block does not: once
 * the line opens with a label, following label lines keep being swallowed, so
 * the boundary consumes the whole block and no stray "Subject: …" line survives
 * as a bubble of its own.
 */
export function collectAttributionLine(start: Node): InlineLine {
  const line = collectInlineLine(start);
  if (!HEADER_LABEL_PATTERN.test(line.text.replace(/\s+/g, ' ').trim())) return line;

  let { text, last, terminator } = line;
  while (terminator && terminator.nodeName === 'BR') {
    const next = nextNonBlankSibling(terminator);
    // A block element ends the header block: whatever follows is content.
    if (!next || isBlockElement(next)) break;
    const continuation = collectInlineLine(next);
    if (!HEADER_LABEL_PATTERN.test(continuation.text.replace(/\s+/g, ' ').trim())) break;
    text += ` ${continuation.text}`;
    last = continuation.last;
    terminator = continuation.terminator;
  }
  return { text, last, terminator };
}

/** Blocks and inline wrappers whose first child can begin a visual line. */
const LINE_START_CONTAINER_SELECTOR = 'div, p, td, li, blockquote, span, a, font';

/**
 * Every node that could START a visual line: the first child of each container,
 * plus whatever follows each `<br>`.
 *
 * A Set, because the two passes overlap constantly — the node after a `<br>` is
 * frequently also the first child of the next wrapper — and a duplicated start
 * yields a duplicated boundary that the overlap pass would then have to undo.
 */
export function lineStartNodes(body: Element): Node[] {
  const starts = new Set<Node>();

  for (const container of safeQueryAll(body, LINE_START_CONTAINER_SELECTOR)) {
    const first = firstNonBlankChild(container);
    if (first && !isBlockElement(first)) starts.add(first);
  }
  for (const lineBreak of safeQueryAll(body, 'br')) {
    const next = nextNonBlankSibling(lineBreak);
    if (next && !isBlockElement(next)) starts.add(next);
  }
  return [...starts];
}

/**
 * Whether a line reads as an attribution.
 *
 * Two ways to qualify. Either it matches {@link HEADER_PATTERN} — a keyword
 * form, unambiguous — or it PARSES to a real date AND a real address while
 * staying short, which is the "no wrote:" shape Zoho and several mobile clients
 * emit. Requiring both the date and the address for that second form is what
 * stops a prose sentence opening with "On Tuesday" from masquerading as one.
 */
function isAttributionLine(line: string, attribution: ParsedAttribution | null): boolean {
  if (HEADER_PATTERN.test(line)) return true;
  return !!attribution?.email && attribution.date !== null && line.length <= MAX_DATELINE_CHARS;
}

/** Boundaries found by walking visual lines. */
function lineBoundaries(body: Element, refDate?: Date): Boundary[] {
  const found: Boundary[] = [];
  for (const start of lineStartNodes(body)) {
    const { text, last, terminator } = collectAttributionLine(start);
    const line = text.replace(/\s+/g, ' ').trim();
    if (line.length < MIN_LINE_CHARS || line.length > MAX_LINE_CHARS) continue;
    const attribution = parseAttribution(line, refDate);
    if (!isAttributionLine(line, attribution)) continue;
    // The line's terminating `<br>` is consumed with it; without one the line
    // ran to a block boundary and its last node is the end of it.
    found.push({ endBefore: start, startAfter: terminator ?? last, ref: start, attribution });
  }
  return found;
}

/** Boundaries found from a client's own attribution-line class marker. */
function markerBoundaries(body: Element, refDate?: Date): Boundary[] {
  const found: Boundary[] = [];
  for (const element of safeQueryAll(body, ATTRIBUTION_MARKER_SELECTOR)) {
    const line = normalizedText(element);
    if (line.length < MIN_LINE_CHARS || line.length > MAX_LINE_CHARS) continue;
    // The class alone is not enough. Clients reuse these wrappers, and an
    // element that does not even OPEN like an attribution is not one.
    if (!/^\s*(?:on\b|from\s*:)/i.test(line)) continue;
    found.push({
      endBefore: element,
      startAfter: element,
      ref: element,
      attribution: parseAttribution(line, refDate),
    });
  }
  return found;
}

/**
 * Boundaries found from a SHORT element whose text opens with an attribution.
 *
 * INNERMOST only, and the size cap alone is not a substitute for it. A whole
 * two-reply Gmail quote container is under 240 characters and its text opens
 * with "On Mon … wrote:" like any attribution — taken as a boundary, it
 * consumes both quoted messages and the thread renders as a single bubble.
 * Every enclosing element inherits the shape of the attribution nested inside
 * it, so only the deepest match can be the attribution itself. The same
 * doctrine the shape-driven `DomRule`s follow, for the same reason.
 */
function wholeElementBoundaries(body: Element, refDate?: Date): Boundary[] {
  const matched = safeQueryAll(body, 'div, p, td, span').filter((element) => {
    const line = normalizedText(element);
    if (line.length < MIN_LINE_CHARS || line.length > MAX_WHOLE_ELEMENT_CHARS) return false;
    return HEADER_PATTERN.test(line);
  });

  return matched
    .filter((element) => !matched.some((other) => other !== element && element.contains(other)))
    .map((element) => ({
      endBefore: element,
      startAfter: element,
      ref: element,
      attribution: parseAttribution(normalizedText(element), refDate),
    }));
}

/**
 * Ordered, non-overlapping quote boundaries.
 *
 * Three detectors run and their results are merged, because the three shapes an
 * attribution takes cannot be found by one query: a `<br>`-delimited line has no
 * element, a class marker has no keyword, and a fragmented attribution has
 * neither a single text node nor a short line. They overlap heavily by design —
 * finding the same boundary twice is safe and missing one is not — so the merge
 * ends by keeping, of any group of anchors covering the same region, the first.
 *
 * A boundary survives only if it starts strictly AFTER the region the previous
 * one consumed, and is not nested INSIDE it. Those two conditions together
 * collapse the duplicate anchors an ancestor/descendant pair produces, which is
 * what an element detector and a line detector both firing on one attribution
 * looks like.
 *
 * `refDate` is the sending time of the mail this body came from; it anchors the
 * relative dates in the attribution lines found here. See
 * {@link parseAttribution}.
 */
export function findBoundaries(body: Element, refDate?: Date): Boundary[] {
  const candidates = [
    ...lineBoundaries(body, refDate),
    ...markerBoundaries(body, refDate),
    ...wholeElementBoundaries(body, refDate),
  ];

  // Paths, not `compareDocumentPosition` — see `comparePaths` for the linkedom
  // bug that makes the method unusable on the text nodes half of these are.
  // BOTH ends are resolved here, once per candidate, rather than inside the
  // comparator (which would walk each ancestor chain O(n log n) times) or inside
  // the loop below (which would need a fallback for a failure that has already
  // been ruled out by the time it could matter). A boundary whose ends do not
  // both resolve against this tree cannot be applied to it, so it is dropped.
  const positioned = candidates
    .map((boundary) => ({
      boundary,
      from: pathTo(boundary.ref, body),
      to: pathTo(boundary.startAfter, body),
    }))
    .filter(
      (entry): entry is { boundary: Boundary; from: number[]; to: number[] } =>
        entry.from !== null && entry.to !== null,
    )
    .sort((left, right) => comparePaths(left.from, right.from));

  const kept: Boundary[] = [];
  let consumedTo: number[] | null = null;
  for (const { boundary, from, to } of positioned) {
    if (consumedTo) {
      if (comparePaths(consumedTo, from) >= 0) continue; // at or before the last region
      if (isPathPrefix(consumedTo, from)) continue; // nested inside it
    }
    kept.push(boundary);
    consumedTo = to;
  }
  return kept;
}
