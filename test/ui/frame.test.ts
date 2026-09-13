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
import { WIDE_TABLE_CSS } from '../../src/ui/wide-tables.js';

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
        '--sec-frame-wash': 'rgba(255, 255, 255, 0.62)',
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
      wash: 'rgba(255, 255, 255, 0.62)',
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
    wash: 'rgba(255, 255, 255, 0.62)',
  };

  it('writes every slot of the theme into the stylesheet', () => {
    const css = buildFrameCss(theme);
    for (const value of Object.values(theme)) expect(css).toContain(value);
  });

  // CHANGED BEHAVIOUR (was: 'never uses !important', then the cell wash alone).
  // Both exceptions exist for the same reason: what they override is an INLINE
  // style on the sender's own element — `style="background-color:…"` on a cell,
  // `style="width:578pt"` on a table and `white-space:nowrap` on its cells —
  // which a normal author declaration cannot outrank. Both are also opt-in:
  // the wash only reaches a cell that declares a colour, and the reflow only a
  // table `fitWideTables` has measured and found too wide.
  //
  // Regression: everything else is a DEFAULT the sender's own CSS must be able
  // to override. One more `!important` and a designed newsletter renders in the
  // app's font instead of its own — the frame stops being a faithful rendering
  // of the mail and becomes an opinion about it.
  it('keeps !important to the cell wash and the wide-table reflow', () => {
    const css = buildFrameCss(theme);
    // Every rule whose selector list starts at a washed cell — the background
    // on the cell itself, and the ink carried into its children.
    const withoutWash = css.replace(/td\[bgcolor\][^}]*\{[^}]*\}/g, '');
    // ...and the reflow rules, which are the whole of WIDE_TABLE_CSS.
    const bare = withoutWash.split(WIDE_TABLE_CSS).join('');
    expect(bare).not.toContain('!important');
    expect(bare).not.toBe(withoutWash);
    expect(withoutWash).not.toBe(css);
  });

  // CHANGED BEHAVIOUR (was: a blanket `table{display:block;…;overflow-x:auto}`
  // making EVERY table its own scroll container). That rescued a wide table,
  // but designed mail is built out of table shells, and restructuring all of
  // them to reach the few that overflow takes apart layouts that were fine.
  //
  // Regression: the measured pass (`fitWideTables`) reaches the same tables and
  // leaves the rest exactly as the sender authored them. Put a blanket rule
  // back and a bare `table` selector is restyling every message again.
  it('restructures no table the measurement has not picked out', () => {
    const css = buildFrameCss(theme);
    expect(css).toContain(WIDE_TABLE_CSS);
    // Every table rule is scoped to one of the two classes.
    expect(css).not.toMatch(/[;{]table\{/);
  });

  // Regression: the bubble now carries the sender's identity colour and the
  // frame is transparent, so a header row the sender painted cyan lands as a
  // saturated block on top of that tint — two colours arguing inside one
  // bubble, with white-on-cyan header text that stops being readable the moment
  // the reader's theme is not the one the sender assumed. The wash has to be a
  // `background-image` GRADIENT, because that paints over the sender's colour
  // instead of replacing it — which is what leaves their hue showing through.
  // Swap it for `background-color` and the colour is not softened, it is gone.
  it('softens a sender cell colour instead of replacing it', () => {
    const css = buildFrameCss(theme);
    expect(css).toContain(`background-image:linear-gradient(${theme.wash},${theme.wash})!important`);
    // Only cells that actually declare a colour; a plain table is untouched.
    expect(css).toContain('td[bgcolor]');
    expect(css).toContain('td[style*="background"]');
    expect(css).toContain('tr[bgcolor]>td');
    // Text forced back to the theme's ink, or a white-on-dark header written
    // for the sender's palette turns invisible once the block is lightened.
    expect(css).toContain(`color:${theme.ink}!important`);
  });

  // Regression: Outlook wraps a cell's text in a `<div style="color:white">`,
  // so forcing the colour on the CELL alone leaves that div white — a header
  // the sender wrote as white-on-navy came out white on pale grey once the
  // navy was softened, i.e. the dimming made it LESS readable than before.
  it('carries the ink override into a cell’s children', () => {
    const css = buildFrameCss(theme);
    expect(css).toContain(`td[bgcolor] *`);
    expect(css).toContain(`tr[bgcolor]>th *`);
  });

  // Regression: the wash keys off a DECLARED colour, never off a cell's place in
  // the table. Scope it to `thead`/`th` — the tempting reading, since headers
  // are where senders put the strong colours — and a mail that colour-codes its
  // BODY rows (a status column, alternating bands) keeps every one of them at
  // full saturation inside a tinted bubble, which is the exact problem the wash
  // was added for. Header and body cell must be washed by the same rule.
  it('softens a coloured body row exactly like a header row', () => {
    const css = buildFrameCss(theme);
    for (const cell of ['td[bgcolor]', 'th[bgcolor]', 'td[style*="background"]', 'th[style*="background"]']) {
      expect(css).toContain(cell);
    }
    // Nothing anchors the rule to a header section.
    expect(css).not.toContain('thead');
  });

  // Regression: a cell with no declared background must be rendered exactly as
  // the sender wrote it. A bare `td` in either selector list and every table in
  // every message gets the app's ink forced onto it.
  it('leaves a cell that declares no colour completely alone', () => {
    const css = buildFrameCss(theme);
    expect(css).not.toMatch(/[,{]td\{/);
    expect(css).not.toMatch(/[,{]td \*/);
  });

  // CHANGED BEHAVIOUR: these three declarations used to sit on a bare `table`
  // selector and applied to every table in the message. They now apply only to
  // a table `fitWideTables` has measured as too wide to wrap — see the sibling
  // test above for why the blanket version had to go.
  //
  // Regression: the protection itself is unchanged and still belongs here. The
  // frame is `scrolling="no"`, so anything wider than it is not scrolled but
  // CUT OFF — a data table with fixed-width cells loses its right half with
  // nothing on screen to say so. `max-width` alone cannot fix that: a table's
  // min-content width is the sum of its cells' widths and wins. These three
  // together are what give it a scrollbar of its own, and the frame has to ship
  // them or step two of the fit has no styling to switch on.
  it('lets a wide table scroll inside itself instead of being clipped', () => {
    const rule = buildFrameCss(theme).match(/\.sec-table-scroll\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('overflow-x:auto');
    expect(rule).toContain('display:block');
    expect(rule).toContain('max-width:100%');
  });

  // Regression: the same clipping, for the other thing that arrives wider than
  // the bubble. `<pre>` does not wrap by definition, so a code block or a
  // fixed-width receipt is cut off at the frame's edge — and the frame has no
  // scrollbar of its own to reach the rest with.
  it('lets a wide pre block scroll inside itself instead of being clipped', () => {
    const rule = buildFrameCss(theme).match(/pre\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('overflow-x:auto');
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

  // Regression: THE trailing-blank-space bug. `documentElement.scrollHeight` is
  // never less than the viewport, and the viewport of a frame sized to its own
  // content is the height we set after the last measurement — so feeding it
  // back in made the measurement a ratchet that could grow but never shrink.
  // A real mail measured 838 for 328px of content: a bubble with five hundred
  // pixels of empty space under the last line, which no later pass could undo.
  it('ignores a scroll height that is only the viewport', () => {
    expect(
      measureFrameHeight(
        fakeDoc({
          rangeBottom: 328,
          bodyScrollHeight: 328,
          documentElement: { scrollHeight: 838, clientHeight: 838 },
        }),
      ),
    ).toBe(328);
  });

  // ...but the value still has something to say when content REALLY overflows
  // the viewport, which is the case it was there for: floated and
  // absolutely-positioned boxes that sit outside the Range's box. Drop it
  // unconditionally and a long message is clipped instead.
  it('keeps a scroll height that overflows the viewport', () => {
    expect(
      measureFrameHeight(
        fakeDoc({
          rangeBottom: 300,
          bodyScrollHeight: 300,
          documentElement: { scrollHeight: 2000, clientHeight: 838 },
        }),
      ),
    ).toBe(2000);
  });

  // Regression: a viewport we cannot read is not evidence that nothing
  // overflows. Under-measuring clips the message, so an unreadable
  // `clientHeight` keeps the scroll height rather than discarding it.
  it('keeps the scroll height when the viewport cannot be read', () => {
    expect(
      measureFrameHeight(fakeDoc({ rangeBottom: 40, documentElement: { scrollHeight: 400 } })),
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
