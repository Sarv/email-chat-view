import { describe, expect, it } from 'vitest';

import {
  comparePaths,
  isPathPrefix,
  nodeAtPath,
  pathTo,
  removeFromNodeOnward,
  removeUpToNodeInclusive,
  sliceBetween,
} from '../../src/transform/dom-slice.js';
import { parseBody, squash } from '../helpers/parser.js';

/** The node whose text is exactly `text`, searched breadth-first over childNodes. */
function findByText(root: Element, text: string): Node {
  const queue: Node[] = Array.from(root.childNodes);
  while (queue.length) {
    const node = queue.shift() as Node;
    if ((node.textContent ?? '').trim() === text) return node;
    queue.push(...Array.from(node.childNodes));
  }
  throw new Error(`no node with text ${JSON.stringify(text)}`);
}

describe('pathTo / nodeAtPath', () => {
  // Regression: the whole slice addresses boundaries by path because the caller
  // holds nodes from the original tree while the cutting happens in a clone. If
  // a path does not round-trip, every segment boundary lands on the wrong node
  // and bubbles get someone else's text.
  it('round-trips a deeply nested node through a clone', () => {
    const body = parseBody('<div><p>one</p><p><b>two</b></p></div>');
    const target = findByText(body, 'two');

    const path = pathTo(target, body);
    expect(path).not.toBeNull();

    const copy = body.cloneNode(true) as Element;
    expect(nodeAtPath(copy, path as number[])?.textContent).toBe('two');
  });

  // Regression: an attribution is often a BARE TEXT NODE between two <br>s. A
  // path counting elements instead of childNodes would silently address the
  // wrong node — the one failure mode that produces plausible-looking garbage
  // rather than an error.
  it('indexes text nodes, not just elements', () => {
    const body = parseBody('text<br>after');
    const bare = body.childNodes[0]!;
    expect(bare.nodeType).toBe(3);

    const path = pathTo(bare, body) as number[];
    const copy = body.cloneNode(true) as Element;
    expect(nodeAtPath(copy, path)?.textContent).toBe('text');
  });

  it('returns an empty path for the root itself', () => {
    const body = parseBody('<p>x</p>');
    expect(pathTo(body, body)).toEqual([]);
    expect(nodeAtPath(body, [])).toBe(body);
  });

  // Regression: a boundary from a DIFFERENT document must not resolve to some
  // coincidental node at the same index. Null is what makes the caller skip
  // that cut instead of slicing at a wrong position.
  it('returns null for a node that is not under the root', () => {
    const body = parseBody('<p>x</p>');
    const other = parseBody('<p>y</p>');
    expect(pathTo(findByText(other, 'y'), body)).toBeNull();
  });

  it('returns null for a detached node', () => {
    const body = parseBody('<p>x</p>');
    const orphan = body.ownerDocument!.createElement('span');
    expect(pathTo(orphan, body)).toBeNull();
  });

  it('returns null when the path runs off the end of the tree', () => {
    const body = parseBody('<p>x</p>');
    expect(nodeAtPath(body, [5])).toBeNull();
    expect(nodeAtPath(body, [0, 0, 0, 0])).toBeNull();
  });
});

describe('comparePaths', () => {
  // Regression: this replaces `compareDocumentPosition`, which linkedom answers
  // WRONG for text-node receivers — two text nodes each reported as preceding
  // the other. Boundaries in mail HTML are text nodes more often than not, so a
  // wrong answer here shuffles a thread's bubbles into an arbitrary order with
  // nothing thrown and nothing logged.
  it.each([
    ['an earlier sibling first', [0, 1], [0, 2], -1],
    ['a later sibling last', [3], [1, 9], 1],
    ['equal paths as equal', [1, 4], [1, 4], 0],
    ['an ancestor before its descendant', [2], [2, 0], -1],
    ['a descendant after its ancestor', [2, 0, 7], [2], 1],
  ])('orders %s', (_label, left, right, expected) => {
    expect(Math.sign(comparePaths(left, right))).toBe(expected);
  });

  // Regression: the comparator has to be antisymmetric or `Array.sort` produces
  // an implementation-defined order — the exact failure the linkedom bug caused.
  it('is antisymmetric on every pair', () => {
    // `|| 0` folds `-0` into `0`: negating a zero sign yields `-0`, which is
    // equal to `0` everywhere except in the strict comparison this assertion uses.
    const sign = (value: number): number => Math.sign(value) || 0;
    const paths = [[0], [0, 0], [0, 1], [1], [1, 2, 3], [2]];
    for (const left of paths) {
      for (const right of paths) {
        expect(sign(comparePaths(left, right))).toBe(sign(-comparePaths(right, left)));
      }
    }
  });
});

describe('isPathPrefix', () => {
  // Regression: a boundary nested inside the region a previous boundary already
  // consumed is a duplicate anchor. Missing that containment emits a second
  // segment for one attribution — an empty bubble between two real messages.
  it('reports a strict ancestor', () => {
    expect(isPathPrefix([1], [1, 0, 4])).toBe(true);
  });

  // The other half: containment must be STRICT. A path is not nested inside
  // itself, and a shorter-or-equal path can never be inside a longer region —
  // treating either as nested would drop a real boundary and merge two messages.
  it.each([
    ['an identical path', [1, 0], [1, 0]],
    ['a longer path', [1, 0, 4], [1, 0]],
    ['a sibling branch', [1], [2, 0]],
  ])('rejects %s', (_label, ancestor, descendant) => {
    expect(isPathPrefix(ancestor, descendant)).toBe(false);
  });
});

describe('removeFromNodeOnward', () => {
  // Regression: the cut must keep content that precedes it INSIDE the same
  // ancestor. Removing the ancestor outright is the bug that ate the sender's
  // own message along with the signature sitting after it.
  it('keeps preceding content in a shared ancestor', () => {
    const body = parseBody('<div>keep<br><span>drop</span></div><p>also drop</p>');
    removeFromNodeOnward(findByText(body, 'drop'), body);
    expect(squash(body.innerHTML)).toBe('<div>keep<br></div>');
  });

  it('is a no-op for the root itself', () => {
    const body = parseBody('<p>x</p>');
    removeFromNodeOnward(body, body);
    expect(squash(body.innerHTML)).toBe('<p>x</p>');
  });
});

describe('removeUpToNodeInclusive', () => {
  // Regression: the mirror half — what `Range.setStartAfter` would have done.
  // Content following the cut inside the same ancestor has to survive, or every
  // quoted segment loses its first line.
  it('keeps following content in a shared ancestor', () => {
    const body = parseBody('<p>drop</p><div><span>drop too</span><br>keep</div>');
    removeUpToNodeInclusive(findByText(body, 'drop too'), body);
    expect(squash(body.innerHTML)).toBe('<div><br>keep</div>');
  });

  it('is a no-op for the root itself', () => {
    const body = parseBody('<p>x</p>');
    removeUpToNodeInclusive(body, body);
    expect(squash(body.innerHTML)).toBe('<p>x</p>');
  });
});

describe('sliceBetween', () => {
  // Regression: this is the `Range.cloneContents` replacement. linkedom has no
  // working Range (no `setEnd`, and `cloneContents` throws after
  // `setEndBefore`), so if this drifts the splitter works in a browser and
  // silently returns whole-body bubbles everywhere else.
  it('takes everything before a boundary', () => {
    const body = parseBody('<p>mine</p><div class="attr">On Mon wrote:</div><p>quoted</p>');
    const head = sliceBetween(body, { endBefore: body.querySelector('.attr')! });
    expect(squash(head.innerHTML)).toBe('<p>mine</p>');
  });

  it('takes everything after a boundary', () => {
    const body = parseBody('<p>mine</p><div class="attr">On Mon wrote:</div><p>quoted</p>');
    const tail = sliceBetween(body, { startAfter: body.querySelector('.attr')! });
    expect(squash(tail.innerHTML)).toBe('<p>quoted</p>');
  });

  it('takes the region between two boundaries', () => {
    const body = parseBody(
      '<p>newest</p><div class="a">attr one</div><p>middle</p><div class="b">attr two</div><p>oldest</p>',
    );
    const middle = sliceBetween(body, {
      startAfter: body.querySelector('.a')!,
      endBefore: body.querySelector('.b')!,
    });
    expect(squash(middle.innerHTML)).toBe('<p>middle</p>');
  });

  // Regression: nesting must survive the slice the way cloneContents preserved
  // it. Flattening here would strip the table/list structure out of every
  // quoted message.
  it('preserves ancestor nesting inside the slice', () => {
    const body = parseBody('<div><ul><li>a</li><li>b</li></ul><br>cut</div>');
    const head = sliceBetween(body, { endBefore: findByText(body, 'cut') });
    expect(squash(head.innerHTML)).toBe('<div><ul><li>a</li><li>b</li></ul><br></div>');
  });

  // Regression: slicing must not mutate the caller's document. findBoundaries
  // hands the SAME body to one slice per segment, so a destructive slice would
  // leave every segment after the first reading a progressively emptier tree.
  it('leaves the source document untouched', () => {
    const body = parseBody('<p>one</p><p>two</p>');
    sliceBetween(body, { endBefore: body.querySelector('p:last-child')! });
    expect(squash(body.innerHTML)).toBe('<p>one</p><p>two</p>');
  });

  it('returns the whole content when given no bounds', () => {
    const body = parseBody('<p>all</p>');
    expect(squash(sliceBetween(body).innerHTML)).toBe('<p>all</p>');
  });

  // Regression: an unresolvable boundary must widen the segment, never empty
  // it. Too much text in a bubble is visible and recoverable; a message that
  // silently vanished is neither.
  it('ignores a boundary it cannot locate', () => {
    const body = parseBody('<p>one</p>');
    const foreign = parseBody('<p>elsewhere</p>').querySelector('p')!;
    expect(squash(sliceBetween(body, { endBefore: foreign }).innerHTML)).toBe('<p>one</p>');
    expect(squash(sliceBetween(body, { startAfter: foreign }).innerHTML)).toBe('<p>one</p>');
  });

  // Regression: order matters. Cutting the head first invalidates the path to
  // the tail boundary, which would slice at a wrong node instead of failing.
  it('applies both bounds correctly when they share an ancestor', () => {
    const body = parseBody('<div>a<br>b<br>c<br>d</div>');
    const slice = sliceBetween(body, {
      startAfter: findByText(body, 'a'),
      endBefore: findByText(body, 'd'),
    });
    expect(slice.textContent).toBe('bc');
  });
});
