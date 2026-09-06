import { describe, expect, it } from 'vitest';

import {
  buildFrameCss,
  buildFrameDocument,
  clickedHref,
  estimateFrameHeight,
  FALLBACK_FRAME_THEME,
  measureFrameHeight,
  readFrameTheme,
  type FrameTheme,
} from '../../src/ui/frame.js';

/**
 * Hand-built stubs rather than a jsdom document.
 *
 * Everything in `frame.ts` is a pure function over a small, named slice of the
 * DOM — `getComputedStyle`, `createRange`, `scrollHeight`, `closest` — so
 * stubbing that slice keeps these tests in the Node environment and, more
 * usefully, lets them reach the failure paths a real browser will not produce
 * on demand (a document that refuses a Range, a non-finite scroll height).
 */
function elementWithTokens(tokens: Record<string, string>): Element {
  return {
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({
          getPropertyValue: (name: string) => tokens[name] ?? '',
        }),
      },
    },
  } as unknown as Element;
}

interface FakeDocOptions {
  body?: unknown;
  rangeThrows?: boolean;
  rangeBottom?: number;
  bodyTop?: number;
  bodyScrollHeight?: number;
  documentElement?: unknown;
}

function fakeDoc({
  body = {},
  rangeThrows = false,
  rangeBottom = 0,
  bodyTop = 0,
  bodyScrollHeight = 0,
  documentElement = { scrollHeight: 0 },
}: FakeDocOptions = {}): Document {
  const bodyNode =
    body === null
      ? null
      : {
          scrollHeight: bodyScrollHeight,
          getBoundingClientRect: () => ({ top: bodyTop }),
          ...(body as object),
        };
  return {
    body: bodyNode,
    documentElement,
    createRange: () => {
      if (rangeThrows) throw new Error('no Range in this document');
      return {
        selectNodeContents: () => undefined,
        getBoundingClientRect: () => ({ bottom: rangeBottom }),
      };
    },
  } as unknown as Document;
}

describe('readFrameTheme', () => {
  // Regression: the frame is a separate document and inherits nothing, so a
  // host that has not loaded the stylesheet leaves every token empty. Falling
  // back to CSS SYSTEM colours (not literals) is what keeps an unthemed frame
  // readable in dark mode.
  it('falls back wholesale when there is nothing to read from', () => {
    expect(readFrameTheme(null)).toBe(FALLBACK_FRAME_THEME);
    expect(readFrameTheme(undefined)).toBe(FALLBACK_FRAME_THEME);
    expect(readFrameTheme({} as Element)).toBe(FALLBACK_FRAME_THEME);
  });

  it('copies the host’s own tokens in', () => {
    const theme = readFrameTheme(
      elementWithTokens({
        '--sec-ink': ' #101010 ',
        '--sec-muted': '#808080',
        '--sec-border': '#dddddd',
        '--sec-brand': '#0057b7',
        '--sec-font': 'Inter, sans-serif',
        '--sec-fs-body': '13px',
        '--sec-lh-body': '1.5',
      }),
    );
    expect(theme).toEqual({
      ink: '#101010',
      muted: '#808080',
      border: '#dddddd',
      link: '#0057b7',
      font: 'Inter, sans-serif',
      fontSize: '13px',
      lineHeight: '1.5',
    });
  });

  // Regression: a host that overrides only some tokens must keep the fallback
  // for the rest, not get an empty string in an `hsl()`-shaped hole.
  it('keeps the fallback for each token the host does not define', () => {
    const theme = readFrameTheme(elementWithTokens({ '--sec-ink': '#101010' }));
    expect(theme.ink).toBe('#101010');
    expect(theme.muted).toBe(FALLBACK_FRAME_THEME.muted);
    expect(theme.font).toBe(FALLBACK_FRAME_THEME.font);
  });
});

describe('buildFrameCss', () => {
  const theme: FrameTheme = {
    ink: '#101010',
    muted: '#808080',
    border: '#dddddd',
    link: '#0057b7',
    font: 'Inter',
    fontSize: '13px',
    lineHeight: '1.5',
  };

  it('writes every slot of the theme into the stylesheet', () => {
    const css = buildFrameCss(theme);
    for (const value of Object.values(theme)) expect(css).toContain(value);
  });

  // Regression: these are DEFAULTS the sender's own CSS must be able to
  // override. One `!important` here and a designed newsletter renders in the
  // app's font instead of its own — the frame stops being a faithful rendering
  // of the mail and becomes an opinion about it.
  it('never uses !important', () => {
    expect(buildFrameCss(theme)).not.toContain('!important');
  });

  // Regression: the frame is `scrolling="no"`, so anything wider than it is not
  // scrolled but CUT OFF — a data table with fixed-width cells loses its right
  // half with nothing on screen to say so. `max-width` alone cannot fix that:
  // a table's min-content width is the sum of its cells' widths and wins.
  // These three declarations together are what give it a scrollbar of its own.
  it('lets a wide table scroll inside itself instead of being clipped', () => {
    const rule = buildFrameCss(theme).match(/table\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('overflow-x:auto');
    expect(rule).toContain('display:block');
    expect(rule).toContain('max-width:100%');
  });

  // Regression: `display:block` costs a table its shrink-to-fit — a two-cell
  // table would stretch across the whole bubble. `width:max-content` gives it
  // back, with `max-width` still capping it at the bubble's edge.
  it('keeps a narrow table shrink-wrapped to its content', () => {
    expect(buildFrameCss(theme)).toContain('width:max-content');
  });
});

describe('buildFrameDocument', () => {
  it('locks everything down by default', () => {
    const doc = buildFrameDocument({ html: '<p>hi</p>' });
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('<p>hi</p>');
    // The default theme is the fallback one.
    expect(doc).toContain(FALLBACK_FRAME_THEME.ink);
  });

  // Regression: THE tracking-pixel protection. It is a CSP policy, not a
  // rewriting pass over `src` attributes — so `img-src` must not list a network
  // scheme while images are blocked, and `cid:`/`data:` must stay, or a
  // signature logo disappears along with the beacon.
  it('permits only local image sources while images are blocked', () => {
    const doc = buildFrameDocument({ html: '', blockRemoteImages: true });
    expect(doc).toContain('img-src data: cid:;');
    expect(doc).toContain('media-src data: cid:;');
    expect(doc).not.toContain('https:');
  });

  it('adds the network schemes once the reader has asked for images', () => {
    const doc = buildFrameDocument({ html: '', blockRemoteImages: false });
    expect(doc).toContain('img-src data: cid: https: http:');
  });

  it('takes a theme when one is supplied', () => {
    const doc = buildFrameDocument({
      html: '',
      theme: { ...FALLBACK_FRAME_THEME, ink: 'rebeccapurple' },
    });
    expect(doc).toContain('rebeccapurple');
  });
});

describe('estimateFrameHeight', () => {
  // Regression: the estimate only exists to keep the thread from lurching when
  // the real measurement lands. A zero would collapse the bubble; an unbounded
  // one would reserve a screenful of blank space per newsletter.
  it('stays between its floor and its ceiling', () => {
    expect(estimateFrameHeight('')).toBe(40);
    expect(estimateFrameHeight(undefined as unknown as string)).toBe(40);
    expect(estimateFrameHeight('<p>hi</p>')).toBe(40);
    expect(estimateFrameHeight('x'.repeat(100_000))).toBe(480);
  });

  it('scales with the size of the markup in between', () => {
    expect(estimateFrameHeight('x'.repeat(900))).toBe(200);
  });
});

describe('measureFrameHeight', () => {
  it('measures nothing when there is no document or no body', () => {
    expect(measureFrameHeight(null)).toBe(0);
    expect(measureFrameHeight(undefined)).toBe(0);
    expect(measureFrameHeight(fakeDoc({ body: null }))).toBe(0);
  });

  // Regression: the frame is sized to this number and its own scrollbar is off,
  // so under-measuring CLIPS the message. Hence the maximum of every source,
  // never the minimum.
  it('takes the largest of the range and the scroll heights', () => {
    expect(
      measureFrameHeight(
        fakeDoc({
          rangeBottom: 120,
          bodyTop: 20,
          bodyScrollHeight: 60,
          documentElement: { scrollHeight: 80 },
        }),
      ),
    ).toBe(100);
    expect(
      measureFrameHeight(
        fakeDoc({
          rangeBottom: 60,
          bodyTop: 20,
          bodyScrollHeight: 300,
          documentElement: { scrollHeight: 80 },
        }),
      ),
    ).toBe(300);
    expect(
      measureFrameHeight(
        fakeDoc({
          rangeBottom: 60,
          bodyTop: 20,
          bodyScrollHeight: 30,
          documentElement: { scrollHeight: 400 },
        }),
      ),
    ).toBe(400);
  });

  // Regression: a document that refuses a Range must still be measured. The
  // scroll heights alone are enough — they just include the trailing margin.
  it('falls back to the scroll heights when there is no Range support', () => {
    expect(measureFrameHeight(fakeDoc({ rangeThrows: true, bodyScrollHeight: 210 }))).toBe(210);
  });

  it('ignores a missing or non-finite scroll height', () => {
    expect(
      measureFrameHeight(
        fakeDoc({ rangeBottom: 50, bodyScrollHeight: Number.NaN, documentElement: null }),
      ),
    ).toBe(50);
  });
});

describe('clickedHref', () => {
  function anchor(href: string | null): unknown {
    return {
      closest: () => (href === null ? null : { getAttribute: () => href }),
    };
  }

  // Regression: the click almost always lands on something INSIDE the link —
  // the text's element, an image, a span the sender wrapped it in — so this has
  // to walk up rather than read the target itself.
  it('finds the anchor a click landed inside', () => {
    expect(clickedHref(anchor('https://x.example/a'))).toBe('https://x.example/a');
    expect(clickedHref(anchor('  mailto:alice@acme.example '))).toBe('mailto:alice@acme.example');
    expect(clickedHref(anchor('HTTP://x.example/a'))).toBe('HTTP://x.example/a');
  });

  // Regression: `javascript:` handed to the host's link opener is a code
  // execution path with the sender's payload in it.
  it('refuses any scheme that is not a link', () => {
    expect(clickedHref(anchor('javascript:alert(1)'))).toBeNull();
    expect(clickedHref(anchor('data:text/html,<script>'))).toBeNull();
    expect(clickedHref(anchor('file:///etc/passwd'))).toBeNull();
    expect(clickedHref(anchor('/relative/path'))).toBeNull();
  });

  it('finds nothing when there is nothing to find', () => {
    expect(clickedHref(null)).toBeNull();
    expect(clickedHref(undefined)).toBeNull();
    expect(clickedHref({})).toBeNull();
    expect(clickedHref(anchor(null))).toBeNull();
    expect(clickedHref(anchor('   '))).toBeNull();
  });

  it('finds nothing on an anchor with no href at all', () => {
    expect(clickedHref({ closest: () => ({ getAttribute: () => null }) })).toBeNull();
  });
});
