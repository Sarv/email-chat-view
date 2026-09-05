/**
 * The DOM the suite runs against.
 *
 * linkedom, injected explicitly — never a jsdom global. Two reasons:
 *
 *   1. It proves the Node story. A consumer running the transform server-side
 *      has to inject a parser, and this is that exact code path. If it breaks,
 *      the suite breaks with it rather than passing on an ambient browser DOM
 *      the consumer does not have.
 *   2. It keeps the transform honest. There is no global `DOMParser` in these
 *      tests, so any code that quietly reaches for one fails loudly.
 */
import { parseHTML } from 'linkedom';

import type { HtmlParser } from '../../src/dom.js';

/**
 * Parse a mail fragment.
 *
 * The `<html><body>` wrapper is load-bearing. The browser `DOMParser` hoists a
 * bare fragment into `document.body`; linkedom does not — it leaves the body
 * empty and puts the nodes nowhere useful. Email bodies are almost always
 * fragments, so without this wrapper every pass would see an empty document and
 * return its input unchanged, and the whole suite would pass while stripping
 * nothing. This is the same wrapper the README tells consumers to use.
 */
export const parser: HtmlParser = (html) =>
  parseHTML(`<html><body>${html}</body></html>`).document;

/** Parse and hand back the `<body>` element, which is what the engines take. */
export function parseBody(html: string): Element {
  const body = parser(html).body;
  if (!body) throw new Error('linkedom returned a document with no body');
  return body;
}

/** A parser that throws, for the "unparseable body must not lose the mail" paths. */
export const throwingParser: HtmlParser = () => {
  throw new Error('parse exploded');
};

/** A parser that yields a document with no `body`, which a real one can do. */
export const bodylessParser: HtmlParser = () =>
  ({ body: null }) as unknown as Document;

/**
 * A parser that works for the first `calls` invocations and then fails.
 *
 * `cleanReplyBody` parses twice when a marker rule cuts the body, and the
 * second parse is handed HTML the FIRST parse never saw — a string sliced at a
 * text boundary, which can easily be malformed. So "the parser succeeded once
 * and failed the next time" is a real state, not a contrived one, and the
 * fallback has to hand back the marker-stripped HTML rather than lose the mail.
 */
export function parserFailingAfter(calls: number, mode: 'throw' | 'bodyless' = 'throw'): HtmlParser {
  let seen = 0;
  return (html) => {
    seen += 1;
    if (seen <= calls) return parser(html);
    if (mode === 'bodyless') return bodylessParser(html);
    return throwingParser(html);
  };
}

/** Collapse whitespace so assertions are about content, not the DOM's formatting. */
export function squash(html: string): string {
  return html.replace(/\s+/g, ' ').trim();
}
