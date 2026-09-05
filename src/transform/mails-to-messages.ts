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
import type { CleanReplyBodyOptions } from './strip.js';
import { cleanReplyBody } from './strip.js';
import type { Attachment, ChatMessage, DateUnit, Mail } from '../types.js';

/**
 * Memo for cleaned bodies, keyed by message id and invalidated by body content.
 *
 * Hold one of these for the lifetime of a thread view and pass it on every
 * call. Without it, the transform is still correct — just quadratic in the
 * number of updates, which is the difference between a thread that opens
 * instantly and one that locks the tab.
 */
export interface BodyCache {
  /** Cleaned result for this mail, if the cached body still matches. */
  get(id: string, body: string): { html: string; applied: string[] } | undefined;
  /** Record a cleaned result. */
  set(id: string, body: string, result: { html: string; applied: string[] }): void;
  /** Drop everything. Call when switching threads. */
  clear(): void;
  /** Current entry count, for diagnostics and tests. */
  readonly size: number;
}

/** Default cache capacity — comfortably more than any single thread. */
const DEFAULT_CACHE_CAPACITY = 500;

/**
 * Create a bounded, least-recently-used body cache.
 *
 * Bounded because entries hold both the source and cleaned HTML: unbounded, a
 * long-lived session browsing thousands of messages would retain every body it
 * ever rendered. `Map` iterates in insertion order, which is all an LRU needs —
 * re-inserting on a hit moves an entry to the end, so the oldest key is always
 * first.
 */
export function createBodyCache(capacity = DEFAULT_CACHE_CAPACITY): BodyCache {
  const entries = new Map<string, { body: string; result: { html: string; applied: string[] } }>();

  return {
    get(id, body) {
      const entry = entries.get(id);
      // Compare the body, not just the id. A pending message whose body later
      // arrives keeps the same id, and serving the stale (empty) result for it
      // is exactly the bug where a message never renders its content.
      if (!entry || entry.body !== body) return undefined;
      entries.delete(id);
      entries.set(id, entry);
      return entry.result;
    },
    set(id, body, result) {
      if (entries.has(id)) entries.delete(id);
      entries.set(id, { body, result });
      if (entries.size > capacity) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
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
}

/** Normalize a declared-unit timestamp to epoch milliseconds. */
function toEpochMillis(date: number, unit: DateUnit): number {
  if (!Number.isFinite(date) || date <= 0) return Number.NaN;
  return unit === 's' ? date * 1000 : date;
}

/** Lowercased, trimmed set of the reader's addresses; empty when unresolvable. */
function ownAddressSet(input: MailsToMessagesOptions['currentUserAddress']): Set<string> {
  const values = input === undefined ? [] : Array.isArray(input) ? input : [input as string];
  const own = new Set<string>();
  for (const value of values) {
    const normalized = (value ?? '').trim().toLowerCase();
    // A comma-separated blob is a recipient LIST that got passed in where an
    // identity was expected, not an identity. Treating it as one would flag
    // every recipient as the reader, so it is rejected outright.
    if (!normalized || normalized.includes(',')) continue;
    own.add(normalized);
  }
  return own;
}

/** Attachments worth showing: real parts only, inline body images filtered out. */
function displayableAttachments(attachments?: Attachment[]): Attachment[] | undefined {
  if (!attachments?.length) return undefined;
  const visible = attachments.filter((attachment) => !attachment.inline);
  return visible.length ? visible : undefined;
}

/**
 * Convert one mail into one chat message.
 *
 * Exported for incremental use: when a single body arrives, re-transform that
 * message alone rather than the thread. `isOldest` is thread context the
 * message cannot know about itself.
 */
export function mailToMessage(
  mail: Mail,
  context: {
    isOldest: boolean;
    ownAddresses: Set<string>;
    dateUnit: DateUnit;
    cache?: BodyCache;
    stripOptions?: CleanReplyBodyOptions;
  },
): ChatMessage {
  const { isOldest, ownAddresses, dateUnit, cache, stripOptions } = context;

  const from = (mail.fromAddress ?? '').trim().toLowerCase();
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
    // undefined, not false, when identity is unknown — the view can then tell
    // "not mine" apart from "unknowable" if it ever wants to.
    isFromMe: ownAddresses.size ? ownAddresses.has(from) : undefined,
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
  const { currentUserAddress, dateUnit = 'ms', cache, includeDrafts = false, ...stripOptions } =
    options;

  const ownAddresses = ownAddressSet(currentUserAddress);

  const visible = includeDrafts ? [...mails] : mails.filter((mail) => !mail.isDraft);

  const ordered = [...visible].sort((left, right) => {
    const leftDate = toEpochMillis(left.date, dateUnit);
    const rightDate = toEpochMillis(right.date, dateUnit);
    const leftUnknown = Number.isNaN(leftDate);
    const rightUnknown = Number.isNaN(rightDate);
    if (leftUnknown && rightUnknown) return 0;
    if (leftUnknown) return 1;
    if (rightUnknown) return -1;
    return leftDate - rightDate;
  });

  const oldestId = ordered[0]?.id;

  return ordered.map((mail) =>
    mailToMessage(mail, {
      isOldest: mail.id === oldestId,
      ownAddresses,
      dateUnit,
      cache,
      stripOptions,
    }),
  );
}
