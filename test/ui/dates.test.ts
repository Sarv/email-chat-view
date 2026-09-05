import { describe, expect, it } from 'vitest';

import {
  dateGroupLabel,
  formatChatTime,
  formatChatTimestamp,
  formatFullTimestamp,
  isSameLocalDay,
} from '../../src/ui/dates.js';
import { DEFAULT_LABELS } from '../../src/ui/labels.js';

/**
 * Local-time constructors throughout, never UTC millisecond literals.
 *
 * Everything in this module answers a question about the READER's calendar day,
 * so a test pinned to a UTC instant would pass in London and fail in Auckland.
 */
const NOW = new Date(2026, 2, 3, 14, 30).getTime(); // 3 March 2026, local
const TODAY = new Date(2026, 2, 3, 10, 4).getTime();
const YESTERDAY = new Date(2026, 2, 2, 21, 15).getTime();
const LAST_YEAR = new Date(2025, 10, 9, 8, 5).getTime();

/**
 * Every shape of unreadable timestamp a mail store has been seen to produce.
 *
 * `1e16` is the one that looks fine and is not: it is a finite positive number,
 * so it passes every arithmetic guard, but it is outside the range `Date` can
 * represent, and every `toLocale*` call on it throws a RangeError.
 */
const UNREADABLE = [
  0,
  -1,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  1e16,
  undefined as unknown as number,
];

describe('isSameLocalDay', () => {
  it('compares the local calendar day, not the instant', () => {
    expect(isSameLocalDay(new Date(TODAY), new Date(NOW))).toBe(true);
    expect(isSameLocalDay(new Date(YESTERDAY), new Date(NOW))).toBe(false);
  });

  // Regression: comparing only month and day would fold the same date in two
  // different years together, so a year-old message would read as "Today".
  it('does not fold the same day in a different year', () => {
    expect(isSameLocalDay(new Date(2025, 2, 3), new Date(2026, 2, 3))).toBe(false);
    expect(isSameLocalDay(new Date(2026, 1, 3), new Date(2026, 2, 3))).toBe(false);
  });
});

describe('formatChatTime', () => {
  it('renders the clock time in the reader’s locale', () => {
    expect(formatChatTime(TODAY, 'en-GB')).toBe('10:04');
    expect(formatChatTime(TODAY, 'en-US')).toMatch(/10:04\s?AM/i);
  });

  // Regression: an unreadable timestamp rendering as 1 January 1970 instead of
  // as nothing. The bubble drops the element entirely when this is empty.
  it('renders nothing for a timestamp it cannot read', () => {
    for (const value of UNREADABLE) expect(formatChatTime(value)).toBe('');
  });
});

describe('formatChatTimestamp', () => {
  it('shows the time alone for today', () => {
    expect(formatChatTimestamp(TODAY, DEFAULT_LABELS, 'en-GB', NOW)).toBe('10:04');
  });

  it('prefixes yesterday’s label', () => {
    expect(formatChatTimestamp(YESTERDAY, DEFAULT_LABELS, 'en-GB', NOW)).toBe('Yesterday 21:15');
  });

  // Regression: a bubble can be scrolled far from its date separator, so
  // anything older than yesterday has to carry its own day.
  it('adds the day for anything older', () => {
    expect(formatChatTimestamp(LAST_YEAR, DEFAULT_LABELS, 'en-GB', NOW)).toBe('9 Nov, 8:05');
  });

  // Regression: "yesterday" computed by subtracting 24 hours breaks at a month
  // boundary and on a DST change; `setDate(getDate() - 1)` is the local-calendar
  // step that does not.
  it('crosses a month boundary correctly', () => {
    const firstOfMarch = new Date(2026, 2, 1, 9, 0).getTime();
    const lastOfFebruary = new Date(2026, 1, 28, 23, 30).getTime();
    expect(formatChatTimestamp(lastOfFebruary, DEFAULT_LABELS, 'en-GB', firstOfMarch)).toBe(
      'Yesterday 23:30',
    );
  });

  it('renders nothing for a timestamp it cannot read', () => {
    for (const value of UNREADABLE) {
      expect(formatChatTimestamp(value, DEFAULT_LABELS, 'en-GB', NOW)).toBe('');
    }
  });

  it('defaults “now” to the real clock', () => {
    expect(formatChatTimestamp(Date.now(), DEFAULT_LABELS, 'en-GB')).toMatch(/^\d{1,2}:\d{2}$/);
  });
});

describe('formatFullTimestamp', () => {
  // Regression: the `title` on a bubble's time is the one place nothing may be
  // abbreviated away — it is what a reader hovers when the short form is
  // ambiguous.
  it('spells the instant out in full', () => {
    const full = formatFullTimestamp(TODAY, 'en-GB');
    expect(full).toContain('March');
    expect(full).toContain('2026');
  });

  it('renders nothing for a timestamp it cannot read', () => {
    for (const value of UNREADABLE) expect(formatFullTimestamp(value)).toBe('');
  });
});

describe('dateGroupLabel', () => {
  it('names today and yesterday from the labels', () => {
    expect(dateGroupLabel(TODAY, DEFAULT_LABELS, 'en-GB', NOW)).toBe('Today');
    expect(dateGroupLabel(YESTERDAY, DEFAULT_LABELS, 'en-GB', NOW)).toBe('Yesterday');
  });

  it('spells the date out for older days, in the reader’s locale', () => {
    expect(dateGroupLabel(LAST_YEAR, DEFAULT_LABELS, 'en-GB', NOW)).toBe('9 November 2025');
    expect(dateGroupLabel(LAST_YEAR, DEFAULT_LABELS, 'en-US', NOW)).toBe('November 9, 2025');
  });

  // Regression: a message with an unreadable date must get its own honest
  // heading. Dropping it loses mail; filing it under 1970 sorts it to the far
  // end of the thread where nobody looks.
  it('gives an unreadable date its own heading', () => {
    for (const value of UNREADABLE) {
      expect(dateGroupLabel(value, DEFAULT_LABELS, 'en-GB', NOW)).toBe(DEFAULT_LABELS.unknownDate);
    }
  });

  it('defaults “now” to the real clock', () => {
    expect(dateGroupLabel(Date.now(), DEFAULT_LABELS, 'en-GB')).toBe(DEFAULT_LABELS.today);
  });
});
