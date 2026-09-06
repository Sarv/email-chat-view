/**
 * Whitespace, blank blocks and the "is this a designed email?" question.
 *
 * A chat bubble hugs its text. Mail HTML does not: senders stack empty
 * paragraphs, Word round-trips leave `<div>&nbsp;</div>` nests, and every
 * client appends its own trailing `<br>` run. Rendered verbatim in a bubble
 * that draws a border, all of that becomes visible dead space — the single most
 * common complaint about naive chat-ifying of email.
 *
 * Everything here is string- or node-level and pure, so the transform entry
 * point can use it with no DOM and no React.
 */
import {
  EMBEDDED_MEDIA_SELECTOR,
  foldNbsp,
  normalizedText,
  safeMatches,
  safeQueryAll,
  visibleText,
} from './node-utils.js';

/**
 * Apply a trailing-only trim, bounded to a fixed tail window so it stays linear
 * however large the input is.
 *
 * Trailing dead space only ever lives at the very END of a body, but the
 * anchored `(?:…)+$` regexes that strip it scan from every start position — so
 * over a whole body they degrade to O(n²). Measured on the corpus this came
 * from: ~200ms at 36KB and ~3.5s at 200KB, enough to stall the thread doing the
 * extraction. Capping the scanned region keeps every pass linear.
 *
 * `peel` MUST strip only from the end and return the rest unchanged, because
 * only the suffix is replaced here — `head + peel(tail)` has to reconstruct the
 * input exactly, including when a tag straddles the window boundary. 8KB is far
 * larger than any real trailing empty-tag nest, and if the whole window turns
 * out to be dead space it is dropped and the loop continues, so correctness
 * never depends on the window size.
 */
export function trimTrailingWindowed(
  input: string,
  peel: (tail: string) => string,
  windowSize = 8192,
): string {
  let out = input;
  for (;;) {
    if (out.length <= windowSize) return peel(out);
    const splitAt = out.length - windowSize;
    const trimmedTail = peel(out.slice(splitAt));
    if (trimmedTail === '') {
      out = out.slice(0, splitAt);
      continue;
    }
    return out.slice(0, splitAt) + trimmedTail;
  }
}

/** Whitespace, `&nbsp;`, `<br>` and empty `<p>`/`<div>` — the edge dead space. */
const EDGE_DEAD_SPACE =
  '(?:\\s|&nbsp;|<br\\s*/?>|<p>\\s*</p>|<div>\\s*</div>|<p>\\s*&nbsp;\\s*</p>|<div>\\s*&nbsp;\\s*</div>)+';

const LEADING_DEAD_SPACE = new RegExp(`^${EDGE_DEAD_SPACE}`, 'i');
const TRAILING_DEAD_SPACE = new RegExp(`${EDGE_DEAD_SPACE}$`, 'i');
const LONG_BREAK_RUN = /(?:<br\s*\/?>\s*){3,}/gi;

/**
 * Drop leading and trailing empty blocks, `<br>` runs and `&nbsp;` so a bubble
 * hugs its text.
 *
 * The leading strip is anchored at index 0 and so is already linear. The
 * trailing one is windowed — see {@link trimTrailingWindowed} for why that is
 * not an optimisation but a requirement.
 */
export function trimEmptyEdges(html: string): string {
  const withoutLead = html.replace(LEADING_DEAD_SPACE, '');
  const trimmed = trimTrailingWindowed(withoutLead, (tail) =>
    tail.replace(TRAILING_DEAD_SPACE, ''),
  );
  return trimmed.replace(LONG_BREAK_RUN, '<br><br>').trim();
}

/**
 * Elements that are visible content even with no text.
 *
 * The shared media list plus the three form controls that render as something
 * on their own. Built from {@link EMBEDDED_MEDIA_SELECTOR} rather than
 * restating it, so "what counts as content?" has one answer across the package.
 */
const VISIBLE_WITHOUT_TEXT = `${EMBEDDED_MEDIA_SELECTOR},hr,input,button`;

/**
 * An element holding no visible content — no text, no media, no control.
 *
 * Checks the element ITSELF as well as its descendants, and both halves are
 * load-bearing. `querySelectorAll` only ever looks downward, so an `<img>` —
 * which has no children and no text — answers "holds no media" about itself and
 * is judged empty. {@link trimEdgeEmpties} recurses into the last element, so
 * without the self-check a message ending in a picture loses the picture.
 */
export function isEmptyElement(element: Element): boolean {
  if (safeMatches(element, VISIBLE_WITHOUT_TEXT)) return false;
  if (safeQueryAll(element, VISIBLE_WITHOUT_TEXT).length) return false;
  return !normalizedText(element);
}

/**
 * The same question as {@link isEmptyElement}, asked of a STRING.
 *
 * Derived from the same selector list rather than restating the tags, because a
 * caller that drops a "blank" segment and a caller that drops a "blank" element
 * disagreeing about whether a picture counts is how an image-only message
 * vanishes from a thread.
 */
const VISIBLE_WITHOUT_TEXT_TAG = new RegExp(
  `<(?:${VISIBLE_WITHOUT_TEXT.split(',').join('|')})\\b`,
  'i',
);

/**
 * Whether a serialized fragment would render as ANYTHING.
 *
 * Used to decide that a cleaned segment is empty and can be dropped. Text is
 * the common answer, but not the only one: a message whose whole content is a
 * screenshot has no text at all, and judging it by text alone deletes it from
 * the thread — which is exactly what the code this came from did.
 */
export function hasVisibleContent(html: string): boolean {
  if (!html) return false;
  if (VISIBLE_WITHOUT_TEXT_TAG.test(html)) return true;
  return foldNbsp(html.replace(/<[^>]*>/g, ' ')).trim().length > 0;
}

const NODE_TYPE_ELEMENT = 1;
const NODE_TYPE_TEXT = 3;

/**
 * Trim leading and trailing empties at the NODE level, recursing into the
 * first and last element.
 *
 * This is the half {@link trimEmptyEdges} cannot reach. A trailing break nested
 * inside the final paragraph — `<p style="…">text<br></p>` — is not at the end
 * of the string, so no anchored regex sees it, and the bubble renders a blank
 * line under the message. Recursing into the last real element is what removes
 * it.
 */
export function trimEdgeEmpties(root: Node): void {
  const stripEnd = (parent: Node): void => {
    let last = parent.lastChild;
    while (last) {
      if (last.nodeType === NODE_TYPE_TEXT) {
        // `visibleText`, not a bare `.trim()`: an edge text node holding only
        // `&nbsp;` renders as blank space and must be trimmed like any other
        // blank. `isEmptyElement`, three lines down, already folds nbsp — the
        // two halves of the same walk disagreeing is how a trailing gap
        // survives on Outlook mail and not on Gmail's.
        if (visibleText(last)) break;
        const previous = last.previousSibling;
        last.parentNode?.removeChild(last);
        last = previous;
        continue;
      }
      if (last.nodeType !== NODE_TYPE_ELEMENT) break;
      const element = last as Element;
      if (element.tagName === 'BR' || isEmptyElement(element)) {
        const previous = last.previousSibling;
        element.remove();
        last = previous;
        continue;
      }
      stripEnd(element); // the last real element — trim its own trailing empties
      break;
    }
  };

  const stripStart = (parent: Node): void => {
    let first = parent.firstChild;
    while (first) {
      if (first.nodeType === NODE_TYPE_TEXT) {
        if (visibleText(first)) break;
        const next = first.nextSibling;
        first.parentNode?.removeChild(first);
        first = next;
        continue;
      }
      if (first.nodeType !== NODE_TYPE_ELEMENT) break;
      const element = first as Element;
      if (element.tagName === 'BR' || isEmptyElement(element)) {
        const next = first.nextSibling;
        element.remove();
        first = next;
        continue;
      }
      stripStart(element);
      break;
    }
  };

  stripStart(root);
  stripEnd(root);
}

/**
 * Placeholder standing in for a removed empty block. An HTML comment because it
 * survives every intermediate regex untouched, renders as nothing if it ever
 * leaks through, and cannot collide with body text.
 */
const EMPTY_MARK = '<!--ecv-blank-->';

/**
 * A `<p>`/`<div>` holding nothing but whitespace, `&nbsp;`, `<br>` — or a
 * placeholder left by an earlier pass.
 *
 * That last alternative is what makes the repeat loop below work at all.
 * Without it the marker a nested match leaves behind is a character the class
 * does not accept, so the enclosing block stops matching forever and
 * `<div><div></div></div>` keeps its wrappers no matter how many passes run.
 */
const EMPTY_BLOCK =
  /<(p|div)\b(?![^>]*\sstyle\s*=)[^>]*>(?:\s|&nbsp;|&#160;|<br\s*\/?>|<!--ecv-blank-->)*<\/\1>/gi;

/** A RUN of adjacent placeholders, whatever whitespace sits between them. */
const EMPTY_RUN = /(?:<!--ecv-blank-->\s*)+/g;

/**
 * How deep a nest of empty wrappers to peel.
 *
 * Each pass strips one level, so this bounds the work on hostile input while
 * sitting far above anything a real Word or Outlook round-trip produces.
 */
const MAX_EMPTY_BLOCK_PASSES = 8;

/**
 * Collapse excessive vertical whitespace while leaving real formatting alone.
 *
 * A run of blank lines becomes one; a `<br>` run becomes two. A deliberate
 * blank line still shows, a wall of them does not.
 *
 * Conservative in two ways, because this runs on bodies otherwise rendered
 * verbatim: a block carrying a `style=` attribute is never touched — a `<div>`
 * with an explicit height is a template's SPACER, not stray blankness — and
 * callers skip designed bodies entirely (see {@link looksDesigned}).
 */
export function collapseExcessBlankSpace(html: string): string {
  if (!html) return html;
  // Empty blocks nest, and a global replace only reaches the innermost level in
  // one pass — so peel until nothing changes.
  let out = html;
  for (let pass = 0; pass < MAX_EMPTY_BLOCK_PASSES; pass += 1) {
    const next = out.replace(EMPTY_BLOCK, EMPTY_MARK);
    if (next === out) break;
    out = next;
  }
  out = out.replace(EMPTY_RUN, '<br>');
  return out.replace(LONG_BREAK_RUN, '<br><br>');
}

/**
 * Whether a body is a DESIGNED email — marketing, transactional, a
 * notification — rather than something a person typed.
 *
 * A designed body owns its own layout. Unwrapping its structure, stripping
 * blocks that look like signatures, or normalizing its fonts turns it into a
 * wireframe, so it must be rendered verbatim. Getting this wrong in the
 * permissive direction costs a signature left in a bubble; getting it wrong in
 * the other direction destroys the email.
 */
export function looksDesigned(html: string | null | undefined): boolean {
  if (!html) return false;
  // Structural markers of a template.
  if (/<style[\s>]/i.test(html)) return true;
  if (/role=["']presentation["']/i.test(html)) return true;
  if (/\bbgcolor=/i.test(html)) return true;
  if ((html.match(/<table/gi)?.length ?? 0) >= 2) return true;
  // Embedded images: logo, banner, button graphics. Hand-written mail rarely
  // carries any.
  if ((html.match(/<img\b/gi)?.length ?? 0) >= 1) return true;
  // An inline-styled template with no <style> block and no tables: a CTA button
  // styled with a background, or several elements each carrying a style
  // attribute (callout boxes, dividers, chips). This is what separates such a
  // template from a plain hand-written reply.
  if (/<a\b[^>]*\sstyle=["'][^"']*(?:background|padding|border-radius)/i.test(html)) return true;
  return (html.match(/\bstyle\s*=/gi)?.length ?? 0) >= 4;
}
