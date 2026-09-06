/**
 * The programmatic email -> chat transform.
 *
 * Pure, and pure per MESSAGE, which is the property that makes large threads
 * work. Cleaning one body means parsing HTML and walking a DOM — real work,
 * tens of milliseconds on a fat Outlook mail. A 200-message thread cannot
 * afford to redo that every time one more body arrives, and in a mail client
 * bodies arrive one at a time, continuously.
 *
 * So the expensive step is memoized per message and keyed on the body itself:
 * appending message 201, or filling in a body that was pending, re-cleans
 * exactly that one message and reuses the other 200 results untouched.
 */
import type { ChatMessage, DateUnit, Mail } from '../types.js';

import { createKeyedCache, type KeyedCache } from './lru-cache.js';
import {
  compareEpochMillis,
  displayableAttachments,
  isOwnAddress,
  ownAddressSet,
  toEpochMillis,
} from './mail-fields.js';
import type { CleanReplyBodyOptions } from './strip.js';
import { cleanReplyBody } from './strip.js';

/** A cleaned body and the audit trail of what shaped it. */
export interface CleanedBody {
  html: string;
  applied: string[];
}

/**
 * Memo for cleaned bodies, keyed by message id and invalidated by body content.
 *
 * Hold one of these for the lifetime of a thread view and pass it on every
 * call. Without it, the transform is still correct — just quadratic in the
 * number of updates, which is the difference between a thread that opens
 * instantly and one that locks the tab.
 */
export type BodyCache = KeyedCache<CleanedBody>;

/** Create a bounded, least-recently-used body cache. See {@link createKeyedCache}. */
export function createBodyCache(capacity?: number): BodyCache {
  return createKeyedCache<CleanedBody>(capacity);
}

/** Options for {@link mailsToMessages}. */
export interface MailsToMessagesOptions extends CleanReplyBodyOptions {
  /**
   * The reader's own address, or addresses.
   *
   * An array because multi-account clients have several, and a message from any
   * of them should right-align. Omit it and nothing right-aligns, which is the
   * correct fallback: a flat thread reads fine, whereas attributing someone
   * else's message to the reader does not.
   */
  currentUserAddress?: string | readonly string[];
  /** Unit of {@link Mail.date}. Defaults to `'ms'`. See {@link DateUnit}. */
  dateUnit?: DateUnit;
  /** Memo for cleaned bodies. Strongly recommended — see {@link createBodyCache}. */
  cache?: BodyCache;
  /** Render drafts as bubbles too. Off by default; an unsent draft is not a turn. */
  includeDrafts?: boolean;
  /**
   * Whether `mails` contains the thread's first message. Defaults to `true`.
   *
   * The oldest mail in the array is cleaned with its quoted history left in
   * place: the thread's opener has nothing behind it to strip, so the quote
   * passes could only damage real content. That is right for a whole thread and
   * wrong for a PAGE of one — the oldest mail of page two does have history
   * behind it, and treating it as the opener renders the entire conversation
   * inside a single bubble.
   *
   * Pass `false` when handing over anything less than the thread from its
   * start. Prefer passing the whole thread and paging with `bodyPending` and
   * the view's `maxRendered`, which costs nothing per unfetched message.
   */
  containsThreadStart?: boolean;
}

/** Thread context {@link mailToMessage} cannot derive from a single mail. */
export interface MailToMessageContext {
  /**
   * True only for the thread's genuine first message, whose quoted history is
   * kept. See {@link MailsToMessagesOptions.containsThreadStart}.
   */
  isOldest: boolean;
  /**
   * The reader's own address, or addresses. Normalized here, so the caller does
   * not have to know that matching is case-insensitive.
   */
  currentUserAddress?: string | readonly string[];
  /** Unit of {@link Mail.date}. Defaults to `'ms'`. See {@link DateUnit}. */
  dateUnit?: DateUnit;
  /** Memo for cleaned bodies. See {@link createBodyCache}. */
  cache?: BodyCache;
  /** Rule overrides, passed through to {@link cleanReplyBody}. */
  stripOptions?: CleanReplyBodyOptions;
}

/** {@link MailToMessageContext} with the reader's identity already resolved. */
interface ResolvedContext extends Omit<MailToMessageContext, 'currentUserAddress' | 'dateUnit'> {
  ownAddresses: Set<string>;
  dateUnit: DateUnit;
}

/**
 * Convert one mail into one chat message.
 *
 * Exported for incremental use: when a single body arrives, re-transform that
 * message alone rather than the thread. `isOldest` is thread context the
 * message cannot know about itself, so the caller supplies it — pass `true`
 * only for the thread's real first message.
 */
export function mailToMessage(mail: Mail, context: MailToMessageContext): ChatMessage {
  const { currentUserAddress, dateUnit = 'ms', ...rest } = context;
  return toMessage(mail, { ...rest, ownAddresses: ownAddressSet(currentUserAddress), dateUnit });
}

/**
 * The shared body, taking the reader's addresses already normalized.
 *
 * {@link mailsToMessages} builds that set once for the thread rather than once
 * per message, which is the only reason this is separate from the public
 * function above.
 */
function toMessage(mail: Mail, context: ResolvedContext): ChatMessage {
  const { isOldest, ownAddresses, dateUnit, cache, stripOptions } = context;

  const base: ChatMessage = {
    id: mail.id,
    fromAddress: mail.fromAddress,
    fromName: mail.fromName ?? null,
    toAddress: mail.toAddress ?? null,
    toNames: mail.toNames ?? null,
    ccAddress: mail.ccAddress ?? null,
    ccNames: mail.ccNames ?? null,
    date: toEpochMillis(mail.date, dateUnit),
    body: '',
    attachments: displayableAttachments(mail.attachments),
    isFromMe: isOwnAddress(mail.fromAddress, ownAddresses),
  };

  // No body yet, or no body ever. Report the state and do no transform work:
  // cleaning an empty string wastes a parse per pending message, and on a
  // freshly-opened large thread that is every message.
  const raw = mail.body ?? '';
  if (!raw) {
    return {
      ...base,
      bodyPending: mail.bodyPending ?? false,
      bodyFailed: mail.bodyFailed ?? false,
    };
  }

  const cached = cache?.get(mail.id, raw);
  const cleaned =
    cached ??
    cleanReplyBody(raw, {
      ...stripOptions,
      // The thread's first message has no history behind it, so there is
      // nothing to strip — only genuine content a quote pass could damage.
      keepQuotedHistory: isOldest,
    });
  if (!cached) cache?.set(mail.id, raw, cleaned);

  return { ...base, body: cleaned.html, applied: cleaned.applied };
}

/**
 * Convert a thread's mails into chat messages, oldest first.
 *
 * Order is normalized here rather than trusted from the caller: mail stores
 * return threads in arrival, UID or relevance order, and a chat view that
 * renders them out of sequence is not a chat view.
 *
 * Messages with an unparseable date sort last and keep `NaN`, so the view can
 * group them under an explicit "unknown date" heading instead of silently
 * dropping them or planting them in 1970.
 */
export function mailsToMessages(
  mails: readonly Mail[],
  options: MailsToMessagesOptions = {},
): ChatMessage[] {
  const {
    currentUserAddress,
    dateUnit = 'ms',
    cache,
    includeDrafts = false,
    containsThreadStart = true,
    ...stripOptions
  } = options;

  const ownAddresses = ownAddressSet(currentUserAddress);

  const visible = includeDrafts ? [...mails] : mails.filter((mail) => !mail.isDraft);

  const ordered = [...visible].sort((left, right) =>
    compareEpochMillis(toEpochMillis(left.date, dateUnit), toEpochMillis(right.date, dateUnit)),
  );

  // No id matches `undefined`, so a page that does not start the thread has no
  // opener and every one of its messages is quote-stripped.
  const oldestId = containsThreadStart ? ordered[0]?.id : undefined;

  return ordered.map((mail) =>
    toMessage(mail, {
      isOldest: mail.id === oldestId,
      ownAddresses,
      dateUnit,
      cache,
      stripOptions,
    }),
  );
}
