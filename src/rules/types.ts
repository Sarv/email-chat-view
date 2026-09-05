/**
 * The rule contract.
 *
 * Every mail-client convention this package knows about is a small declarative
 * object, not code inside a function. That is deliberate: adding support for a
 * new provider should be a five-line object plus a fixture, reviewable by
 * someone who has never read the engine.
 *
 * Three rule kinds cover everything real mail throws at us:
 *
 *   DomRule        an element identifiable by a CSS selector
 *                  (`.gmail_signature`, `div.moz-signature`, `blockquote`)
 *   MarkerRule     a text boundary after which everything is quoted history
 *                  ("On ... wrote:", "-----Original Message-----")
 *   DisclaimerRule a trailing legal/confidentiality footer, matched by opening
 *                  phrasing plus corroborating signals
 *
 * Prefer a DomRule whenever the provider gives you a class or id to grab: it is
 * exact, order-independent, and cannot mis-fire on body text that merely quotes
 * a phrase. Reach for a MarkerRule only for conventions that exist purely as
 * prose, which is genuinely the case for reply attributions.
 */

/**
 * An element removable by CSS selector.
 *
 * @example A provider that marks its signature with a dedicated class:
 * ```ts
 * { name: 'zoho', provider: 'Zoho Mail', selectors: ['div.zmail_signature'] }
 * ```
 *
 * @example A provider that reuses the same id for body wrappers, so the match
 * is only trusted when it is short enough to actually be a signature:
 * ```ts
 * { name: 'outlook-desktop', provider: 'Outlook', selectors: ['#Signature'], maxTextLength: 500 }
 * ```
 */
export interface DomRule {
  /**
   * Stable identifier, reported back in {@link StripResult.applied}. Tests and
   * bug reports name this, so treat it as public API: renaming one is a
   * breaking change.
   */
  name: string;
  /** Which mail client / service this convention comes from, for humans. */
  provider: string;
  /** CSS selectors for the element(s) to remove. Any match counts. */
  selectors: string[];
  /**
   * Only remove a match whose normalized text is shorter than this.
   *
   * Several clients reuse signature-ish ids and classes as ordinary body
   * wrappers — Outlook is the notorious one, wrapping an entire reply in
   * `<div id="Signature">`. Without a guard, stripping that deletes the whole
   * message. With one, the rule stays safe. Omit when the provider's marker is
   * unambiguous (Gmail's `.gmail_signature` always is).
   */
  maxTextLength?: number;
  /**
   * Treat a match as a BOUNDARY: remove it and every following sibling, rather
   * than just the element itself.
   *
   * Some clients do not wrap the quoted history in a container at all — they
   * drop an empty marker div at the point where the reply ends and let the
   * history follow as ordinary siblings. Outlook's `appendonsend` and
   * `divRplyFwdMsg` are exactly this. Removing only the marker leaves the whole
   * quoted thread on screen, which is the failure this flag exists to prevent.
   *
   * Use it only for a marker whose meaning genuinely is "everything past here
   * is history". It is the most destructive thing a rule can declare: a
   * mismatch takes the rest of the message with it.
   */
  boundary?: boolean;
  /**
   * When matches are NESTED, keep only the deepest one.
   *
   * For a selector-driven rule the default — remove every match — is right, and
   * an outer match simply takes its inner duplicate with it. For a rule that
   * identifies an element by its SHAPE it is dangerous, because shape is
   * inherited upwards: a short message whose wrapper `<div>` holds both the
   * text and the signature card matches "contains a phone and a website and is
   * under 400 characters" just as the card does. Removing every match there
   * deleted the entire message — card AND the words above it. Discarding any
   * candidate that contains another leaves exactly the card.
   *
   * Set it on shape rules ({@link test}-driven). Leave it off for selectors.
   */
  innermost?: boolean;
  /**
   * Extra predicate for the rare convention a selector cannot express. Runs
   * after the selector matches and after {@link maxTextLength}; return false to
   * keep the element.
   */
  test?: (element: Element) => boolean;
}

/**
 * A prose boundary: everything from the match onward is quoted history.
 *
 * The engine cuts from the START of the match, so a pattern describes only the
 * marker itself and never needs a trailing `[\s\S]*$`. All rules are evaluated
 * against the full body and the EARLIEST match wins, which makes the rule set
 * order-independent — a rule you add cannot change what an existing rule does.
 *
 * Patterns must be bounded (`{0,200}`, not `*`) so they stay linear on hostile
 * input. An unbounded pattern over a 200KB body is a denial-of-service waiting
 * for the one email that triggers it.
 *
 * @example
 * ```ts
 * { name: 'attribution-de', provider: 'Gmail', language: 'de',
 *   patterns: [/Am\s+[^\n<]{4,200}\s+schrieb\s+[^\n<]{2,200}:/i] }
 * ```
 */
export interface MarkerRule {
  /** Stable identifier, reported in {@link StripResult.applied}. */
  name: string;
  /** Which mail client / service emits this marker, for humans. */
  provider: string;
  /**
   * BCP-47 language tag when the marker is localized prose. Untagged means
   * English. This is the field that makes non-English contributions
   * discoverable rather than buried in a regex.
   */
  language?: string;
  /**
   * Patterns matching the marker only — grouped in one rule when they are
   * spelling variants of the SAME convention (bare text vs. wrapped in a
   * `<div>`, say). Earliest match across the whole rule set wins, so listing a
   * tag-wrapped variant alongside the bare one makes the cut land on the
   * opening tag instead of leaving it dangling.
   *
   * Every pattern must be bounded (`{0,200}`, never `*` or `+`) so it stays
   * linear on hostile input.
   */
  patterns: RegExp[];
}

/**
 * A convention that exists as a standalone visual LINE.
 *
 * The gap between {@link DomRule} and {@link MarkerRule}, and a surprisingly
 * large one. An RFC 3676 `-- ` delimiter, a "Sent from my iPhone" footer, a
 * `-----Original Message-----` separator, a gateway's "External sender" banner:
 * none has a class to select on, and none can be matched against the serialized
 * HTML either, because the line it occupies is assembled out of text nodes,
 * `<br>`s and block boundaries that no single string pattern spans reliably.
 *
 * So these are matched against the FLATTENED text, one visual line at a time,
 * and applied back to the node the line came from.
 *
 * @example The mobile-footer convention, in full:
 * ```ts
 * { name: 'mobile-footer', provider: 'Common / mobile clients', action: 'cut',
 *   pattern: /^(sent from my |get outlook for )/i, maxLineLength: 60 }
 * ```
 */
export interface LineRule {
  /** Stable identifier, reported in {@link StripResult.applied}. */
  name: string;
  /** Which client or gateway emits this line, for humans. */
  provider: string;
  /** BCP-47 language tag when the line is localized prose. Untagged means English. */
  language?: string;
  /**
   * What the line must match. Tested against the line's text with whitespace
   * collapsed and non-breaking spaces folded, already trimmed — so anchor with
   * `^` freely and never account for surrounding space.
   */
  pattern: RegExp;
  /**
   * Lines longer than this are never this convention.
   *
   * Required, with no default, because it is the only thing standing between a
   * rule and the paragraph it will otherwise eat. "Sent from my phone I could
   * not reach you earlier…" is a sentence, not a footer, and the length cap is
   * what tells them apart.
   */
  maxLineLength: number;
  /**
   * `'cut'` removes the line AND everything after it — for a boundary whose
   * meaning is "the message ends here" (a signature delimiter, a mobile
   * footer). `'line'` removes only the line itself — for a marker that sits
   * above content worth keeping (`-----Original Message-----`, an
   * external-sender banner above the real body).
   *
   * `'cut'` is the more destructive of the two by a wide margin: a mismatch
   * takes the rest of the message with it. Reach for `'line'` unless the
   * convention genuinely terminates the message.
   */
  action: 'cut' | 'line';
}

/**
 * A trailing legal / confidentiality footer.
 *
 * Matched by evidence rather than a single pattern, because "confidential" also
 * appears in real sentences people write. A block qualifies only when it is at
 * the trailing edge, OPENS with boilerplate phrasing, and carries at least
 * {@link minSignals} distinct disclaimer signals. A paragraph that merely
 * mentions confidentiality fails the opening test; a wrapper holding real
 * content plus a footer fails it too, so the engine descends into it instead.
 */
export interface DisclaimerRule {
  /** Stable identifier, reported in {@link StripResult.applied}. */
  name: string;
  /** Jurisdiction / provider this boilerplate is typical of, for humans. */
  provider?: string;
  /** BCP-47 language tag. Untagged means English. */
  language?: string;
  /**
   * Phrasing the block must START with. Required for the trailing-block
   * strategy; a rule without it is used only after an explicit `<hr>`
   * delimiter, where the rule itself is the boundary evidence.
   */
  opens?: RegExp;
  /** Corroborating signals; {@link minSignals} distinct ones must match. */
  signals: RegExp[];
  /** How many distinct {@link signals} must fire. Default 2. */
  minSignals?: number;
  /** Blocks shorter than this are never treated as disclaimers. Default 120. */
  minTextLength?: number;
}

/** What a strip pass removed, and what it left. */
export interface StripResult {
  /** The remaining HTML. */
  html: string;
  /**
   * Names of the rules that actually removed something, in the order applied.
   *
   * Returned rather than discarded because a mail client's single worst failure
   * mode is content vanishing with no explanation. With this, "why did half my
   * email disappear?" is answerable — and a contributor's test asserts a rule
   * name instead of diffing HTML blobs.
   */
  applied: string[];
}

/** Options common to every strip pass. */
export interface StripOptions {
  /**
   * HTML parser to use. Defaults to the platform `DOMParser`; required in Node.
   * See `src/dom.ts`.
   */
  parser?: import('../dom.js').HtmlParser;
}
