/**
 * Splitting one body into the messages quoted inside it.
 *
 * The regressions here are the two that make the whole feature worthless: a
 * thread that comes back as ONE bubble (boundaries missed) and a bubble that
 * comes back EMPTY (a boundary consumed the message it introduced). Every
 * fixture below is a real client's markup, because both failures are markup
 * shaped — they do not reproduce on hand-simplified HTML.
 */
import { describe, expect, it } from 'vitest';

import { minimalFragmentOptions, splitMailBody } from '../../src/thread/split-body.js';
import { bodylessParser, parser, squash, throwingParser } from '../helpers/parser.js';

/** Gmail: nested `.gmail_quote` blockquotes, attribution in its own `.gmail_attr`. */
const GMAIL_THREAD = `
<div dir="ltr">Yes, Tuesday works for me.</div>
<div class="gmail_quote">
  <div class="gmail_attr">On Mon, 1 Sep 2026 at 10:04, Alice &lt;alice@example.com&gt; wrote:</div>
  <blockquote class="gmail_quote" style="border-left:1px solid #ccc;padding-left:1ex">
    <div dir="ltr">Can we move the review to Tuesday?</div>
    <div class="gmail_quote">
      <div class="gmail_attr">On Sun, 31 Aug 2026 at 18:20, Bob &lt;bob@example.com&gt; wrote:</div>
      <blockquote class="gmail_quote" style="border-left:1px solid #ccc;padding-left:1ex">
        <div dir="ltr">Review is scheduled for Monday.</div>
      </blockquote>
    </div>
  </blockquote>
</div>`;

/** Outlook: a flat header block of `<br>`-separated labels, no blockquote at all. */
const OUTLOOK_THREAD = `
<div><p>Sounds good.</p></div>
<div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0in 0in 0in">
<p><b>From:</b> Alice &lt;alice@example.com&gt;<br><b>Sent:</b> Monday, 1 September 2026 10:04<br><b>To:</b> Bob<br><b>Subject:</b> Review</p>
</div>
<p>Can we move the review to Tuesday?</p>`;

describe('splitMailBody', () => {
  // Nested Gmail quoting is the most common thread shape there is. If the
  // boundaries are missed the whole conversation renders as one bubble.
  it('splits a nested Gmail thread into one segment per message', () => {
    const segments = splitMailBody(GMAIL_THREAD, { parser });

    expect(segments).toHaveLength(3);
    expect(segments[0]?.attribution).toBeNull();
    expect(squash(segments[0]!.html)).toBe('<div dir="ltr">Yes, Tuesday works for me.</div>');
    expect(segments[1]?.attribution?.email).toBe('alice@example.com');
    expect(squash(segments[1]!.html)).toBe(
      '<div dir="ltr">Can we move the review to Tuesday?</div>',
    );
    expect(segments[2]?.attribution?.email).toBe('bob@example.com');
    expect(squash(segments[2]!.html)).toBe('<div dir="ltr">Review is scheduled for Monday.</div>');
  });

  // An Outlook header spans four `<br>`-separated label lines. Consuming only
  // the first leaves "Sent: … To: … Subject: …" rendering as its own bubble.
  it('consumes a whole Outlook header block as one boundary', () => {
    const segments = splitMailBody(OUTLOOK_THREAD, { parser });

    expect(segments).toHaveLength(2);
    expect(squash(segments[0]!.html)).toBe('<div><p>Sounds good.</p></div>');
    expect(segments[1]?.attribution?.email).toBe('alice@example.com');
    expect(squash(segments[1]!.html)).toBe('<p>Can we move the review to Tuesday?</p>');
    expect(segments[1]!.html).not.toContain('Subject:');
  });

  // The shape no element-level model can express: the attribution is a bare run
  // of text between two `<br>`s, sharing a div with the reply above and below.
  it('splits on an inline attribution line inside a shared block', () => {
    const segments = splitMailBody(
      '<div>Pankaj Kumar<br>On 27 Apr 2026 at 11:38, Ruby &lt;ruby@example.com&gt; wrote:' +
        '<br>Sure, sending it now.</div>',
      { parser },
    );

    expect(segments).toHaveLength(2);
    expect(squash(segments[0]!.html)).toBe('<div>Pankaj Kumar</div>');
    expect(segments[1]?.attribution?.email).toBe('ruby@example.com');
    expect(squash(segments[1]!.html)).toBe('<div>Sure, sending it now.</div>');
  });

  // Zoho and Apple render "On <date> <name> <email>" with no "wrote:" at all.
  // Missing this leaves the entire quoted history inside the first bubble.
  it('splits on a class-marked attribution that never says "wrote"', () => {
    const segments = splitMailBody(
      '<div>Confirmed.</div>' +
        '<div class="original-sender-line">On Mon, 01 Sep 2026 10:04 Alice &lt;alice@example.com&gt;</div>' +
        '<div>The invoice is attached.</div>',
      { parser },
    );

    expect(segments).toHaveLength(2);
    expect(squash(segments[0]!.html)).toBe('<div>Confirmed.</div>');
    expect(squash(segments[1]!.html)).toBe('<div>The invoice is attached.</div>');
  });

  // A body with no quoting is one message, and the structural passes must not
  // run over it — a designed notification comes back unwrapped and truncated.
  it('leaves a body with no boundaries structurally intact', () => {
    const segments = splitMailBody(
      '<blockquote style="border-left:3px solid #eee"><p>Task #42 was updated.</p></blockquote>' +
        '<div class="gmail_signature">Notifications</div>',
      { parser },
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]?.attribution).toBeNull();
    expect(squash(segments[0]!.html)).toBe(
      '<blockquote style="border-left:3px solid #eee"><p>Task #42 was updated.</p></blockquote>',
    );
  });

  // The minimal chain runs on bodies nobody proved are conversational, so a
  // misfire there must leave the original rather than an empty bubble.
  it('falls back to the original when the solo pass empties the body', () => {
    const html = '<div class="gmail_signature">Alice</div>';

    const segments = splitMailBody(html, { parser });

    expect(segments).toEqual([{ attribution: null, isOwn: true, html, applied: [] }]);
  });

  // The solo recipe is a value so callers can extend it; if that stops being
  // honoured, a caller's override silently does nothing.
  it('honours a caller’s solo options', () => {
    const segments = splitMailBody(
      '<div><p>Read the notes.</p><div class="gmail_signature">Alice</div></div>',
      { parser, solo: { ...minimalFragmentOptions, signatureRules: [] } },
    );

    expect(segments[0]!.html).toContain('gmail_signature');
  });

  // A quote level holding nothing but a repeated signature is not a message.
  it('drops a segment that cleans away to nothing', () => {
    const segments = splitMailBody(
      '<div>Thanks for this.</div>' +
        '<div class="gmail_attr">On Mon, 1 Sep 2026, Alice &lt;alice@example.com&gt; wrote:</div>' +
        '<div class="gmail_signature">Alice — Example Ltd</div>',
      { parser },
    );

    expect(segments).toHaveLength(1);
    expect(squash(segments[0]!.html)).toBe('<div>Thanks for this.</div>');
  });

  // A message whose whole content is a screenshot has no text. Judging
  // emptiness by text alone deletes it from the thread.
  it('keeps a segment whose only content is an image', () => {
    const segments = splitMailBody(
      '<div>Here it is.</div>' +
        '<div class="gmail_attr">On Mon, 1 Sep 2026, Alice &lt;alice@example.com&gt; wrote:</div>' +
        '<div><img src="cid:screenshot"></div>',
      { parser },
    );

    expect(segments).toHaveLength(2);
    expect(segments[1]!.html).toContain('<img');
  });

  // Segment cleaning must be overridable per caller, same as every other pass.
  it('honours caller segment options', () => {
    const segments = splitMailBody(
      '<div>Reply text.</div>' +
        '<div class="gmail_attr">On Mon, 1 Sep 2026, Alice &lt;alice@example.com&gt; wrote:</div>' +
        '<blockquote class="gmail_quote"><p>Quoted words.</p></blockquote>',
      { parser, segment: { keepStructure: true } },
    );

    expect(squash(segments[1]!.html)).toBe(
      '<blockquote class="gmail_quote"><p>Quoted words.</p></blockquote>',
    );
  });

  // Losing the mail entirely is never acceptable; one over-long bubble is.
  it.each([
    ['a parser that throws', throwingParser],
    ['a parser returning no body', bodylessParser],
  ])('returns the original body for %s', (_label, brokenParser) => {
    const html = '<p>Something arrived.</p>';

    expect(splitMailBody(html, { parser: brokenParser })).toEqual([
      { attribution: null, isOwn: true, html, applied: [] },
    ]);
  });

  // An empty body has no message in it, and a bubble holding nothing is worse
  // than no bubble.
  it('returns nothing for an empty body', () => {
    expect(splitMailBody('', { parser })).toEqual([]);
  });

  // Regression: ownership is stated, not positional. A reply whose own words
  // are nothing but a signature loses that segment to the empty filter, and a
  // caller reading "index 0" as "the sender's own message" then credits the
  // sender with the words of the person they quoted.
  it('marks ownership even when the sender’s own segment is dropped', () => {
    const segments = splitMailBody(
      '<div class="gmail_signature">Alice — Example Ltd</div>' +
        '<div class="gmail_attr">On Mon, 1 Sep 2026, Bob &lt;bob@example.com&gt; wrote:</div>' +
        '<div>The invoice is attached.</div>',
      { parser },
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]?.isOwn).toBe(false);
    expect(segments[0]?.attribution?.email).toBe('bob@example.com');
  });

  // Regression: the audit trail has to survive the split. "Why is half my
  // email missing?" is answerable per BUBBLE only if each segment reports the
  // rules that shaped it, not just the body as a whole.
  it('reports which rules cleaned each segment', () => {
    const segments = splitMailBody(
      '<div>Here you go.<div class="gmail_signature">Alice</div></div>' +
        '<div class="gmail_attr">On Mon, 1 Sep 2026, Bob &lt;bob@example.com&gt; wrote:</div>' +
        '<div>Please send the invoice.</div>',
      { parser },
    );

    expect(segments[0]?.applied).toContain('signature:gmail');
    expect(segments[1]?.applied).toEqual([]);
  });
});
