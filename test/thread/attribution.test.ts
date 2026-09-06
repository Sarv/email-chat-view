import { describe, expect, it } from 'vitest';

import {
  cleanAttributionName,
  deriveNameFromEmail,
  extractEmailFrom,
  parseAttribution,
} from '../../src/thread/attribution.js';

/** Local calendar parts of a parsed attribution date. */
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

describe('extractEmailFrom', () => {
  it('finds an address inside prose', () => {
    expect(extractEmailFrom('On Thu, anish.sharma3@tcs.com wrote:')).toBe('anish.sharma3@tcs.com');
  });

  // Regression: the address is nearly always followed by the punctuation of the
  // sentence around it. Keeping the trailing ">" or "," makes every downstream
  // identity comparison — is this the same person as the mail's sender? — fail.
  it('trims the punctuation the surrounding sentence left on it', () => {
    expect(extractEmailFrom('<ankur.d@sarv.com>')).toBe('ankur.d@sarv.com');
    expect(extractEmailFrom('ankur.d@sarv.com, and')).toBe('ankur.d@sarv.com');
  });

  it('returns null when there is no address and for nullish input', () => {
    expect(extractEmailFrom('On Thursday we agreed')).toBeNull();
    expect(extractEmailFrom(null)).toBeNull();
    expect(extractEmailFrom(undefined)).toBeNull();
  });
});

describe('deriveNameFromEmail', () => {
  // Regression: an Outlook-mangled quote carries an address and no name. A
  // derived name is a guess, but "Anish Sharma" is a usable bubble header and
  // "unknown" is not.
  it('humanizes a local part, dropping digits and separators', () => {
    expect(deriveNameFromEmail('anish.sharma3@tcs.com')).toBe('Anish Sharma');
    expect(deriveNameFromEmail('ankur_d-dubey@sarv.com')).toBe('Ankur D Dubey');
  });

  it('returns null when there is nothing to humanize', () => {
    expect(deriveNameFromEmail(null)).toBeNull();
    expect(deriveNameFromEmail('12345@sarv.com')).toBeNull();
  });
});

describe('cleanAttributionName', () => {
  it('drops an embedded address chunk', () => {
    expect(cleanAttributionName('Ankur Dubey <ankur.d@sarv.com>')).toBe('Ankur Dubey');
  });

  // Regression: Gmail writes "…at 10:52 AM rakesh kumawat" with no comma, so
  // the meridiem lands in the name capture. Left in, every Gmail quote is
  // attributed to a person called "AM rakesh kumawat".
  it('strips a leading meridiem and timezone run', () => {
    expect(cleanAttributionName('PM IST Ankur Dubey')).toBe('Ankur Dubey');
  });

  it('drops a "via <service>" suffix', () => {
    expect(cleanAttributionName('Alice via Google Groups')).toBe('Alice');
  });

  // Regression: Outlook sometimes loses the "<local@" of an address, leaving a
  // bare domain glued to the name.
  it('drops a mangled trailing domain remnant', () => {
    expect(cleanAttributionName('Anurag Nirwal tcs.com>')).toBe('Anurag Nirwal');
  });

  it('falls back to a derived name when nothing usable remains', () => {
    expect(cleanAttributionName('', 'anish.sharma3@tcs.com')).toBe('Anish Sharma');
    expect(cleanAttributionName(null, 'anish.sharma3@tcs.com')).toBe('Anish Sharma');
  });

  it('returns null when there is neither a name nor an address', () => {
    expect(cleanAttributionName('   ')).toBeNull();
  });
});

describe('parseAttribution', () => {
  // Gmail / Apple: comma after the time, angle-bracketed address.
  it('reads the Gmail shape', () => {
    const parsed = parseAttribution(
      'On Thu, Jul 9, 2026 at 10:52 AM, Rakesh Kumawat <rakesh@sarv.com> wrote:',
    );
    expect(parsed).toMatchObject({ name: 'Rakesh Kumawat', email: 'rakesh@sarv.com' });
    expect(parts(parsed!.date)).toMatchObject({
      year: 2026,
      month: 7,
      day: 9,
      hour: 10,
      minute: 52,
    });
  });

  // Regression: Outlook omits the comma after the time, which is why the
  // pattern anchors on the name rather than on punctuation. If the anchor moved
  // back to the comma, every Outlook quote would stop parsing entirely.
  it('reads the Outlook no-comma shape', () => {
    const parsed = parseAttribution(
      'On Wed, Apr 15, 2026 at 11:02AM Manoj Tewari <manoj@sarv.com> wrote:',
    );
    expect(parsed).toMatchObject({ name: 'Manoj Tewari', email: 'manoj@sarv.com' });
    expect(parts(parsed!.date)).toMatchObject({ month: 4, day: 15, hour: 11, minute: 2 });
  });

  // Regression: THE half-day bug. With no comma, the "PM" is captured as part
  // of the name and then stripped — so "5:06 PM" parsed as 05:06 and the reply
  // sorted above the message it was answering.
  it('gives the meridiem back to the date when the name capture stole it', () => {
    const parsed = parseAttribution(
      'On Fri, 17 Apr 2026 at 5:06 PM Ankur Dubey <ankur.d@sarv.com> wrote:',
    );
    expect(parsed).toMatchObject({ name: 'Ankur Dubey' });
    expect(parts(parsed!.date)).toMatchObject({ day: 17, hour: 17, minute: 6 });
  });

  // Regression: "PM Sharma" is a person, not a meridiem. Appending it would
  // turn a date chrono parses into one it does not, losing the date entirely.
  it('does not treat a name that looks like a meridiem as one', () => {
    const parsed = parseAttribution('On 27 April 2026, PM Sharma wrote:');
    expect(parts(parsed!.date)).toMatchObject({ year: 2026, month: 4, day: 27 });
  });

  // Bare address, no angle brackets — and an address containing digits, which
  // the name-anchored patterns deliberately exclude.
  it('reads a bare address with a numeric date', () => {
    const parsed = parseAttribution('On 4/17/2026, 2:51:17 PM, anish.sharma3@tcs.com wrote:');
    expect(parsed).toMatchObject({ name: 'Anish Sharma', email: 'anish.sharma3@tcs.com' });
    expect(parts(parsed!.date)).toMatchObject({ month: 4, day: 17, hour: 14, minute: 51 });
  });

  it('reads a mangled address left as a bare domain', () => {
    const parsed = parseAttribution('On 27 April 2026 18:31 Anurag Nirwal tcs.com> wrote:');
    expect(parsed).toMatchObject({ name: 'Anurag Nirwal', email: null });
    expect(parts(parsed!.date)).toMatchObject({ month: 4, day: 27, hour: 18, minute: 31 });
  });

  it('reads a name-only attribution', () => {
    const parsed = parseAttribution('On 27 April 2026, Ankur Dubey wrote:');
    expect(parsed).toMatchObject({ name: 'Ankur Dubey', email: null });
    expect(parts(parsed!.date)).toMatchObject({ year: 2026, month: 4, day: 27 });
  });

  it('reads an Outlook From:/Sent: header block', () => {
    const parsed = parseAttribution(
      'From: Ankur Dubey <ankur.d@sarv.com> Sent: 27 April 2026 18:31 To: team@sarv.com Subject: Re: hi',
    );
    expect(parsed).toMatchObject({ name: 'Ankur Dubey', email: 'ankur.d@sarv.com' });
    expect(parts(parsed!.date)).toMatchObject({ month: 4, day: 27, hour: 18, minute: 31 });
  });

  // Regression: an Outlook block whose name field is nothing but an address.
  // The domain-remnant cleanup eats "sarv.com" and leaves the stub "manoj@",
  // which is non-empty and so suppresses the derived-name fallback — the bubble
  // reads "manoj@". Also covers the Date: label and a block with no To:/Subject:
  // to terminate on.
  it('derives a name from a header block whose name field is only an address', () => {
    const parsed = parseAttribution('From: manoj@sarv.com Date: 9 Jul 2026');
    expect(parsed).toMatchObject({ email: 'manoj@sarv.com', name: 'Manoj' });
  });

  // Zoho's original-sender-line and several mobile clients: no "wrote:" at all.
  it('reads an attribution with no "wrote:"', () => {
    const parsed = parseAttribution('On 27 April 2026 18:31 Ankur Dubey <ankur.d@sarv.com>');
    expect(parsed).toMatchObject({ name: 'Ankur Dubey', email: 'ankur.d@sarv.com' });
  });

  // Regression: the no-"wrote:" pattern requires a trailing address precisely
  // so an ordinary sentence opening with "On …" cannot be mistaken for an
  // attribution. A false positive here does not mislabel a bubble — it SPLITS
  // one message into two, mid-sentence.
  it('does not mistake ordinary prose for an attribution', () => {
    expect(parseAttribution('On Tuesday we agreed to ship the release on Friday.')).toBeNull();
    expect(parseAttribution('On the whole this looks good to me')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseAttribution('')).toBeNull();
    expect(parseAttribution('   ')).toBeNull();
  });

  // Regression: attribution lines are flattened out of HTML, so they arrive
  // with newlines and doubled spaces wherever the markup had a tag boundary.
  // Without the collapse, none of the anchored patterns match.
  it('matches across the whitespace the HTML flattening leaves behind', () => {
    const parsed = parseAttribution(
      'On  Thu, Jul 9, 2026\n at 10:52 AM,\tRakesh <rakesh@sarv.com>\n wrote:',
    );
    expect(parsed).toMatchObject({ name: 'Rakesh', email: 'rakesh@sarv.com' });
  });

  // Regression: a date the parser cannot read must leave the rest of the
  // attribution intact. Dropping the whole line because the date failed loses a
  // known sender over an unknown timestamp — the caller can fall back to the
  // enclosing mail's date, but not to a name it never received.
  it('keeps the sender when the date is unreadable', () => {
    const parsed = parseAttribution('On someday, Ankur Dubey <ankur.d@sarv.com> wrote:');
    expect(parsed).toMatchObject({ name: 'Ankur Dubey', email: 'ankur.d@sarv.com', date: null });
  });
});
