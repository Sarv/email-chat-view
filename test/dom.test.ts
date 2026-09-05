import { afterEach, describe, expect, it } from 'vitest';

import { hasGlobalDomParser, NoDomParserError, resolveParser } from '../src/dom.js';

import { parser } from './helpers/parser.js';

/**
 * The DOM is injected, not assumed. If these break, the library has grown an
 * implicit dependency on a browser and every server-side consumer is broken.
 */
describe('resolveParser', () => {
  const globals = globalThis as { DOMParser?: unknown };

  afterEach(() => {
    delete globals.DOMParser;
  });

  // Regression: an injected parser must win. If the platform one were preferred,
  // a consumer's custom sanitizing parser would be silently ignored.
  it('returns the caller-supplied parser unchanged', () => {
    expect(resolveParser(parser)).toBe(parser);
  });

  // Regression: with no parser and no DOMParser, the failure has to be the
  // dedicated error carrying the wiring instructions — not a bare TypeError on
  // `undefined is not a constructor`, which tells the consumer nothing.
  it('throws NoDomParserError when nothing can parse', () => {
    expect(hasGlobalDomParser()).toBe(false);
    const resolved = resolveParser();
    expect(() => resolved('<p>hi</p>')).toThrow(NoDomParserError);
    expect(() => resolved('<p>hi</p>')).toThrow(/no global DOMParser/i);
  });

  // Regression: the message must keep telling consumers to wrap the fragment in
  // <body>. Drop that sentence and the most common Node setup silently strips
  // nothing at all — see the note in test/helpers/parser.ts.
  it('explains the <body> wrapper linkedom needs', () => {
    expect(new NoDomParserError().message).toContain('<html><body>');
    expect(new NoDomParserError().name).toBe('NoDomParserError');
  });

  // Regression: availability is checked at CALL time. A bundle evaluated during
  // SSR and then run in a browser must pick the platform parser up on the way,
  // which a module-level constant would have frozen out.
  it('picks up a DOMParser that appears after module evaluation', () => {
    const parseFromString = (html: string) => parser(html);
    class FakeDomParser {
      parseFromString(html: string) {
        return parseFromString(html);
      }
    }
    globals.DOMParser = FakeDomParser;

    expect(hasGlobalDomParser()).toBe(true);
    const document = resolveParser()('<p>hi</p>');
    expect(document.body?.innerHTML).toBe('<p>hi</p>');
  });

  // Regression: a non-function DOMParser (a stub, a polyfill that assigned an
  // object) must not read as available and then blow up mid-render.
  it('does not treat a non-function DOMParser as available', () => {
    globals.DOMParser = {};
    expect(hasGlobalDomParser()).toBe(false);
  });
});
