/**
 * Turning a flat list of messages into the shape a chat is read in.
 *
 * Two independent groupings, both purely derived from the messages so there is
 * no state to get out of sync with them:
 *
 *   by DAY   -> the date separators between blocks
 *   by RUN   -> consecutive messages from one sender collapse into a run, and
 *               the follow-ups drop their avatar and header
 *
 * Both are plain functions over `ChatMessage[]`, which is what makes them
 * testable without rendering anything, and what lets a consumer reuse them to
 * build a different layout on the same data.
 */
import type { ChatMessage } from '../types.js';
import { dateGroupLabel } from './dates.js';
import type { ViewLabels } from './labels.js';

/** Messages from one sender inside this window read as one turn. */
export const DEFAULT_SENDER_RUN_MS = 5 * 60 * 1000;

/** A sender address that identifies nobody, and must never merge with another. */
const UNIDENTIFIED = new Set(['', 'unknown']);

/** Usable, comparable form of a sender address; empty when unidentified. */
function senderKey(address: string | null | undefined): string {
  const normalized = (address || '').trim().toLowerCase();
  return UNIDENTIFIED.has(normalized) ? '' : normalized;
}

/** A timestamp usable for arithmetic, or NaN. */
function usableDate(dateMs: number | null | undefined): number {
  return typeof dateMs === 'number' && Number.isFinite(dateMs) && dateMs > 0 ? dateMs : Number.NaN;
}

/**
 * Whether `next` continues `previous`'s run.
 *
 * Deliberately strict — every uncertainty answers "no", because a wrongly
 * merged run hides a header and so attributes one person's message to another,
 * whereas a wrongly split run merely repeats an avatar.
 */
export function isSameSenderRun(
  previous: ChatMessage | null | undefined,
  next: ChatMessage | null | undefined,
  windowMs: number = DEFAULT_SENDER_RUN_MS,
): boolean {
  if (!previous || !next) return false;
  // A window of zero (or less) is how a consumer turns run-grouping off, so
  // every message keeps its own header. Answered before the timestamps, since
  // two messages with the identical timestamp would otherwise still merge.
  if (!(windowMs > 0)) return false;

  const previousSender = senderKey(previous.fromAddress);
  const nextSender = senderKey(next.fromAddress);
  if (!previousSender || !nextSender || previousSender !== nextSender) return false;

  const previousDate = usableDate(previous.date);
  const nextDate = usableDate(next.date);
  if (Number.isNaN(previousDate) || Number.isNaN(nextDate)) return false;

  return Math.abs(nextDate - previousDate) <= windowMs;
}

/** One day's worth of messages, under one separator. */
export interface DateGroup {
  /** Stable identity for the day — the React key. */
  key: string;
  /** What the separator reads. */
  label: string;
  /** Index of this group's first message in the ORIGINAL list. */
  startIndex: number;
  /** The messages, in the order given. */
  messages: ChatMessage[];
}

/** `2025-03-03` in the reader's own zone, or `unknown`. */
function localDayKey(dateMs: number): string {
  if (typeof dateMs !== 'number' || !Number.isFinite(dateMs) || dateMs <= 0) return 'unknown';
  const date = new Date(dateMs);
  if (Number.isNaN(date.getTime())) return 'unknown';
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Split messages into consecutive day blocks.
 *
 * Consecutive, not sorted or bucketed: the list arrives in reading order and
 * stays in it. Re-sorting here would fight the transform, which already decided
 * the order (and deliberately puts undated messages last), and re-bucketing
 * would move a message the reader can already see.
 *
 * The key is the reader's local calendar day, not the label, so "Today" stays
 * one group across a locale change and two blocks of undated messages on either
 * side of a dated one do not silently fuse.
 */
export function groupMessagesByDate(
  messages: readonly ChatMessage[],
  labels: ViewLabels,
  locale?: string | string[],
  now?: number,
): DateGroup[] {
  const groups: DateGroup[] = [];
  let openKey: string | null = null;

  messages.forEach((message, index) => {
    const key = localDayKey(message.date);
    if (key !== openKey) {
      groups.push({
        key,
        label: dateGroupLabel(message.date, labels, locale, now),
        startIndex: index,
        messages: [],
      });
      openKey = key;
    }
    groups[groups.length - 1]!.messages.push(message);
  });

  return groups;
}
