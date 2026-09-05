/**
 * The public data contract.
 *
 * Two shapes, and the distinction is the whole design:
 *
 *   Mail         what a mail store gives you — a raw message, body and all
 *   ChatMessage  what the view renders — one bubble's worth of resolved content
 *
 * `mailsToMessages` turns the first into the second programmatically. Anything
 * that already produces clean per-turn content (an LLM extraction pass, a
 * different parser, your own heuristics) skips the transform and supplies
 * `ChatMessage[]` directly. That is why there is no "mode" anywhere in this
 * package: the view renders messages, and where they came from is your business.
 */

/** A file attached to a message. */
export interface Attachment {
  /** Filename as received. Used as the display label and the download name. */
  filename: string;
  /** Size in bytes, when the store knows it. Rendered human-readable. */
  sizeBytes?: number;
  /** MIME type, when known. Drives the preview affordance. */
  mimeType?: string;
  /**
   * True for a `cid:`-referenced image that is part of the body rather than a
   * real attachment. Inline parts are excluded from the attachment row, since
   * listing a signature logo as an attachment is noise.
   */
  inline?: boolean;
}

/**
 * How a {@link Mail.date} is expressed.
 *
 * Declared rather than guessed. Mail stores disagree — IMAP internal dates are
 * frequently kept as epoch SECONDS, while everything in JavaScript is
 * milliseconds — and a silent factor-of-1000 error does not crash: it puts
 * every message in 1970, sorts the thread wrongly, and produces date separators
 * nobody notices are wrong. Say which one you have.
 */
export type DateUnit = 'ms' | 's';

/** A raw message from a mail store, as input to the transform. */
export interface Mail {
  /** Stable unique id within the thread. Used as the React key. */
  id: string;
  /** RFC 5322 Message-ID, when available. Only used for de-duplication. */
  messageId?: string | null;
  /** Sender address. Bare address, no display name. */
  fromAddress: string;
  /** Sender display name, when known. */
  fromName?: string | null;
  /** Recipient address list, comma-separated as received. */
  toAddress?: string | null;
  /** Recipient display names, comma-separated, positionally matching `toAddress`. */
  toNames?: string | null;
  /** Cc address list, comma-separated as received. */
  ccAddress?: string | null;
  /** Cc display names, comma-separated. */
  ccNames?: string | null;
  /** Timestamp, in the unit declared by the transform's `dateUnit` option. */
  date: number;
  /**
   * Raw HTML (or plain text) body.
   *
   * Deliberately optional. In any real mail client the thread's metadata
   * arrives long before its bodies do — see {@link Mail.bodyPending}.
   */
  body?: string | null;
  /** Attachments. Inline parts may be included; the view filters them out. */
  attachments?: Attachment[];
  /**
   * True while the body is still being fetched. The bubble shows a spinner
   * instead of an empty shell, and no transform work is attempted.
   */
  bodyPending?: boolean;
  /**
   * True when the body fetch failed permanently. The bubble shows a retry
   * affordance rather than a spinner that never resolves — a spinner that spins
   * forever is the worst of the three states, because the reader cannot tell
   * whether to wait.
   */
  bodyFailed?: boolean;
  /** True for an unsent draft. Drafts are excluded from the rendered thread. */
  isDraft?: boolean;
}

/** One bubble's worth of resolved, ready-to-render content. */
export interface ChatMessage {
  /** Stable unique id. React key, and the argument to every action callback. */
  id: string;
  /** Sender address. */
  fromAddress: string;
  /** Sender display name, when known. */
  fromName?: string | null;
  /** Recipient address list, comma-separated. */
  toAddress?: string | null;
  /** Recipient display names, comma-separated. */
  toNames?: string | null;
  /** Cc address list, comma-separated. */
  ccAddress?: string | null;
  /** Cc display names, comma-separated. */
  ccNames?: string | null;
  /** Timestamp in epoch MILLISECONDS — always normalized, whatever came in. */
  date: number;
  /** Displayable HTML for this turn only, quoted history and signature removed. */
  body: string;
  /** Attachments worth showing (inline parts already filtered out). */
  attachments?: Attachment[];
  /**
   * Whether this message was sent by the reader, which right-aligns the bubble.
   *
   * Resolved by the transform from the reader's address when it can be. Left
   * undefined when the reader's identity is not knowable, in which case the
   * view left-aligns everything rather than guessing — mislabelling someone
   * else's message as yours is a worse error than a flat layout.
   */
  isFromMe?: boolean;
  /** Body still downloading — render a spinner. */
  bodyPending?: boolean;
  /** Body permanently failed — render a retry affordance. */
  bodyFailed?: boolean;
  /**
   * Which rules shaped this body, e.g. `['signature:gmail', 'quote:gmail']`.
   *
   * Carried through so an application can answer "why is part of my email
   * missing?" without re-running anything. Content disappearing with no
   * explanation is a mail client's worst failure mode; this is the audit trail
   * that makes it debuggable.
   */
  applied?: string[];
  /**
   * Source id when this message was derived from a larger one — several turns
   * extracted out of a single bottom-quoted email, say. Lets the view route an
   * action (reply, download, open original) back to the real underlying mail.
   */
  sourceId?: string;
}
