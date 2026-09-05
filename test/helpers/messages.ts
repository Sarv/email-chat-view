/**
 * Message fixtures for the component tests.
 *
 * `date` is built with the local-time `Date` constructor, never a UTC
 * millisecond literal: every date decision in the view is about the READER's
 * calendar day, so a fixture pinned to an instant would pass in London and fail
 * in Auckland.
 */
import type { ChatMessage } from '../../src/types.js';

/** The "now" every component test renders against. 3 March 2026, 14:30 local. */
export const NOW = new Date(2026, 2, 3, 14, 30).getTime();

/** Earlier the same day, so the default fixture lands under "Today". */
export const TODAY_AT_TEN = new Date(2026, 2, 3, 10, 0).getTime();

export function chatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    fromAddress: 'alice@acme.example',
    fromName: 'Alice Chen',
    toAddress: 'bob@acme.example',
    date: TODAY_AT_TEN,
    body: '<p>Sounds good — see you at 4.</p>',
    ...overrides,
  };
}

/** A thread of `count` messages alternating between two senders, one per hour. */
export function thread(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_unused, index) =>
    chatMessage({
      id: `m${index}`,
      fromAddress: index % 2 === 0 ? 'alice@acme.example' : 'bob@acme.example',
      fromName: index % 2 === 0 ? 'Alice Chen' : 'Bob Ray',
      isFromMe: index % 2 === 1,
      date: TODAY_AT_TEN + index * 60 * 60 * 1000,
      body: `<p>message ${index}</p>`,
    }),
  );
}
