import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../../src/types.js';
import {
  DEFAULT_SENDER_RUN_MS,
  groupMessagesByDate,
  isSameSenderRun,
} from '../../src/ui/grouping.js';
import { DEFAULT_LABELS } from '../../src/ui/labels.js';

const NOW = new Date(2026, 2, 3, 14, 30).getTime();

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    fromAddress: 'alice@acme.example',
    date: new Date(2026, 2, 3, 10, 0).getTime(),
    body: '<p>hi</p>',
    ...overrides,
  };
}

describe('isSameSenderRun', () => {
  const first = message({ id: 'a', date: 1_700_000_000_000 });

  it('merges two messages from the same sender inside the window', () => {
    const second = message({ id: 'b', date: first.date + 60_000 });
    expect(isSameSenderRun(first, second)).toBe(true);
  });

  it('is case- and whitespace-insensitive about the sender', () => {
    const second = message({
      id: 'b',
      fromAddress: '  ALICE@Acme.example ',
      date: first.date + 1_000,
    });
    expect(isSameSenderRun(first, second)).toBe(true);
  });

  it('splits once the gap exceeds the window', () => {
    const second = message({ id: 'b', date: first.date + DEFAULT_SENDER_RUN_MS + 1 });
    expect(isSameSenderRun(first, second)).toBe(false);
  });

  it('accepts a gap exactly equal to the window', () => {
    const second = message({ id: 'b', date: first.date + DEFAULT_SENDER_RUN_MS });
    expect(isSameSenderRun(first, second)).toBe(true);
  });

  // Regression: a message arriving out of order (a store that back-fills) has a
  // NEGATIVE delta, and comparing the raw difference against the window would
  // merge two messages hours apart.
  it('measures the gap in either direction', () => {
    const earlier = message({ id: 'b', date: first.date - 60_000 });
    const muchEarlier = message({ id: 'c', date: first.date - DEFAULT_SENDER_RUN_MS - 1 });
    expect(isSameSenderRun(first, earlier)).toBe(true);
    expect(isSameSenderRun(first, muchEarlier)).toBe(false);
  });

  it('splits two different senders', () => {
    const second = message({ id: 'b', fromAddress: 'bob@acme.example', date: first.date + 1_000 });
    expect(isSameSenderRun(first, second)).toBe(false);
  });

  // Regression: THE failure this function exists to avoid. A wrongly merged run
  // hides the header, which attributes one person's message to another; two
  // senders nobody could identify must never be treated as the same person.
  it('never merges unidentified senders', () => {
    const unknownLeft = message({ id: 'a', fromAddress: 'unknown', date: first.date });
    const unknownRight = message({ id: 'b', fromAddress: 'unknown', date: first.date + 1_000 });
    const blankLeft = message({ id: 'c', fromAddress: '   ', date: first.date });
    const blankRight = message({ id: 'd', fromAddress: '', date: first.date + 1_000 });
    expect(isSameSenderRun(unknownLeft, unknownRight)).toBe(false);
    expect(isSameSenderRun(blankLeft, blankRight)).toBe(false);
    // Either side being unidentified is enough.
    expect(isSameSenderRun(first, blankRight)).toBe(false);
    expect(isSameSenderRun(blankLeft, first)).toBe(false);
  });

  it('never merges when either timestamp is unusable', () => {
    const noDate = message({ id: 'b', date: 0 });
    const notANumber = message({ id: 'c', date: Number.NaN });
    const missing = message({ id: 'd', date: undefined as unknown as number });
    expect(isSameSenderRun(first, noDate)).toBe(false);
    expect(isSameSenderRun(notANumber, first)).toBe(false);
    expect(isSameSenderRun(first, missing)).toBe(false);
  });

  it('treats a missing neighbour as the start of a run', () => {
    expect(isSameSenderRun(null, first)).toBe(false);
    expect(isSameSenderRun(undefined, first)).toBe(false);
    expect(isSameSenderRun(first, null)).toBe(false);
  });

  // Regression: `senderRunWindowMs={0}` is the documented way to give every
  // message its own header. Answering it after the timestamp comparison would
  // still merge two messages that share an identical timestamp.
  it('disables run-grouping entirely for a window of zero or less', () => {
    const identical = message({ id: 'b', date: first.date });
    expect(isSameSenderRun(first, identical, 0)).toBe(false);
    expect(isSameSenderRun(first, identical, -1)).toBe(false);
    expect(isSameSenderRun(first, identical, Number.NaN)).toBe(false);
  });
});

describe('groupMessagesByDate', () => {
  it('returns nothing for an empty thread', () => {
    expect(groupMessagesByDate([], DEFAULT_LABELS, 'en-GB', NOW)).toEqual([]);
  });

  it('puts one day’s messages under one heading', () => {
    const groups = groupMessagesByDate(
      [
        message({ id: 'a', date: new Date(2026, 2, 3, 9, 0).getTime() }),
        message({ id: 'b', date: new Date(2026, 2, 3, 17, 0).getTime() }),
      ],
      DEFAULT_LABELS,
      'en-GB',
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('Today');
    expect(groups[0]?.key).toBe('2026-03-03');
    expect(groups[0]?.startIndex).toBe(0);
    expect(groups[0]?.messages.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  // Regression: `startIndex` is what the view adds to a message's position in
  // its group to recover its index in the caller's own array — the number the
  // visible-range callback reports. Off by one and the host prefetches the
  // wrong bodies.
  it('records where each day starts in the original list', () => {
    const groups = groupMessagesByDate(
      [
        message({ id: 'a', date: new Date(2026, 2, 1, 9, 0).getTime() }),
        message({ id: 'b', date: new Date(2026, 2, 2, 9, 0).getTime() }),
        message({ id: 'c', date: new Date(2026, 2, 2, 10, 0).getTime() }),
        message({ id: 'd', date: new Date(2026, 2, 3, 9, 0).getTime() }),
      ],
      DEFAULT_LABELS,
      'en-GB',
      NOW,
    );
    expect(groups.map((group) => group.startIndex)).toEqual([0, 1, 3]);
    expect(groups.map((group) => group.label)).toEqual(['1 March 2026', 'Yesterday', 'Today']);
  });

  // Regression: an undated message must keep a heading of its own rather than
  // joining whichever day happened to precede it.
  it('gives undated messages their own group', () => {
    const groups = groupMessagesByDate(
      [
        message({ id: 'a', date: new Date(2026, 2, 3, 9, 0).getTime() }),
        message({ id: 'b', date: 0 }),
        message({ id: 'c', date: Number.NaN }),
        message({ id: 'd', date: undefined as unknown as number }),
        // Finite, positive, and still not a date: outside the range `Date` can
        // represent, so it survives the arithmetic guards and then throws.
        message({ id: 'e', date: 1e16 }),
      ],
      DEFAULT_LABELS,
      'en-GB',
      NOW,
    );
    expect(groups).toHaveLength(2);
    expect(groups[1]?.key).toBe('unknown');
    expect(groups[1]?.label).toBe(DEFAULT_LABELS.unknownDate);
    expect(groups[1]?.messages.map((entry) => entry.id)).toEqual(['b', 'c', 'd', 'e']);
  });

  // Documents a deliberate limitation: grouping is CONSECUTIVE, never sorted or
  // bucketed, so a caller who supplies unordered messages gets one group per
  // run — and two groups can therefore share a `key`. That is why the view
  // composes its React key from the key AND the start index.
  it('opens a new group each time the day changes, even back to an earlier one', () => {
    const groups = groupMessagesByDate(
      [
        message({ id: 'a', date: new Date(2026, 2, 1, 9, 0).getTime() }),
        message({ id: 'b', date: new Date(2026, 2, 2, 9, 0).getTime() }),
        message({ id: 'c', date: new Date(2026, 2, 1, 10, 0).getTime() }),
      ],
      DEFAULT_LABELS,
      'en-GB',
      NOW,
    );
    expect(groups.map((group) => group.key)).toEqual(['2026-03-01', '2026-03-02', '2026-03-01']);
  });

  it('zero-pads the day key so it sorts as a string', () => {
    const groups = groupMessagesByDate(
      [message({ id: 'a', date: new Date(2026, 0, 5, 9, 0).getTime() })],
      DEFAULT_LABELS,
      'en-GB',
      NOW,
    );
    expect(groups[0]?.key).toBe('2026-01-05');
  });
});
