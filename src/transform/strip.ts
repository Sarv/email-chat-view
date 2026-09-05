/**
 * The public strip API.
 *
 * Each family is exposed on its own (`stripSignature`, `stripBanner`,
 * `stripLines`, `stripQuote`, `stripDisclaimer`, `stripMarkers`) because they
 * are independently useful and independently testable — and because a consumer
 * with an unusual corpus may want five of the six.
 *
 * {@link cleanReplyBody} runs the whole pipeline and is what the chat view
 * uses. It parses the document ONCE and hands the same tree to every DOM pass,
 * where calling the individual functions in sequence would reparse the body for
 * each one. On a 200-message thread that difference is the whole cost.
 */
import { resolveParser } from '../dom.js';
import { bannerRules as defaultBannerRules } from '../rules/banner.js';
import { disclaimerRules as defaultDisclaimerRules } from '../rules/disclaimer.js';
import { lineRules as defaultLineRules } from '../rules/line.js';
import { markerRules as defaultMarkerRules } from '../rules/marker.js';
import { quoteRules as defaultQuoteRules } from '../rules/quote.js';
import { signatureRules as defaultSignatureRules } from '../rules/signature.js';
import type {
  DisclaimerRule,
  DomRule,
  LineRule,
  MarkerRule,
  StripOptions,
  StripResult,
} from '../rules/types.js';

import { applyDisclaimerRules } from './apply-disclaimer-rules.js';
import { applyDomRules } from './apply-dom-rules.js';
import { applyLineRules } from './apply-line-rules.js';
import { applyMarkerRules } from './apply-marker-rules.js';
import { cutSignOff } from './sign-off.js';

/** Options for a single-family strip pass. */
export interface StripFamilyOptions<TRule> extends StripOptions {
  /** Replaces the default rule set entirely. Compose it from the exported rules. */
  rules?: readonly TRule[];
}

/**
 * Parse, run one DOM pass, serialize.
 *
 * A body that fails to parse is returned untouched rather than thrown on. In a
 * mail client, showing a message with its signature still attached is a
 * cosmetic problem; failing to show the message at all is a lost email.
 */
function runDomPass(
  html: string,
  rules: readonly DomRule[],
  apply: (root: Element, rules: readonly DomRule[]) => string[],
  options?: StripOptions,
): StripResult {
  if (!html) return { html, applied: [] };
  try {
    const document = resolveParser(options?.parser)(html);
    const body = document.body;
    if (!body) return { html, applied: [] };
    const applied = apply(body, rules);
    return { html: body.innerHTML, applied };
  } catch {
    return { html, applied: [] };
  }
}

/** Remove the sender's signature block. */
export function stripSignature(
  html: string,
  options?: StripFamilyOptions<DomRule>,
): StripResult {
  return runDomPass(html, options?.rules ?? defaultSignatureRules, applyDomRules, options);
}

/** Remove quoted-history containers. Does not handle prose markers — see {@link stripMarkers}. */
export function stripQuote(html: string, options?: StripFamilyOptions<DomRule>): StripResult {
  return runDomPass(html, options?.rules ?? defaultQuoteRules, applyDomRules, options);
}

/**
 * Remove the warning and confidentiality BOXES a gateway injected.
 *
 * Only the two element-shaped variants. A banner that arrived as a bare text
 * line between `<br>`s has no element to remove and is handled by
 * {@link stripLines}, which is why {@link cleanReplyBody} runs both.
 */
export function stripBanner(html: string, options?: StripFamilyOptions<DomRule>): StripResult {
  return runDomPass(html, options?.rules ?? defaultBannerRules, applyDomRules, options);
}

/**
 * Remove conventions that exist as a standalone visual LINE — an RFC 3676
 * delimiter, "Sent from my iPhone", a `-----Original Message-----` separator.
 *
 * Matched against the flattened text rather than the markup, because the line
 * these occupy is assembled out of text nodes, `<br>`s and block boundaries that
 * no single string pattern spans reliably.
 */
export function stripLines(html: string, options?: StripFamilyOptions<LineRule>): StripResult {
  if (!html) return { html, applied: [] };
  const rules = options?.rules ?? defaultLineRules;
  try {
    const document = resolveParser(options?.parser)(html);
    const body = document.body;
    if (!body) return { html, applied: [] };
    const applied = applyLineRules(body, rules);
    return { html: body.innerHTML, applied };
  } catch {
    return { html, applied: [] };
  }
}

/**
 * Cut a trailing sign-off ("Thanks,\nAnkur\n+91 …") and everything after it.
 *
 * The one pass with no rule set to override, because it is not a rule set: it is
 * a set of size and evidence guards around a handful of words people also use in
 * sentences. Extending it means adding a pattern to `signOffPatterns`.
 */
export function stripSignOff(html: string, options?: StripOptions): StripResult {
  if (!html) return { html, applied: [] };
  try {
    const document = resolveParser(options?.parser)(html);
    const body = document.body;
    if (!body) return { html, applied: [] };
    const cut = cutSignOff(body);
    return { html: body.innerHTML, applied: cut ? ['sign-off'] : [] };
  } catch {
    return { html, applied: [] };
  }
}

/** Remove trailing legal / confidentiality boilerplate. */
export function stripDisclaimer(
  html: string,
  options?: StripFamilyOptions<DisclaimerRule>,
): StripResult {
  if (!html) return { html, applied: [] };
  const rules = options?.rules ?? defaultDisclaimerRules;
  try {
    const document = resolveParser(options?.parser)(html);
    const body = document.body;
    if (!body) return { html, applied: [] };
    const applied = applyDisclaimerRules(body, rules);
    return { html: body.innerHTML, applied };
  } catch {
    return { html, applied: [] };
  }
}

/**
 * Truncate at the earliest quoted-history prose marker ("On ... wrote:").
 *
 * Operates on the string, not the DOM, because these boundaries are text a
 * client injected and frequently sit between elements rather than inside one.
 */
export function stripMarkers(
  html: string,
  options?: StripFamilyOptions<MarkerRule>,
): StripResult {
  if (!html) return { html, applied: [] };
  return applyMarkerRules(html, options?.rules ?? defaultMarkerRules);
}

/** Rule sets for {@link cleanReplyBody}; any omitted family uses its defaults. */
export interface CleanReplyBodyOptions extends StripOptions {
  signatureRules?: readonly DomRule[];
  bannerRules?: readonly DomRule[];
  lineRules?: readonly LineRule[];
  quoteRules?: readonly DomRule[];
  disclaimerRules?: readonly DisclaimerRule[];
  markerRules?: readonly MarkerRule[];
  /**
   * Leave a trailing sign-off in place.
   *
   * The sign-off pass is the most speculative one in the pipeline — its marker
   * is "Thanks," and "Best regards," which are also how people end sentences —
   * so it is the one worth turning off first when a corpus loses content it
   * should have kept.
   */
  keepSignOff?: boolean;
  /**
   * Skip the quote and marker passes, keeping only signature and disclaimer
   * removal.
   *
   * Set this for the OLDEST message in a thread. It has no quoted history to
   * strip — nothing came before it — so running the quote passes over it can
   * only misfire on genuine content the sender happened to blockquote.
   */
  keepQuotedHistory?: boolean;
}

/**
 * Turn a raw reply body into just what its sender wrote.
 *
 * Pass order is deliberate, and each step earns its place:
 *
 *   1. SIGNATURE, so a signature sitting inside a quote wrapper is already gone
 *      and cannot be mistaken for quoted content.
 *   2. BANNER boxes, before anything cuts, because a gateway prepends as often
 *      as it appends and a leading banner would otherwise still be there when
 *      the trailing-edge passes have finished.
 *   3. QUOTE containers, removing whole marked-up histories.
 *   4. LINE rules, on the tree — and after the quote pass, deliberately. Half of
 *      them CUT to the end of the body, so the less history is still attached
 *      when they run, the less a mis-fire can take.
 *   5. SIGN-OFF, last of the in-tree cuts and the most speculative of them. It
 *      runs on what the earlier passes left, so its size guards ("the signature
 *      cannot be 40% of the message") are measured against the real message
 *      rather than against the message plus a quoted thread.
 *   6. MARKERS, on the serialized string, catching the plain-text boundaries no
 *      container marked up ("On Mon, Alice wrote:" between two bare divs).
 *   7. DISCLAIMER last of all, because it is the only pass that reasons about
 *      the TRAILING EDGE. Run it any earlier and a body whose tail is unmarked
 *      quoted history has its footer buried in the middle, where the
 *      trailing-block walk never looks — the disclaimer then survives into the
 *      bubble. Found by test, not by inspection.
 *
 * Steps 1–5 share ONE parse. Step 7 needs a second one only when step 6
 * actually cut something, because that is the only way the tree can have gone
 * stale — so the common case (no plain-text marker) still parses once.
 */
export function cleanReplyBody(html: string, options?: CleanReplyBodyOptions): StripResult {
  if (!html) return { html, applied: [] };

  const applied: string[] = [];
  const parse = resolveParser(options?.parser);
  const disclaimers = options?.disclaimerRules ?? defaultDisclaimerRules;

  /** Run the trailing-boilerplate pass over an already-parsed tree. */
  const runDisclaimers = (body: Element): string => {
    for (const name of applyDisclaimerRules(body, disclaimers)) {
      applied.push(`disclaimer:${name}`);
    }
    return body.innerHTML;
  };

  let intermediate: string;
  let parsed: Element;
  try {
    const body = parse(html).body;
    if (!body) return { html, applied: [] };
    parsed = body;

    for (const name of applyDomRules(body, options?.signatureRules ?? defaultSignatureRules)) {
      applied.push(`signature:${name}`);
    }

    for (const name of applyDomRules(body, options?.bannerRules ?? defaultBannerRules)) {
      applied.push(`banner:${name}`);
    }

    if (!options?.keepQuotedHistory) {
      for (const name of applyDomRules(body, options?.quoteRules ?? defaultQuoteRules)) {
        applied.push(`quote:${name}`);
      }
    }

    for (const name of applyLineRules(body, options?.lineRules ?? defaultLineRules)) {
      applied.push(`line:${name}`);
    }

    if (!options?.keepSignOff && cutSignOff(body)) applied.push('sign-off');

    // The oldest message in a thread has no history behind it, so there is
    // nothing to cut — only genuine content a marker could truncate. Its
    // disclaimer is already at the trailing edge of the tree in hand, so it
    // needs no reparse either.
    if (options?.keepQuotedHistory) return { html: runDisclaimers(body), applied };

    intermediate = body.innerHTML;
  } catch {
    // Parsing failed. Still run the string-only marker pass, so a body we could
    // not parse at least loses its plain-text quote boundary — degrade, never
    // give up and show the whole thread history in one bubble.
    const markers = applyMarkerRules(html, options?.markerRules ?? defaultMarkerRules);
    for (const name of markers.applied) applied.push(`marker:${name}`);
    return { html: markers.html, applied };
  }

  const markers = applyMarkerRules(intermediate, options?.markerRules ?? defaultMarkerRules);
  for (const name of markers.applied) applied.push(`marker:${name}`);

  // No marker fired, so the tree from the first parse is still exactly this
  // HTML — reuse it. Only a cut invalidates it and forces the second parse.
  if (!markers.applied.length) return { html: runDisclaimers(parsed), applied };

  try {
    const body = parse(markers.html).body;
    if (!body) return { html: markers.html, applied };
    return { html: runDisclaimers(body), applied };
  } catch {
    return { html: markers.html, applied };
  }
}
