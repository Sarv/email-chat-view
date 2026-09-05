/**
 * Cutting the sender's own sign-off block.
 *
 * Every other signature pass needs an explicit marker: a wrapper class, an RFC
 * 3676 rule line, a graphical contact card. None of them can see the ordinary
 *
 *     Thanks
 *
 *     Ankur Dubey
 *     Engineer, Sarv
 *     +91 …
 *
 * that most people actually write, which is why signature blocks kept arriving
 * in chat bubbles intact. This finds where that block starts and hands the
 * position to the shared node cutter, so "cut from here to the end" still has
 * exactly one implementation.
 *
 * It is also the most dangerous pass in the package, because its marker is a
 * word people use in sentences. Everything below the search is a guard.
 */
import { signatureTitlePattern, signOffPatterns } from '../rules/sign-off.js';

import { distinctDomainCount } from './block-shapes.js';
import { removeFromNodeOnward, SHOW_TEXT } from './dom-slice.js';
import { domToText } from './dom-text.js';
import { visibleText } from './node-utils.js';

/** Longest line a cut may anchor on — a real sign-off line is short. */
const MAX_ANCHOR_LINE = 120;
/** A signature bigger than this is almost certainly a misfire. */
const MAX_SIGNATURE_CHARS = 600;
/** …nor may it be more than this share of the message. */
const MAX_SIGNATURE_SHARE = 0.4;
/** Minimum that must remain: a one-line "Thanks, Alice" reply is ALL sign-off. */
const MIN_KEPT_CHARS = 40;
/** The same two limits, relaxed, once the block proves what it is. */
const MAX_SIGNATURE_CHARS_STRONG = 900;
const MAX_SIGNATURE_SHARE_STRONG = 0.8;

/**
 * Everything from the LAST sign-off line onward, or null if there is none.
 *
 * The last, not the first, and the difference is the whole message: "Thanks for
 * the quick turnaround" in an opening sentence would otherwise anchor the cut
 * at the top and take the entire body with it.
 */
export function signOffBlock(text: string): string | null {
  let cutAt = -1;
  for (const pattern of signOffPatterns) {
    // The patterns are module-level constants. A global copy is built per call
    // so `lastIndex` state can never leak between calls — a stateful regex
    // shared across messages skips matches in whichever body happens to run
    // second, which is the kind of bug that only shows up under load.
    const scan = new RegExp(
      pattern.source,
      pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
    );
    for (let match = scan.exec(text); match; match = scan.exec(text)) {
      if (match.index > cutAt) cutAt = match.index;
      // `signOffPatterns` is exported for a consumer to extend with their own
      // language, so a contributed pattern that can match zero-width is
      // reachable — and a zero-width global match never advances `lastIndex`,
      // which hangs the process rather than producing a wrong answer.
      if (match[0].length === 0) break;
    }
  }
  return cutAt < 0 ? null : text.slice(cutAt).trim() || null;
}

/**
 * Unambiguous signature evidence: a job title, or two-plus distinct domains.
 *
 * Present, the cut is allowed past the normal size and share guards. A short
 * "here are the details" note whose second half is a full contact card is
 * common, and that card is never the message even when it is most of the text.
 */
export function hasStrongSignatureEvidence(block: string): boolean {
  return signatureTitlePattern.test(block) || distinctDomainCount(block) >= 2;
}

/**
 * Find the first text node whose line equals `anchor`, and cut from there.
 *
 * Nodes are collected before any mutation: a live TreeWalker positioned on a
 * removed node is undefined behaviour, and in linkedom it stops early.
 */
function cutAtLine(root: Element, anchor: string): boolean {
  const document = root.ownerDocument;
  if (!document) return false;
  const nodes: Node[] = [];
  const walker = document.createTreeWalker(root, SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);

  for (const node of nodes) {
    // Trimmed but NOT whitespace-collapsed, matching how `domToText` produced
    // the anchor. Collapsing here would make a line with a double space compare
    // unequal to the anchor it came from, and the cut would silently not happen.
    if (visibleText(node) !== anchor) continue;
    removeFromNodeOnward(node, root);
    return true;
  }
  return false;
}

/**
 * Remove the sender's sign-off block from a parsed tree, in place.
 *
 * Returns true when something was cut. Every guard below exists because it
 * fired on a real message:
 *
 *   - the anchor line must be SHORT, or "Thanks for sending the revised
 *     contract over this morning" becomes a cut point;
 *   - the block must be a MINORITY of the text, unless it carries strong
 *     evidence of being a card;
 *   - enough must REMAIN, because a one-line "Thanks, Alice" reply is entirely
 *     sign-off and cutting it leaves an empty bubble.
 */
export function cutSignOff(root: Element): boolean {
  const text = domToText(root);
  if (!text.trim()) return false;

  const block = signOffBlock(text);
  if (!block) return false;

  const strong = hasStrongSignatureEvidence(block);
  const maxChars = strong ? MAX_SIGNATURE_CHARS_STRONG : MAX_SIGNATURE_CHARS;
  const maxShare = strong ? MAX_SIGNATURE_SHARE_STRONG : MAX_SIGNATURE_SHARE;
  if (block.length > maxChars) return false;
  if (block.length > text.trim().length * maxShare) return false;

  // `signOffBlock` returns trimmed non-empty text, so its first line is always
  // non-empty — no "find the first line with something on it" search needed,
  // and no unreachable branch guarding against one that does not exist.
  const anchor = block.split('\n')[0]!.trim();
  if (anchor.length > MAX_ANCHOR_LINE) return false;

  const kept = text.slice(0, text.indexOf(anchor));
  if (kept.replace(/\s+/g, '').length < MIN_KEPT_CHARS) return false;

  return cutAtLine(root, anchor);
}
