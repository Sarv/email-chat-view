/**
 * Automated-mail signals — a weighted registry, same contribution model as the
 * strip rules.
 *
 * The question this answers: is a message a human conversation turn, or a
 * template / system / bulk send? The chat view uses it to decide which messages
 * get chat treatment (a sender tint, a hugging bubble) and which are rendered
 * verbatim because they own a bespoke layout.
 *
 * WEIGHTED, NOT A SINGLE RULE. A lone weak hit — a corporate signature that
 * happens to contain the word "unsubscribe" — must not misclassify a genuine
 * reply. Only signals a human's mail client essentially never produces carry
 * enough weight to decide on their own.
 *
 * DELIBERATELY NOT SIGNALS: "heavy/designed HTML" and "low text-to-markup
 * ratio". Both fire on ordinary long Outlook and Word mail, which misflagged
 * real replies as automated. The trustworthy version of that signal is the
 * `List-Unsubscribe` / `Auto-Submitted` / `Precedence` header, not the body's
 * shape — see {@link MailClassificationInput.headers}.
 */

/** A weighted signal that a message was machine-generated. */
export interface AutomatedSignal {
  /** Stable identifier, reported in {@link MailClassification.signals}. */
  name: string;
  /**
   * Weight. The verdict flips at {@link AUTOMATED_THRESHOLD} (3), so a weight
   * of 3+ decides alone and a weight of 2 must combine with something else.
   * Give a signal 3 only if a human's client genuinely never emits it.
   */
  weight: number;
  /** Why this indicates automation, for reviewers. */
  rationale: string;
  /** Returns true when the signal is present. */
  test: (input: NormalizedInput) => boolean;
}

/** Inputs to classification, all optional — score what you have. */
export interface MailClassificationInput {
  /** Raw HTML or text body. */
  body?: string | null;
  /** RFC 5322 Message-ID. */
  messageId?: string | null;
  /** Sender address. */
  fromAddress?: string | null;
  /**
   * Raw headers, lowercased keys, when the store keeps them.
   *
   * These are the gold standard and outrank every body heuristic here:
   * `List-Unsubscribe`, `Auto-Submitted: auto-generated` and
   * `Precedence: bulk` are what bulk senders are actually required to set.
   * Supply them if you have them; the body signals exist for stores that do not.
   */
  headers?: Record<string, string | undefined>;
}

/** Pre-lowercased view of the input, so each signal need not re-normalize. */
export interface NormalizedInput {
  body: string;
  messageId: string;
  fromAddress: string;
  headers: Record<string, string | undefined>;
}

/** The verdict. */
export interface MailClassification {
  kind: 'human' | 'automated';
  /** Total weight accumulated. Higher is more machine-like. */
  score: number;
  /** Names of the signals that fired, for logging and tuning. */
  signals: string[];
}

/** Score at which a message is called automated. */
export const AUTOMATED_THRESHOLD = 3;

/**
 * Message-ID domains belonging to email service providers and bulk senders.
 *
 * A human client's Message-ID comes from its own mail host (`@mail.gmail.com`),
 * never one of these. A very easy and very welcome contribution: add the ESP
 * you see in your own corpus.
 */
export const ESP_MESSAGE_ID_DOMAINS: readonly string[] = [
  'amazonses.com',
  'sendgrid.net',
  'sendgrid.me',
  'sendgrid.com',
  'mailgun.org',
  'mailgun.net',
  'mg.',
  'sparkpostmail.com',
  'sparkpost.com',
  'mandrillapp.com',
  // Mailchimp family
  'mcsv.net',
  'mcdlv.net',
  'rsgsv.net',
  'sendinblue.com',
  'sibmail.com',
  'brevo.com',
  'postmarkapp.com',
  'pmta',
  'mailjet.com',
  'mtasv.net',
  'ccsend.com',
  'constantcontact.com',
  'hubspotemail.net',
  'zoho.com.cn',
  'customeriomail.com',
  'e.customerio.com',
];

const UNSUBSCRIBE =
  /\bunsubscribe\b|\bopt[-\s]?out\b|manage\s+(?:your\s+)?(?:email\s+)?preferences|update\s+your\s+preferences|email\s+preferences/i;

/**
 * A 1x1 pixel, sized by `width`/`height` attributes in either order or by an
 * inline `width:1px;height:1px` style. Humans never embed these.
 */
const TRACKING_PIXEL =
  /<img\b[^>]*?(?:width\s*=\s*["']?1["']?[^>]*?height\s*=\s*["']?1["']?|height\s*=\s*["']?1["']?[^>]*?width\s*=\s*["']?1["']?|style\s*=\s*["'][^"']*?width\s*:\s*1px[^"']*?height\s*:\s*1px)/i;

/** Merge tags a template engine failed to render. */
const PLACEHOLDER =
  /\{\{\s*[\w.]+\s*\}\}|%[A-Z][A-Z0-9_]{2,}%|\[(?:FIRST_?NAME|LAST_?NAME|FULL_?NAME|NAME|EMAIL|RECIPIENT|USER(?:NAME)?)\]/;

/** Sender local-parts that only ever send automated mail. */
const NOREPLY =
  /(?:no[-_.]?reply|donotreply|do[-_.]?not[-_.]?reply)|^(?:notifications?|mailer|mailer-daemon|bounce[-+.\w]*|postmaster|automated?|system)@/i;

/** Whether a Message-ID's domain belongs to a known ESP. */
export function hasEspMessageIdDomain(messageId: string): boolean {
  const at = messageId.lastIndexOf('@');
  if (at === -1) return false;
  const domain = messageId
    .slice(at + 1)
    .replace(/[>\s]+$/, '')
    .toLowerCase();
  if (!domain) return false;
  return ESP_MESSAGE_ID_DOMAINS.some(
    (known) => domain === known || domain.endsWith(`.${known}`) || domain.includes(known),
  );
}

/**
 * Default signal set.
 *
 * Header signals come first and are weighted decisively, because a sender
 * declaring itself bulk is not a heuristic — it is the sender telling you.
 */
export const automatedSignals: AutomatedSignal[] = [
  {
    name: 'list-unsubscribe-header',
    weight: 3,
    rationale: 'Bulk senders set List-Unsubscribe; a person replying never does.',
    test: (input) => !!input.headers['list-unsubscribe'],
  },
  {
    name: 'auto-submitted-header',
    weight: 3,
    rationale: 'RFC 3834: anything but "no" means the message was generated automatically.',
    test: (input) => {
      const value = input.headers['auto-submitted']?.trim().toLowerCase();
      return !!value && value !== 'no';
    },
  },
  {
    name: 'bulk-precedence-header',
    weight: 3,
    rationale: 'Precedence: bulk / list / junk is a self-declared mass send.',
    test: (input) => {
      const value = input.headers['precedence']?.trim().toLowerCase();
      return value === 'bulk' || value === 'list' || value === 'junk';
    },
  },
  {
    name: 'tracking-pixel',
    weight: 3,
    rationale: 'A 1x1 image exists only to report an open. No human client inserts one.',
    test: (input) => TRACKING_PIXEL.test(input.body),
  },
  {
    name: 'unrendered-placeholder',
    weight: 3,
    rationale: 'A leaked {{merge_tag}} proves a template engine produced the message.',
    test: (input) => PLACEHOLDER.test(input.body),
  },
  {
    name: 'esp-message-id',
    weight: 3,
    rationale: 'The Message-ID was minted by a bulk-sending platform, not a mail client.',
    test: (input) => !!input.messageId && hasEspMessageIdDomain(input.messageId),
  },
  {
    name: 'noreply-sender',
    weight: 3,
    rationale: 'A no-reply / mailer-daemon / postmaster local-part never holds a conversation.',
    test: (input) => !!input.fromAddress && NOREPLY.test(input.fromAddress),
  },
  {
    name: 'unsubscribe-copy',
    weight: 2,
    rationale:
      'Common in bulk mail, but a corporate footer can carry it too — so it must combine with another signal rather than decide alone.',
    test: (input) => UNSUBSCRIBE.test(input.body),
  },
];
