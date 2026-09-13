/**
 * Deciding how one body should be rendered.
 *
 * A cleaned email body is one of two very different things. Most of them are
 * text with a link in them, and those belong INLINE in the bubble, where they
 * inherit the app's font, wrap with the layout, and take the bubble's padding
 * and tint. A minority are real documents — a table-based newsletter, a
 * signature with a logo, a receipt — and those need an iframe, because their
 * own CSS would otherwise leak into the host application and their layout needs
 * a sized containing block.
 *
 * LENGTH IS NOT WHAT SEPARATES THEM, and conflating the two is the bug this
 * split exists to prevent: a long letter used to be framed purely for being
 * long, which handed a plain text message the treatment a designed document
 * needs — a frame with no padding of its own, inside a bubble that drops its
 * padding and its tint so the document can reach the card's edge. The reader
 * got their correspondent's words jammed against the border of an untinted box,
 * clipped at the right edge, with a screenful of dead frame under the last line.
 * Length is answered separately, by `long`, and it decides WIDTH only.
 *
 * Answered by PARSING the body, once, rather than by pattern-matching the
 * markup. The regex version of this ("does the string contain `<table`?") gets
 * confused by the word `<table` inside a code sample, by an attribute value,
 * and by any tag it did not think of; and it has to strip tags with a second
 * regex to measure the text, which is where the length estimate drifts from
 * what the reader actually sees.
 */
import { resolveParser, type HtmlParser } from '../dom.js';
import {
  EMBEDDED_MEDIA_SELECTOR,
  isElement,
  isIgnorableNode,
  normalizedText,
  safeQueryAll,
} from '../transform/node-utils.js';

/**
 * Elements that make a body a document rather than a remark.
 *
 * Embedded media, plus `<pre>`: preformatted text is not media, but it carries
 * its own whitespace and its own width, and inlining it into a bubble that
 * wraps destroys the only thing it was for.
 */
const RICH_SELECTOR = `${EMBEDDED_MEDIA_SELECTOR},pre`;

/**
 * The one rich marker that is LAYOUT rather than media.
 *
 * Everything else in {@link RICH_SELECTOR} is content in its own right — an
 * image, a video, a chart, a block of preformatted text — and the inline path
 * would drop it on the floor, so none of it is ever reconsidered. A `<table>`
 * is different: in mail it is usually a wrapper, and unwrapping one costs
 * nothing but the wrapper. It is therefore the only marker a conversational
 * thread is allowed to reinterpret. See {@link isConversationalThread}.
 */
const LAYOUT_TAG = 'table';

/**
 * {@link RICH_SELECTOR} without the layout table.
 *
 * Derived from the shared list rather than re-typed, so a tag added to
 * {@link EMBEDDED_MEDIA_SELECTOR} cannot be silently missing from this one.
 */
const RICH_WITHOUT_LAYOUT_TABLES = [
  ...EMBEDDED_MEDIA_SELECTOR.split(',').filter((tag) => tag.trim() !== LAYOUT_TAG),
  'pre',
].join(',');

/**
 * Rows at which a table stops looking like a wrapper and starts looking like a
 * grid somebody actually meant.
 *
 * A signature block is one or two rows — a logo beside a name, a name over a
 * title. Three is where a reader would start reading DOWN a column, and
 * flattening that loses the only thing it was for.
 */
const DATA_TABLE_MIN_ROWS = 3;

/**
 * Whether a table is data the reader would lose, rather than a wrapper.
 *
 * A header cell settles it outright — nobody writes a `<th>` to indent a
 * signature. Failing that, height does: see {@link DATA_TABLE_MIN_ROWS}.
 *
 * Errs toward DATA. Calling a grid a wrapper flattens it into a run-on
 * paragraph with nothing on screen to say so, which is silent damage; calling a
 * wrapper a grid merely frames a message that would have looked better inline.
 */
function isDataTable(table: Element): boolean {
  if (safeQueryAll(table, 'th').length > 0) return true;
  return safeQueryAll(table, 'tr').length >= DATA_TABLE_MIN_ROWS;
}

/**
 * Longer than this and the bubble stops hugging its text.
 *
 * A width decision, not a rendering one: a two-word reply should look like a
 * two-word reply, and a letter should not be forced to wrap in a column the
 * width of its longest paragraph. What it must NOT decide is whether the body
 * is framed — see the module header.
 */
export const SIMPLE_TEXT_LIMIT = 350;

/** How a body should be rendered. */
export type BodyKind =
  /** Nothing to show — the reader gets the "no content" note. */
  | 'empty'
  /** Text and inline markup: render inline in the bubble, at any length. */
  | 'simple'
  /** Brings its own layout or media: render in a sandboxed frame. */
  | 'rich';

/** Everything the view needs to know about one body, from one parse. */
export interface BodyShape {
  kind: BodyKind;
  /**
   * The body to render: the input with its trailing dead space removed.
   *
   * Render THIS, not the original — see {@link inspectBody}. Empty whenever
   * `kind` is `empty`, so there is nothing to render by mistake.
   */
  html: string;
  /** The visible text, whitespace collapsed. Used for length and for `title`. */
  text: string;
  /**
   * Whether the body is long enough that the bubble should stop hugging it.
   *
   * Independent of `kind`: a long letter is still a chat message and still
   * renders inline. All this says is that it deserves the full column.
   */
  long: boolean;
  /**
   * Whether the body pulls images off the network.
   *
   * Drives the tracking-pixel banner, so it errs toward TRUE: claiming there
   * are no remote images when there are turns the protection off silently.
   */
  hasRemoteImages: boolean;
}

/** Nothing parsed, nothing to render. */
const EMPTY_SHAPE: BodyShape = {
  kind: 'empty',
  html: '',
  text: '',
  long: false,
  hasRemoteImages: false,
};

/**
 * The most conservative answer available: frame it, and assume it phones home.
 *
 * Used when the body cannot be parsed at all. Every part of it fails safe — the
 * frame is sandboxed, the image banner stays up, and the html is the ORIGINAL,
 * untrimmed: a body we could not parse is one we have no business editing.
 * Throwing instead would take the whole thread down with it, and a mail client
 * that cannot render one message must still render the other 199.
 */
function unparseableShape(html: string): BodyShape {
  return { kind: 'rich', html, text: '', long: true, hasRemoteImages: true };
}

/**
 * How deep the trailing trim walks before it stops.
 *
 * Only a guard against a pathological body recursing the stack away. Real mail
 * nests deeply — an Outlook table layout is easily twenty levels — but the tail
 * of a message is never sixty-four wrappers down, so a body that hits this
 * simply keeps whatever dead space is below it.
 */
const MAX_TRIM_DEPTH = 64;

/**
 * Remove the dead space from the END of a body, in place.
 *
 * Mail arrives with a tail of nothing on it — `<div><br></div>` stacked several
 * deep, `&nbsp;` paragraphs, the empty wrappers left behind when a signature or
 * a quoted history was stripped out. It is invisible in a list preview and
 * harmless in a full-page reader, but a chat bubble is sized to its content:
 * the frame's measured height counts every one of those empty ELEMENTS as
 * layout, so the reader gets a bubble with a screenful of blank under the last
 * line and no way to tell whether something failed to load.
 *
 * Done on the tree rather than with anchored `…$` regexes over the serialized
 * string, which is how the view this package was extracted from did it. Those
 * regexes are quadratic on a large body unless the scanned tail is windowed,
 * and an earlier single-regex version of them backtracked catastrophically and
 * froze the render thread outright. Walking the tail of a tree that is already
 * parsed is linear and cannot backtrack at all.
 *
 * {@link isIgnorableNode} decides what counts as dead, which is the same
 * judgement the strip rules use — including its media exception, so an
 * image-only `<div>` at the end of a message is content and stays.
 */
function trimTrailingDeadSpace(element: Element, depth = 0): void {
  let last = element.lastChild;
  while (last && isIgnorableNode(last)) {
    element.removeChild(last);
    last = element.lastChild;
  }
  // Descend only into an element that survived: one with text or media in it
  // cannot itself become dead by losing its own tail, so there is nothing to
  // re-check on the way back up.
  if (last && isElement(last) && depth < MAX_TRIM_DEPTH) trimTrailingDeadSpace(last, depth + 1);
}

/** Schemes that fetch from the network when an `<img>` is laid out. */
const REMOTE_PREFIXES = ['http://', 'https://', '//'];

/** Whether an `<img src>` value, exactly as authored, hits the network. */
function isRemoteSource(source: string | null): boolean {
  const value = (source ?? '').trim().toLowerCase();
  return REMOTE_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/** Options for {@link inspectBody}. */
export interface InspectBodyOptions {
  /** Parser to use. Defaults to the platform `DOMParser`. */
  parser?: HtmlParser;
  /** Override the hug-vs-full-width text threshold. */
  textLimit?: number;
  /**
   * Whether this body arrived in a thread where people are writing to each
   * other — see {@link isConversationalThread}.
   *
   * Narrows what counts as a document: a `<table>` in a conversation is read as
   * the signature wrapper or client indentation it almost always is, unless it
   * is big enough to be data (see {@link isDataTable}). Media and preformatted
   * text still frame the body, conversation or not, because the inline path
   * would throw them away.
   *
   * Defaults to false, which is the conservative answer: a thread we know
   * nothing about is treated as though it might be a newsletter.
   */
  conversational?: boolean;
}

/**
 * Inspect one body: how to render it, its text, whether it loads remotely, and
 * the html to actually render.
 *
 * One function rather than four because every answer comes from the same parse,
 * and a body is inspected once per render of a bubble. Four exported predicates
 * would each parse again — four parses per message, per render, on a
 * 200-message thread.
 *
 * The returned `html` is the reason this is not a pure read: the tail trim (see
 * {@link trimTrailingDeadSpace}) has to happen on the tree, and the tree is
 * here. Callers render `shape.html`; rendering `message.body` instead puts the
 * dead space back.
 */
export function inspectBody(
  html: string | null | undefined,
  options: InspectBodyOptions = {},
): BodyShape {
  const source = (html ?? '').trim();
  if (!source) return EMPTY_SHAPE;

  const { parser, textLimit = SIMPLE_TEXT_LIMIT, conversational = false } = options;

  // No initialiser: the `catch` returns, so the only way past this block is
  // with the parse result assigned.
  let body: Element | null;
  try {
    body = resolveParser(parser)(source).body;
  } catch {
    return unparseableShape(source);
  }
  if (!body) return unparseableShape(source);

  // Before anything is measured or counted: a tail of empty wrappers must not
  // make a body look longer, richer or emptier than it reads.
  trimTrailingDeadSpace(body);

  const images = Array.from(body.querySelectorAll('img'));
  const hasRemoteImages = images.some((image) => isRemoteSource(image.getAttribute('src')));

  const text = normalizedText(body);
  if (!text && !images.length && !body.querySelector(RICH_SELECTOR)) {
    // No text and no media of any kind. Whatever markup is in there — empty
    // divs, a stray `<br>`, a wrapper the strip passes hollowed out — renders
    // as blank space, so say so and let the bubble show its "no content" note
    // instead of an empty shell the reader stares at.
    return { kind: 'empty', html: '', text: '', long: false, hasRemoteImages };
  }

  // Only markup that brings its own layout earns a frame. Length is answered
  // beside it, never instead of it.
  const designed = conversational
    ? // In a conversation a bare table is a sign-off wrapper, not a newsletter,
      // so it only counts when it is big enough to be data the reader would miss.
      Boolean(body.querySelector(RICH_WITHOUT_LAYOUT_TABLES)) ||
      safeQueryAll(body, LAYOUT_TAG).some(isDataTable)
    : Boolean(body.querySelector(RICH_SELECTOR));
  return {
    kind: designed ? 'rich' : 'simple',
    html: body.innerHTML,
    text,
    long: text.length > textLimit,
    hasRemoteImages,
  };
}
