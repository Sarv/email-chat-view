/**
 * Node-level helpers shared by the rule engines.
 *
 * These exist as their own module because "which children actually count?" is
 * the single judgement every structural pass depends on. When each pass answered
 * it slightly differently — one ignoring `<br>`, another not — the passes
 * disagreed about where a message ended, which is precisely how the hand-rolled
 * strippers this package replaces drifted apart.
 */

const NODE_TYPE_ELEMENT = 1;
const NODE_TYPE_TEXT = 3;

/**
 * A non-breaking space (U+00A0), built by char code rather than written out.
 *
 * Mail HTML is full of `&nbsp;`, so it has to count as whitespace here. A raw
 * U+00A0 in the source would be invisible to the next reader and trivially
 * destroyed by a reformat or a careless copy-paste — this form is greppable and
 * survives any editor.
 */
const NBSP = new RegExp(String.fromCharCode(160), 'g');

/**
 * Non-breaking spaces folded to ordinary ones.
 *
 * THE one place in the package that knows about U+00A0. Every pass that reads
 * text has to fold it — a rule written with a space must match the same line a
 * client wrote with `&nbsp;`, or it fires on Gmail and not on Outlook — and a
 * second copy of this constant is a second chance for one pass to stop folding.
 */
/**
 * ...and it takes the nullable input directly. `Node.textContent` is typed
 * `string | null`, so every caller would otherwise carry its own `?? ''` —
 * which is the same duplication one level down.
 */
export function foldNbsp(text: string | null | undefined): string {
  return (text ?? '').replace(NBSP, ' ');
}

/** Trimmed text with non-breaking spaces treated as ordinary whitespace. */
export function visibleText(node: { textContent?: string | null }): string {
  return foldNbsp(node.textContent).trim();
}

/**
 * Elements that are content even with no text in them.
 *
 * An image, a layout table, a chart, a video: nothing here has a `textContent`,
 * and all of it is the visible part of somebody's message. The render layer's
 * "does this body need a frame?" question is the same list plus `<pre>`, and
 * builds itself from this one so the two cannot drift.
 */
export const EMBEDDED_MEDIA_SELECTOR = 'img,table,iframe,svg,video,audio,object,embed,canvas';

/**
 * Whether a node carries no meaning for structural decisions.
 *
 * Ignorable: whitespace-only text, comments and processing instructions,
 * `<br>` and `<hr>` (pure presentation), and any empty element that is not
 * embedded media and contains none.
 *
 * The media exception matters in both directions, and missing either one loses
 * a message's visible content. An image-only `<div>` has no text at all but is
 * absolutely content — that is the descendant half. So is the `<img>` ITSELF,
 * which a descendant check alone answers "holds no media" about, since
 * `querySelector` only ever looks downward.
 */
export function isIgnorableNode(node: Node): boolean {
  if (node.nodeType === NODE_TYPE_TEXT) return !visibleText(node);
  if (node.nodeType !== NODE_TYPE_ELEMENT) return true;
  const element = node as Element;
  if (element.tagName === 'BR' || element.tagName === 'HR') return true;
  if (visibleText(element)) return false;
  if (safeMatches(element, EMBEDDED_MEDIA_SELECTOR)) return false;
  return !safeQueryAll(element, EMBEDDED_MEDIA_SELECTOR).length;
}

/** Children that carry meaning, in document order. See {@link isIgnorableNode}. */
export function meaningfulChildren(element: Element): Node[] {
  return Array.from(element.childNodes).filter((node) => !isIgnorableNode(node));
}

/** The last meaningful child, or undefined when the element has none. */
export function lastMeaningfulChild(element: Element): Node | undefined {
  const children = meaningfulChildren(element);
  return children[children.length - 1];
}

/** True when `node` is an Element. Narrows for callers walking childNodes. */
export function isElement(node: Node | null | undefined): node is Element {
  return !!node && node.nodeType === NODE_TYPE_ELEMENT;
}

/** Normalized text of a node — whitespace collapsed, nbsp folded, trimmed. */
export function normalizedText(node: { textContent?: string | null } | null | undefined): string {
  return foldNbsp(node?.textContent)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether a selector matches, swallowing selector-support differences.
 *
 * `Element.matches` throws on a selector the engine cannot parse, and support
 * genuinely varies between browsers and server-side DOM implementations. A
 * rule set must never take down a render because one selector is exotic, so an
 * unsupported selector means "did not match".
 */
export function safeMatches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

/** {@link safeMatches} for querying descendants. Returns [] when unsupported. */
export function safeQueryAll(root: Element, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}
