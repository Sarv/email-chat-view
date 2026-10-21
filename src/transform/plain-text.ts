/**
 * A cleaned body as plain text.
 *
 * For hosts that draw their own bubbles — a native iOS or Android list, a
 * notification, a search snippet — and want words, not markup. It runs AFTER
 * the clean, on the HTML that would have been rendered, so the two formats can
 * never disagree about what the message says: quoted history and signatures
 * are already gone, and this only decides how the rest reads as text.
 *
 * Not `domToText`, deliberately. That one keeps the source's raw whitespace
 * because the line rules compare against it; text meant for a reader has to
 * collapse it the way a browser does, or every indented `<div>` in an Outlook
 * mail turns into a line of leading spaces.
 */
import { type HtmlParser, resolveParser } from '../dom.js';

import { isBlockElement } from './dom-text.js';
import { foldNbsp } from './node-utils.js';

const NODE_TYPE_ELEMENT = 1;
const NODE_TYPE_TEXT = 3;

/** Elements whose text is never shown: styles, scripts and document metadata. */
const HIDDEN_TAGS = new Set(['HEAD', 'TITLE', 'STYLE', 'SCRIPT', 'TEMPLATE', 'NOSCRIPT']);

/**
 * Line-breaking elements beyond the ones the strip rules break on.
 *
 * Headings, `<pre>` and the sectioning tags render as their own lines too. They
 * are kept out of `isBlockElement` because the line rules were tuned without
 * them, and widening that set would move where every rule thinks a line ends.
 */
const EXTRA_BLOCK_TAGS = new Set([
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'PRE',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'ADDRESS',
  'CENTER',
  'DL',
  'DT',
  'DD',
  'FIGURE',
]);

/** More than one blank line in a row reads as a gap in the message, not a pause. */
const BLANK_RUN = /\n{3,}/g;
const TRAILING_SPACE = /[ \t]+\n/g;

function isTextBlock(element: Element): boolean {
  return isBlockElement(element) || EXTRA_BLOCK_TAGS.has(element.nodeName);
}

/** The bullet for a list item: its number inside an `<ol>`, a dot otherwise. */
function listMarker(item: Element): string {
  const list = item.parentNode as Element | null;
  if (list?.nodeName !== 'OL') return '• ';
  const position = Array.from(list.children)
    .filter((sibling) => sibling.nodeName === 'LI')
    .indexOf(item);
  return `${position + 1}. `;
}

/** Lines trimmed on the right, blank runs capped at one, ends trimmed. */
function tidyLines(text: string): string {
  return text.replace(TRAILING_SPACE, '\n').replace(BLANK_RUN, '\n\n').trim();
}

/**
 * `html` as readable plain text.
 *
 * Whitespace collapses as a browser collapses it (except inside `<pre>`),
 * `<br>` and block elements become line breaks, list items get a bullet or
 * their number, and styles, scripts and images contribute nothing. Links keep
 * their text only: a reader-facing snippet full of tracking URLs is worse than
 * one without them, and a host that needs the targets renders the HTML.
 */
export function htmlToPlainText(html: string, parser?: HtmlParser): string {
  if (!html) return '';
  const body = resolveParser(parser)(html).body;
  if (!body) return '';

  let out = '';
  const atLineStart = (): boolean => out === '' || out.endsWith('\n');
  const breakLine = (): void => {
    if (!atLineStart()) out += '\n';
  };

  const walk = (node: Node, preformatted: boolean): void => {
    if (node.nodeType === NODE_TYPE_TEXT) {
      const text = foldNbsp(node.textContent);
      if (preformatted) {
        out += text;
        return;
      }
      const collapsed = text.replace(/\s+/g, ' ');
      const leading = atLineStart() || out.endsWith(' ');
      out += leading ? collapsed.trimStart() : collapsed;
      return;
    }
    if (node.nodeType !== NODE_TYPE_ELEMENT) return;
    const element = node as Element;
    if (HIDDEN_TAGS.has(element.nodeName)) return;
    if (element.nodeName === 'BR') {
      out += '\n';
      return;
    }
    const block = isTextBlock(element);
    if (block) breakLine();
    if (element.nodeName === 'LI') out += listMarker(element);
    const childPreformatted = preformatted || element.nodeName === 'PRE';
    Array.from(element.childNodes).forEach((child) => walk(child, childPreformatted));
    if (block) breakLine();
  };

  walk(body, false);
  return tidyLines(out);
}
