/**
 * Splitting ONE email body into the messages quoted inside it.
 *
 * This is the half of thread reconstruction that needs no thread. A single
 * reply, opened on its own, already contains the conversation: the sender's
 * words, then the message they replied to, then the one before that, each
 * introduced by an attribution line. {@link findBoundaries} locates those lines;
 * this turns the regions between them into segments.
 *
 * Two rules govern everything here, and both were learned the expensive way:
 *
 *   1. NOTHING is stripped before the split. A signature sweep over the whole
 *      body deletes the quoted headers the boundary detector navigates by, and
 *      a nine-message thread collapses into two bubbles. Cleaning happens per
 *      segment, afterwards.
 *   2. A body with NO boundaries is not a conversation. The whole thing is one
 *      message, and running the structural passes over it unwraps and truncates
 *      designed mail — a task-tracker notification whose content sits in an
 *      inline-styled blockquote comes out as a wireframe. Such a body gets the
 *      minimal, marker-required chain instead, so the sender's signature still
 *      goes but the layout survives.
 */
import { resolveParser } from '../dom.js';
import { minimalLineRules } from '../rules/line.js';
import type { StripOptions } from '../rules/types.js';
import { sliceBetween } from '../transform/dom-slice.js';
import { cleanFragment, type CleanFragmentOptions } from '../transform/fragment.js';
import { hasVisibleContent } from '../transform/html-space.js';

import type { ParsedAttribution } from './attribution.js';
import { findBoundaries } from './boundaries.js';

/** One message carved out of a body. */
export interface BodySegment {
  /**
   * Who wrote it and when, read off the attribution line that introduced it.
   * Null for the sender's own segment, which no line introduces — and also null
   * for a quoted segment whose attribution line would not parse, which is why
   * {@link BodySegment.isOwn} exists rather than a null check standing in for it.
   */
  attribution: ParsedAttribution | null;
  /**
   * Whether this is the carrier mail's OWN message rather than one it quotes.
   *
   * Stated, not inferred from position. Segments that clean away to nothing are
   * dropped, so the sender's own segment is not reliably index 0 — a reply
   * consisting only of a signature loses it — and reading position as ownership
   * then credits the carrier's sender with words somebody else wrote.
   */
  isOwn: boolean;
  /** The segment's cleaned HTML. */
  html: string;
  /** Which rules shaped this segment, e.g. `['signature:gmail', 'sign-off']`. */
  applied: string[];
}

/**
 * The cleaning recipe for a body that was never split.
 *
 * Structure untouched, no banner rules, and only the two line rules whose
 * marker is unambiguous. Exported as a VALUE so a caller can extend it —
 * `{ ...minimalFragmentOptions, keepSignOff: true }` — rather than
 * reconstructing a recipe described in prose somewhere.
 */
export const minimalFragmentOptions: CleanFragmentOptions = {
  keepStructure: true,
  bannerRules: [],
  lineRules: minimalLineRules,
};

/** How to parse and how to clean, for {@link splitMailBody}. */
export interface SplitMailBodyOptions extends StripOptions {
  /** Cleaning options for a QUOTED segment — the full chain by default. */
  segment?: CleanFragmentOptions;
  /**
   * Cleaning options for a body with no boundaries at all.
   * Defaults to {@link minimalFragmentOptions}.
   */
  solo?: CleanFragmentOptions;
  /**
   * When this mail was sent, anchoring the relative dates its attribution lines
   * carry ("On Monday", "Yesterday at 4pm"). Pass it whenever you have it —
   * without it those resolve against the reader's clock, which dates a quote
   * after the mail quoting it. See {@link parseAttribution}.
   */
  refDate?: Date;
}

/**
 * Split a body into segments, newest first.
 *
 * Returns the sender's own message followed by each quoted message in the order
 * they appear, which for every client is newest to oldest. Segments that clean
 * away to nothing are dropped — a quote level holding only a repeated signature
 * is not a message.
 *
 * A body that cannot be parsed comes back as ONE segment holding the original
 * HTML. Showing a whole thread in a single bubble is a visible flaw the reader
 * can work around; returning nothing loses the mail.
 */
export function splitMailBody(html: string, options?: SplitMailBodyOptions): BodySegment[] {
  if (!html) return [];

  const whole = (segmentHtml: string): BodySegment[] => [
    { attribution: null, isOwn: true, html: segmentHtml, applied: [] },
  ];

  let body: Element;
  try {
    const parsed = resolveParser(options?.parser)(html).body;
    if (!parsed) return whole(html);
    body = parsed;
  } catch {
    return whole(html);
  }

  const boundaries = findBoundaries(body, options?.refDate);

  if (boundaries.length === 0) {
    const cleaned = cleanFragment(body, options?.solo ?? minimalFragmentOptions);
    // Never let the minimal pass empty a message. It runs on bodies nobody
    // verified are conversational, and a rule misfiring there would blank the
    // bubble rather than merely leave a signature in it.
    if (!hasVisibleContent(cleaned.html)) return whole(html);
    return [{ attribution: null, isOwn: true, html: cleaned.html, applied: cleaned.applied }];
  }

  const segments: BodySegment[] = [];

  // The sender's own message: everything before the first attribution line.
  const own = cleanFragment(
    sliceBetween(body, { endBefore: boundaries[0]!.endBefore }),
    options?.segment,
  );
  segments.push({ attribution: null, isOwn: true, html: own.html, applied: own.applied });

  // Each quoted message: from just after its attribution to the next one.
  boundaries.forEach((boundary, index) => {
    const slice = sliceBetween(body, {
      startAfter: boundary.startAfter,
      endBefore: boundaries[index + 1]?.endBefore,
    });
    const cleaned = cleanFragment(slice, options?.segment);
    segments.push({
      attribution: boundary.attribution,
      isOwn: false,
      html: cleaned.html,
      applied: cleaned.applied,
    });
  });

  return segments.filter((segment) => hasVisibleContent(segment.html));
}
