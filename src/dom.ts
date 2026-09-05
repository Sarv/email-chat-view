/**
 * DOM access for the transform layer.
 *
 * Every rule engine here works on a parsed document, never on a string with a
 * regex, because email HTML is real markup: a selector like `.gmail_signature`
 * matches whether the element is a `<div>` or a `<table>`, whatever attribute
 * order it carries, however deeply it nests. A regex over the same markup is
 * both slower to reason about and wrong on ordinary input.
 *
 * The parser is INJECTABLE rather than assumed, so the transform runs in three
 * places without change:
 *   - a browser / Electron renderer  -> the global `DOMParser` is used
 *   - Node (SSR, a CLI, a mail pipeline) -> pass one built on `linkedom` etc.
 *   - a test -> pass linkedom, which is exactly what this package's own suite
 *     does, so the Node path is covered rather than assumed to work.
 */

/** Parses an HTML fragment or document into something with a `body`. */
export type HtmlParser = (html: string) => Document;

/**
 * Thrown when the transform is called with no parser and no global `DOMParser`.
 * A dedicated class (rather than a bare `Error`) so a consumer can distinguish
 * "you forgot to wire up a DOM" from a genuine parse failure and recover.
 */
export class NoDomParserError extends Error {
  constructor() {
    super(
      'No HTML parser available. This environment has no global DOMParser, so ' +
        'you must pass one explicitly:\n\n' +
        "  import { parseHTML } from 'linkedom';\n" +
        '  const parser = (h) => parseHTML(`<html><body>${h}</body></html>`).document;\n' +
        '  stripSignature(html, { parser });\n\n' +
        'Note the <body> wrapper: unlike the browser DOMParser, linkedom does ' +
        'NOT hoist a bare fragment into document.body, and an email body is ' +
        'almost always a fragment — without the wrapper every strip pass sees ' +
        'an empty document and returns the input unchanged.\n',
    );
    this.name = 'NoDomParserError';
  }
}

/**
 * Parser backed by the platform `DOMParser`. Not exported as a constant because
 * availability must be checked at CALL time, not module-eval time — a bundle
 * can be evaluated during SSR and then run in a browser.
 */
function globalDomParser(html: string): Document {
  const Parser = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (!Parser) throw new NoDomParserError();
  return new Parser().parseFromString(html, 'text/html');
}

/** Resolves the parser to use: the caller's if given, else the platform one. */
export function resolveParser(parser?: HtmlParser): HtmlParser {
  return parser ?? globalDomParser;
}

/** True when this environment can parse HTML without an injected parser. */
export function hasGlobalDomParser(): boolean {
  return typeof (globalThis as { DOMParser?: unknown }).DOMParser === 'function';
}

// normalizedText lives in transform/node-utils.ts — there is exactly one
// definition of "how text is counted", because every length guard in every rule
// compares against it. Two near-identical copies (one folding nbsp, one not) is
// precisely the drift this package was extracted to end.
