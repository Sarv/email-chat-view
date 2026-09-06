/**
 * Rebuilding a conversation from a thread whose mails quote each other.
 *
 * Two failures define this file, and they pull in opposite directions. Merge
 * too eagerly and a real message disappears from the chat view while staying
 * visible in the mail view — the two disagree about what arrived, and the
 * reader has no way to know which is lying. Merge too little and the same
 * paragraph renders five times, once per reply that quoted it.
 */
import { describe, expect, it } from 'vitest';

import {
  contentKey,
  createSegmentCache,
  threadToMessages,
} from '../../src/thread/thread-to-messages.js';
import type { Mail } from '../../src/types.js';
import { parser } from '../helpers/parser.js';

const options = { parser };

/** Fixed instants. Literal, because a test must not depend on "now". */
const SEP_1 = Date.UTC(2026, 8, 1, 10, 4, 0);
const SEP_2 = Date.UTC(2026, 8, 2, 9, 30, 0);
const SEP_3 = Date.UTC(2026, 8, 3, 16, 15, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

const mail = (partial: Partial<Mail> & Pick<Mail, 'id'>): Mail => ({
  fromAddress: 'alice@example.com',
  date: SEP_1,
  ...partial,
});

/** A reply from Bob that quotes Alice's message, Gmail-style. */
const BOB_REPLY = `
<div dir="ltr">Tuesday works.</div>
<div class="gmail_quote">
  <div class="gmail_attr">On Tue, 1 Sep 2026 at 10:04, Alice &lt;alice@example.com&gt; wrote:</div>
  <blockquote class="gmail_quote"><div dir="ltr">Can we move the review to Tuesday?</div></blockquote>
</div>`;

describe('contentKey', () => {
  // Regression: an original and the copy a client quoted differ cosmetically in
  // half a dozen ways at once. If any of them survives into the key the copies
  // do not merge and the reader sees the same paragraph twice.
  it('collapses the cosmetic differences quoting introduces', () => {
    const original = '<div dir="ltr">Can we move the review to Tuesday?</div>';
    const quoted = '<p style="margin:0">Can&nbsp;we move the review to Tuesday?&nbsp;</p>';

    expect(contentKey(quoted)).toBe(contentKey(original));
  });

  // Regression: quoting mangles the TAIL — a deep quote level gets truncated, a
  // client appends a footer. Comparing whole bodies stops recognising the copy.
  it('compares openings, not whole bodies', () => {
    const head = 'x'.repeat(150);

    expect(contentKey(`<p>${head}</p>`)).toBe(contentKey(`<p>${head} plus a trailing footer</p>`));
  });

  // Regression: a segment of pure markup has no content to compare, and an
  // empty key must never be treated as "same as that other empty one".
  it('is empty for markup with no text', () => {
    expect(contentKey('<div><br></div>')).toBe('');
    expect(contentKey('')).toBe('');
  });
});

describe('threadToMessages', () => {
  // Regression: THE reason this exists. Alice's message may exist nowhere in
  // the store — only inside Bob's reply. One bubble per mail loses it.
  it('recovers a message that exists only as a quote', () => {
    const messages = threadToMessages(
      [mail({ id: 'b1', fromAddress: 'bob@example.com', date: SEP_2, body: BOB_REPLY })],
      options,
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]?.fromAddress).toBe('alice@example.com');
    expect(messages[0]?.body).toContain('move the review');
    expect(messages[0]?.sourceId).toBe('b1');
    expect(messages[1]?.fromAddress).toBe('bob@example.com');
    expect(messages[1]?.id).toBe('b1');
  });

  // Regression: every later reply re-quotes the same message. Without the merge
  // a three-mail thread renders the first message three times.
  it('merges a quoted copy into the real message it copies', () => {
    const messages = threadToMessages(
      [
        mail({
          id: 'a1',
          date: SEP_1,
          body: '<div dir="ltr">Can we move the review to Tuesday?</div>',
        }),
        mail({ id: 'b1', fromAddress: 'bob@example.com', date: SEP_2, body: BOB_REPLY }),
      ],
      options,
    );

    expect(messages.map((message) => message.id)).toEqual(['a1', 'b1']);
  });

  // Regression: a real message is authoritative even when a quoted copy of it
  // was read first, and even when the two collide on content. Hiding it makes
  // the chat view disagree with the mail view about what arrived.
  it('keeps the real message and drops the quoted copy, whatever the order', () => {
    const messages = threadToMessages(
      [
        mail({ id: 'b1', fromAddress: 'bob@example.com', date: SEP_2, body: BOB_REPLY }),
        mail({
          id: 'a1',
          date: SEP_3,
          body: '<div dir="ltr">Can we move the review to Tuesday?</div>',
        }),
      ],
      options,
    );

    expect(messages.map((message) => message.id)).toEqual(['b1', 'a1']);
    expect(messages.every((message) => message.sourceId === undefined)).toBe(true);
  });

  // Regression: two replies that each quote the same third message must yield
  // ONE bubble for it, not one per carrier.
  it('merges the same quote carried by two different replies', () => {
    const messages = threadToMessages(
      [
        mail({ id: 'b1', fromAddress: 'bob@example.com', date: SEP_2, body: BOB_REPLY }),
        mail({ id: 'c1', fromAddress: 'carol@example.com', date: SEP_3, body: BOB_REPLY }),
      ],
      options,
    );

    expect(messages.filter((message) => message.body.includes('move the review'))).toHaveLength(1);
  });

  // Regression: a relative date in an attribution line must resolve against the
  // mail that CARRIED it, not against the reader's clock. Anchored on now, "On
  // Monday" inside an old thread lands next week — after the reply quoting it —
  // and the conversation renders in reverse.
  it('resolves a relative attribution date against the carrier, not the reader’s clock', () => {
    const messages = threadToMessages(
      [
        mail({
          id: 'b1',
          fromAddress: 'bob@example.com',
          date: SEP_2,
          body:
            '<div>Agreed.</div><div class="gmail_attr">On Monday, Alice ' +
            '&lt;alice@example.com&gt; wrote:</div><div>Shall we start at nine?</div>',
        }),
      ],
      options,
    );

    // SEP_2 is a Wednesday, so the only Monday its author can mean is two days
    // earlier. Nothing here depends on when the suite runs.
    const quoted = messages.find((message) => message.body.includes('start at nine'));
    expect(quoted?.dateApprox).toBeUndefined();
    expect(quoted!.date).toBeLessThan(SEP_2);
    expect(SEP_2 - quoted!.date).toBeLessThan(3 * DAY_MS);
  });

  // Regression: a quoted message with no readable date must not sort to 1970 —
  // it would head every thread it appears in. Dated from its carrier instead,
  // and flagged, because an unmarked guess is worse than a guess.
  //
  // Known limitation, pinned deliberately: the date parser reads English, so a
  // localised relative date is what "no readable date" looks like in real mail.
  // Teaching it Japanese would make this fixture parseable and this test would
  // need another one — it is not asserting that Japanese must fail.
  it('dates a quote with no readable date from the mail carrying it', () => {
    const messages = threadToMessages(
      [
        mail({
          id: 'b1',
          fromAddress: 'bob@example.com',
          date: SEP_2,
          body:
            '<div>Agreed.</div><div class="gmail_attr">On 一昨日, Alice ' +
            '&lt;alice@example.com&gt; wrote:</div><div>Shall we start at nine?</div>',
        }),
      ],
      options,
    );

    const quoted = messages.find((message) => message.body.includes('start at nine'));
    expect(quoted?.dateApprox).toBe(true);
    expect(quoted!.date).toBeLessThan(SEP_2);
    expect(SEP_2 - quoted!.date).toBeLessThan(1000);
    expect(messages[messages.length - 1]?.dateApprox).toBeUndefined();
  });

  // Regression: a message cannot be quoted before it was written, so a date
  // landing after the carrier is a misparse — a two-digit year, a numeric date
  // read the other way round. Believing it sorts the quoted message below the
  // reply that quotes it.
  it('refuses an attribution date later than the mail carrying it', () => {
    const messages = threadToMessages(
      [
        mail({
          id: 'b1',
          fromAddress: 'bob@example.com',
          date: SEP_2,
          body:
            '<div>Agreed.</div><div class="gmail_attr">On 5 October 2027 at 09:00, Alice ' +
            '&lt;alice@example.com&gt; wrote:</div><div>Shall we start at nine?</div>',
        }),
      ],
      options,
    );

    expect(messages.map((message) => message.body.replace(/<[^>]*>/g, ''))).toEqual([
      'Shall we start at nine?',
      'Agreed.',
    ]);
    expect(messages[0]?.dateApprox).toBe(true);
  });

  // Regression: quotes nest newest-to-oldest down the page. Giving every
  // dateless level the same timestamp leaves their order to chance, and the
  // conversation reads backwards.
  it('orders dateless quote levels oldest last', () => {
    const messages = threadToMessages(
      [
        mail({
          id: 'b1',
          fromAddress: 'bob@example.com',
          date: SEP_2,
          body:
            '<div>Newest.</div>' +
            '<div class="gmail_attr">On 一昨日, Alice &lt;alice@example.com&gt; wrote:</div>' +
            '<div>Middle message.</div>' +
            '<div class="gmail_attr">On 一昨日, Carol &lt;carol@example.com&gt; wrote:</div>' +
            '<div>Oldest message.</div>',
        }),
      ],
      options,
    );

    expect(messages.map((message) => message.body.replace(/<[^>]*>/g, ''))).toEqual([
      'Oldest message.',
      'Middle message.',
      'Newest.',
    ]);
  });

  // Regression: a thread where nothing has a readable date must stay unknown
  // rather than land on today — the view has an "unknown date" heading for
  // exactly this, and a fabricated "now" puts an old thread at the top.
  it('leaves an unreadable date unreadable', () => {
    const messages = threadToMessages(
      [mail({ id: 'a1', date: 0, body: '<p>No date at all.</p>' })],
      options,
    );

    expect(Number.isNaN(messages[0]!.date)).toBe(true);
    expect(messages[0]?.dateApprox).toBeUndefined();
  });

  // Regression: nothing may be invented from nothing. A dateless quote inside a
  // dateless carrier has no evidence behind it, and any number put there — 1970,
  // today — sorts the bubble somewhere the reader will believe.
  it('leaves a quote unreadable when its carrier has no date either', () => {
    const messages = threadToMessages(
      [
        mail({
          id: 'b1',
          date: 0,
          body:
            '<div>Agreed.</div><div class="gmail_attr">On 一昨日, Alice ' +
            '&lt;alice@example.com&gt; wrote:</div><div>Shall we start at nine?</div>',
        }),
      ],
      options,
    );

    expect(messages.map((message) => Number.isNaN(message.date))).toEqual([true, true]);
    expect(messages.some((message) => message.dateApprox)).toBe(true);
  });

  // Regression: two mails can share a timestamp to the millisecond (a bulk
  // send, a second-resolution store). Left to the sort alone their order is
  // whatever the engine feels like, and the thread reshuffles between renders.
  it('keeps scan order when two messages share a timestamp', () => {
    const thread = [
      mail({ id: 'a1', date: SEP_2, body: '<p>First to be read.</p>' }),
      mail({ id: 'a2', date: SEP_2, body: '<p>Second to be read.</p>' }),
    ];

    expect(threadToMessages(thread, options).map((message) => message.id)).toEqual(['a1', 'a2']);
  });

  // Regression: the attribution line is prose from an unknown client, and the
  // parser reads a fraction of the shapes in circulation. A quote whose line
  // yields no sender is still a message — rendering it senderless beats losing
  // it, and beats crediting the carrier with someone else's words.
  it('recovers a quote whose attribution line says nothing usable', () => {
    const messages = threadToMessages(
      [
        mail({
          id: 'b1',
          fromAddress: 'bob@example.com',
          date: SEP_2,
          body:
            '<div>Agreed.</div><div class="gmail_attr">On the thread from before, ' +
            'about the review</div><div>Shall we start at nine?</div>',
        }),
      ],
      options,
    );

    const quoted = messages.find((message) => message.body.includes('start at nine'));
    expect(quoted).toBeDefined();
    expect(quoted?.fromAddress).toBe('');
    expect(quoted?.fromName).toBeNull();
  });

  // Regression: half the clients that mangle an address keep the name. Falling
  // back to it keeps the bubble headed by a person instead of a blank.
  it('falls back to the attribution name when the line carried no address', () => {
    const messages = threadToMessages(
      [
        mail({
          id: 'b1',
          fromAddress: 'bob@example.com',
          date: SEP_2,
          body:
            '<div>Agreed.</div><div class="gmail_attr">On Tue, 1 Sep 2026 at 10:04, ' +
            'Alice Chen wrote:</div><div>Shall we start at nine?</div>',
        }),
      ],
      options,
    );

    const quoted = messages.find((message) => message.body.includes('start at nine'));
    expect(quoted?.fromName).toBe('Alice Chen');
    expect(quoted?.fromAddress).toBe('Alice Chen');
  });

  // Regression: a quote level holding only a spacer image or a stray separator
  // has no content to compare, and keeping it puts empty bubbles between real
  // ones. Only QUOTED segments may go this way — see the real-message rule.
  it('drops a quoted segment with no text in it', () => {
    const messages = threadToMessages(
      [
        mail({
          id: 'b1',
          fromAddress: 'bob@example.com',
          date: SEP_2,
          body:
            '<div>Agreed.</div><div class="gmail_attr">On Tue, 1 Sep 2026 at 10:04, Alice ' +
            '&lt;alice@example.com&gt; wrote:</div><div><img src="spacer.gif"></div>',
        }),
      ],
      options,
    );

    expect(messages.map((message) => message.id)).toEqual(['b1']);
  });

  // Regression: a quoted message's recipients are NOT the carrier's. Copying
  // them across labels a bubble with people who never received it.
  it('never borrows the carrier’s recipients for a quoted message', () => {
    const messages = threadToMessages(
      [
        mail({
          id: 'b1',
          fromAddress: 'bob@example.com',
          toAddress: 'team@example.com',
          date: SEP_2,
          body: BOB_REPLY,
        }),
      ],
      options,
    );

    expect(messages[0]?.toAddress).toBeNull();
    expect(messages[1]?.toAddress).toBe('team@example.com');
  });

  // Regression: right-alignment has to work for a message recovered from a
  // quote too — the reader's own words rendered as somebody else's is the most
  // visible error this transform can make.
  it('resolves the reader’s own messages from the attribution line', () => {
    const messages = threadToMessages(
      [mail({ id: 'b1', fromAddress: 'bob@example.com', date: SEP_2, body: BOB_REPLY })],
      { ...options, currentUserAddress: 'ALICE@example.com' },
    );

    expect(messages[0]?.isFromMe).toBe(true);
    expect(messages[1]?.isFromMe).toBe(false);
  });

  // Regression: with no identity to compare against, nothing may be claimed as
  // the reader's — a flat thread beats a mislabelled one.
  it('leaves ownership unknown when no address was given', () => {
    const messages = threadToMessages([mail({ id: 'a1', body: '<p>Hello.</p>' })], options);

    expect(messages[0]?.isFromMe).toBeUndefined();
  });

  // Regression: in a real client the metadata arrives long before the bodies.
  // A mail with no body yet must still render, as a spinner, not vanish.
  it('reports a pending body without attempting a split', () => {
    const messages = threadToMessages(
      [mail({ id: 'a1', bodyPending: true }), mail({ id: 'a2', date: SEP_2, bodyFailed: true })],
      options,
    );

    expect(messages[0]).toMatchObject({ id: 'a1', body: '', bodyPending: true, bodyFailed: false });
    expect(messages[1]).toMatchObject({ id: 'a2', body: '', bodyPending: false, bodyFailed: true });
  });

  // Regression: an unsent draft is not a turn in the conversation, and one
  // rendered as a bubble reads as though it was sent.
  it('excludes drafts unless asked for them', () => {
    const thread = [
      mail({ id: 'a1', body: '<p>Sent message.</p>' }),
      mail({ id: 'd1', date: SEP_2, body: '<p>Unsent thought.</p>', isDraft: true }),
    ];

    expect(threadToMessages(thread, options).map((message) => message.id)).toEqual(['a1']);
    expect(
      threadToMessages(thread, { ...options, includeDrafts: true }).map((message) => message.id),
    ).toEqual(['a1', 'd1']);
  });

  // Regression: a store keeping epoch SECONDS renders every bubble in 1970
  // unless the unit is honoured — and 1970 does not crash, it just sorts wrong.
  it('honours a seconds date unit', () => {
    const messages = threadToMessages(
      [mail({ id: 'a1', date: Math.floor(SEP_1 / 1000), body: '<p>Hello.</p>' })],
      { ...options, dateUnit: 's' },
    );

    expect(messages[0]?.date).toBe(SEP_1);
  });

  // Regression: inline images are part of the body, and listing a signature
  // logo as an attachment is noise the reader has to filter by eye.
  it('shows only real attachments on the carrier’s own message', () => {
    const messages = threadToMessages(
      [
        mail({
          id: 'a1',
          body: '<p>Attached.</p>',
          attachments: [{ filename: 'logo.png', inline: true }, { filename: 'invoice.pdf' }],
        }),
      ],
      options,
    );

    expect(messages[0]?.attachments).toEqual([{ filename: 'invoice.pdf' }]);
  });

  // Regression: the audit trail per bubble. "Why is half my email missing?"
  // must be answerable for a recovered message too, not just a whole mail.
  it('carries the applied rules through to each message', () => {
    const messages = threadToMessages(
      [
        mail({
          id: 'a1',
          body: '<div>Here you go.<div class="gmail_signature">Alice</div></div>',
        }),
      ],
      options,
    );

    expect(messages[0]?.applied).toContain('signature:gmail');
  });

  // Regression: ids must be stable as the thread grows. Numbering bubbles by
  // their position means one new mail re-keys every bubble after it, React
  // remounts them, and every body iframe reloads under the reader.
  it('keeps a recovered message’s id stable when a newer mail arrives', () => {
    const bob = mail({ id: 'b1', fromAddress: 'bob@example.com', date: SEP_2, body: BOB_REPLY });
    const before = threadToMessages([bob], options);
    const after = threadToMessages(
      [mail({ id: 'z1', date: SEP_3, body: '<p>Something later.</p>' }), bob],
      options,
    );

    expect(after.find((message) => message.body.includes('move the review'))?.id).toBe(
      before[0]?.id,
    );
  });

  it('returns nothing for an empty thread', () => {
    expect(threadToMessages([], options)).toEqual([]);
  });
});

describe('threadToMessages with a segment cache', () => {
  // Regression: splitting is the most expensive thing here — a parse, a
  // boundary sweep and a clean per segment. Without the memo every newly
  // arrived body re-splits every body already rendered.
  it('splits a body once across repeated calls', () => {
    const cache = createSegmentCache();
    let parses = 0;
    const countingParser = ((html: string) => {
      parses += 1;
      return parser(html);
    }) as typeof parser;
    const thread = [mail({ id: 'b1', date: SEP_2, body: BOB_REPLY })];

    threadToMessages(thread, { parser: countingParser, cache });
    threadToMessages(thread, { parser: countingParser, cache });

    expect(parses).toBe(1);
    expect(cache.size).toBe(1);
  });

  // Regression: keyed on the BODY, not the id alone. A pending message whose
  // body finally arrives keeps its id, and serving the cached empty split is
  // the bug where a message never renders its content.
  it('re-splits when the body changes under the same id', () => {
    const cache = createSegmentCache();

    threadToMessages([mail({ id: 'b1', body: '<p>First.</p>' })], { ...options, cache });
    const messages = threadToMessages([mail({ id: 'b1', body: '<p>Second.</p>' })], {
      ...options,
      cache,
    });

    expect(messages[0]?.body).toContain('Second.');
  });

  // Regression: the cache must be droppable, or switching threads keeps the
  // previous conversation's bodies alive for the session.
  it('empties on clear', () => {
    const cache = createSegmentCache();
    threadToMessages([mail({ id: 'b1', body: BOB_REPLY })], { ...options, cache });

    cache.clear();

    expect(cache.size).toBe(0);
  });
});
