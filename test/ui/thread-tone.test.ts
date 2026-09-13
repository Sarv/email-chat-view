import { describe, expect, it } from 'vitest';

import { isConversationalThread } from '../../src/ui/thread-tone.js';
import { chatMessage, thread } from '../helpers/messages.js';

describe('isConversationalThread', () => {
  // Regression: THE signal. A table is how designed mail is built AND how
  // Outlook wraps a signature; only the thread can tell those apart, because
  // the thing that distinguishes them is that somebody answered.
  it('is true once two different people have written', () => {
    expect(isConversationalThread(thread(2))).toBe(true);
    expect(isConversationalThread(thread(9))).toBe(true);
  });

  // Regression: the case this exists to EXCLUDE. A newsletter, a receipt, an
  // alert and a notification all arrive from one address, however many of them
  // there are, so no volume of them may ever read as a conversation.
  it('is false for any number of messages from one sender', () => {
    const blasts = Array.from({ length: 6 }, (_unused, index) =>
      chatMessage({ id: `n${index}`, fromAddress: 'news@vendor.example' }),
    );
    expect(isConversationalThread(blasts)).toBe(false);
  });

  it('is false for a single message, whoever sent it', () => {
    expect(isConversationalThread(thread(1))).toBe(false);
    expect(isConversationalThread([])).toBe(false);
  });

  // Regression: an address is compared as an address. The same person writing
  // from a client that capitalises the domain is not a second participant, and
  // counting them as one would let a one-sided thread pass.
  it('treats one address in two spellings as one sender', () => {
    expect(
      isConversationalThread([
        chatMessage({ id: 'a', fromAddress: 'news@Vendor.Example' }),
        chatMessage({ id: 'b', fromAddress: ' news@vendor.example ' }),
      ]),
    ).toBe(false);
  });

  // Regression: an unattributable sender tells us nothing about who is talking.
  // Counting it as "somebody else" would make a two-message newsletter thread
  // with one malformed header look like a conversation.
  it('does not count a message with no usable sender as a participant', () => {
    expect(
      isConversationalThread([
        chatMessage({ id: 'a', fromAddress: 'news@vendor.example' }),
        chatMessage({ id: 'b', fromAddress: '' }),
        chatMessage({ id: 'c', fromAddress: '   ' }),
      ]),
    ).toBe(false);
  });

  // Regression: `fromAddress` is declared a string, but the host filling it is
  // frequently untyped JS reading a header that was simply not there. Calling
  // `.trim()` on that takes the whole thread view down over one bad message.
  it('survives a sender the host left null', () => {
    expect(
      isConversationalThread([
        chatMessage({ id: 'a', fromAddress: null as unknown as string }),
        chatMessage({ id: 'b', fromAddress: 'news@vendor.example' }),
      ]),
    ).toBe(false);
  });

  it('has an answer for a caller with no thread at all', () => {
    expect(isConversationalThread(null)).toBe(false);
    expect(isConversationalThread(undefined)).toBe(false);
  });
});
