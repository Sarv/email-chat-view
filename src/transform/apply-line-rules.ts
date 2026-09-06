/**
 * The {@link LineRule} engine.
 *
 * Walks the text nodes of a tree, tests each one's visible line against every
 * rule, and either cuts from that point to the end (`action: 'cut'`) or removes
 * just that node (`action: 'line'`).
 *
 * Text nodes rather than a flattened string, and that is the whole design. The
 * rules describe visual LINES, but the cut has to happen in the DOM — so
 * matching against flattened text would mean mapping a string offset back onto
 * a node, which is exactly the fragile bookkeeping this avoids. In real mail a
 * standalone line is its own text node anyway: clients emit
 * `text<br>text<br>text`, and each of those is a node whose content is one line.
 */
import type { LineRule } from '../rules/types.js';

import { removeFromNodeOnward, SHOW_TEXT } from './dom-slice.js';
import { normalizedText } from './node-utils.js';

/**
 * Every text node under `root`, in document order, collected up front.
 *
 * Collected rather than streamed because both actions MUTATE the tree, and a
 * live TreeWalker positioned on a node that has just been removed is undefined
 * behaviour across DOM implementations — in linkedom it silently stops early,
 * leaving the rest of the body unexamined.
 */
function textNodesOf(root: Element): Node[] {
  const document = root.ownerDocument;
  if (!document) return [];
  const nodes: Node[] = [];
  const walker = document.createTreeWalker(root, SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  return nodes;
}

/**
 * Apply line rules to a parsed tree, in place. Returns the names of the rules
 * that removed something.
 *
 * A `'cut'` stops the whole pass: everything after the cut point is already
 * gone, so no later rule has anything left to say about it. `'line'` rules keep
 * going, since each removes only its own line.
 *
 * The EARLIEST cut wins, whichever rule found it — the same doctrine
 * {@link MarkerRule} follows, and for the same reason. Running each cut rule as
 * its own top-to-bottom pass instead would make the rule set order-dependent: a
 * rule added at the end of the list could move where an existing rule cuts, and
 * "adding a provider is a five-line object" stops being true the moment that is
 * possible.
 */
export function applyLineRules(root: Element, rules: readonly LineRule[]): string[] {
  const applied: string[] = [];
  const lineRules = rules.filter((rule) => rule.action === 'line');
  const cutRules = rules.filter((rule) => rule.action === 'cut');

  // No "is this node still attached?" guard, deliberately. The list is
  // collected up front, so a pass that detached nodes OTHER than the one it was
  // looking at would go on testing content nobody can see and credit rules for
  // removing it. Neither action can: `'cut'` detaches a whole tail but returns
  // immediately, and `'line'` detaches only the node it just tested. Any new
  // action that breaks that invariant has to reinstate the guard.
  for (const node of textNodesOf(root)) {
    const line = normalizedText(node);
    if (!line) continue;

    const cut = cutRules.find(
      (rule) => line.length <= rule.maxLineLength && rule.pattern.test(line),
    );
    if (cut) {
      removeFromNodeOnward(node, root);
      applied.push(cut.name);
      return applied;
    }

    const drop = lineRules.find(
      (rule) => line.length <= rule.maxLineLength && rule.pattern.test(line),
    );
    if (drop) {
      // Non-null by construction: a TreeWalker over `root`'s descendants never
      // yields a node without a parent.
      node.parentNode!.removeChild(node);
      applied.push(drop.name);
    }
  }

  return applied;
}
