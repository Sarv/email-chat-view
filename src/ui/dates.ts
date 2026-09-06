/**
 * Rendering timestamps.
 *
 * Every message carries epoch MILLISECONDS by the time it reaches the view (the
 * transform normalizes that, and `dateUnit` is what it is for). Everything here
 * turns one of those numbers into something a person reads, in THEIR locale and
 * THEIR time zone — resolved at render time by `Intl`, from the browser, never
 * stored and never guessed.
 *
 * That is the whole reason there is no date library here: `Intl` already knows
 * that a reader in Tokyo wants 24-hour time and one in Chicago does not, which
 * a format string like `'h:mm a'` hard-codes wrongly for most of the world.
 */
import type { DayLabels, ViewLabels } from './labels.js';

/** An unreadable timestamp renders as nothing rather than as 1970. */
function toDate(dateMs: number): Date | null {
  if (typeof dateMs !== 'number' || !Number.isFinite(dateMs) || dateMs <= 0) return null;
  const date = new Date(dateMs);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whether two instants fall on the same calendar day in the READER's zone. */
export function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** The local calendar day before `reference`. */
function previousLocalDay(reference: Date): Date {
  const day = new Date(reference.getTime());
  // `setDate` with a value below 1 rolls back into the previous month (and
  // year), and it does so in local time — which is what "yesterday" means to
  // the reader. Subtracting 24 hours would be wrong on a DST boundary.
  day.setDate(day.getDate() - 1);
  return day;
}

/** Clock time alone — `10:04` or `10:04 AM`, whichever the locale uses. */
export function formatChatTime(dateMs: number, locale?: string | string[]): string {
  const date = toDate(dateMs);
  if (!date) return '';
  return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/**
 * The timestamp shown in a bubble header.
 *
 * Time alone for today, since the date separator above already said which day
 * it is; the day is added back for anything older, because a bubble can be
 * scrolled far away from its separator.
 */
export function formatChatTimestamp(
  dateMs: number,
  labels: ViewLabels,
  locale?: string | string[],
  now: number = Date.now(),
): string {
  const date = toDate(dateMs);
  if (!date) return '';
  const time = date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const reference = new Date(now);
  if (isSameLocalDay(date, reference)) return time;
  if (isSameLocalDay(date, previousLocalDay(reference))) return `${labels.yesterday} ${time}`;
  const day = date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  return `${day}, ${time}`;
}

/** The full instant, for a `title` attribute — nothing abbreviated away. */
export function formatFullTimestamp(dateMs: number, locale?: string | string[]): string {
  const date = toDate(dateMs);
  if (!date) return '';
  return date.toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' });
}

/** What a bubble header shows for a timestamp, and what its tooltip says. */
export interface BubbleTimestamp {
  /** Visible text. Empty when the date cannot be read — the element is then dropped. */
  text: string;
  /** Hover text: the full instant, and whether it is a guess. */
  title: string;
}

/**
 * The timestamp of one bubble, marked when the date was inferred.
 *
 * A message recovered from a quote is dated from the mail that quoted it (see
 * {@link ChatMessage.dateApprox}), and showing that as an exact time invents a
 * precision nobody has. The tilde is the same shorthand a clock face or a
 * measurement uses, and the tooltip says it in words for anyone who does not
 * read it that way.
 */
export function bubbleTimestamp(
  dateMs: number,
  approximate: boolean | undefined,
  labels: ViewLabels,
  locale?: string | string[],
  now: number = Date.now(),
): BubbleTimestamp {
  const text = formatChatTimestamp(dateMs, labels, locale, now);
  const full = formatFullTimestamp(dateMs, locale);
  if (!approximate) return { text, title: full };
  return { text: text && `~${text}`, title: `${labels.approximateTime}: ${full}` };
}

/**
 * Heading for a date separator: `Today`, `Yesterday`, `3 March 2025`, or the
 * explicit unknown-date label.
 *
 * Unreadable dates get their own heading rather than being dropped or filed
 * under 1970 — a message the reader can see and act on, with an honest "we
 * don't know when this was sent", beats a message that silently vanished.
 */
export function dateGroupLabel(
  dateMs: number,
  labels: DayLabels,
  locale?: string | string[],
  now: number = Date.now(),
): string {
  const date = toDate(dateMs);
  if (!date) return labels.unknownDate;
  const reference = new Date(now);
  if (isSameLocalDay(date, reference)) return labels.today;
  if (isSameLocalDay(date, previousLocalDay(reference))) return labels.yesterday;
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}
