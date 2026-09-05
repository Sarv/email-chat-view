/**
 * Flattening an element to text WITH its line structure intact.
 *
 * `textContent` is the obvious tool and the wrong one: it glues
 * `<div>a</div><div>b</div>` into "ab". Every line-based decision in this
 * package — is this line a sign-off? a delimiter? a mobile footer? — depends on
 * knowing where the lines were, and `textContent` is precisely the operation
 * that destroys that. A signature detector fed glued text finds "Thanks" in the
 * middle of a sentence and cuts the message in half.
 */

import { foldNbsp } from './node-utils.js';

const NODE_TYPE_ELEMENT = 1;
const NODE_TYPE_TEXT = 3;

/**
 * Tags that start and end a visual line.
 *
 * Deliberately narrow: only elements that a mail client actually renders as a
 * block. Inline markup (`<span>`, `<b>`, `<a>`, `<font>`) must NOT appear here
 * — a name wrapped in `<b>` inside a sign-off is part of that line, and
 * breaking on it would split "Thanks,\n**Ankur**" into two lines the rules then
 * judge separately.
 */
const BLOCK_TAGS = new Set([
  'DIV',
  'P',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TD',
  'BLOCKQUOTE',
  'UL',
  'OL',
  'LI',
  'HR',
]);

/** Whether a node renders as its own visual line. */
export function isBlockElement(node: Node): boolean {
  return node.nodeType === NODE_TYPE_ELEMENT && BLOCK_TAGS.has(node.nodeName);
}

/**
 * The element's text with `<br>` and block boundaries turned into newlines.
 *
 * Non-breaking spaces are folded to ordinary ones so a line written with
 * `&nbsp;` compares equal to the same line written with a space — clients
 * disagree about which they emit, and a rule that only matched one of them
 * would fire on Gmail and not on Outlook.
 */
export function domToText(root: Node): string {
  let out = '';
  const walk = (node: Node): void => {
    if (node.nodeType === NODE_TYPE_TEXT) {
      out += foldNbsp(node.textContent);
      return;
    }
    if (node.nodeType !== NODE_TYPE_ELEMENT) return;
    const element = node as Element;
    if (element.nodeName === 'BR') {
      out += '\n';
      return;
    }
    const block = isBlockElement(element);
    if (block && out && !out.endsWith('\n')) out += '\n';
    Array.from(element.childNodes).forEach(walk);
    if (block && !out.endsWith('\n')) out += '\n';
  };
  walk(root);
  return out;
}
