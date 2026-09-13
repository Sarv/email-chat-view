// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  fitWideTables,
  TABLE_REFLOW_CLASS,
  TABLE_SCROLL_CLASS,
  WIDE_TABLE_CSS,
} from '../../src/ui/wide-tables.js';

// jsdom has no layout engine, so `scrollWidth` is the one thing these tests have
// to supply themselves. Each table is given a width as a FUNCTION of whether it
// carries the reflow class — which is exactly the question the real code asks
// the browser, so the decision logic here is the real one.

const FRAME_WIDTH = 600;

/** Install a body whose `clientWidth` is the frame's. */
function frameDocument(): Document {
  document.body.innerHTML = '';
  Object.defineProperty(document.body, 'clientWidth', { value: FRAME_WIDTH, configurable: true });
  return document;
}

/**
 * Add a table whose width depends on whether it has been allowed to wrap.
 *
 * @param unwrapped width while the sender's own `nowrap` still applies
 * @param wrapped   width once the cells may wrap
 */
function addTable(parent: HTMLElement, unwrapped: number, wrapped: number): HTMLTableElement {
  const table = document.createElement('table');
  table.innerHTML = '<tbody><tr><td>cell</td></tr></tbody>';
  parent.appendChild(table);
  Object.defineProperty(table, 'scrollWidth', {
    get: () => (table.classList.contains(TABLE_REFLOW_CLASS) ? wrapped : unwrapped),
    configurable: true,
  });
  return table;
}

const reflowed = (table: Element) => table.classList.contains(TABLE_REFLOW_CLASS);
const scrolls = (table: Element) => table.classList.contains(TABLE_SCROLL_CLASS);

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('fitWideTables', () => {
  // Regression: the whole point. An Excel paste arrives with a pixel width and
  // `nowrap` on every cell, so the frame slices it off at the bubble's edge —
  // and with overlay scrollbars there is nothing on screen to say the rest of
  // it is reachable. Allowed to wrap, it fits and is visible at once.
  it('lets a too-wide table wrap when wrapping makes it fit', () => {
    const doc = frameDocument();
    const table = addTable(doc.body, 900, 560);

    fitWideTables(doc);

    expect(reflowed(table)).toBe(true);
  });

  // Regression: a table the sender laid out to fit must be rendered EXACTLY as
  // they wrote it. Reflowing every table would re-wrap deliberate single-line
  // columns — dates, amounts, codes — across two lines for no reason.
  it('leaves a table that already fits completely alone', () => {
    const doc = frameDocument();
    const table = addTable(doc.body, 500, 400);

    fitWideTables(doc);

    expect(reflowed(table)).toBe(false);
  });

  // Regression: a sheet with genuinely many columns is still too wide once its
  // text wraps. Half-wrapping it is worse than not trying — the reader gets a
  // mangled layout AND still cannot reach the right-hand columns — so the
  // reflow comes back off and that one table is made to scroll.
  it('scrolls a table that is still too wide once wrapped', () => {
    const doc = frameDocument();
    const table = addTable(doc.body, 1800, 1400);

    fitWideTables(doc);

    expect(reflowed(table)).toBe(false);
    expect(scrolls(table)).toBe(true);
  });

  // Regression: THE reason step two is measured separately. If the scroll
  // decision used the width the sender authored rather than the width after
  // wrapping, every nowrap table would get a scrollbar it no longer needs and
  // the reflow would have changed nothing the reader can see.
  it('decides to scroll on the wrapped width, not the authored one', () => {
    const doc = frameDocument();
    // Far too wide as authored, comfortably inside the frame once wrapped.
    const table = addTable(doc.body, 2400, 520);

    fitWideTables(doc);

    expect(reflowed(table)).toBe(true);
    expect(scrolls(table)).toBe(false);
  });

  // Regression: restructuring a table (`display:block`) is what makes it a
  // scroll container, and doing it to a table that FITS takes apart the layout
  // shells designed mail is built from. It is reserved for tables that have
  // earned it — which is the whole reason this is measured rather than guessed.
  it('never restructures a table it has not measured as too wide', () => {
    const doc = frameDocument();
    const shell = addTable(doc.body, 580, 580);
    const sheet = addTable(doc.body, 1800, 1400);

    fitWideTables(doc);

    expect(shell.className).toBe('');
    expect(scrolls(sheet)).toBe(true);
  });

  // Regression: a table sized to exactly the body rounds a fraction either way.
  // Restyling that one is worse than leaving it as the sender authored it.
  it('does not touch a table that matches the body width', () => {
    const doc = frameDocument();
    const table = addTable(doc.body, FRAME_WIDTH, FRAME_WIDTH);

    fitWideTables(doc);

    expect(table.className).toBe('');
  });

  // Regression: a message can carry several pasted ranges. The narrow ones must
  // stay exactly as authored while the wide ones are fitted — a pass that acted
  // on all of them or none would be no better than the blanket rule this
  // replaced.
  it('acts only on the tables that overflow', () => {
    const doc = frameDocument();
    const narrow = addTable(doc.body, 400, 400);
    const wide = addTable(doc.body, 900, 560);

    fitWideTables(doc);

    expect(narrow.className).toBe('');
    expect(reflowed(wide)).toBe(true);
  });

  // Regression: THE loop. This runs from the same callback a `ResizeObserver`
  // drives, and changing a class changes layout, which fires the observer
  // again. A table that wrapping cannot save would have the class added and
  // removed forever, pinning a core at 100%.
  it('is idempotent, so the resize observer cannot drive it in a loop', () => {
    const doc = frameDocument();
    const unsaveable = addTable(doc.body, 1800, 1400);
    const saveable = addTable(doc.body, 900, 560);

    for (let pass = 0; pass < 5; pass += 1) fitWideTables(doc);

    expect(scrolls(unsaveable)).toBe(true);
    expect(reflowed(unsaveable)).toBe(false);
    expect(reflowed(saveable)).toBe(true);
  });

  // Regression: the reader widening the window is the one time a decision can
  // legitimately change — a table that had to scroll at 600px may fit at
  // 1200px. Caching a bare "already decided" flag would pin it to scrolling for
  // the life of the message.
  it('reconsiders a table when the frame is resized', () => {
    const doc = frameDocument();
    const table = addTable(doc.body, 1000, 800);

    fitWideTables(doc);
    expect(scrolls(table)).toBe(true);

    Object.defineProperty(doc.body, 'clientWidth', { value: 900, configurable: true });
    fitWideTables(doc);

    expect(reflowed(table)).toBe(true);
    // And the earlier decision is gone, not layered under the new one.
    expect(scrolls(table)).toBe(false);
  });

  // Regression: a nested table is laid out inside its parent's cell, so its own
  // width says nothing about what the reader can see. Reflowing it on its own
  // re-wraps an inner layout table — the classic newsletter spacer — while the
  // outer one, the one that actually overflows, is left as it was.
  it('ignores a table nested inside another table', () => {
    const doc = frameDocument();
    const outer = addTable(doc.body, 900, 560);
    const cell = outer.querySelector('td') as HTMLTableCellElement;
    const inner = addTable(cell as unknown as HTMLElement, 900, 560);

    fitWideTables(doc);

    expect(reflowed(outer)).toBe(true);
    expect(reflowed(inner)).toBe(false);
  });

  // Regression: measured before the frame has been laid out, every width is 0
  // and every table looks like it fits. Deciding then would mark each one
  // "fits" and — the decision being cached — never look again.
  it('does nothing before the frame has a width', () => {
    const doc = frameDocument();
    Object.defineProperty(doc.body, 'clientWidth', { value: 0, configurable: true });
    const table = addTable(doc.body, 900, 560);

    fitWideTables(doc);
    // The width arrives; the table must still be reconsidered.
    Object.defineProperty(doc.body, 'clientWidth', { value: FRAME_WIDTH, configurable: true });
    fitWideTables(doc);

    expect(reflowed(table)).toBe(true);
  });

  // Regression: called with no document at all (the frame not yet loaded, or
  // torn down mid-measure) this must be a no-op rather than a thrown error that
  // takes the height measurement down with it and leaves the bubble at its
  // estimated size.
  it('survives a frame with no document', () => {
    expect(() => fitWideTables(null)).not.toThrow();
    expect(() => fitWideTables(undefined)).not.toThrow();
  });
});

describe('WIDE_TABLE_CSS', () => {
  // Regression: what these rules override is the sender's INLINE
  // `style="width:578pt"` on the table and inline `white-space:nowrap` on the
  // cells. An author declaration cannot beat an inline one, so without
  // `!important` the class goes on and nothing whatsoever changes.
  it('overrides the sender’s own inline width and nowrap', () => {
    expect(WIDE_TABLE_CSS).toContain('width:auto!important');
    expect(WIDE_TABLE_CSS).toContain('white-space:normal!important');
    // The base stylesheet makes every table `display:block;width:max-content`
    // so it can scroll; left in place that holds the table at its unwrapped
    // width however freely the cells are allowed to wrap.
    expect(WIDE_TABLE_CSS).toContain('display:table!important');
    expect(WIDE_TABLE_CSS).toContain('table-layout:auto!important');
  });

  // Regression: an authoring tool puts `nowrap` on the `<td>`, on a `<span>`
  // inside it, or on both — reaching only the cell leaves the span holding the
  // table wide.
  it('reaches the contents of a cell, not just the cell', () => {
    expect(WIDE_TABLE_CSS).toContain(`.${TABLE_REFLOW_CLASS} td *`);
    expect(WIDE_TABLE_CSS).toContain(`.${TABLE_REFLOW_CLASS} th *`);
  });

  // Regression: every rule is scoped to the class, so a table the measurement
  // never touched is rendered exactly as the sender wrote it.
  it('does nothing to a table that carries neither class', () => {
    for (const rule of WIDE_TABLE_CSS.split('}').filter(Boolean)) {
      expect(rule).toMatch(new RegExp(`${TABLE_REFLOW_CLASS}|${TABLE_SCROLL_CLASS}`));
    }
  });

  // Regression: `display:block` is what makes the table a scroll container, and
  // `width:max-content` is what stops that costing it its shrink-to-fit. Drop
  // either and step two either does not scroll or scrolls a table stretched to
  // the full width of the pane.
  it('makes a table that must scroll into its own scroll container', () => {
    expect(WIDE_TABLE_CSS).toContain(`.${TABLE_SCROLL_CLASS}{display:block!important`);
    expect(WIDE_TABLE_CSS).toContain('width:max-content!important');
    expect(WIDE_TABLE_CSS).toContain('overflow-x:auto!important');
  });
});
