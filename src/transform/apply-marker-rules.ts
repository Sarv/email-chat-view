/**
 * Engine for {@link MarkerRule} — cut the body at a prose boundary.
 */
import type { MarkerRule } from '../rules/types.js';

/**
 * Truncate `html` at the earliest marker any rule matches.
 *
 * EARLIEST MATCH WINS, across the whole rule set, rather than applying rules
 * one after another. Two reasons, and both matter for a package meant to take
 * outside contributions:
 *
 *  - It is order-independent. A rule you add cannot change what an existing
 *    rule does, so reviewing a new rule means reading that rule, not
 *    re-reasoning about the pipeline.
 *  - It picks the cleanest cut for free. When one rule matches a bare
 *    "On ... wrote:" and another matches the `<div>` that wraps it, the wrapped
 *    variant starts earlier in the string, so the opening tag is removed too
 *    instead of being orphaned.
 *
 * Ties go to the earlier rule in the array, so the result is deterministic.
 */
export function applyMarkerRules(
  html: string,
  rules: readonly MarkerRule[],
): { html: string; applied: string[] } {
  let cutAt = -1;
  let winner: string | undefined;

  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      // `String.search` rather than `RegExp.exec`: it ignores a stray `g` flag
      // and always searches from index 0. `exec` on a global regex carries
      // `lastIndex` between calls, which would make a rule set's behaviour
      // depend on how many times it had been used before — a genuinely nasty
      // bug to track down in someone else's application.
      const index = html.search(pattern);
      if (index === -1) continue;
      if (cutAt === -1 || index < cutAt) {
        cutAt = index;
        winner = rule.name;
      }
    }
  }

  if (cutAt === -1 || winner === undefined) return { html, applied: [] };
  return { html: html.slice(0, cutAt), applied: [winner] };
}
