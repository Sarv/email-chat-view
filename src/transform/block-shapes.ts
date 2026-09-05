/**
 * Predicates for rules whose marker is a block's SHAPE, not a selector.
 *
 * Most conventions announce themselves: Gmail writes `.gmail_signature`, Apple
 * Mail writes `.AppleMailSignature`, and a `DomRule` selector is the whole
 * story. Three do not, and they are the three that survive every other pass:
 *
 *   - the external-sender warning BOX a gateway injects as an anonymous
 *     `<table>` of styled `<td>`s;
 *   - the graphical CONTACT CARD a rich signature editor emits — a logo image
 *     and a table of name, title, phone, website, with no class on any of it;
 *   - the brand LOGO STRIP that follows it.
 *
 * Nothing about their markup says what they are. What identifies them is their
 * shape: what they contain, how much text, whether that text is anything but
 * banner phrasing. That question needs code, which is why `DomRule` has a
 * {@link DomRule.test} hook — and why these predicates live here, next to the
 * DOM helpers they need, rather than inline in the rule files.
 *
 * Each is a FACTORY taking its own thresholds, so the numbers stay in the rule
 * object where a contributor reviewing that rule can see them, instead of being
 * buried in a shared module they have no reason to open.
 */
import { normalizedText, safeMatches, safeQueryAll } from './node-utils.js';

/**
 * Containers of quoted history — a guard, not a target.
 *
 * Every predicate here answers "may this whole block be deleted?", and the
 * answer is always no when the block holds a quote, because the quote is
 * somebody's message. Deliberately kept separate from the quote RULES in
 * `src/rules/quote.ts`: those decide what to REMOVE and are free to be precise,
 * while this list decides what to PROTECT and is better off broad. A guard that
 * misses is a deleted conversation; a guard that over-fires leaves one banner
 * in place.
 */
const QUOTE_CONTAINER_SELECTOR = 'blockquote, .gmail_quote, .gmail_quote_container';

/** Tags that make an element a container rather than a single visual line. */
const NESTED_BLOCK_SELECTOR = 'p, div, table, ul, ol, blockquote';

/** Where a block's text actually lives, for the "is every leaf a banner?" walk. */
const LEAF_SELECTOR = 'p, div, td, li, span, font';

/**
 * True when the element IS or HOLDS quoted history, and must therefore be kept.
 *
 * The self-check is not symmetry for its own sake. `querySelectorAll` only ever
 * looks downward, so a `<blockquote>` asked "do you contain a quote?" answers no
 * about itself — and a rule whose selector list happens to include `blockquote`
 * or `div` then deletes a whole quoted message as though it were a banner. The
 * same trap `isEmptyElement` has to sidestep for `<img>`.
 */
export function containsQuote(element: Element): boolean {
  if (safeMatches(element, QUOTE_CONTAINER_SELECTOR)) return true;
  return safeQueryAll(element, QUOTE_CONTAINER_SELECTOR).length > 0;
}

/**
 * True when the element has no block-level children — it renders as one line
 * rather than as a container of them.
 *
 * The guard for any rule that judges a whole element by its text. A real
 * paragraph that merely mentions "confidential" sits inside a block that has
 * other block children; a gateway's banner line does not.
 */
export function isLeafBlock(element: Element): boolean {
  return safeQueryAll(element, NESTED_BLOCK_SELECTOR).length === 0;
}

/**
 * Distinct web domains in a blob — `sarv.com`, `wave.sarv.com`, `enquiry.ai`.
 *
 * Two or more is the tell of a corporate links strip, which is one of the two
 * things that can prove a block is a signature card, and — in the sign-off pass
 * — one of the two that let a cut past its size guards.
 */
export function distinctDomainCount(text: string): number {
  const domains = new Set<string>();
  // Private and non-extensible, so no zero-width guard is needed on the loop:
  // every alternative requires at least one character.
  const scan = /(?:www\.|https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;
  for (let match = scan.exec(text); match; match = scan.exec(text)) {
    const domain = match[1]!.toLowerCase();
    // The final label must be alphabetic, which is what separates `sarv.com`
    // from the `192.168.1.1` of a dial-in block or a version number in prose.
    if (/\.[a-z]{2,}$/.test(domain)) domains.add(domain);
  }
  return domains.size;
}

/** Whether a short blob of text is banner phrasing and nothing else. */
function isBannerText(text: string, pattern: RegExp, maxChars: number): boolean {
  return text.length > 0 && text.length <= maxChars && pattern.test(text);
}

/**
 * A block whose every non-empty leaf is banner text.
 *
 * The shape a gateway injects its external-sender warning in: a `<table>` or
 * `<div>` of styled cells, no class, nothing in it but the warning. Requiring
 * EVERY leaf to be banner phrasing is what makes deleting the whole block safe
 * — a message that merely mentions "confidential" has at least one leaf that is
 * real prose, so it is spared here and its banner line, if it has one, is left
 * to the narrower line-level rules.
 *
 * The `maxChars` tolerance is much higher than the line rules' because of that:
 * a block proven to contain nothing but banner text is unambiguous however long
 * it runs, while a single line inside real content never is.
 */
export function isPureBannerBlock(pattern: RegExp, maxChars: number) {
  return (element: Element): boolean => {
    if (containsQuote(element)) return false;

    let sawBanner = false;
    for (const leaf of safeQueryAll(element, LEAF_SELECTOR)) {
      if (!isLeafBlock(leaf)) continue; // a container; its own leaves get judged
      const text = normalizedText(leaf);
      if (!text) continue;
      if (!isBannerText(text, pattern, maxChars)) return false; // real content
      sawBanner = true;
    }

    // No leaf elements at all — `<div>External Email: use caution</div>` is the
    // common shape — so there is nothing to walk and the block's own text is
    // the only thing to judge.
    if (!sawBanner) return isBannerText(normalizedText(element), pattern, maxChars);
    return true;
  };
}

/**
 * A single visual line that is banner phrasing, inside an otherwise real block.
 *
 * Carries the quote guard even though it only ever looks at leaves, because a
 * `<blockquote>` holding one short line has no block children and is therefore
 * a leaf by this module's definition — and deleting it deletes a message.
 */
export function isBannerLineBlock(pattern: RegExp, maxChars: number) {
  return (element: Element): boolean =>
    !containsQuote(element) &&
    isLeafBlock(element) &&
    isBannerText(normalizedText(element), pattern, maxChars);
}

/**
 * A graphical signature card: an image or a table layout, SHORT text, and
 * either a phone number together with a website, or a multi-domain links strip.
 *
 * Requiring both halves of the classic card — not just one — is what keeps a
 * genuinely short message that happens to embed a picture and a link from being
 * read as a signature. A real card lists name, title, phone and site; a message
 * with a photo in it does not.
 *
 * The links-strip alternative exists because a corporate card often carries no
 * phone at all: "sarv.com | deepcall.com | wave.sarv.com | enquiry.ai" is a
 * signature on its own, and two distinct domains is a thing prose never does.
 */
export function isContactCard(phonePattern: RegExp, webPattern: RegExp, maxChars: number) {
  return (element: Element): boolean => {
    if (containsQuote(element)) return false;
    // A logo image OR a table layout — the two shapes rich signatures take. A
    // text-only signature is still table-structured when an editor made it.
    if (!safeQueryAll(element, 'img').length && element.tagName !== 'TABLE') return false;

    const text = normalizedText(element);
    if (text.length > maxChars) return false;
    return (phonePattern.test(text) && webPattern.test(text)) || distinctDomainCount(text) >= 2;
  };
}

/**
 * A brand-logo strip: several images and almost no text.
 *
 * Signature furniture — a row of product logos under a card — and it can sit
 * above other quoted text rather than only at the very end, so it is matched
 * wherever it appears rather than only when trailing.
 *
 * Two images, not one: a single image with little text around it is just as
 * likely to be the screenshot the message was sent to deliver.
 */
export function isLogoStrip(minImages: number, maxChars: number) {
  return (element: Element): boolean => {
    if (containsQuote(element)) return false;
    if (safeQueryAll(element, 'img').length < minImages) return false;
    return normalizedText(element).length < maxChars;
  };
}
