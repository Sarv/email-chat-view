/**
 * Who a message is from and who it went to, as displayable text.
 *
 * The parsing is done by `email-addresses`, an RFC 5322 grammar
 * implementation, and not by splitting on commas — because a comma inside a
 * quoted display name is legal and extremely common:
 *
 *     "Chen, Alice" <alice@acme.example>, bob@acme.example
 *
 * Splitting that on commas produces three recipients, two of them nonsense,
 * and the bug shows up as a header that reads `Chen +2 others` on a message
 * with two real recipients. A grammar gets it right; a regex gets it right
 * until the first quoted name.
 */
import addressParser from 'email-addresses';

import { fillTemplate, type ViewLabels } from './labels.js';

/** One participant. */
export interface ParsedAddress {
  /** The bare address. Lowercased is NOT assumed — displayed as received. */
  address: string;
  /** Display name, when the header carried one. */
  name?: string;
}

/**
 * Parse an address-list header.
 *
 * `names` is the positional display-name list some mail stores keep in a
 * separate column, parallel to the address column. It is used only to fill in
 * names the header itself did not carry, never to override one it did.
 */
export function parseAddressList(
  addresses?: string | null,
  names?: string | null,
): ParsedAddress[] {
  const raw = (addresses || '').trim();
  if (!raw) return [];

  const fallbackNames = (names || '').split(',').map((name) => name.trim());

  // `partial: true` keeps a header the grammar cannot fully accept from
  // returning null and taking every recipient with it. Real mail carries
  // malformed address lists constantly, and showing four of five recipients
  // beats showing none.
  const parsed = addressParser.parseAddressList({ input: raw, partial: true });

  const mailboxes = (parsed ?? [])
    .flatMap((node) => ('addresses' in node ? node.addresses : [node]))
    .filter((mailbox) => Boolean(mailbox.address));

  if (mailboxes.length) {
    return mailboxes.map((mailbox, index) => {
      const name = mailbox.name?.trim() || fallbackNames[index] || '';
      return name ? { address: mailbox.address, name } : { address: mailbox.address };
    });
  }

  // The grammar rejected the header outright — a store that keeps bare
  // addresses without separators, a truncated field. Fall back to the naive
  // split, which is wrong on quoted commas but right on the input that got us
  // here, and is strictly better than rendering an empty recipient row.
  return raw
    .split(',')
    .map((part, index) => {
      const address = part.trim();
      const name = fallbackNames[index] || '';
      return name ? { address, name } : { address };
    })
    .filter((recipient) => Boolean(recipient.address));
}

/** Shortest honest label for a participant: their name, else their address. */
export function displayNameFor(address: string | null | undefined, name?: string | null): string {
  const trimmedName = (name || '').trim();
  if (trimmedName) return trimmedName;
  // The FULL address, not the local part: in a tooltip or a header with room,
  // `noreply@bank.example` identifies the sender and `noreply` does not.
  // Shortening is `shortNameFor`'s job, where the caller has asked for it.
  return (address || '').trim();
}

/** First name, or the local part, for a compact header. */
export function shortNameFor(address: string | null | undefined, name?: string | null): string {
  const label = displayNameFor(address, name);
  if (!label) return '';
  // `split` always yields at least one element, so index 0 is a string. The
  // assertion satisfies `noUncheckedIndexedAccess`; a `?? label` fallback here
  // would be a branch no input can reach.
  if (label.includes('@')) return label.split('@')[0]!;
  return label.split(' ')[0]!;
}

/** Up to two initials for an avatar. */
export function initialsFor(address: string | null | undefined, name?: string | null): string {
  const label = displayNameFor(address, name);
  if (!label) return '?';
  const source = label.includes('@') ? label.split('@')[0]! : label;
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0]![0]!;
  const second = words.length > 1 ? words[words.length - 1]![0]! : '';
  return (first + second).toUpperCase();
}

/** The recipient run of a header, in the two parts a header truncates apart. */
export interface RecipientSummary {
  /** The names that fit the budget, comma-joined. Empty when there are none. */
  names: string;
  /** `+3 others`, or empty when every recipient is named. */
  more: string;
}

/**
 * Describe the recipient run as its two parts, so a header can choose which
 * one to sacrifice.
 *
 * Two names shown at most. The header is a glance, not a manifest; the full
 * list is one hover away in the recipients tooltip, which is why truncating
 * here loses nothing.
 *
 * Split rather than pre-joined because these two parts are worth very
 * different amounts. Handed to the header as one string it gets one ellipsis,
 * applied at whatever character the width runs out at — and since the count is
 * on the END, the count is what disappears: `Ankur Dubey +23 othe…` tells
 * the reader neither who else is on the message nor even how many. Truncating
 * the names instead costs a name the reader can already see in full one hover
 * away, and keeps the only number in the header that is not recoverable by
 * looking at it.
 */
export function describeRecipients(
  recipients: readonly ParsedAddress[],
  labels: ViewLabels,
  maxShown = 2,
): RecipientSummary {
  if (!recipients.length) return { names: '', more: '' };
  const shown = recipients
    .slice(0, maxShown)
    .map((recipient) => shortNameFor(recipient.address, recipient.name));
  const hidden = recipients.length - shown.length;
  return {
    names: shown.join(', '),
    more: hidden > 0 ? fillTemplate(labels.moreRecipients, { count: hidden }) : '',
  };
}

/**
 * `Alice`, `Alice, Bob`, `Alice +3 others` — the recipient run as one string.
 *
 * The flat form of {@link describeRecipients}, for a caller with nowhere to put
 * two elements: a `title`, a plain-text export, a host's own header.
 */
export function formatRecipientLabels(
  recipients: readonly ParsedAddress[],
  labels: ViewLabels,
  maxShown = 2,
): string {
  const { names, more } = describeRecipients(recipients, labels, maxShown);
  return more ? `${names} ${more}` : names;
}
