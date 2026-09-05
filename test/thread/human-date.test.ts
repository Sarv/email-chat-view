import * as chrono from 'chrono-node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseHumanDate } from '../../src/thread/human-date.js';

/** The parsed value as local calendar parts, which is how a reader sees it. */
function parts(ms: number | null) {
  expect(ms).not.toBeNull();
  const date = new Date(ms as number);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseHumanDate', () => {
  // Regression: THE reason this parser exists. `Date.parse`, `new Date()` and
  // chrono's default locale all read "07/08/2026" as 8 July. Most of the world
  // wrote 7 August. Bubbles are sorted by date, so getting this wrong does not
  // just mislabel one message — it reorders the thread around it.
  it('reads an ambiguous numeric date day-first', () => {
    expect(parts(parseHumanDate('07/08/2026'))).toMatchObject({ year: 2026, month: 8, day: 7 });
  });

  // Regression: day-first must not break US-written mail. A leading number
  // above 12 cannot be a month, so both locales agree — if this ever changed,
  // half the corpus would silently move.
  it('leaves an unambiguous US numeric date alone', () => {
    expect(parts(parseHumanDate('4/17/2026, 2:51:17 PM'))).toMatchObject({
      year: 2026,
      month: 4,
      day: 17,
      hour: 14,
    });
  });

  it('reads a textual Gmail attribution date', () => {
    expect(parts(parseHumanDate('Thu, Jul 9, 2026 at 10:52 AM'))).toMatchObject({
      year: 2026,
      month: 7,
      day: 9,
      hour: 10,
      minute: 52,
    });
  });

  it('reads a day-first textual date with a 24-hour time', () => {
    expect(parts(parseHumanDate('27 April 2026 18:31'))).toMatchObject({
      year: 2026,
      month: 4,
      day: 27,
      hour: 18,
      minute: 31,
    });
  });

  // Regression: attribution lines arrive with newlines and runs of whitespace
  // from the HTML they were flattened out of. Without the collapse, chrono sees
  // a different string than the one that was tested and returns null.
  it('collapses whitespace before parsing', () => {
    expect(parts(parseHumanDate('  Jul   9,\n2026  '))).toMatchObject({ month: 7, day: 9 });
  });

  // Regression: a relative expression must resolve against the mail it came
  // from, not against the moment the thread happens to be rendered — otherwise
  // the same quote shows a different date every day it is reopened.
  it('anchors a relative expression to the reference date', () => {
    const reference = new Date(2026, 4, 10, 12, 0, 0);
    expect(parts(parseHumanDate('yesterday', reference))).toMatchObject({
      year: 2026,
      month: 5,
      day: 9,
    });
  });

  it('returns null for empty, whitespace and nullish input', () => {
    expect(parseHumanDate('')).toBeNull();
    expect(parseHumanDate('   ')).toBeNull();
    expect(parseHumanDate(null)).toBeNull();
    expect(parseHumanDate(undefined)).toBeNull();
  });

  // Regression: null, never 0. A zero would be a real timestamp — 1 Jan 1970 —
  // and would sort the message to the very top of the thread instead of letting
  // the caller fall back to the mail's own date.
  it('returns null rather than zero when nothing is date-like', () => {
    expect(parseHumanDate('wrote:')).toBeNull();
  });

  // Regression: chrono throws on a few pathological inputs instead of returning
  // null. An unparseable date is an ordinary outcome here; letting the throw
  // escape would take down the whole thread split over one bad quote line.
  it('returns null when the parser throws', () => {
    vi.spyOn(chrono.en.GB, 'parseDate').mockImplementation(() => {
      throw new Error('pathological input');
    });
    expect(parseHumanDate('27 April 2026')).toBeNull();
  });
});
