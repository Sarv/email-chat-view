import { describe, expect, it, vi } from 'vitest';

import type { Mail } from '../src/types.js';
import {
  createBodyCache,
  mailsToMessages,
  mailToMessage,
} from '../src/transform/mails-to-messages.js';

import { parser } from './helpers/parser.js';

const options = { parser };

/** Epoch milliseconds for a fixed instant. Literal, because a test must not depend on "now". */
const MARCH_3 = Date.UTC(2025, 2, 3, 10, 0, 0);
const MARCH_4 = Date.UTC(2025, 2, 4, 10, 0, 0);
const MARCH_5 = Date.UTC(2025, 2, 5, 10, 0, 0);

const mail = (partial: Partial<Mail> & Pick<Mail, 'id'>): Mail => ({
  fromAddress: 'alice@example.com',
  date: MARCH_3,
  ...partial,
});

describe('createBodyCache', () => {
  // Regression: THE reason the cache exists. Cleaning one body parses HTML and
  // walks a DOM. In a mail client bodies arrive one at a time, continuously —
  // re-cleaning all 200 on each arrival is the difference between a thread that
  // opens and a tab that locks.
  it('returns a stored result for the same id and body', () => {
    const cache = createBodyCache();
    const result = { html: '<p>x</p>', applied: ['signature:gmail'] };

    cache.set('1', 'raw', result);
    expect(cache.get('1', 'raw')).toBe(result);
    expect(cache.size).toBe(1);
  });

  // Regression: keyed on the BODY, not just the id. A pending message whose
  // body later arrives keeps the same id — serving the stale (empty) result is
  // exactly the bug where a message never renders its content.
  it('misses when the body changed under the same id', () => {
    const cache = createBodyCache();
    cache.set('1', 'old', { html: 'old', applied: [] });

    expect(cache.get('1', 'new')).toBeUndefined();
  });

  it('misses on an unknown id', () => {
    expect(createBodyCache().get('nope', 'raw')).toBeUndefined();
  });

  // Regression: entries hold both source and cleaned HTML. Unbounded, a session
  // browsing thousands of messages retains every body it ever rendered.
  it('evicts the least recently used entry past capacity', () => {
    const cache = createBodyCache(2);
    cache.set('a', 'a', { html: 'a', applied: [] });
    cache.set('b', 'b', { html: 'b', applied: [] });
    cache.set('c', 'c', { html: 'c', applied: [] });

    expect(cache.size).toBe(2);
    expect(cache.get('a', 'a')).toBeUndefined();
    expect(cache.get('b', 'b')).toBeDefined();
    expect(cache.get('c', 'c')).toBeDefined();
  });

  // Regression: a HIT must refresh recency, or the message the reader is
  // actually looking at gets evicted while ones they scrolled past survive.
  it('treats a read as a use when choosing what to evict', () => {
    const cache = createBodyCache(2);
    cache.set('a', 'a', { html: 'a', applied: [] });
    cache.set('b', 'b', { html: 'b', applied: [] });
    cache.get('a', 'a');
    cache.set('c', 'c', { html: 'c', applied: [] });

    expect(cache.get('a', 'a')).toBeDefined();
    expect(cache.get('b', 'b')).toBeUndefined();
  });

  // Regression: re-setting an existing id must not grow the map, or a message
  // whose body is refetched repeatedly leaks an entry per attempt.
  it('overwrites in place when the same id is set again', () => {
    const cache = createBodyCache(2);
    cache.set('a', 'v1', { html: '1', applied: [] });
    cache.set('a', 'v2', { html: '2', applied: [] });

    expect(cache.size).toBe(1);
    expect(cache.get('a', 'v2')?.html).toBe('2');
  });

  it('clears every entry', () => {
    const cache = createBodyCache();
    cache.set('a', 'a', { html: 'a', applied: [] });
    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get('a', 'a')).toBeUndefined();
  });
});

describe('mailToMessage', () => {
  const context = { isOldest: false, ownAddresses: new Set<string>(), dateUnit: 'ms' as const };

  it('carries identity, recipients and the cleaned body through', () => {
    const message = mailToMessage(
      mail({
        id: '1',
        fromAddress: 'Alice@Example.com',
        fromName: 'Alice',
        toAddress: 'bob@example.com, carol@example.com',
        toNames: 'Bob, Carol',
        ccAddress: 'dave@example.com',
        ccNames: 'Dave',
        body: '<p>Hi</p><div class="gmail_signature">Alice</div>',
      }),
      { ...context, stripOptions: options },
    );

    expect(message).toMatchObject({
      id: '1',
      fromAddress: 'Alice@Example.com',
      fromName: 'Alice',
      toAddress: 'bob@example.com, carol@example.com',
      toNames: 'Bob, Carol',
      ccAddress: 'dave@example.com',
      ccNames: 'Dave',
      date: MARCH_3,
      applied: ['signature:gmail'],
    });
    expect(message.body).toBe('<p>Hi</p>');
  });

  // Regression: the reader's own address right-aligns the bubble. Matching is
  // case-insensitive because SMTP local-parts are case-sensitive in the RFC but
  // never in practice, and stores normalize inconsistently.
  it('marks the reader’s own message regardless of address case', () => {
    const own = new Set(['me@example.com']);
    expect(
      mailToMessage(mail({ id: '1', fromAddress: 'ME@Example.com' }), {
        ...context,
        ownAddresses: own,
      }).isFromMe,
    ).toBe(true);
    expect(
      mailToMessage(mail({ id: '2', fromAddress: 'other@example.com' }), {
        ...context,
        ownAddresses: own,
      }).isFromMe,
    ).toBe(false);
  });

  // Regression: undefined, not false, when identity is unknowable. The view
  // left-aligns everything rather than guessing — attributing someone else's
  // message to the reader is worse than a flat layout.
  it('leaves isFromMe undefined when the reader is unknown', () => {
    expect(mailToMessage(mail({ id: '1' }), context).isFromMe).toBeUndefined();
  });

  // Regression: cleaning an empty string still costs a parse. On a
  // freshly-opened large thread every message is pending, so that is 200 wasted
  // parses at exactly the moment the view needs to appear.
  it('does no transform work for a pending body and reports the state', () => {
    const stripOptions = { parser: vi.fn(parser) };
    const message = mailToMessage(mail({ id: '1', body: '', bodyPending: true }), {
      ...context,
      stripOptions,
    });

    expect(stripOptions.parser).not.toHaveBeenCalled();
    expect(message).toMatchObject({ body: '', bodyPending: true, bodyFailed: false });
  });

  // Regression: a permanent failure must be distinguishable from a pending one,
  // or the bubble shows a spinner that never resolves — the worst of the three
  // states, because the reader cannot tell whether to wait.
  it('reports a failed body distinctly from a pending one', () => {
    const message = mailToMessage(mail({ id: '1', body: null, bodyFailed: true }), context);
    expect(message).toMatchObject({ bodyPending: false, bodyFailed: true });
  });

  // Regression: the thread's first message has no history behind it, so the
  // quote pass can only misfire on content the sender genuinely quoted.
  it('keeps quoted content on the oldest message', () => {
    const body = '<p>Spec says:</p><blockquote>a real quotation</blockquote>';
    const oldest = mailToMessage(mail({ id: '1', body }), {
      ...context,
      isOldest: true,
      stripOptions: options,
    });
    const later = mailToMessage(mail({ id: '2', body }), { ...context, stripOptions: options });

    expect(oldest.body).toContain('a real quotation');
    expect(later.body).not.toContain('a real quotation');
  });

  // Regression: inline `cid:` images are body content, not attachments.
  // Listing a signature logo in the attachment row is noise.
  it('drops inline attachments and keeps real ones', () => {
    const message = mailToMessage(
      mail({
        id: '1',
        attachments: [
          { filename: 'logo.png', inline: true },
          { filename: 'report.pdf', sizeBytes: 1024 },
        ],
      }),
      context,
    );

    expect(message.attachments).toEqual([{ filename: 'report.pdf', sizeBytes: 1024 }]);
  });

  it('reports no attachments rather than an empty list', () => {
    expect(mailToMessage(mail({ id: '1' }), context).attachments).toBeUndefined();
    expect(mailToMessage(mail({ id: '2', attachments: [] }), context).attachments).toBeUndefined();
    expect(
      mailToMessage(mail({ id: '3', attachments: [{ filename: 'a.png', inline: true }] }), context)
        .attachments,
    ).toBeUndefined();
  });

  // Regression: the memo must actually be consulted, and a cached result must
  // be reused verbatim — this is what makes appending message 201 cheap.
  it('serves a cached result without re-parsing', () => {
    const cache = createBodyCache();
    const stripOptions = { parser: vi.fn(parser) };
    const subject = mail({ id: '1', body: '<p>Hi</p><div class="gmail_signature">A</div>' });

    const first = mailToMessage(subject, { ...context, cache, stripOptions });
    const callsAfterFirst = stripOptions.parser.mock.calls.length;
    const second = mailToMessage(subject, { ...context, cache, stripOptions });

    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(stripOptions.parser.mock.calls.length).toBe(callsAfterFirst);
    expect(second.body).toBe(first.body);
    expect(second.applied).toEqual(first.applied);
  });
});

describe('mailsToMessages', () => {
  // Regression: mail stores return threads in arrival, UID or relevance order.
  // A chat view that renders them out of sequence is not a chat view, so order
  // is normalized here rather than trusted from the caller.
  it('sorts oldest first whatever order it is given', () => {
    const messages = mailsToMessages(
      [mail({ id: 'c', date: MARCH_5 }), mail({ id: 'a', date: MARCH_3 }), mail({ id: 'b', date: MARCH_4 })],
      options,
    );

    expect(messages.map((message) => message.id)).toEqual(['a', 'b', 'c']);
  });

  // Regression: IMAP internal dates are frequently epoch SECONDS. A silent
  // factor-of-1000 error does not crash — it puts every message in 1970, sorts
  // the thread wrongly, and produces date separators nobody notices are wrong.
  it('normalizes seconds to milliseconds when told the unit', () => {
    const seconds = Math.floor(MARCH_3 / 1000);
    const [message] = mailsToMessages([mail({ id: '1', date: seconds })], {
      ...options,
      dateUnit: 's',
    });

    expect(message?.date).toBe(MARCH_3);
  });

  it('defaults to milliseconds', () => {
    const [message] = mailsToMessages([mail({ id: '1', date: MARCH_3 })], options);
    expect(message?.date).toBe(MARCH_3);
  });

  // Regression: an unparseable date must sort last and keep NaN, so the view
  // can group it under an explicit heading — not silently drop the message or
  // plant it in 1970 at the top of the thread.
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('sorts a %s date last and keeps it NaN', (_label, date) => {
    const messages = mailsToMessages(
      [mail({ id: 'bad', date }), mail({ id: 'good', date: MARCH_3 })],
      options,
    );

    expect(messages.map((message) => message.id)).toEqual(['good', 'bad']);
    expect(messages[1]?.date).toBeNaN();
  });

  it('keeps two unknown dates in their given order', () => {
    const messages = mailsToMessages(
      [mail({ id: 'x', date: 0 }), mail({ id: 'y', date: 0 })],
      options,
    );
    expect(messages.map((message) => message.id)).toEqual(['x', 'y']);
  });

  // Regression: the comparator must answer "unknown vs known" the same way
  // whichever side the sort hands it. With only two messages the engine may ask
  // it one way round only, so an asymmetric comparator survives — and then the
  // resulting order depends on how the caller happened to arrange the input,
  // meaning the same thread renders differently after a refresh.
  it('sorts an unknown date last from any starting position', () => {
    const arrangements = [
      ['bad', 'a', 'b'],
      ['a', 'bad', 'b'],
      ['a', 'b', 'bad'],
    ];
    const dates: Record<string, number> = { a: MARCH_3, b: MARCH_4, bad: 0 };

    for (const arrangement of arrangements) {
      const input = arrangement.map((id) => mail({ id, date: dates[id] as number }));
      expect(mailsToMessages(input, options).map((message) => message.id)).toEqual([
        'a',
        'b',
        'bad',
      ]);
    }
  });

  // Regression: `isOldest` is thread context, so it must be assigned AFTER
  // sorting. Taking the caller's first element instead would apply the
  // keep-quotes policy to whichever message happened to be listed first.
  it('applies the oldest-message policy after sorting, not to the input’s first element', () => {
    const body = '<p>Text</p><blockquote>quoted</blockquote>';
    const messages = mailsToMessages(
      [mail({ id: 'newer', date: MARCH_5, body }), mail({ id: 'older', date: MARCH_3, body })],
      options,
    );

    expect(messages[0]?.id).toBe('older');
    expect(messages[0]?.body).toContain('quoted');
    expect(messages[1]?.body).not.toContain('quoted');
  });

  // Regression: an unsent draft is not a conversation turn. Rendering one as a
  // bubble makes it look sent, which is the kind of thing that loses a deal.
  it('excludes drafts by default and includes them on request', () => {
    const mails = [mail({ id: 'sent' }), mail({ id: 'draft', isDraft: true })];

    expect(mailsToMessages(mails, options).map((message) => message.id)).toEqual(['sent']);
    expect(
      mailsToMessages(mails, { ...options, includeDrafts: true }).map((message) => message.id),
    ).toEqual(['sent', 'draft']);
  });

  // Regression: multi-account clients have several of the reader's addresses,
  // and a message from any of them should right-align.
  it('accepts several of the reader’s own addresses', () => {
    const messages = mailsToMessages(
      [
        mail({ id: '1', fromAddress: 'work@example.com' }),
        mail({ id: '2', fromAddress: 'home@example.com' }),
        mail({ id: '3', fromAddress: 'someone@else.com' }),
      ],
      { ...options, currentUserAddress: ['work@example.com', 'home@example.com'] },
    );

    expect(messages.map((message) => message.isFromMe)).toEqual([true, true, false]);
  });

  it('accepts a single address as a bare string', () => {
    const [message] = mailsToMessages([mail({ id: '1', fromAddress: 'me@example.com' })], {
      ...options,
      currentUserAddress: 'me@example.com',
    });
    expect(message?.isFromMe).toBe(true);
  });

  // Regression: a comma-separated blob is a recipient LIST passed where an
  // identity was expected. Treating it as one flags every recipient as the
  // reader, right-aligning the whole thread.
  it('rejects a comma-separated recipient list passed as the reader’s identity', () => {
    const [message] = mailsToMessages([mail({ id: '1', fromAddress: 'a@example.com' })], {
      ...options,
      currentUserAddress: 'a@example.com, b@example.com',
    });
    expect(message?.isFromMe).toBeUndefined();
  });

  it('ignores blank and empty addresses', () => {
    const [message] = mailsToMessages([mail({ id: '1' })], {
      ...options,
      currentUserAddress: ['  ', ''],
    });
    expect(message?.isFromMe).toBeUndefined();
  });

  // Regression: the types say these are strings, but this ships as a JS package
  // and the values come from an account store — "the account has no address
  // yet" arrives as null far more often than the types admit. A throw here
  // takes the whole thread down; the right answer is "no identity known".
  it('tolerates a null entry among the reader’s addresses', () => {
    const messages = mailsToMessages(
      [mail({ id: '1', fromAddress: 'me@example.com' }), mail({ id: '2' })],
      {
        ...options,
        currentUserAddress: [null as unknown as string, 'me@example.com'],
      },
    );

    expect(messages.map((message) => message.isFromMe)).toEqual([true, false]);
  });

  // Regression: same reasoning for the sender. A mail row with no From (a
  // malformed message, or one whose headers never parsed) must still render as
  // a bubble from an unknown sender rather than crash the view.
  it('tolerates a mail with no sender address', () => {
    const [message] = mailsToMessages(
      [{ id: '1', date: MARCH_3, fromAddress: null } as unknown as Mail],
      { ...options, currentUserAddress: 'me@example.com' },
    );

    expect(message?.isFromMe).toBe(false);
    expect(message?.id).toBe('1');
  });

  // Regression: the streaming contract. Metadata arrives first and bodies fill
  // in one at a time; re-running the transform must re-clean only the message
  // that changed and reuse the rest.
  it('re-cleans only the message whose body arrived', () => {
    const cache = createBodyCache();
    const stripOptions = { parser: vi.fn(parser) };
    const signature = '<div class="gmail_signature">S</div>';

    const pending = [
      mail({ id: '1', date: MARCH_3, body: `<p>One</p>${signature}` }),
      mail({ id: '2', date: MARCH_4, body: '', bodyPending: true }),
    ];
    mailsToMessages(pending, { ...options, cache, ...stripOptions });
    const afterFirstPass = stripOptions.parser.mock.calls.length;

    const arrived = [pending[0] as Mail, mail({ id: '2', date: MARCH_4, body: `<p>Two</p>${signature}` })];
    const messages = mailsToMessages(arrived, { ...options, cache, ...stripOptions });
    const parsesForTheNewBody = stripOptions.parser.mock.calls.length - afterFirstPass;

    expect(messages.map((message) => message.body)).toEqual(['<p>One</p>', '<p>Two</p>']);
    // Message 1 came from the memo; only message 2 was parsed.
    expect(parsesForTheNewBody).toBeGreaterThan(0);
    expect(parsesForTheNewBody).toBeLessThanOrEqual(2);
    expect(cache.size).toBe(2);
  });

  it('returns an empty list for no mails', () => {
    expect(mailsToMessages([], options)).toEqual([]);
  });
});
