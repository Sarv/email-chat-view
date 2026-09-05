import * as chrono from 'chrono-node';

/**
 * Parse a human-written date — an attribution line, a forwarded-message header,
 * an LLM-echoed date — into epoch MILLISECONDS.
 *
 * Milliseconds because that is what {@link ChatMessage.date} carries and what
 * every JavaScript date API speaks. A mail store that keeps epoch seconds
 * declares `dateUnit: 's'` at the transform boundary and is converted once,
 * there; nothing downstream of that boundary deals in seconds.
 *
 * DAY-FIRST (`en.GB`), deliberately. An ambiguous numeric date like
 * "07/08/2026" is 7 August here, not 8 July. `Date.parse`, `new Date()` and
 * chrono's own default locale all impose US month-first, which silently
 * misdates the majority of the world's mail — and misdating a quote is not
 * cosmetic in a chat view, because the bubbles are sorted by date: a reply
 * lands a month from the message it answers and the thread reads out of order.
 * Unambiguous shapes are unaffected — a textual month ("Jul 9, 2026") or a
 * leading number above 12 ("4/17/2026") parses identically under either locale
 * — so nothing US-written regresses.
 *
 * `refDate` anchors relative expressions ("yesterday", "2 days ago") that
 * occasionally survive into a quote; it defaults to now, inside chrono.
 *
 * Returns null when nothing date-like is found. Callers treat null as "date
 * unknown" and fall back to the enclosing mail's own timestamp — never to zero,
 * which would sort the message to 1970.
 */
export function parseHumanDate(raw: string | undefined | null, refDate?: Date): number | null {
  const text = (raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  try {
    const parsed = chrono.en.GB.parseDate(text, refDate);
    return parsed ? parsed.getTime() : null;
  } catch {
    // chrono throws on a few pathological inputs rather than returning null.
    // An unparseable date is an ordinary outcome here, not an error worth
    // propagating: the caller has the mail's own timestamp to fall back on.
    return null;
  }
}
