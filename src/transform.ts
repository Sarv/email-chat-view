/**
 * `email-chat-view/transform` — the transform layer, with no React.
 *
 * A separate entry point on purpose. Everything reachable from here is pure
 * TypeScript over strings and DOM nodes, so it imports and runs in places React
 * has no business being: a Node mail pipeline, a worker, a CLI that prints a
 * thread, a server-side digest builder, a test. Importing the package root
 * would pull React in as a peer for no reason.
 *
 * @example Node, with an injected parser
 * ```ts
 * import { parseHTML } from 'linkedom';
 * import { mailsToMessages } from 'email-chat-view/transform';
 *
 * const messages = mailsToMessages(mails, {
 *   parser: (html) => parseHTML(html).document,
 *   currentUserAddress: 'me@example.com',
 *   dateUnit: 's',
 * });
 * ```
 */

// --- Data contract -----------------------------------------------------------
export type { Attachment, ChatMessage, DateUnit, Mail } from './types.js';

// --- DOM injection -----------------------------------------------------------
export { hasGlobalDomParser, NoDomParserError, resolveParser } from './dom.js';
export type { HtmlParser } from './dom.js';

// --- The transform -----------------------------------------------------------
export {
  createBodyCache,
  mailsToMessages,
  mailToMessage,
} from './transform/mails-to-messages.js';
export type { BodyCache, MailsToMessagesOptions } from './transform/mails-to-messages.js';

// --- Individual strip passes -------------------------------------------------
export {
  cleanReplyBody,
  stripBanner,
  stripDisclaimer,
  stripLines,
  stripMarkers,
  stripQuote,
  stripSignature,
  stripSignOff,
} from './transform/strip.js';
export type { CleanReplyBodyOptions, StripFamilyOptions } from './transform/strip.js';

// --- Rule engines ------------------------------------------------------------
// Exported so a consumer with an already-parsed document can run a pass over it
// directly, without a serialize/reparse round trip.
export { applyDisclaimerRules } from './transform/apply-disclaimer-rules.js';
export { applyDomRules } from './transform/apply-dom-rules.js';
export { applyLineRules } from './transform/apply-line-rules.js';
export { applyMarkerRules } from './transform/apply-marker-rules.js';
export { cutSignOff, hasStrongSignatureEvidence, signOffBlock } from './transform/sign-off.js';

// --- Shape predicates --------------------------------------------------------
// The building blocks of a `DomRule.test`. A contributed shape rule should be
// composed from these rather than re-deriving "does this hold a quote?" —
// that guard drifting per rule is how content gets deleted.
export {
  containsQuote,
  distinctDomainCount,
  isBannerLineBlock,
  isContactCard,
  isLeafBlock,
  isLogoStrip,
  isPureBannerBlock,
} from './transform/block-shapes.js';

// --- Rule types (the contribution contract) ----------------------------------
export type {
  DisclaimerRule,
  DomRule,
  LineRule,
  MarkerRule,
  StripOptions,
  StripResult,
} from './rules/types.js';

// --- Rule sets, and every rule individually ----------------------------------
// Both the bundle and its parts. Take `signatureRules` to get the defaults, or
// name the four you trust and build your own list — a rule is a plain object,
// so composing a set is array literal syntax, not an API.
export {
  appleMailSignature,
  CARD_MAX_CHARS,
  contactCard,
  CONTACT_PHONE_RE,
  CONTACT_WEB_RE,
  genericSignature,
  gmailSignature,
  LOGO_STRIP_MAX_CHARS,
  LOGO_STRIP_MIN_IMAGES,
  logoStrip,
  looseSignatureClass,
  outlookDesktopSignature,
  outlookMobileSignature,
  sarvSignature,
  signatureRules,
  thunderbirdSignature,
} from './rules/signature.js';
export {
  BANNER_BLOCK_MAX_CHARS,
  BANNER_LINE_MAX_CHARS,
  bannerBox,
  bannerLineBlock,
  bannerPattern,
  bannerRules,
} from './rules/banner.js';
export {
  bannerLine,
  forwardMarkerLine,
  gibberishBlobLine,
  lineRules,
  meetingBoilerplateLine,
  mobileFooterLine,
  signatureDelimiterLine,
} from './rules/line.js';
export { signatureTitlePattern, signOffPatterns } from './rules/sign-off.js';
export {
  bareBlockquote,
  citeQuote,
  gmailQuote,
  outlookClassicQuote,
  outlookModernQuote,
  quoteRules,
  thunderbirdQuote,
  webmailReferenceQuote,
} from './rules/quote.js';
export {
  forwardedMessage,
  markerRules,
  originalMessage,
  outlookHeaderBlock,
  outlookUnderscoreSeparator,
  wroteAttribution,
} from './rules/marker.js';
export {
  disclaimerRules,
  englishDisclaimer,
  hrDelimitedDisclaimer,
} from './rules/disclaimer.js';

// --- Classification ----------------------------------------------------------
export { classifyMail, isConversational } from './classify/classify-mail.js';
export type { ClassifyMailOptions } from './classify/classify-mail.js';
export {
  AUTOMATED_THRESHOLD,
  automatedSignals,
  ESP_MESSAGE_ID_DOMAINS,
  hasEspMessageIdDomain,
} from './classify/signals.js';
export type {
  AutomatedSignal,
  MailClassification,
  MailClassificationInput,
  NormalizedInput,
} from './classify/signals.js';

// --- Node helpers ------------------------------------------------------------
// Small and unglamorous, but a contributed rule's `test` hook needs them, and
// re-implementing "does this element have meaningful children" per rule is how
// the guards drifted in the first place.
export {
  isElement,
  isIgnorableNode,
  lastMeaningfulChild,
  meaningfulChildren,
  normalizedText,
  safeMatches,
  safeQueryAll,
} from './transform/node-utils.js';
