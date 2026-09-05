/**
 * Deciding how one body should be rendered.
 *
 * A cleaned email body is one of two very different things. Most of them are a
 * few sentences of text with a link in them, and those belong INLINE in the
 * bubble, where they inherit the app's font, wrap with the layout, and let the
 * bubble hug its content. A minority are real documents — a table-based
 * newsletter, a signature with a logo, a receipt — and those need an iframe,
 * because their own CSS would otherwise leak into the host application and
 * their layout needs a sized containing block.
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
} from '../transform/node-utils.js';

/**
 * Elements that make a body a document rather than a remark.
 *
 * Embedded media, plus `<pre>`: preformatted text is not media, but it carries
 * its own whitespace and its own width, and inlining it into a bubble that
 * wraps destroys the only thing it was for.
 */
const RICH_SELECTOR = `${EMBEDDED_MEDIA_SELECTOR},pre`;

/** Longer than this and the bubble stops being a chat message. */
export const SIMPLE_TEXT_LIMIT = 350;

/** How a body should be rendered. */
export type BodyKind =
  /** Nothing to show — the reader gets the "no content" note. */
  | 'empty'
  /** Short, text-only: render inline in the bubble. */
  | 'simple'
  /** Markup with layout or media: render in a sandboxed frame. */
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
   * Whether the body pulls images off the network.
   *
   * Drives the tracking-pixel banner, so it errs toward TRUE: claiming there
   * are no remote images when there are turns the protection off silently.
   */
  hasRemoteImages: boolean;
}

/** Nothing parsed, nothing to render. */
const EMPTY_SHAPE: BodyShape = { kind: 'empty', html: '', text: '', hasRemoteImages: false };

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
  return { kind: 'rich', html, text: '', hasRemoteImages: true };
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
  /** Override the inline-vs-frame text threshold. */
  textLimit?: number;
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

  const { parser, textLimit = SIMPLE_TEXT_LIMIT } = options;

  let body: Element | null = null;
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
    return { kind: 'empty', html: '', text: '', hasRemoteImages };
  }

  const rich = text.length > textLimit || Boolean(body.querySelector(RICH_SELECTOR));
  return { kind: rich ? 'rich' : 'simple', html: body.innerHTML, text, hasRemoteImages };
}
