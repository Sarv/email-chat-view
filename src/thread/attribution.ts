/**
 * Reading the "On <date>, <someone> wrote:" line that introduces a quote.
 *
 * This one line is the only place a quoted message says who wrote it and when.
 * Get it right and a flat reply chain becomes a chat thread with real names and
 * real timestamps; get it wrong and every quoted bubble is "unknown" at the
 * wrong time, sorted into the wrong place.
 *
 * There is no standard for it. Gmail, Apple Mail, Outlook, Zoho and a long tail
 * of mobile clients each punctuate differently, several mangle the address on
 * the way out, and localised clients drop the English keywords entirely. What
 * follows is a small ordered set of patterns tried most-specific first — the
 * shapes observed in real mail, each documented with the client that emits it.
 *
 * Yes, these are regexes, and a parser would normally be the better answer.
 * There is no grammar to parse against: the input is prose in an unknown
 * dialect, and no maintained package targets it. The mitigation is that each
 * pattern is anchored, bounded, and covered by a fixture from the client it
 * came from.
 */

import { parseHumanDate } from './human-date.js';

/** Who wrote a quoted message, and when, as read off its attribution line. */
export interface ParsedAttribution {
  /** Display name, tidied. Null when the line carried none and none could be derived. */
  name: string | null;
  /** Sender address. Null when the line carried none. */
  email: string | null;
  /** Epoch MILLISECONDS. Null when no date could be read. */
  date: number | null;
}

/**
 * The tail of a timestamp — meridiem, timezone, or both — sitting at the START
 * of a captured name.
 *
 * The name captures below exclude digits and colons so the date can greedily
 * absorb the whole timestamp. "PM" and "IST" contain neither, so a client that
 * puts no comma after the time (Outlook, several mobile clients) hands them to
 * the name instead. Anchored and repeated, so "5:06 PM IST Ankur Dubey" gives
 * up both.
 */
const LEADING_TIME_TAIL =
  /^(?:(?:[AP]\.?M\.?|GMT|UTC|IST|EST|EDT|PST|PDT|CST|CDT|CET|CEST|BST)\b[\s,]*)+/i;

/**
 * Parse an attribution date, taking back the time tail the name capture stole.
 *
 * Without this, "…at 5:06 PM Ankur Dubey <…>" parses as 05:06 — the PM is
 * dropped on the floor with the rest of the name tidy-up — and the message
 * lands twelve hours early. In a view sorted by time that is not cosmetic: an
 * afternoon reply sorts ABOVE the morning message it answers, and the thread
 * reads backwards.
 *
 * Only reattached to a date that actually ends in a time. "On 27 April 2026, PM
 * Sharma wrote:" is a person, not a meridiem, and appending it would turn a
 * date chrono parses into one it does not.
 */
function parseAttributionDate(date: string, nameBlob: string, refDate?: Date): number | null {
  const trimmedDate = date.trim();
  if (!/\d$/.test(trimmedDate)) return parseHumanDate(trimmedDate, refDate);
  const tail = nameBlob.match(LEADING_TIME_TAIL)?.[0].replace(/[\s,]+$/, '');
  return parseHumanDate(tail ? `${trimmedDate} ${tail}` : trimmedDate, refDate);
}

/**
 * First email address in a free-text blob, trimmed of trailing punctuation.
 *
 * Not `email-addresses` (which this package already depends on): that library
 * parses a well-formed RFC 5322 address LIST and correctly rejects prose. The
 * input here is a sentence with an address somewhere inside it, frequently a
 * mangled one, so the strict parser returns null on exactly the inputs that
 * need help. `parseAddressList` still owns real header fields — this is only
 * for the attribution line.
 */
export function extractEmailFrom(raw: string | undefined | null): string | null {
  const match = (raw || '').match(/[^\s"',:;<>][^\s"',:;<>@]*@[^\s"',:;<>]+\.[^\s<>,;:"']+/);
  return match ? match[0].replace(/[.,;:>'"]+$/, '') : null;
}

/**
 * Humanize an address local-part into a display name
 * ("anish.sharma3@x.com" -> "Anish Sharma").
 *
 * A guess, and only ever used when the attribution line carried no name at all.
 * A plausible name beats rendering the bubble as "unknown", which is what the
 * reader would otherwise see on every Outlook-mangled quote.
 */
export function deriveNameFromEmail(email: string | null): string | null {
  if (!email) return null;
  const local = email.split('@')[0]!.replace(/\d+/g, '');
  const words = local.split(/[._+-]+/).filter(Boolean);
  if (!words.length) return null;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

/**
 * Tidy a captured attribution name.
 *
 * Drops embedded addresses — both `<bracketed>` and bare — and mangled
 * trailing domain remnants ("Anurag Nirwal tcs.com>" — Outlook sometimes loses
 * the "<local@" of an address), strips a stray leading AM/PM/timezone token
 * (Gmail's "10:52 AM name" with no comma) and a trailing "via …" service
 * suffix. Falls back to a name derived from the address when nothing usable
 * remains.
 *
 * The bare-address pass has to happen BEFORE the domain-remnant pass, and that
 * ordering is the whole reason it exists. An Outlook block whose name field is
 * nothing but an address ("From: manoj@sarv.com Date: …") otherwise has only
 * its domain eaten, leaving the non-empty stub "manoj@" — which then blocks the
 * derived-name fallback, and the bubble is headed "manoj@" instead of "Manoj".
 */
export function cleanAttributionName(
  raw: string | undefined | null,
  email: string | null = null,
): string | null {
  const name = (raw || '')
    .replace(/<[^>]*>/g, ' ') // drop "<email>" chunks
    .replace(/\S+@\S+/g, ' ') // drop bare addresses; see the note above on order
    .replace(LEADING_TIME_TAIL, '') // "PM Ankur" -> "Ankur"; see parseAttributionDate
    .replace(/\s+via\s+(?:\S.*)?$/i, '') // "Alice via Google Groups"
    .replace(/[\s,]*\b[\w-]+(?:\.[\w-]+)+>?\s*$/, ' ') // trailing domain remnant "tcs.com>"
    .replace(/["'<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name || deriveNameFromEmail(email);
}

/**
 * Parse a quote attribution line into sender and date, or null if it is not one.
 *
 * Null is the common case and not a failure: this is called on every candidate
 * line in a body, and most of them are ordinary prose.
 *
 * `refDate` anchors the relative expressions attribution lines are full of —
 * "On Monday", "Yesterday at 4pm", "2 days ago". Pass the SENDING TIME of the
 * mail the line was found in: a quote is always written before the mail that
 * quotes it, so anchoring on the carrier resolves "Monday" to the Monday before
 * that mail. Leaving it to default to now resolves it against the reader's
 * clock instead, which on an old thread dates a quote AFTER the reply carrying
 * it and sorts the conversation backwards.
 */
export function parseAttribution(text: string, refDate?: Date): ParsedAttribution | null {
  const line = (text || '').replace(/\s+/g, ' ').trim();
  if (!line) return null;

  // "On <date>, <name> <email> wrote:" — Gmail, Apple and Outlook, which
  // punctuate differently: Gmail puts a comma after the time ("…10:52 AM,
  // rakesh kumawat"), Outlook does not ("…11:02AM Manoj Tewari"). So anchor on
  // the NAME rather than the comma: the name is the run right before <email>
  // that has no digits or colons (dates and times always have one, names never
  // do), which lets the date greedily absorb the whole timestamp either way.
  let match = line.match(/^On\s+(.+?)[,\s]+([^<>@,\d:]+?)\s*<([^\s>][^\s>@]*@[^\s>]+)>\s*wrote:?/i);
  if (match) {
    const email = match[3]!.trim();
    return {
      name: cleanAttributionName(match[2], email),
      email,
      date: parseAttributionDate(match[1]!, match[2]!, refDate),
    };
  }

  // Bare address, no angle brackets: "On 4/17/2026, 2:51:17 PM,
  // anish.sharma3@tcs.com wrote:". Covers numeric-date Outlook and mobile
  // lines, and addresses containing digits — which the name-anchored patterns
  // deliberately exclude.
  match = line.match(/^On\s+(.+?)[,\s]+([^\s,<>][^\s,<>@]*@[^\s,<>]+)\s+wrote:?/i);
  if (match) {
    const email = extractEmailFrom(match[2]);
    return {
      name: cleanAttributionName('', email),
      email,
      date: parseHumanDate(match[1]!, refDate),
    };
  }

  // Mangled address: "On <date> <name> domain> wrote:" — the client ate the
  // "<local@" of the address, leaving a bare "domain>" before "wrote:".
  match = line.match(/^On\s+(.+?)[,\s]+([^<>@,\d:]+?)\s+[\w.-]+\.\w{2,}>?\s*wrote:?/i);
  if (match) {
    return {
      name: cleanAttributionName(match[2]),
      email: null,
      date: parseAttributionDate(match[1]!, match[2]!, refDate),
    };
  }

  // Name only, no address: "On <date>, <name> wrote:"
  match = line.match(/^On\s+(.+?)[,\s]+([^<>,\d:]+?)\s+wrote:?/i);
  if (match) {
    return {
      name: cleanAttributionName(match[2]),
      email: null,
      date: parseAttributionDate(match[1]!, match[2]!, refDate),
    };
  }

  // Outlook header block: "From: <name> <email> Sent/Date: <date> To: …".
  // Tolerant of the mangled-address case (Outlook can drop the "<local@",
  // leaving "Name domain>"): take everything up to Sent/Date as the name blob,
  // pull the address out of it if there is one, and let cleanAttributionName
  // tidy whatever remains.
  match = line.match(/^From:\s*(.*?)\s*(?:Sent|Date):\s*(.+?)\s*(?:To:|Cc:|Subject:|$)/i);
  if (match) {
    const email = extractEmailFrom(match[1]);
    return {
      name: cleanAttributionName(match[1], email),
      email,
      date: parseHumanDate(match[2]!, refDate),
    };
  }

  // Attribution with NO "wrote:" (Zoho's `original-sender-line`, some mobile
  // clients): "On <date> <name> <email>". A trailing address is REQUIRED, so an
  // ordinary sentence beginning "On Tuesday we agreed…" cannot be mistaken for
  // an attribution and swallow the paragraph after it.
  match = line.match(/^On\s+(.+?)[,\s]+([^<>@,\d:]+?)\s*<?([^\s,<>][^\s,<>@]*@[^\s,<>]+)>?\s*$/i);
  if (match) {
    const email = extractEmailFrom(match[3]);
    return {
      name: cleanAttributionName(match[2], email),
      email,
      date: parseAttributionDate(match[1]!, match[2]!, refDate),
    };
  }

  return null;
}
