/**
 * Finding the line where one quoted message ends and the next begins.
 *
 * Every regression here has the same two shapes. Detect too little and a nine
 * message thread renders as one enormous bubble; detect too much and a boundary
 * swallows the message it introduces, so a bubble comes back empty or a
 * paragraph is cut in half. Both are silent — nothing throws, the mail is just
 * wrong — which is why the collectors are tested directly and not only through
 * {@link splitMailBody}.
 */
import { describe, expect, it } from 'vitest';

import {
  collectAttributionLine,
  collectInlineLine,
  findBoundaries,
  firstNonBlankChild,
  lineStartNodes,
} from '../../src/thread/boundaries.js';
import { parseBody } from '../helpers/parser.js';

/** The line text a collector gathered, whitespace-collapsed the way the detector sees it. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

describe('firstNonBlankChild', () => {
  // Regression: pretty-printed mail puts a newline between the tag and its
  // first line of text. Starting the walk on that blank node reads an empty
  // line and the attribution below it is never examined.
  it('skips blank text to reach the first real node', () => {
    const body = parseBody('<div>\n   <span>Alice</span></div>');
    const first = firstNonBlankChild(body.querySelector('div')!);

    expect(first?.nodeName).toBe('SPAN');
  });

  // Regression: a LEADING `<br>` is an empty line, not nothing. Skipping it —
  // which `meaningfulChildren` would — moves the start of the block's first
  // visual line past the break, and the line after it is collected as if it
  // began the block.
  it('returns a leading <br> rather than skipping it', () => {
    const body = parseBody('<div><br>On Mon, Alice wrote:</div>');

    expect(firstNonBlankChild(body.querySelector('div')!)?.nodeName).toBe('BR');
  });

  it('returns null for a block holding nothing but whitespace', () => {
    const body = parseBody('<div>   </div>');

    expect(firstNonBlankChild(body.querySelector('div')!)).toBeNull();
  });
});

describe('collectInlineLine', () => {
  // Regression: a `<br>` terminates the line AND is consumed with it. If the
  // collector ran past it the attribution would absorb the quoted reply below,
  // and that reply would then be missing from the thread entirely.
  it('stops at the first <br> and reports it as the terminator', () => {
    const body = parseBody('<div>On Mon, Alice wrote:<br>Quoted reply.</div>');
    const line = collectInlineLine(firstNonBlankChild(body.querySelector('div')!)!);

    expect(collapse(line.text)).toBe('On Mon, Alice wrote:');
    expect(line.terminator?.nodeName).toBe('BR');
  });

  // Regression: a block element starts a line of its own. Without this stop the
  // "line" runs to the end of the body — over the 2000-character cap on a real
  // thread, so the boundary is silently discarded and nothing splits.
  it('stops before a block sibling, with no terminator', () => {
    const body = parseBody('<div>On Mon, Alice wrote:<p>Quoted reply.</p></div>');
    const line = collectInlineLine(firstNonBlankChild(body.querySelector('div')!)!);

    expect(collapse(line.text)).toBe('On Mon, Alice wrote:');
    expect(line.terminator).toBeNull();
  });

  // Regression: the start node is never treated as a block boundary — it is
  // where the line begins. Breaking on it returns an empty line, so a `<div>`
  // whose own first child is the attribution never yields a boundary.
  it('does not stop on the start node even when it is a block', () => {
    const body = parseBody('<div><div>On Mon, Alice wrote:</div></div>');
    const line = collectInlineLine(body.querySelector('div > div')!);

    expect(collapse(line.text)).toBe('On Mon, Alice wrote:');
  });

  // Regression: `Node.textContent` is nullable — a document or doctype node
  // answers null. Without the guard the line gains a literal "null", which the
  // attribution parser then reads as part of the sender's name.
  it('contributes nothing for a node whose textContent is null', () => {
    const nullish = {
      nodeName: '#document',
      textContent: null,
      nextSibling: null,
    } as unknown as Node;

    expect(collectInlineLine(nullish).text).toBe('');
  });
});

describe('collectAttributionLine', () => {
  // Regression: an Outlook header is four `<br>`-separated label lines. Consume
  // only the first and "Sent: … To: … Subject: …" renders as a bubble of its own
  // between two real messages.
  it('folds a multi-line Outlook header block into one line', () => {
    const body = parseBody(
      '<p>From: Alice &lt;alice@example.com&gt;<br>Sent: Monday, 1 September 2026 10:04' +
        '<br>To: Bob<br>Subject: Review</p>',
    );
    const line = collectAttributionLine(firstNonBlankChild(body.querySelector('p')!)!);

    expect(collapse(line.text)).toBe(
      'From: Alice <alice@example.com> Sent: Monday, 1 September 2026 10:04 To: Bob Subject: Review',
    );
  });

  // Regression: the fold must STOP at the first line that is not a label, or
  // the boundary eats the quoted message's opening paragraph.
  it('stops folding at the first non-label line', () => {
    const body = parseBody(
      '<p>From: Alice<br>Sent: Monday, 1 September 2026<br>Can we move the review?</p>',
    );
    const line = collectAttributionLine(firstNonBlankChild(body.querySelector('p')!)!);

    expect(collapse(line.text)).toBe('From: Alice Sent: Monday, 1 September 2026');
    expect(line.text).not.toContain('move the review');
  });

  // Regression: a block element ends the header block — whatever follows it is
  // content. Folding across it would swallow the quoted body.
  it('stops folding at a block element', () => {
    const body = parseBody(
      '<div>From: Alice<br>Sent: Monday, 1 September 2026<br><div>Quoted reply.</div></div>',
    );
    const line = collectAttributionLine(firstNonBlankChild(body.querySelector('div')!)!);

    expect(collapse(line.text)).toBe('From: Alice Sent: Monday, 1 September 2026');
  });

  // Regression: a header block ending in a trailing `<br>` has nothing after it
  // to examine. Reading past the end here throws on a real Outlook forward.
  it('stops folding when the block ends after the last <br>', () => {
    const body = parseBody('<p>From: Alice<br>Sent: Monday, 1 September 2026<br></p>');
    const line = collectAttributionLine(firstNonBlankChild(body.querySelector('p')!)!);

    expect(collapse(line.text)).toBe('From: Alice Sent: Monday, 1 September 2026');
  });

  // Regression: clients indent continuation lines, so the node right after a
  // `<br>` is frequently blank text. Treating that as the next line ends the
  // fold one line early and the rest of the header becomes its own bubble.
  it('skips blank text between the <br> and the next label line', () => {
    const body = parseBody('<p>From: Alice<br>  <span>Sent: Monday, 1 September 2026</span></p>');
    const line = collectAttributionLine(firstNonBlankChild(body.querySelector('p')!)!);

    expect(collapse(line.text)).toBe('From: Alice Sent: Monday, 1 September 2026');
  });

  // Regression: an "On … wrote:" attribution is ONE line. Folding it the way a
  // label block is folded would consume the first line of the quoted message.
  it('leaves an "On … wrote:" line unfolded', () => {
    const body = parseBody('<div>On Mon, Alice wrote:<br>Quoted reply.<br>More reply.</div>');
    const line = collectAttributionLine(firstNonBlankChild(body.querySelector('div')!)!);

    expect(collapse(line.text)).toBe('On Mon, Alice wrote:');
  });
});

describe('lineStartNodes', () => {
  // Regression: the node after a `<br>` is very often also a container's first
  // child. Emitting it twice yields two boundaries for one attribution, and the
  // second one produces an empty bubble.
  it('reports each start position once', () => {
    const body = parseBody('<div><span>One</span><br><span>Two</span></div>');
    const starts = lineStartNodes(body);

    expect(new Set(starts).size).toBe(starts.length);
  });

  // Regression: a block child does not start a line INSIDE its parent, it opens
  // its own. Emitting it here collects the parent's whole text as one line,
  // which then exceeds the length cap and detects nothing.
  it('skips a container whose first child is a block', () => {
    const body = parseBody('<div><p>One</p></div>');
    const starts = lineStartNodes(body);

    expect(starts.map((node) => node.textContent)).toEqual(['One']);
  });
});

describe('findBoundaries', () => {
  // Regression: THE thread-collapse bug. A whole two-reply Gmail quote
  // container is under the size cap and its text opens with "On Mon … wrote:"
  // exactly like the attribution nested inside it. Taken as a boundary it
  // consumes both quoted messages and the thread renders as a single bubble, so
  // only the INNERMOST match may be the attribution.
  it('takes the innermost element when attributions nest', () => {
    const body = parseBody(
      '<div dir="ltr">Yes.</div>' +
        '<div class="gmail_quote"><div class="gmail_attr">On Mon, 1 Sep 2026, Alice ' +
        '&lt;alice@example.com&gt; wrote:</div><blockquote class="gmail_quote"><div>Older.</div>' +
        '</blockquote></div>',
    );
    const boundaries = findBoundaries(body);

    expect(boundaries).toHaveLength(1);
    expect((boundaries[0]!.endBefore as Element).className).toBe('gmail_attr');
  });

  // Regression: the class marker alone is not evidence. Clients reuse these
  // wrappers for one-word labels, and cutting on one splits a message in two.
  it('ignores a marked element too short to be an attribution', () => {
    const body = parseBody('<div>Reply text.</div><div class="gmail_attr">On x</div>');

    expect(findBoundaries(body)).toEqual([]);
  });

  // Regression: same wrapper, enough text, but it does not even OPEN like an
  // attribution — a mobile footer Gmail marked up with the attribution class.
  it('ignores a marked element that does not open like an attribution', () => {
    const body = parseBody(
      '<div>Reply text.</div><div class="gmail_attr">Sent from my iPhone, please excuse typos</div>',
    );

    expect(findBoundaries(body)).toEqual([]);
  });

  // Regression: boundaries must come back in document order, and half of them
  // are text nodes — the case linkedom's `compareDocumentPosition` answers
  // wrong. Out of order, the segments are sliced against the wrong neighbours
  // and bubbles get someone else's text.
  it('returns boundaries in document order', () => {
    const body = parseBody(
      '<div>Latest.<br>On Tue, 2 Sep 2026, Bob &lt;bob@example.com&gt; wrote:<br>Middle.' +
        '<br>On Mon, 1 Sep 2026, Alice &lt;alice@example.com&gt; wrote:<br>Oldest.</div>',
    );
    const boundaries = findBoundaries(body);

    expect(boundaries.map((boundary) => boundary.attribution?.email)).toEqual([
      'bob@example.com',
      'alice@example.com',
    ]);
  });

  // Regression: a body with no quoting at all must yield nothing, so the caller
  // renders it as one message instead of running the structural passes that
  // turn a designed email into a wireframe.
  it('finds nothing in a body with no attribution', () => {
    expect(findBoundaries(parseBody('<div><p>Just a note about Monday.</p></div>'))).toEqual([]);
  });
});
