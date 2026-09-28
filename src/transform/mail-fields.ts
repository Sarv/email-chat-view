/**
 * Reading the fields every transform needs off a {@link Mail}, one way.
 *
 * Two transforms turn mail into bubbles — {@link mailsToMessages}, one bubble
 * per message, and {@link threadToMessages}, one bubble per message QUOTED
 * inside them — and they must agree on the boring questions: what unit is this
 * date, is this address the reader's, does this attachment get a chip. Two
 * copies of those answers is how a thread renders one way in the plain view and
 * another way in the split view, for the same mail.
 */
import type { Attachment, DateUnit } from '../types.js';

/**
 * Normalize a declared-unit timestamp to epoch milliseconds.
 *
 * Returns `NaN` for a date that cannot be read, and that value is carried all
 * the way to the view on purpose: a message the reader can see under an honest
 * "unknown date" heading beats one silently dropped or planted in 1970.
 */
export function toEpochMillis(date: number, unit: DateUnit): number {
  if (!Number.isFinite(date) || date <= 0) return Number.NaN;
  return unit === 's' ? date * 1000 : date;
}

/**
 * Order two normalized timestamps, oldest first, with unreadable dates LAST.
 *
 * `NaN` compares false against everything, so a comparator that does not name
 * the case returns an arbitrary order and `Array.sort` scatters those messages
 * through the thread.
 *
 * Exported so a host sorting messages it built itself puts them in the same
 * order `mailsToMessages` and `threadToMessages` do. The contract:
 *
 * - both readable: `left - right` — negative when `left` is older, positive
 *   when it is newer, `0` when they are equal;
 * - exactly one is `NaN`: the `NaN` side sorts AFTER the readable one (`1` when
 *   `left` is `NaN`, `-1` when `right` is), so every unreadable date lands at
 *   the end of the list, where the view groups them under an honest heading;
 * - both `NaN`: `0`, so a stable sort keeps them in the order it was given —
 *   chain a tiebreak (`|| left.order - right.order`) when that order is not
 *   already the one you want.
 *
 * Only `NaN` counts as unreadable here. Normalize first, the way the transforms
 * do ({@link toEpochMillis}: zero, negative and non-finite dates become `NaN`),
 * because a raw `0` passed straight in sorts as 1970, at the top of the thread.
 *
 * @param left - Epoch milliseconds, or `NaN` for an unreadable date.
 * @param right - Epoch milliseconds, or `NaN` for an unreadable date.
 * @returns A comparator result for `Array.prototype.sort`.
 *
 * @example
 * ```ts
 * messages.sort((a, b) => compareEpochMillis(a.date, b.date));
 * ```
 */
export function compareEpochMillis(left: number, right: number): number {
  const leftUnknown = Number.isNaN(left);
  const rightUnknown = Number.isNaN(right);
  if (leftUnknown && rightUnknown) return 0;
  if (leftUnknown) return 1;
  if (rightUnknown) return -1;
  return left - right;
}

/** Lowercased, trimmed set of the reader's addresses; empty when unresolvable. */
export function ownAddressSet(input?: string | readonly string[]): Set<string> {
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

/**
 * Whether an address is the reader's — `undefined`, not `false`, when the
 * reader's identity is not knowable.
 *
 * The view left-aligns everything in that case rather than guessing:
 * mislabelling someone else's message as yours is a worse error than a flat
 * layout.
 */
export function isOwnAddress(
  address: string | null | undefined,
  ownAddresses: Set<string>,
): boolean | undefined {
  if (!ownAddresses.size) return undefined;
  return ownAddresses.has((address ?? '').trim().toLowerCase());
}

/** Attachments worth showing: real parts only, inline body images filtered out. */
export function displayableAttachments(attachments?: Attachment[]): Attachment[] | undefined {
  if (!attachments?.length) return undefined;
  const visible = attachments.filter((attachment) => !attachment.inline);
  return visible.length ? visible : undefined;
}
