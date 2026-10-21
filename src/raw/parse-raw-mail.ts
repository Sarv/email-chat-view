/**
 * A raw RFC 822 message — an `.eml` file, an IMAP `BODY[]` fetch, a Gmail
 * `format=raw` payload — turned into the {@link Mail} the transform takes.
 *
 * The MIME work (multipart trees, transfer encodings, charsets, encoded-word
 * headers, address grammar) is postal-mime's: a solved, standardized problem
 * with more edge cases than any hand-rolled parser survives. What lives here is
 * only the mapping onto this package's contract.
 */
import PostalMime, {
  type Address,
  type Attachment as RawAttachment,
  type Email,
} from 'postal-mime';

import type { Attachment, Mail } from '../types.js';

/** A raw message: its bytes, its text, or a browser `File`/`Blob` holding it. */
export type RawMailSource = string | ArrayBuffer | Uint8Array | Blob;

/** Options for {@link parseRawMail}. */
export interface ParseRawMailOptions {
  /**
   * The mail's id in the thread. Defaults to its Message-ID, else a key built
   * from sender, date and subject — stable across re-parses of the same file.
   */
  id?: string;
  /**
   * Point `cid:` image references in the body at the attached image itself, as
   * a `data:` URI, so a signature logo or a pasted screenshot shows inline.
   * Defaults to `true`. Turn it off to keep bodies small and resolve `cid:`
   * yourself.
   */
  inlineImages?: boolean;
}

type Mailbox = { name: string; address: string };

/** Group syntax (`Team: a@x, b@y;`) flattened to its members. */
function mailboxesOf(addresses: readonly Address[] | undefined): Mailbox[] {
  return (addresses ?? []).flatMap((entry) =>
    entry.group ? entry.group : [{ name: entry.name, address: entry.address }],
  );
}

/**
 * An address list in header form: `"Lee, Ann" <ann@x.example>, bob@y.example`.
 *
 * Header form rather than a bare-address column plus a positional name column,
 * because a display name can contain a comma ("Lee, Ann" is how a whole
 * Outlook directory is written) and a comma-separated name column cannot carry
 * one. The view parses this form back with its address grammar.
 */
function headerList(addresses: readonly Address[] | undefined): string | null {
  const formatted = mailboxesOf(addresses).map(({ name, address }) =>
    name ? `"${name.replace(/(["\\])/g, '\\$1')}" <${address}>` : address,
  );
  return formatted.length ? formatted.join(', ') : null;
}

/** The time the last hop stamped on the topmost `Received:` header. */
function receivedDate(email: Email): number {
  const received = email.headers.find((header) => header.key === 'received')?.value ?? '';
  const stamp = received.slice(received.lastIndexOf(';') + 1);
  return Date.parse(stamp.trim());
}

/**
 * When the mail was sent, in epoch milliseconds.
 *
 * The `Date:` header first; a mail without one (some drafts, some gateways)
 * falls back to when it was received. `NaN` when neither exists, which the
 * transform sorts last under an explicit "unknown date" rather than in 1970.
 */
function sentAt(email: Email): number {
  const sent = Date.parse(email.date ?? '');
  return Number.isNaN(sent) ? receivedDate(email) : sent;
}

/** Plain text as HTML that renders the same lines, less the final line break. */
function textToHtml(text: string): string {
  const escaped = text
    .replace(/(\r?\n)+$/, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div>${escaped.replace(/\r?\n/g, '<br>')}</div>`;
}

/** Byte length of base64 content, without decoding it. */
function base64Size(content: string): number {
  const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0;
  return Math.floor((content.length * 3) / 4) - padding;
}

/** A Content-ID as body references use it: no angle brackets, any case. */
function cidKey(contentId: string): string {
  return contentId.replace(/^<|>$/g, '').toLowerCase();
}

/** `cid:` references that point at an attached image, swapped for the image's bytes. */
function inlineCidImages(html: string, attachments: readonly RawAttachment[]): string {
  const images = new Map(
    attachments
      .filter((part) => part.contentId && part.mimeType.startsWith('image/'))
      .map((part) => [
        cidKey(String(part.contentId)),
        `data:${part.mimeType};base64,${String(part.content)}`,
      ]),
  );
  return html.replace(/\bcid:([^"'\s)>]+)/gi, (reference, id: string) => {
    return images.get(cidKey(id)) ?? reference;
  });
}

/** Whether the body refers to this part by its Content-ID. */
function referencedInBody(part: RawAttachment, html: string): boolean {
  return (
    Boolean(part.contentId) && html.toLowerCase().includes(`cid:${cidKey(String(part.contentId))}`)
  );
}

function attachmentOf(part: RawAttachment, html: string): Attachment {
  return {
    filename: part.filename ?? 'attachment',
    sizeBytes: base64Size(String(part.content)),
    mimeType: part.mimeType,
    inline: referencedInBody(part, html),
  };
}

/**
 * Parse a raw message into a {@link Mail}.
 *
 * Async because the bytes are decoded in chunks. The body is the HTML part, or
 * the plain-text part converted to HTML when there is no HTML part, so either
 * kind goes through the transform the same way. Attachments are listed with
 * their sizes; a `cid:` image the body shows is marked `inline`, which keeps it
 * out of the attachment row.
 */
export async function parseRawMail(
  raw: RawMailSource,
  options: ParseRawMailOptions = {},
): Promise<Mail> {
  const email = await PostalMime.parse(raw, { attachmentEncoding: 'base64' });
  const { inlineImages = true } = options;

  const sourceHtml = email.html ?? (email.text ? textToHtml(email.text) : '');
  const body = inlineImages ? inlineCidImages(sourceHtml, email.attachments) : sourceHtml;
  const [sender] = mailboxesOf(email.from ? [email.from] : []);
  const date = sentAt(email);

  return {
    id:
      options.id ??
      email.messageId ??
      `${sender?.address ?? ''}|${Number.isNaN(date) ? '' : date}|${email.subject ?? ''}`,
    messageId: email.messageId ?? null,
    fromAddress: sender?.address ?? '',
    fromName: sender?.name || null,
    toAddress: headerList(email.to),
    ccAddress: headerList(email.cc),
    date,
    body,
    attachments: email.attachments.map((part) => attachmentOf(part, sourceHtml)),
  };
}
