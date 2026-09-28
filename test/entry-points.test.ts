/**
 * The public surface a host imports, checked from the entry points themselves.
 *
 * Every other suite imports the module that defines a function. That proves the
 * function works; it does not prove a consumer can reach it. A helper that
 * quietly drops out of `src/transform.ts` still passes every one of those tests
 * while every host importing it fails to build — or, worse, keeps a private
 * copy "until it is exported" that drifts from the library's rule.
 *
 * The date-order helpers are the case in point: a host that splits a body
 * itself (an LLM extraction pass) must date and sort its bubbles exactly the way
 * `threadToMessages` does, or its chat view and the library's disagree about the
 * order of the same conversation.
 */
import { describe, expect, it } from 'vitest';

import * as root from '../src/index.js';
import {
  quoteDate as definedQuoteDate,
  threadToMessages,
} from '../src/thread/thread-to-messages.js';
import {
  compareEpochMillis as definedCompareEpochMillis,
  toEpochMillis,
} from '../src/transform/mail-fields.js';
import * as transform from '../src/transform.js';
import type { QuoteDate } from '../src/transform.js';

import { parser } from './helpers/parser.js';

const { compareEpochMillis, quoteDate } = transform;

/** Fixed instants. Literal, because a test must not depend on "now". */
const SEP_1 = Date.UTC(2026, 8, 1, 10, 4, 0);
const SEP_2 = Date.UTC(2026, 8, 2, 9, 30, 0);
const SEP_3 = Date.UTC(2026, 8, 3, 16, 15, 0);

describe('entry points: date-order helpers', () => {
  // Regression: a host importing `compareEpochMillis` / `quoteDate` from
  // '@sarv-in/email-chat-view/transform' fails to build if the React-free entry
  // stops exporting them.
  it('exports compareEpochMillis and quoteDate from the React-free /transform entry', () => {
    expect(typeof transform.compareEpochMillis).toBe('function');
    expect(typeof transform.quoteDate).toBe('function');
  });

  // Regression: an export that is a re-implementation rather than the function
  // the transforms call would let the two orders drift apart silently — the
  // host's bubbles would sort one way and the library's another.
  it('exports the very functions the transforms run on, not copies', () => {
    expect(transform.compareEpochMillis).toBe(definedCompareEpochMillis);
    expect(transform.quoteDate).toBe(definedQuoteDate);
  });

  // Regression: the package root promises everything on /transform too; a host
  // importing from the root would lose the helpers if that re-export broke.
  it('re-exports them from the package root', () => {
    expect(root.compareEpochMillis).toBe(definedCompareEpochMillis);
    expect(root.quoteDate).toBe(definedQuoteDate);
  });
});

describe('compareEpochMillis contract', () => {
  // Regression: the basic order. Inverted, every thread renders newest-first.
  it('orders two readable dates oldest first, and ties as equal', () => {
    expect(compareEpochMillis(SEP_1, SEP_2)).toBeLessThan(0);
    expect(compareEpochMillis(SEP_2, SEP_1)).toBeGreaterThan(0);
    expect(compareEpochMillis(SEP_1, SEP_1)).toBe(0);
  });

  // Regression: NaN compares false against everything, so a comparator that
  // does not name the case scatters undated messages through the thread.
  it('sorts an unreadable date after any readable one, whichever side it is on', () => {
    expect(compareEpochMillis(Number.NaN, SEP_1)).toBe(1);
    expect(compareEpochMillis(SEP_1, Number.NaN)).toBe(-1);
  });

  // Regression: two undated messages must compare equal, or a stable sort
  // reorders them arbitrarily and a caller's tiebreak never runs.
  it('treats two unreadable dates as equal so a tiebreak or stable sort decides', () => {
    expect(compareEpochMillis(Number.NaN, Number.NaN)).toBe(0);
    const undated = [
      { id: 'first', date: Number.NaN },
      { id: 'second', date: Number.NaN },
    ];
    expect(undated.sort((a, b) => compareEpochMillis(a.date, b.date)).map(({ id }) => id)).toEqual([
      'first',
      'second',
    ]);
  });

  // Regression: a host sorting its own bubbles with the export must land on the
  // order the library produces — undated ones grouped at the END, not in 1970.
  it('puts every unreadable date at the end of a sorted list', () => {
    const dates = [SEP_3, Number.NaN, SEP_1, Number.NaN, SEP_2];
    expect([...dates].sort(compareEpochMillis)).toEqual([
      SEP_1,
      SEP_2,
      SEP_3,
      Number.NaN,
      Number.NaN,
    ]);
  });

  // Regression: the JSDoc tells hosts to normalize first. A raw 0 is NOT
  // treated as unreadable — it sorts as 1970 — and normalizing through the
  // transforms' own rule is what moves it to the end.
  it('treats only NaN as unreadable: a raw zero sorts first until normalized', () => {
    expect(compareEpochMillis(0, SEP_1)).toBeLessThan(0);
    expect(compareEpochMillis(toEpochMillis(0, 'ms'), SEP_1)).toBe(1);
  });
});

describe('quoteDate contract', () => {
  // Regression: a date read off the attribution line that is plausible must be
  // shown as read, unmarked — flagging it approximate would put a "~" on every
  // quoted time in every thread.
  it('takes a read date earlier than the carrier as written', () => {
    const result: QuoteDate = quoteDate(SEP_1, SEP_2, 1);
    expect(result).toEqual({ date: SEP_1, approx: false });
  });

  // Regression: the boundary. Only a STRICTLY later read date is refused; one
  // equal to the carrier (a reply sent the same minute) is believed.
  it('believes a read date equal to the carrier', () => {
    expect(quoteDate(SEP_2, SEP_2, 1)).toEqual({ date: SEP_2, approx: false });
  });

  // Regression: a message cannot be quoted before it was written. Believing a
  // later read date sorts the quote BELOW the reply quoting it.
  it('clamps a read date later than the carrier to carrier minus the quote level', () => {
    expect(quoteDate(SEP_3, SEP_2, 1)).toEqual({ date: SEP_2 - 1, approx: true });
    expect(quoteDate(SEP_3, SEP_2, 3)).toEqual({ date: SEP_2 - 3, approx: true });
  });

  // Regression: a quote with no readable date must not sort to 1970 — it is
  // dated from its carrier, one millisecond back per level so the levels keep
  // their newest-to-oldest order, and flagged as a guess.
  it('infers a missing read date from the carrier, older per quote level', () => {
    const first = quoteDate(null, SEP_2, 1);
    const second = quoteDate(null, SEP_2, 2);
    expect(first).toEqual({ date: SEP_2 - 1, approx: true });
    expect(second).toEqual({ date: SEP_2 - 2, approx: true });
    expect(compareEpochMillis(second.date, first.date)).toBeLessThan(0);
  });

  // Regression: a carrier with no readable date cannot contradict a read date,
  // so the read date must stand rather than being thrown away.
  it('keeps the read date when the carrier date is unreadable', () => {
    expect(quoteDate(SEP_3, Number.NaN, 1)).toEqual({ date: SEP_3, approx: false });
  });

  // Regression: with nothing readable on either side, the result must be an
  // honest NaN (sorted last, grouped as unknown) — never 0, which is 1970.
  it('returns NaN, marked approximate, when neither date is readable', () => {
    const result = quoteDate(null, Number.NaN, 1);
    expect(result.date).toBeNaN();
    expect(result.approx).toBe(true);
  });

  // Regression: the exported rule and the one `threadToMessages` applies must
  // agree on a real body, or a host's AI-split bubbles and the library's
  // deterministic ones date the same quote differently.
  it('dates a quote exactly the way threadToMessages does', () => {
    const [quoted] = threadToMessages(
      [
        {
          id: 'b1',
          fromAddress: 'bob@example.com',
          date: SEP_2,
          body:
            '<div>Agreed.</div><div class="gmail_attr">On 5 October 2027 at 09:00, Alice ' +
            '&lt;alice@example.com&gt; wrote:</div><div>Shall we start at nine?</div>',
        },
      ],
      { parser },
    );

    const readDate = Date.UTC(2027, 9, 5, 9, 0, 0);
    const expected = quoteDate(readDate, SEP_2, 1);
    expect(quoted?.body).toContain('start at nine');
    expect(quoted?.date).toBe(expected.date);
    expect(quoted?.dateApprox).toBe(expected.approx);
  });
});
