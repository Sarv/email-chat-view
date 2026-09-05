/**
 * Engine for {@link DomRule} — remove elements a provider marked for us.
 */
import type { DomRule } from '../rules/types.js';

import { normalizedText, safeQueryAll } from './node-utils.js';

/**
 * Apply every rule to `root`, removing matched elements in place.
 *
 * @returns the names of rules that actually removed something, in rule order.
 *
 * Rules are independent: each is evaluated against the document as it stands,
 * and a rule that matches nothing is simply not reported. That independence is
 * what lets a contributor add a rule without auditing the rest of the set.
 */
/**
 * Everything the rule's selectors name, deduplicated, in document order.
 *
 * Two selectors on one rule regularly name the same element (`#signature` and
 * `div[id*="signature"]`), and `querySelectorAll` hands back a static list per
 * selector, so without the set an element would be judged and removed twice.
 */
function selectorMatches(root: Element, rule: DomRule): Element[] {
  const seen = new Set<Element>();
  for (const selector of rule.selectors) {
    for (const element of safeQueryAll(root, selector)) seen.add(element);
  }
  return [...seen];
}

/** Whether the rule's guards accept a matched element. */
function accepts(rule: DomRule, element: Element): boolean {
  // Size guard. Several providers reuse signature-ish ids and classes as
  // ordinary body wrappers, so a rule may declare "only when short".
  if (rule.maxTextLength !== undefined && normalizedText(element).length >= rule.maxTextLength) {
    return false;
  }
  return !rule.test || rule.test(element);
}

/**
 * The elements to remove for one rule, in the order to remove them.
 *
 * Two strategies, because {@link DomRule.innermost} genuinely needs a different
 * one. Without it, guards are evaluated LAZILY during the removal loop, so a
 * nested match swallowed by its own container is never judged at all — the
 * cheapest order, and the one a rule with an expensive `test` depends on. With
 * it, every guard has to run up front: deciding which candidate is innermost
 * means comparing survivors against each other, which is impossible once the
 * first removal has detached some of them.
 */
function targetsFor(root: Element, rule: DomRule): Element[] {
  const matches = selectorMatches(root, rule);
  if (!rule.innermost) return matches;

  const candidates = matches.filter((element) => accepts(rule, element));
  return candidates.filter(
    (element) => !candidates.some((other) => other !== element && element.contains(other)),
  );
}

export function applyDomRules(root: Element, rules: readonly DomRule[]): string[] {
  const applied: string[] = [];

  for (const rule of rules) {
    const targets = targetsFor(root, rule);
    let removedAny = false;

    for (const element of targets) {
      // When a rule matches both an outer and an inner element, removing the
      // outer one leaves the inner one still in this list — detached, but with
      // its own parent link intact. Removing it again is harmless; claiming
      // credit for it is not. `applied` is what a consumer debugs "why did my
      // content vanish?" with, and it has to name the rule that actually did
      // the removing.
      //
      // Asked as "is it still inside the root we were given?" rather than
      // `isConnected`, because `applyDomRules` is exported to run against any
      // already-parsed subtree. A detached root is a legitimate argument, and
      // there every element is `isConnected === false` — that check would make
      // the engine silently strip nothing at all.
      if (!root.contains(element)) continue;

      // For an `innermost` rule these already ran, in `targetsFor`. For every
      // other rule this is the first and only time they run, and running them
      // here rather than up front is what keeps a guard off an element that an
      // ancestor's removal has already taken care of.
      if (!rule.innermost && !accepts(rule, element)) continue;

      // A boundary marker means "everything past here is history". Take the
      // following siblings first: once the element itself is detached it has
      // no siblings left to walk.
      if (rule.boundary) {
        let sibling = element.nextSibling;
        while (sibling) {
          const doomed = sibling;
          sibling = sibling.nextSibling;
          doomed.parentNode?.removeChild(doomed);
        }
      }

      element.remove();
      removedAny = true;
    }

    if (removedAny) applied.push(rule.name);
  }

  return applied;
}
