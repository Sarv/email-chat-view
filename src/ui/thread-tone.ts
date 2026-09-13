/**
 * Whether a thread is people talking, or a sender broadcasting.
 *
 * The question this answers is not cosmetic. A body is framed — rendered
 * verbatim in a sandboxed iframe, in a bubble that gives up its padding and its
 * tint so the document can reach the card's edge — when it carries its own
 * layout. In mail, "carries its own layout" is very nearly synonymous with
 * "contains a `<table>`", because that is how designed mail has been built
 * since the nineties.
 *
 * But a table is also how Outlook wraps a signature, how a mail client indents
 * a block, and how half the world's mail clients emit a two-line sign-off. In a
 * thread where two people are writing back and forth, a table is that and
 * essentially never a newsletter: people replying to each other do not send
 * each other designed documents. So the tone of the thread is worth knowing
 * before a single leftover signature wrapper is allowed to turn a two-line
 * reply into a "document".
 *
 * Deliberately a property of the THREAD and not of the message. One message in
 * isolation cannot tell you this — the signal is that somebody answered.
 */
import type { ChatMessage } from '../types.js';

/** A sender address, comparable: trimmed, lowercased, empty when unusable. */
function senderKey(message: ChatMessage): string {
  return (message.fromAddress ?? '').trim().toLowerCase();
}

/**
 * Whether this thread is a conversation between people.
 *
 * True when at least two messages arrived from at least two different senders.
 * That is the whole test, and it is deliberately the cheapest one that cannot
 * be faked by the case it exists to exclude: a newsletter, a receipt, a
 * notification and an alert all arrive from ONE address and are never replied
 * to, so none of them can ever reach two distinct senders.
 *
 * Unattributable senders are not counted. A message whose `fromAddress` is
 * missing tells us nothing about who is talking, and counting it as "someone
 * else" would let a single-sender thread of two look like a conversation.
 */
export function isConversationalThread(
  messages: readonly ChatMessage[] | null | undefined,
): boolean {
  if (!messages || messages.length < 2) return false;
  const senders = new Set<string>();
  for (const message of messages) {
    const key = senderKey(message);
    if (key) senders.add(key);
    // Nothing more to learn once two different people have written.
    if (senders.size > 1) return true;
  }
  return false;
}
