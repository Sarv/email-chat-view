import { describe, expect, it } from 'vitest';

import type { DomRule, LineRule } from '../../src/rules/types.js';
import {
  ATTRIBUTION_LINE_SELECTORS,
  cleanFragment,
  drawsLeftBorder,
  removeAttributionLines,
  removeEmptyBlocks,
  unwrapElement,
  unwrapIndentBars,
  unwrapQuoteWrappers,
} from '../../src/transform/fragment.js';

import { parseBody, squash } from '../helpers/parser.js';

describe('drawsLeftBorder', () => {
  it('reports no border for an element with no style attribute', () => {
    expect(drawsLeftBorder(null)).toBe(false);
  });

  // Regression: `border-left` in the style attribute is not evidence of an
  // indent bar. Table cells RESET it constantly, and unwrapping those flattens
  // a table for nothing.
  it.each([
    ['border-left: none', 'none'],
    ['border-left:0', 'zero'],
    ['padding:4px;border-left : NONE;color:red', 'none among other declarations'],
  ])('reports no border for %s', (style) => {
    expect(drawsLeftBorder(style)).toBe(false);
  });

  it('reports a border for a bar that is actually drawn', () => {
    expect(drawsLeftBorder('border-left: 3px solid #ccc; padding-left: 8px')).toBe(true);
  });
});

describe('unwrapElement', () => {
  it('replaces an element with its own children', () => {
    const body = parseBody('<div><span>keep</span><b>this</b></div>');
    const wrapper = body.querySelector('div')!;

    expect(unwrapElement(wrapper)).toBe(true);
    expect(squash(body.innerHTML)).toBe('<span>keep</span><b>this</b>');
  });

  // Regression: nested wrappers are the normal case, so "already detached" is
  // an ordinary answer rather than an error — and a caller counting what it
  // changed must not count the same node twice.
  it('reports false for an element that is already detached', () => {
    const body = parseBody('<div>gone</div>');
    const wrapper = body.querySelector('div')!;
    wrapper.remove();

    expect(unwrapElement(wrapper)).toBe(false);
  });
});

describe('unwrapQuoteWrappers', () => {
  // Regression: the whole point of the fragment cleaner. After a split the
  // contents of the quote ARE the segment, so removing the wrapper the way the
  // reply cleaner does would delete the message.
  it('peels nested wrappers and keeps every word', () => {
    const body = parseBody(
      '<div class="gmail_quote"><blockquote>the message<blockquote>and its own quote</blockquote></blockquote></div>',
    );

    expect(unwrapQuoteWrappers(body)).toBe(3);
    expect(squash(body.innerHTML)).toBe('the messageand its own quote');
  });

  it('reports zero when the fragment holds no wrapper', () => {
    const body = parseBody('<div>plain reply</div>');

    expect(unwrapQuoteWrappers(body)).toBe(0);
    expect(squash(body.innerHTML)).toBe('<div>plain reply</div>');
  });
});

describe('unwrapIndentBars', () => {
  it('peels a drawn bar and leaves a reset one alone', () => {
    const body = parseBody(
      '<div style="border-left:3px solid #ccc">quoted</div>' +
        '<td style="border-left:none">a cell</td>',
    );

    expect(unwrapIndentBars(body)).toBe(1);
    expect(squash(body.innerHTML)).toBe('quoted<td style="border-left:none">a cell</td>');
  });
});

describe('removeAttributionLines', () => {
  // The splitter consumed this line as the boundary and turned it into the
  // bubble's sender and timestamp; left in place it renders twice.
  it.each(ATTRIBUTION_LINE_SELECTORS)('removes a %s line', (selector) => {
    const className = selector.slice(1);
    const body = parseBody(
      `<div class="${className}">On Mon, Alice wrote:</div><div>her words</div>`,
    );

    expect(removeAttributionLines(body)).toBe(1);
    expect(squash(body.innerHTML)).toBe('<div>her words</div>');
  });

  // Regression: Outlook nests Gmail's marker inside its own header block on a
  // round-tripped thread. The inner one goes with the outer, and counting it
  // again would report a removal that never happened.
  it('counts a nested line taken with its container only once', () => {
    const body = parseBody(
      '<div class="OutlookMessageHeader"><div class="gmail_attr">On Mon, Alice wrote:</div></div><p>her words</p>',
    );

    expect(removeAttributionLines(body)).toBe(1);
    expect(squash(body.innerHTML)).toBe('<p>her words</p>');
  });

  it('reports zero when the fragment has no attribution line', () => {
    const body = parseBody('<p>her words</p>');

    expect(removeAttributionLines(body)).toBe(0);
  });
});

describe('removeEmptyBlocks', () => {
  // `<p><br></p>` is what Outlook emits for the Enter key. Rendered in a bubble
  // that draws a border, a stack of them is visible dead space.
  it('drops internal blank blocks and keeps the words around them', () => {
    const body = parseBody('<p>first</p><p><br></p><div>&nbsp;</div><p>second</p>');

    expect(removeEmptyBlocks(body)).toBe(2);
    expect(squash(body.innerHTML)).toBe('<p>first</p><p>second</p>');
  });

  it('counts a blank block taken with its blank container only once', () => {
    const body = parseBody('<div><div><br></div></div><p>words</p>');

    expect(removeEmptyBlocks(body)).toBe(1);
    expect(squash(body.innerHTML)).toBe('<p>words</p>');
  });

  // Regression: a block with no text is not necessarily empty. An image-only
  // cell is the whole content of plenty of messages.
  it('keeps a block whose content is visible without text', () => {
    const body = parseBody('<div><img src="cid:logo"></div>');

    expect(removeEmptyBlocks(body)).toBe(0);
    expect(squash(body.innerHTML)).toBe('<div><img src="cid:logo"></div>');
  });
});

describe('cleanFragment', () => {
  /** Clean a fragment and report what came back. */
  function clean(html: string, options?: Parameters<typeof cleanFragment>[1]) {
    const body = parseBody(html);
    const result = cleanFragment(body, options);
    return { html: squash(result.html), applied: result.applied };
  }

  it('unwraps the quote, drops the attribution and reports both', () => {
    const { html, applied } = clean(
      '<div class="gmail_attr">On Mon, Alice wrote:</div>' +
        '<blockquote><div style="border-left:2px solid #ccc">Are we still on for Tuesday?</div></blockquote>',
    );

    expect(html).toBe('Are we still on for Tuesday?');
    expect(applied).toEqual(['remove:attribution', 'unwrap:quote-wrapper', 'unwrap:indent-bar']);
  });

  // A fragment that needs nothing done to it must say so. An `applied` list
  // that names passes which changed nothing is what makes "why did my content
  // vanish?" unanswerable.
  it('reports nothing applied for a fragment that is already clean', () => {
    const { html, applied } = clean('<p>Room is booked, see you at ten.</p>');

    expect(html).toBe('<p>Room is booked, see you at ten.</p>');
    expect(applied).toEqual([]);
  });

  it('runs the shipped signature, banner and line rules', () => {
    const { html, applied } = clean(
      '<div>Proposal attached, happy to walk through it.</div>' +
        '<div>---- Original Message ----</div>' +
        '<div>External Email: use caution, this came from outside the organisation.</div>' +
        '<div class="gmail_signature">--<br>Carol Nayar | Vendor Ltd</div>',
    );

    expect(html).toBe('<div>Proposal attached, happy to walk through it.</div>');
    // `remove:empty-block` is the line rule's own leftover: cutting the marker
    // TEXT node cannot remove the `<div>` that held it, so the blank-block pass
    // in the same run is what clears it. Two entries, one cause.
    expect(applied).toEqual([
      'signature:gmail',
      'banner:warning-banner-box',
      'line:forward-marker',
      'remove:empty-block',
    ]);
  });

  it('cuts a hand-typed sign-off', () => {
    const { html, applied } = clean(
      '<div>Room is booked for ten and the agenda is attached.</div><div>Thanks</div><div>Ankur</div>',
    );

    expect(html).toBe('<div>Room is booked for ten and the agenda is attached.</div>');
    // Same leftover as the line rules: the cut takes the anchor text and
    // everything after it, and the emptied wrappers go with the blank-block pass.
    expect(applied).toEqual(['sign-off', 'remove:empty-block']);
  });

  it('keeps the sign-off when asked to', () => {
    const { html, applied } = clean(
      '<div>Room is booked for ten and the agenda is attached.</div><div>Thanks</div><div>Ankur</div>',
      { keepSignOff: true },
    );

    expect(html).toContain('Thanks');
    expect(applied).toEqual([]);
  });

  // `keepStructure` is for a body that was never split: the whole body is the
  // one message, so there is no boundary to clean around and the structural
  // passes can only do harm — a designed notification whose content sits in an
  // inline-styled blockquote comes out unwrapped and truncated.
  it('leaves structure alone under keepStructure', () => {
    const source =
      '<div class="gmail_attr">On Mon, Alice wrote:</div>' +
      '<blockquote style="border-left:2px solid #ccc"><p>the designed content</p><p><br></p></blockquote>';
    const { html, applied } = clean(source, { keepStructure: true });

    expect(html).toBe(
      '<div class="gmail_attr">On Mon, Alice wrote:</div>' +
        '<blockquote style="border-left:2px solid #ccc"><p>the designed content</p></blockquote>',
    );
    expect(applied).toEqual([]);
  });

  it('drops the blank blocks a sender stacked between lines', () => {
    const { html, applied } = clean('<p>first</p><p><br></p><p>second</p>');

    expect(html).toBe('<p>first</p><p>second</p>');
    expect(applied).toEqual(['remove:empty-block']);
  });

  // The rule sets are the contribution contract: a consumer composes their own
  // array, and passing an empty one is how a caller turns a family off.
  it('honours injected rule sets', () => {
    const signature: DomRule = {
      name: 'acme',
      provider: 'Acme',
      selectors: ['.acme-sig'],
    };
    const banner: DomRule = {
      name: 'acme-warning',
      provider: 'Acme',
      selectors: ['.acme-banner'],
    };
    const line: LineRule = {
      name: 'acme-footer',
      provider: 'Acme',
      pattern: /^internal use only$/i,
      maxLineLength: 60,
      action: 'line',
    };

    const { html, applied } = clean(
      '<div>the words</div>' +
        '<div class="acme-sig">Alice, Acme</div>' +
        '<div class="acme-banner">Careful now</div>' +
        '<div>Internal use only</div>' +
        '<div class="gmail_signature">--<br>not this one</div>',
      { signatureRules: [signature], bannerRules: [banner], lineRules: [line] },
    );

    expect(html).toBe('<div>the words</div><div class="gmail_signature">--<br>not this one</div>');
    expect(applied).toEqual([
      'signature:acme',
      'banner:acme-warning',
      'line:acme-footer',
      'remove:empty-block',
    ]);
  });

  // A fragment that cleans away to nothing is the caller's decision to make —
  // a splitter drops the segment, a single-body caller falls back to the
  // original — so this returns the empty string rather than guarding.
  it('returns the empty string when nothing survives', () => {
    const { html } = clean('<div class="gmail_attr">On Mon, Alice wrote:</div>');

    expect(html).toBe('');
  });
});
