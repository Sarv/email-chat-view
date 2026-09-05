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
export function applyDomRules(root: Element, rules: readonly DomRule[]): string[] {
  const applied: string[] = [];

  for (const rule of rules) {
    let removedAny = false;

    for (const selector of rule.selectors) {
      for (const element of safeQueryAll(root, selector)) {
        // `querySelectorAll` returns a STATIC snapshot, so when a selector
        // matches both an outer and an inner element, removing the outer one
        // leaves the inner one still sitting in the list we are iterating —
        // detached, but with its own parent link intact. Removing it again is
        // harmless; claiming credit for it is not. `applied` is what a consumer
        // debugs "why did my content vanish?" with, and it has to name the rule
        // that actually did the removing.
        //
        // Asked as "is it still inside the root we were given?" rather than
        // `isConnected`, because `applyDomRules` is exported to run against any
        // already-parsed subtree. A detached root is a legitimate argument, and
        // there every element is `isConnected === false` — that check would make
        // the engine silently strip nothing at all.
        if (!root.contains(element)) continue;

        // Size guard. Several providers reuse signature-ish ids and classes as
        // ordinary body wrappers, so a rule may declare "only when short".
        if (rule.maxTextLength !== undefined) {
          if (normalizedText(element).length >= rule.maxTextLength) continue;
        }

        if (rule.test && !rule.test(element)) continue;

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
    }

    if (removedAny) applied.push(rule.name);
  }

  return applied;
}
