/**
 * A thread's mails -> one bubble per MESSAGE, including the ones only ever seen
 * as quotes.
 *
 * The other transform, {@link mailsToMessages}, renders one bubble per mail and
 * throws the quoted history away. That is right when the store holds every
 * message of the conversation. Very often it does not: a mail forwarded into
 * the mailbox, a thread joined halfway, a colleague's reply pasted in — the
 * only copy of those messages is the quoted text inside a mail somebody else
 * sent. Render one bubble per mail and the conversation has holes in it.
 *
 * So each body is split ({@link splitMailBody}), every segment becomes a
 * candidate message, and the copies are then merged: the SAME message is quoted
 * again by every later reply, so a five-mail thread yields fifteen candidates
 * for five distinct messages.
 *
 * Three rules decide that merge, and each is a bug someone hit:
 *
 *   1. A REAL message — a mail's own segment — is never dropped. Not for an
 *      empty key, not for a collision. It is visible in the plain mail view, so
 *      a chat view that hides it makes the two disagree about what arrived.
 *   2. A QUOTED copy is dropped when its content already appears anywhere: in a
 *      real message, or in a quoted copy already kept. Otherwise the thread
 *      shows the same paragraph five times.
 *   3. A quote with no readable date is dated from the mail carrying it and
 *      says so ({@link ChatMessage.dateApprox}). Zero would sort it to 1970,
 *      which puts the oldest-looking bubble at the top of every thread.
 */
import { createKeyedCache, type KeyedCache } from '../transform/lru-cache.js';
import {
  compareEpochMillis,
  displayableAttachments,
  isOwnAddress,
  ownAddressSet,
  toEpochMillis,
} from '../transform/mail-fields.js';
import type { ChatMessage, DateUnit, Mail } from '../types.js';

import { splitMailBody, type BodySegment, type SplitMailBodyOptions } from './split-body.js';

/** Memo for split bodies, keyed by mail id and invalidated by body content. */
export type SegmentCache = KeyedCache<BodySegment[]>;

/**
 * Create a bounded, least-recently-used segment cache.
 *
 * Splitting is the most expensive thing this package does — a parse, a boundary
 * sweep, and a clean per segment. Hold one of these for the lifetime of a
 * thread view and pass it on every call; without it, each newly arrived body
 * re-splits every body already rendered.
 */
export function createSegmentCache(capacity?: number): SegmentCache {
  return createKeyedCache<BodySegment[]>(capacity);
}

/** How much of a message's text is enough to recognise a quoted copy of it. */
const CONTENT_KEY_CHARS = 150;

/**
 * A normalized key for "is this the same message?".
 *
 * Tags, entities and every non-alphanumeric character are thrown away, so the
 * cosmetic differences between an original and the copy a client quoted —
 * `&nbsp;` for a space, a mention rendered as a link in one and as plain text
 * in the other, a wrapped line, altered punctuation spacing — collapse to the
 * same key and the copies merge into one bubble.
 *
 * Truncated because quoting mangles the TAIL of a message far more than the
 * head: a quote level too deep gets cut off, a client appends its own footer.
 * Comparing openings recognises the copies; comparing whole bodies does not.
 */
export function contentKey(html: string): string {
  return (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, CONTENT_KEY_CHARS);
}

/** Options for {@link threadToMessages}. */
export interface ThreadToMessagesOptions extends SplitMailBodyOptions {
  /**
   * The reader's own address, or addresses. Omit it and nothing right-aligns,
   * which is the correct fallback — see {@link isOwnAddress}.
   */
  currentUserAddress?: string | readonly string[];
  /** Unit of {@link Mail.date}. Defaults to `'ms'`. See {@link DateUnit}. */
  dateUnit?: DateUnit;
  /** Memo for split bodies. Strongly recommended — see {@link createSegmentCache}. */
  cache?: SegmentCache;
  /** Render drafts too. Off by default; an unsent draft is not a turn. */
  includeDrafts?: boolean;
}

/** A candidate message, before de-duplication and date inference. */
interface Candidate {
  message: ChatMessage;
  key: string;
  isOwn: boolean;
  /** Position in the flattened scan. The tiebreak that keeps sorting stable. */
  order: number;
}

/** The carrier mail's own message, taken whole from the mail's own fields. */
function ownCandidate(
  mail: Mail,
  segment: BodySegment,
  context: { ownAddresses: Set<string>; dateUnit: DateUnit; order: number },
): Candidate {
  return {
    message: {
      id: mail.id,
      fromAddress: mail.fromAddress,
      fromName: mail.fromName ?? null,
      toAddress: mail.toAddress ?? null,
      toNames: mail.toNames ?? null,
      ccAddress: mail.ccAddress ?? null,
      ccNames: mail.ccNames ?? null,
      date: toEpochMillis(mail.date, context.dateUnit),
      body: segment.html,
      applied: segment.applied,
      attachments: displayableAttachments(mail.attachments),
      isFromMe: isOwnAddress(mail.fromAddress, context.ownAddresses),
    },
    key: contentKey(segment.html),
    isOwn: true,
    order: context.order,
  };
}

/**
 * Date a quote whose attribution line carried no readable date.
 *
 * The mail carrying the quote is a real upper bound — a message cannot be
 * quoted before it is written — and it is far better evidence than a
 * neighbouring bubble. The one-millisecond-per-level offset encodes the other
 * thing the body already tells us: quotes run newest to oldest down the page,
 * so level 2 is older than level 1. Sub-second, so nothing the reader sees
 * changes; enough to sort deterministically, which sharing one timestamp is not.
 */
function inferredQuoteDate(carrierMillis: number, index: number): number {
  return Number.isNaN(carrierMillis) ? Number.NaN : carrierMillis - index;
}

/**
 * The date to put on a quoted message, and whether it is a guess.
 *
 * A date read off the attribution line is taken as written, with one exception
 * that is arithmetic rather than taste: a message cannot be quoted before it
 * was written, so a read date LATER than the carrier means the parse was wrong
 * — a misread numeric date, a two-digit year, a relative expression no
 * reference date could rescue. Believing it sorts the quoted message BELOW the
 * reply quoting it and the conversation reads backwards, so the carrier's own
 * time is used instead and marked as inferred.
 *
 * A carrier with no readable date of its own cannot contradict anything, so the
 * comparison quietly passes (`NaN > x` is false) and the read date stands.
 */
function quoteDate(
  readDate: number | null,
  carrierMillis: number,
  index: number,
): { date: number; approx: boolean } {
  if (readDate !== null && !(readDate > carrierMillis)) return { date: readDate, approx: false };
  return { date: inferredQuoteDate(carrierMillis, index), approx: true };
}

/**
 * A message known only from the quote of it inside `mail`.
 *
 * Everything comes from the attribution line, and what the line does not say is
 * left null rather than borrowed from the carrier mail. Recipients especially:
 * the carrier's `To` is who the CARRIER was sent to, and stamping that on a
 * message somebody else wrote invents a fact the reader cannot check.
 */
function quotedCandidate(
  mail: Mail,
  segment: BodySegment,
  index: number,
  context: { ownAddresses: Set<string>; dateUnit: DateUnit; order: number },
): Candidate {
  const { attribution } = segment;
  const { date, approx } = quoteDate(
    attribution?.date ?? null,
    toEpochMillis(mail.date, context.dateUnit),
    index,
  );
  return {
    message: {
      // Derived from the carrier and the segment's position in it, so the id is
      // stable as the thread grows. An index into the finished list is not: one
      // new mail renumbers every bubble after it, React remounts them all, and
      // each body iframe reloads mid-read.
      id: `${mail.id}#${index}`,
      fromAddress: attribution?.email ?? attribution?.name ?? '',
      fromName: attribution?.name ?? null,
      toAddress: null,
      date,
      ...(approx ? { dateApprox: true } : {}),
      body: segment.html,
      applied: segment.applied,
      isFromMe: isOwnAddress(attribution?.email, context.ownAddresses),
      sourceId: mail.id,
    },
    key: contentKey(segment.html),
    isOwn: false,
    order: context.order,
  };
}

/** A mail whose body has not arrived: one bubble reporting that state. */
function pendingCandidate(
  mail: Mail,
  context: { ownAddresses: Set<string>; dateUnit: DateUnit; order: number },
): Candidate {
  const candidate = ownCandidate(
    mail,
    { attribution: null, isOwn: true, html: '', applied: [] },
    context,
  );
  return {
    ...candidate,
    message: {
      ...candidate.message,
      applied: undefined,
      bodyPending: mail.bodyPending ?? false,
      bodyFailed: mail.bodyFailed ?? false,
    },
  };
}

/**
 * Split one mail's body, through the cache when there is one.
 *
 * The mail's own send time goes in as the reference date, so "On Monday" in an
 * attribution line means the Monday before THIS mail rather than the Monday
 * before the reader opened the thread. An unreadable send time is left out
 * entirely — an Invalid Date as an anchor is worse than no anchor.
 */
function segmentsOf(
  mail: Mail,
  options: ThreadToMessagesOptions,
  body: string,
  carrierMillis: number,
): BodySegment[] {
  const cached = options.cache?.get(mail.id, body);
  if (cached) return cached;
  const segments = splitMailBody(body, {
    ...options,
    ...(Number.isNaN(carrierMillis) ? {} : { refDate: new Date(carrierMillis) }),
  });
  options.cache?.set(mail.id, body, segments);
  return segments;
}

/**
 * Drop quoted copies of content already accounted for.
 *
 * Real messages are kept unconditionally and their keys claimed first, so a
 * quoted copy never survives a real one regardless of which mail came first.
 */
function dedupe(candidates: readonly Candidate[]): Candidate[] {
  const realKeys = new Set(
    candidates.filter((candidate) => candidate.isOwn && candidate.key).map(({ key }) => key),
  );
  const keptQuoted = new Set<string>();

  return candidates.filter((candidate) => {
    if (candidate.isOwn) return true;
    // A quoted segment with no text at all is quoting noise — a stray
    // separator, an empty quote level — not a message.
    if (!candidate.key) return false;
    if (realKeys.has(candidate.key) || keptQuoted.has(candidate.key)) return false;
    keptQuoted.add(candidate.key);
    return true;
  });
}

/**
 * Build a conversation out of a thread's mails, oldest first, with the messages
 * that exist only as quotes recovered as bubbles of their own.
 *
 * Deterministic: same input, same output, no model, no network. An application
 * doing LLM extraction can use this as the instant first render and replace it
 * when the model answers.
 */
export function threadToMessages(
  mails: readonly Mail[],
  options: ThreadToMessagesOptions = {},
): ChatMessage[] {
  const { currentUserAddress, dateUnit = 'ms', includeDrafts = false } = options;
  const ownAddresses = ownAddressSet(currentUserAddress);

  const visible = includeDrafts ? [...mails] : mails.filter((mail) => !mail.isDraft);
  const ordered = [...visible].sort((left, right) =>
    compareEpochMillis(toEpochMillis(left.date, dateUnit), toEpochMillis(right.date, dateUnit)),
  );

  const candidates: Candidate[] = [];
  for (const mail of ordered) {
    const body = mail.body ?? '';
    if (!body) {
      candidates.push(pendingCandidate(mail, { ownAddresses, dateUnit, order: candidates.length }));
      continue;
    }
    segmentsOf(mail, options, body, toEpochMillis(mail.date, dateUnit)).forEach(
      (segment, index) => {
        const order = candidates.length;
        candidates.push(
          segment.isOwn
            ? ownCandidate(mail, segment, { ownAddresses, dateUnit, order })
            : quotedCandidate(mail, segment, index, { ownAddresses, dateUnit, order }),
        );
      },
    );
  }

  // Scan order is the tiebreak, not the order: two messages sharing a timestamp
  // keep the sequence they were read in, and a message whose date is unreadable
  // sorts last with `NaN` intact so the view can group it honestly.
  return dedupe(candidates)
    .sort(
      (left, right) =>
        compareEpochMillis(left.message.date, right.message.date) || left.order - right.order,
    )
    .map(({ message }) => message);
}
