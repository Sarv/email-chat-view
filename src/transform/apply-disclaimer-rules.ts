/**
 * Engine for {@link DisclaimerRule} — remove trailing legal boilerplate.
 *
 * Two strategies, both driven by the same rule list:
 *
 *   1. AFTER AN <hr>. The divider is itself the boundary evidence, so a single
 *      corroborating signal in the text that follows is enough.
 *   2. TRAILING BLOCK. No divider, so the bar is higher: the block must sit at
 *      the trailing edge, OPEN with boilerplate phrasing, and carry several
 *      distinct signals.
 *
 * Strategy 1 runs first because it is the stronger evidence.
 */
import type { DisclaimerRule } from '../rules/types.js';

import { isElement, lastMeaningfulChild, normalizedText } from './node-utils.js';

const DEFAULT_MIN_SIGNALS = 2;
const DEFAULT_MIN_TEXT_LENGTH = 120;

/**
 * How deep the trailing-block walk will descend before giving up.
 *
 * Mail HTML nests absurdly (Word round-trips produce a dozen wrapper divs
 * around one paragraph), so the walk has to descend — but it must terminate on
 * a pathological or cyclic-looking document rather than spin.
 */
const MAX_DESCENT = 24;

/** Count how many of a rule's signals appear in `text`. */
function countSignals(rule: DisclaimerRule, text: string): number {
  return rule.signals.reduce((total, signal) => (signal.test(text) ? total + 1 : total), 0);
}

/** Whether `text` satisfies a rule under the given strategy's requirements. */
function matchesRule(rule: DisclaimerRule, text: string, requireOpens: boolean): boolean {
  const minLength = rule.minTextLength ?? DEFAULT_MIN_TEXT_LENGTH;
  if (text.length < minLength) return false;

  if (requireOpens) {
    // A rule with no `opens` cannot judge a block on its own — it exists only
    // for the <hr> strategy, where the divider supplies the boundary.
    if (!rule.opens) return false;
    if (!rule.opens.test(text)) return false;
  }

  return countSignals(rule, text) >= (rule.minSignals ?? DEFAULT_MIN_SIGNALS);
}

/**
 * Strategy 1: find an `<hr>` whose following siblings read as boilerplate, and
 * remove the divider along with everything after it.
 *
 * Dividers are examined LAST FIRST, and that direction is the whole
 * correctness argument. A divider's tail is everything after it, so an early
 * decorative `<hr>` in a message that ALSO carries a footer has a tail
 * containing that footer — judged front-to-back, the first rule fires on the
 * early divider and deletes every real paragraph between the two. Working
 * backwards picks the LATEST boundary that reads as boilerplate, which is the
 * tightest cut and removes the least.
 *
 * It also degrades in the safe direction. A multi-paragraph disclaimer with its
 * own internal `<hr>` may leave its first half behind: the tail of the final
 * divider is a short fragment that fails the length floor, so the walk steps
 * back to the previous divider and takes more. Worst case some boilerplate
 * survives, which is a cosmetic problem — the opposite failure loses the
 * sender's words.
 */
function stripAfterDivider(root: Element, rules: readonly DisclaimerRule[]): string | undefined {
  for (const divider of Array.from(root.querySelectorAll('hr')).reverse()) {
    const tailParts: string[] = [];
    for (let node = divider.nextSibling; node; node = node.nextSibling) {
      tailParts.push(normalizedText(node));
    }
    const tailText = tailParts.filter(Boolean).join(' ');
    if (!tailText) continue;

    // `requireOpens: false` — the <hr> is the boundary, so a rule needs only
    // its signals here. Rules with a `minTextLength` still have to clear it.
    const rule = rules.find((candidate) => matchesRule(candidate, tailText, false));
    if (!rule) continue;

    let node = divider.nextSibling;
    while (node) {
      const doomed = node;
      node = node.nextSibling;
      doomed.parentNode?.removeChild(doomed);
    }
    divider.remove();
    return rule.name;
  }
  return undefined;
}

/**
 * Strategy 2: remove a trailing element that is WHOLLY a disclaimer.
 *
 * Descends through wrappers rather than judging only the body's last child,
 * because the footer is usually buried a few divs deep. The `opens` test is
 * what makes descending safe: a wrapper holding real content followed by a
 * footer does not start with boilerplate, so it fails, and the walk goes
 * inside it instead of deleting the message along with the footer.
 */
function stripTrailingBlock(root: Element, rules: readonly DisclaimerRule[]): string | undefined {
  let current: Element = root;

  for (let depth = 0; depth < MAX_DESCENT; depth += 1) {
    const last = lastMeaningfulChild(current);
    if (!isElement(last)) return undefined;

    const text = normalizedText(last);
    const rule = rules.find((candidate) => matchesRule(candidate, text, true));
    if (rule) {
      last.remove();
      return rule.name;
    }

    current = last;
  }

  return undefined;
}

/**
 * Remove trailing legal boilerplate from `root`, in place.
 *
 * @returns names of the rules that removed something.
 */
export function applyDisclaimerRules(root: Element, rules: readonly DisclaimerRule[]): string[] {
  const applied: string[] = [];

  const afterDivider = stripAfterDivider(root, rules);
  if (afterDivider) applied.push(afterDivider);

  const trailing = stripTrailingBlock(root, rules);
  if (trailing) applied.push(trailing);

  return applied;
}
