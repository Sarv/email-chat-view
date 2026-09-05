/**
 * Slicing a document between two nodes, without DOM `Range`.
 *
 * The obvious implementation of "give me the content between these two
 * boundaries" is a `Range`: `selectNodeContents`, `setStartAfter`,
 * `setEndBefore`, `cloneContents`. That is what this package's ancestor did,
 * and it works perfectly — in a browser.
 *
 * It does not work anywhere else. `Range` is the most thinly implemented corner
 * of every server-side DOM: linkedom (which this package's own suite runs on,
 * and which the README recommends for Node) has no `setEnd` at all, and
 * `cloneContents` throws `start.cloneNode is not a function` after a
 * `setEndBefore`. Depending on `Range` would mean the splitter silently only
 * worked in a browser, which is the opposite of what `email-chat-view/transform`
 * promises.
 *
 * So the slice is done by subtraction instead: deep-clone the whole root, then
 * delete everything outside the wanted region. Only `childNodes`, `parentNode`
 * and `removeChild` are involved — the parts of the DOM every implementation
 * gets right — and the result preserves ancestor nesting exactly the way
 * `cloneContents` does, because the ancestors were never taken apart.
 *
 * Boundaries are addressed by CHILD-INDEX PATH rather than by identity, since
 * the caller holds nodes from the original tree and the deletions happen in the
 * clone. `cloneNode(true)` is structure-preserving, so the same path lands on
 * the same node.
 */

/** `Node.DOCUMENT_POSITION_FOLLOWING`. Not a global in linkedom — see module doc. */
export const DOCUMENT_POSITION_FOLLOWING = 4;

/** `Node.DOCUMENT_POSITION_CONTAINED_BY`. Not a global in linkedom either. */
export const DOCUMENT_POSITION_CONTAINED_BY = 16;

/** `NodeFilter.SHOW_TEXT`. Same reason: `NodeFilter` is undefined outside a browser. */
export const SHOW_TEXT = 4;

/**
 * The child-index path from `root` down to `node`, or null when unrelated.
 *
 * Index within `childNodes`, not `children`: text nodes are boundaries here
 * (an attribution is frequently a bare text node between two `<br>`s), so a
 * path that counted elements only would point at the wrong node or at nothing.
 */
export function pathTo(node: Node, root: Node): number[] | null {
  const path: number[] = [];
  let current: Node = node;
  while (current !== root) {
    const parent: Node | null = current.parentNode;
    // The only way out other than reaching `root`: the walk ran past the top of
    // the tree, so `node` was detached or belongs to a different document.
    if (!parent) return null;
    // `indexOf` cannot miss — `current` was read from `parent`'s own child list
    // one step ago — so there is no "not found" case to guard.
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
    current = parent;
  }
  return path;
}

/** The node a {@link pathTo} path addresses, or null when the path does not fit. */
export function nodeAtPath(root: Node, path: readonly number[]): Node | null {
  let current: Node = root;
  for (const index of path) {
    const child: ChildNode | undefined = current.childNodes[index];
    if (!child) return null; // the path is deeper or wider than this tree
    current = child;
  }
  return current;
}

/**
 * Remove `node` and everything AFTER it in document order.
 *
 * Walks up the ancestor chain dropping following siblings at each level, so
 * ancestors that also hold content BEFORE the cut survive with that content
 * intact. Removing the ancestors outright would take the kept text with them.
 */
export function removeFromNodeOnward(node: Node, root: Node): void {
  let current: Node | null = node;
  let isCutNode = true;
  while (current && current !== root && current.parentNode) {
    const parent: Node = current.parentNode;
    while (current.nextSibling) parent.removeChild(current.nextSibling);
    if (isCutNode) {
      parent.removeChild(current);
      isCutNode = false;
    }
    current = parent;
  }
}

/**
 * Remove `node` and everything BEFORE it — the mirror of
 * {@link removeFromNodeOnward}, and the half a `Range` would have given for
 * free via `setStartAfter`.
 */
export function removeUpToNodeInclusive(node: Node, root: Node): void {
  let current: Node | null = node;
  let isCutNode = true;
  while (current && current !== root && current.parentNode) {
    const parent: Node = current.parentNode;
    while (current.previousSibling) parent.removeChild(current.previousSibling);
    if (isCutNode) {
      parent.removeChild(current);
      isCutNode = false;
    }
    current = parent;
  }
}

/** Where a slice begins and ends, as nodes in the ORIGINAL tree. */
export interface SliceBounds {
  /** Content starts immediately after this node. Omit to start at the beginning. */
  startAfter?: Node | null;
  /** Content ends immediately before this node. Omit to run to the end. */
  endBefore?: Node | null;
}

/**
 * A detached `<div>` holding the content of `root` between the given bounds.
 *
 * The `Range.cloneContents()` replacement. Returns an element rather than a
 * fragment because every caller immediately wants `innerHTML` or wants to run
 * element-level strip passes over it, and a fragment supports neither.
 *
 * A boundary that cannot be located in the clone is IGNORED rather than
 * treated as an error, matching what the `Range` code did with its try/catch:
 * a boundary that will not resolve means "do not cut on this side", which
 * yields a larger segment. Too much text in a bubble is a visible, recoverable
 * flaw; a boundary failure that silently emptied the message would not be.
 */
export function sliceBetween(root: Element, bounds: SliceBounds = {}): Element {
  // No fallback for a root without an `ownerDocument`, and it was tried: a
  // shallow self-clone looks like one until you find that `cloneNode` reaches
  // for `ownerDocument.createElement` too (linkedom does, verifiably). There is
  // nothing this function can do without a document, so the guard would only
  // have moved the failure one line down while reading as protection.
  const holder = root.ownerDocument.createElement('div');

  // Paths are computed against the ORIGINAL tree, before anything is cloned:
  // afterwards the boundary nodes belong to a tree the clone knows nothing of.
  const startPath = bounds.startAfter ? pathTo(bounds.startAfter, root) : null;
  const endPath = bounds.endBefore ? pathTo(bounds.endBefore, root) : null;

  const copy = root.cloneNode(true) as Element;

  // End first. Removing the tail cannot move anything that precedes it, so the
  // start path stays valid; doing it the other way round would invalidate the
  // end path the moment the head was deleted.
  if (endPath) {
    const endNode = nodeAtPath(copy, endPath);
    if (endNode) removeFromNodeOnward(endNode, copy);
  }
  if (startPath) {
    const startNode = nodeAtPath(copy, startPath);
    if (startNode) removeUpToNodeInclusive(startNode, copy);
  }

  while (copy.firstChild) holder.appendChild(copy.firstChild);
  return holder;
}
