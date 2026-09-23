// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  documentSurfaceCss,
  fitDocumentSurfaces,
  isEditorWhite,
  PAPER_CLASS,
  TABLE_SHEET_CLASS,
} from '../../src/ui/surfaces.js';

// jsdom has no layout engine, but it DOES resolve inline `style` through
// `getComputedStyle` — and the computed background and border are the only
// things this module asks the browser for. So the decisions exercised here are
// the real ones, made on the real inline styles Word and Outlook emit.

const RULED = 'border:1pt solid windowtext';

const fit = (html: string): Document => {
  document.body.innerHTML = html;
  fitDocumentSurfaces(document);
  return document;
};

const papered = (selector: string): boolean =>
  document.querySelector(selector)?.classList.contains(PAPER_CLASS) ?? false;

const sheeted = (selector: string): boolean =>
  document.querySelector(selector)?.classList.contains(TABLE_SHEET_CLASS) ?? false;

/** A table of `cells` cells over two rows, `ruledCount` of them ruled. */
const grid = (cells: number, ruledCount: number, attributes = ''): string => {
  const row = (from: number, count: number) =>
    `<tr>${Array.from(
      { length: count },
      (_unused, index) => `<td style="${from + index < ruledCount ? RULED : ''}">c</td>`,
    ).join('')}</tr>`;
  const half = Math.ceil(cells / 2);
  return `<table ${attributes}>${row(0, half)}${row(half, cells - half)}</table>`;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('isEditorWhite', () => {
  // Regression: THE decision. Word stamps `background:white` on ordinary
  // paragraphs, and left alone that white lands as an opaque slab over the
  // sender's colour — but a colour the sender actually chose must survive, so
  // this cannot be "anything light".
  it('accepts the editor white and refuses a chosen colour', () => {
    expect(isEditorWhite('rgb(255, 255, 255)')).toBe(true);
    expect(isEditorWhite('rgb(254, 254, 254)')).toBe(true);
    expect(isEditorWhite('  rgba(255, 255, 255, 1)  ')).toBe(true);
    expect(isEditorWhite('rgb(21, 61, 100)')).toBe(false);
  });

  // Regression: `#f5f5f5` is somebody's light grey PANEL, not the editor's
  // page. Widening the floor to catch it would edit the sender's design.
  it('refuses a light grey that is a deliberate panel', () => {
    expect(isEditorWhite('rgb(245, 245, 245)')).toBe(false);
  });

  // Regression: translucent white is already letting the page through, so
  // there is no slab to remove and blanking it changes what the sender drew.
  it('refuses a translucent white', () => {
    expect(isEditorWhite('rgba(255, 255, 255, 0.5)')).toBe(false);
  });

  // Regression: in the modern `rgb(255 255 255 / 50%)` spelling the alpha is a
  // PERCENTAGE. Reading `50%` as the number 50 would call a half-transparent
  // white opaque and delete a background that was never a slab.
  it('reads a percentage alpha as a fraction', () => {
    expect(isEditorWhite('rgb(255 255 255 / 50%)')).toBe(false);
    expect(isEditorWhite('rgb(255 255 255 / 100%)')).toBe(true);
  });

  // Regression: the answer decides whether an element's background is DELETED,
  // so anything unparseable has to mean no. `transparent` computes to
  // `rgba(0, 0, 0, 0)`, and a keyword or a hex reaches here from engines that
  // do not normalise.
  it('refuses anything it cannot read as an opaque colour', () => {
    expect(isEditorWhite(null)).toBe(false);
    expect(isEditorWhite(undefined)).toBe(false);
    expect(isEditorWhite('')).toBe(false);
    expect(isEditorWhite('white')).toBe(false);
    expect(isEditorWhite('#ffffff')).toBe(false);
    expect(isEditorWhite('rgb(255, 255)')).toBe(false);
    expect(isEditorWhite('rgb(a, b, c)')).toBe(false);
    expect(isEditorWhite('rgba(255, 255, 255, zz)')).toBe(false);
    expect(isEditorWhite('rgba(0, 0, 0, 0)')).toBe(false);
  });
});

describe("dropping the editor's paper", () => {
  // Regression: THE white-slab bug. A bubble carries the sender's colour and
  // the mail is printed on it; Outlook's `<p style="background:white">` and
  // `<div class="elementToProof">` then paint an opaque white block over PART
  // of that colour, so one message reads as two different backgrounds.
  it('marks a white paragraph and a white wrapper', () => {
    fit('<div style="background-color: rgb(255,255,255)"><p style="background:white">hi</p></div>');
    expect(papered('div')).toBe(true);
    expect(papered('p')).toBe(true);
  });

  // Regression: the sender's own colour is the whole point of leaving the
  // frame transparent. Blanking a background they chose would be editing their
  // design, not undoing their editor's default.
  it('leaves a colour the sender chose alone', () => {
    fit('<p style="background:rgb(21,61,100)">hi</p><p>plain</p>');
    expect(papered('p')).toBe(false);
    expect(document.querySelectorAll(`.${PAPER_CLASS}`)).toHaveLength(0);
  });

  // Regression: a cell's white is handled by the frame's wash rule, which
  // composites rather than deletes. Blanking it here as well would strip a
  // header row the sender deliberately made white-on-colour.
  it('leaves table cells to the wash', () => {
    fit('<table><tr><td style="background:white">c</td></tr></table>');
    expect(papered('td')).toBe(false);
  });

  // Regression: a colour behind an image is part of a PICTURE — a logo band or
  // a gradient header — and deleting it punches a hole in the sender's artwork.
  it('leaves a background that sits under an image', () => {
    fit(
      '<p style="background-color:white;background-image:url(logo.png)">hi</p>' +
        '<div style="background-color:white;background-image:none">d</div>',
    );
    expect(papered('p')).toBe(false);
    expect(papered('div')).toBe(true);
  });

  // Regression: the host re-measures on every resize and on every mutation the
  // observer sees. Re-deciding each candidate's computed style on each of those
  // passes is a style recalculation per element per reflow, and the answer
  // cannot change — so a second pass must be an attribute check and nothing more.
  it('decides each element once', () => {
    fit('<p style="background:white">hi</p>');
    const paragraph = document.querySelector('p')!;
    paragraph.classList.remove(PAPER_CLASS);
    fitDocumentSurfaces(document);
    expect(papered('p')).toBe(false);
  });
});

describe("restoring a ruled table's sheet", () => {
  // Regression: a data table IS drawn as paper with lines on it. Once the page
  // under it carries the sender's colour, a grid whose rows have gone that
  // colour too stops reading as a table at all — which is what the paper rule
  // above would otherwise cause.
  it('gives a ruled grid a sheet to sit on', () => {
    fit(grid(6, 6));
    expect(sheeted('table')).toBe(true);
  });

  // Regression: designed mail is BUILT out of unruled table shells used purely
  // for layout. Painting a sheet behind all of them would put a white slab
  // back over the sender's colour — the very bug the paper rule removes.
  it('leaves an unruled layout shell alone', () => {
    fit(grid(6, 0));
    expect(sheeted('table')).toBe(false);
  });

  // Regression: the majority is what makes this a signal rather than a
  // coincidence — a layout shell with one bordered cell is still a shell.
  it('needs a strong majority of the cells to be ruled', () => {
    fit(grid(6, 3));
    expect(sheeted('table')).toBe(false);
    fit(grid(6, 4));
    expect(sheeted('table')).toBe(true);
  });

  // Regression: `border-style` alone is not a line. Outlook writes
  // `border:none` and `border:0` on shell cells constantly, and counting those
  // as rules would make every shell a grid.
  it('does not count a border with no style or no width', () => {
    fit(
      '<table><tr><td style="border-style:none">a</td><td style="border-style:hidden">b</td></tr>' +
        '<tr><td style="border-style:solid;border-width:0">c</td><td style="border-style:solid">d</td></tr></table>',
    );
    expect(sheeted('table')).toBe(false);
  });

  // Regression: a single ruled row is a banner or a header strip, not a table
  // with rows to read — giving it paper makes a stray white bar.
  it('needs more than one row', () => {
    fit(`<table><tr><td style="${RULED}">c</td></tr></table>`);
    expect(sheeted('table')).toBe(false);
  });

  // Regression: an empty shell (a spacer, or a table whose cells the sanitizer
  // removed) has nothing to divide by.
  it('ignores a table with no cells', () => {
    fit('<table><tr></tr><tr></tr></table>');
    expect(sheeted('table')).toBe(false);
  });

  // Regression: a nested table is a CELL's contents and already sits on
  // whatever sheet the table around it was given. A second sheet inside the
  // first draws a visible box around part of a row.
  it('leaves a table nested inside another alone', () => {
    fit(`<table><tr><td>${grid(6, 6)}</td></tr><tr><td>x</td></tr></table>`);
    const tables = document.querySelectorAll('table');
    expect(tables[0]!.classList.contains(TABLE_SHEET_CLASS)).toBe(true);
    expect(tables[1]!.classList.contains(TABLE_SHEET_CLASS)).toBe(false);
  });

  // CHANGED BEHAVIOUR: the sheet used to be the table BOX's background, so
  // papering a ruled table would have blanked it and this asserted the table
  // kept its white. The sheet is now painted on the cells, which makes the
  // box's own white the same editor artifact as any other wrapper's — and
  // blanking it is what stops it showing beside a grid narrower than the box
  // (a last row one cell short, a `display:block` table stretched wide).
  it('blanks the box of a ruled table that declared white, and keeps the cells', () => {
    fit(grid(6, 6, 'style="background:white"'));
    expect(sheeted('table')).toBe(true);
    expect(papered('table')).toBe(true);
  });

  // ...but an UNRULED shell that declared white is exactly the slab, and stays
  // one — the sheet decision is what protects a table, not being a table.
  it('still drops the white of an unruled shell', () => {
    fit(grid(6, 0, 'style="background:white"'));
    expect(papered('table')).toBe(true);
  });

  // Same reason as the paper pass: the answer cannot change between
  // measurements, so the repeat passes must not re-read every cell's border.
  it('decides each table once', () => {
    fit(grid(6, 6));
    const table = document.querySelector('table')!;
    table.classList.remove(TABLE_SHEET_CLASS);
    fitDocumentSurfaces(document);
    expect(sheeted('table')).toBe(false);
  });
});

/** A ruled row whose cells are written out verbatim, minus the border. */
const row = (...cells: string[]): string =>
  `<tr>${cells.map((attributes) => `<td style="${RULED}" ${attributes}>c</td>`).join('')}</tr>`;

/** How many cells each row of the first table ended up with. */
const widths = (): number[] =>
  Array.from(document.querySelectorAll('table tr'), (tr) => tr.querySelectorAll('td,th').length);

/** How many cells were added rather than written by the sender. */
const fillers = (): number => document.querySelectorAll('[data-sec-filler]').length;

/** A ruled row of cells the sender PAINTED — the shape of a heading band. */
const band = (...cells: string[]): string =>
  `<tr>${cells
    .map((attributes) => `<td style="${RULED};background-color:#cfe2f3" ${attributes}>c</td>`)
    .join('')}</tr>`;

/** The colspan each cell of the first table ended up covering, row by row. */
const spans = (): number[][] =>
  Array.from(document.querySelectorAll('table tr'), (tr) =>
    Array.from(tr.querySelectorAll('td,th'), (cell) => (cell as HTMLTableCellElement).colSpan),
  );

describe('squaring off a ruled grid', () => {
  // Regression: THE notch. Word emits a last row that simply stops early, and a
  // slot with no cell in it has no box to paint — CSS paints a row's background
  // behind its cells and leaves an absent one to the table underneath — so the
  // corner of the grid read as a bite taken out of it, in the bubble's tint.
  it('gives a short row the cell its grid says it has', () => {
    fit(`<table>${row('', '', '', '')}${row('', '', '')}</table>`);
    expect(widths()).toEqual([4, 4]);
    expect(fillers()).toBe(1);
  });

  // Regression: a `colspan` IS the sender saying this row is not short. Counting
  // cells instead of columns would have stuffed three fillers onto the end of a
  // banner row that already reaches across the table.
  it('counts a colspan as the columns it covers', () => {
    fit(`<table>${row('', '', '', '')}${row('colspan="4"')}</table>`);
    expect(widths()).toEqual([4, 1]);
    expect(fillers()).toBe(0);
  });

  // Regression: a `rowspan` reaches DOWN, so the row below is short by a slot it
  // does not own. Padding it would push its real cells one column right and skew
  // every row under the span.
  it('leaves room for a rowspan reaching down from above', () => {
    fit(`<table>${row('rowspan="2"', '', '')}${row('', '')}</table>`);
    expect(widths()).toEqual([3, 2]);
    expect(fillers()).toBe(0);
  });

  // `rowspan="0"` means "to the end of the row group", and a span longer than
  // the table is clamped to it — either read as 1 would put a filler under the
  // span, which is the skew above.
  it('reads an open-ended and an over-long rowspan as reaching the last row', () => {
    fit(`<table>${row('rowspan="0"', '')}${row('')}</table>`);
    expect(widths()).toEqual([2, 1]);

    document.body.innerHTML = '';
    fit(`<table>${row('rowspan="9"', '')}${row('')}</table>`);
    expect(widths()).toEqual([2, 1]);
    expect(fillers()).toBe(0);
  });

  // A grid that is already a rectangle must come out untouched: an extra cell
  // would widen the table by a whole empty column.
  it('adds nothing to a grid that is already square', () => {
    fit(`<table>${row('', '')}${row('', '')}</table>`);
    expect(widths()).toEqual([2, 2]);
    expect(fillers()).toBe(0);
  });

  // Regression: designed mail is BUILT from short layout rows. Squaring those
  // off would be rearranging the sender's page, so only a table already judged
  // a ruled grid is padded.
  it('leaves an unruled layout shell ragged', () => {
    fit('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>');
    expect(sheeted('table')).toBe(false);
    expect(widths()).toEqual([2, 1]);
  });

  // Measurement runs on every resize and image load. A second pass that added a
  // second filler would grow the table a column at a time.
  it('adds the same cell only once', () => {
    const html = `<table>${row('', '', '')}${row('', '')}</table>`;
    fit(html);
    fitDocumentSurfaces(document);
    expect(widths()).toEqual([3, 3]);
    expect(fillers()).toBe(1);
  });
});

describe('reading a short row the way the sender meant it', () => {
  // Regression: THE odd-looking table. A title strip is one painted cell that
  // the sender stopped after, because in their editor it already reached the
  // far edge. Padding it left their colour ending in mid-table with blank
  // white cells after it — the band has to be widened instead.
  it('widens a title band over the columns it left empty', () => {
    fit(`${'<table>'}${band('')}${row('', '', '', '')}${row('', '', '', '')}</table>`);
    expect(spans()[0]).toEqual([4]);
    expect(fillers()).toBe(0);
  });

  // The same decision one step in: two painted headings over four columns means
  // the second one covers the three the sender never wrote.
  it('gives the last of a pair of headings the columns after it', () => {
    fit(`${'<table>'}${band('', '')}${row('', '', '', '')}${row('', '', '', '')}</table>`);
    expect(spans()[0]).toEqual([1, 3]);
    expect(fillers()).toBe(0);
  });

  // Regression: `bgcolor` is how Word spells a band and it is a presentational
  // hint, which an engine may resolve to transparent. Reading only the cascade
  // would make every Word banner read as a data row and get padded.
  it('reads a bgcolor band as painted', () => {
    fit(
      `${'<table>'}<tr><td style="${RULED}" bgcolor="#cfe2f3">c</td></tr>` +
        `${row('', '')}${row('', '')}</table>`,
    );
    expect(spans()[0]).toEqual([2]);
  });

  // The other half of the decision: a data row that ran out of values declares
  // no colour, and widening its last cell would stretch one person's name
  // across the columns their colleagues belong in.
  it('pads a row that declared no colour', () => {
    fit(`<table>${row('', '', '')}${row('', '')}</table>`);
    expect(spans()[1]).toEqual([1, 1, 1]);
    expect(fillers()).toBe(1);
  });

  // A band is painted all the way across. One coloured cell next to a plain one
  // is a data row with a highlight in it, not a heading.
  it('pads a row only some of whose cells are painted', () => {
    fit(
      `${'<table>'}<tr><td style="${RULED};background-color:#cfe2f3">c</td>` +
        `<td style="${RULED}">c</td></tr>${row('', '', '')}${row('', '', '')}</table>`,
    );
    expect(spans()[0]).toEqual([1, 1, 1]);
    expect(fillers()).toBe(1);
  });

  // Widening a cell that also reaches DOWN would drive it into slots the rows
  // below have already filled, skewing every one of them.
  it('pads rather than widen a band cell that spans downwards', () => {
    fit(`${'<table>'}${band('rowspan="2"')}${row('')}${row('', '')}</table>`);
    expect(spans()[0]).toEqual([1, 1]);
    expect(fillers()).toBe(1);
  });

  // The empty slots have to be the ones the last cell would grow into. Here a
  // rowspan from above holds the tail of the row, so the gap is in the middle
  // and widening would collide with it.
  it('pads a band whose empty slots are not at the end', () => {
    fit(
      `${'<table>'}<tr><td style="${RULED}">a</td><td style="${RULED}" rowspan="2">b</td>` +
        `<td style="${RULED}">c</td></tr>${band('')}${row('', '', '')}</table>`,
    );
    expect(spans()[1]).toEqual([1, 1]);
    expect(fillers()).toBe(1);
  });

  // A row with no cells at all has nothing to widen; it still has to close, or
  // the grid keeps the notch this whole pass exists to remove.
  it('fills a row that has no cells at all', () => {
    fit(`<table>${row('', '')}<tr></tr>${row('', '')}</table>`);
    expect(widths()).toEqual([2, 2, 2]);
    expect(fillers()).toBe(2);
  });
});

describe('fitDocumentSurfaces', () => {
  // Regression: the host calls this from a measurement pass that also runs
  // before the frame has a document, and on a frame the reader navigated away
  // from. Throwing there would abort the measurement and leave the bubble at
  // its estimated height forever.
  it('does nothing without a document body', () => {
    expect(() => fitDocumentSurfaces(null)).not.toThrow();
    expect(() => fitDocumentSurfaces(undefined)).not.toThrow();
    expect(() =>
      fitDocumentSurfaces(document.implementation.createDocument(null, 'root')),
    ).not.toThrow();
  });

  // Regression: both decisions are measurements, and a document with no window
  // has never been laid out — there is nothing to measure. Guessing from the
  // markup instead would delete backgrounds on evidence we do not have.
  it('decides nothing in a document that was never given a window', () => {
    const detached = document.implementation.createHTMLDocument('m');
    detached.body.innerHTML = `<p style="background:white">hi</p>${grid(6, 6)}`;
    fitDocumentSurfaces(detached);
    expect(detached.querySelectorAll(`.${PAPER_CLASS},.${TABLE_SHEET_CLASS}`)).toHaveLength(0);
  });
});

describe('documentSurfaceCss', () => {
  // Regression: the paper rule overrides an INLINE `style="background:white"`
  // on the sender's own element. Without `!important` it loses the cascade and
  // the slab stays exactly where it was.
  it('overrides the inline white it exists to remove', () => {
    expect(documentSurfaceCss('#ffffff')).toContain(
      `.${PAPER_CLASS}{background-color:transparent!important;}`,
    );
  });

  // Regression: the sheet must NOT be `!important`. It is a page put UNDER the
  // sender's design, so every background of theirs — an inline one on a banner
  // cell most of all — has to keep winning over it.
  it('lets the sender outrank the sheet', () => {
    expect(documentSurfaceCss('var(--sec-surface)')).toContain(
      `.${TABLE_SHEET_CLASS} tr:not([bgcolor]):not([style*="background"])` +
        '{background-color:var(--sec-surface);}',
    );
  });

  // Regression: a rule on the table BOX paints the whole rectangle, including
  // the slot in the last row where a Word table simply has no fourth cell, and
  // the part of a `display:block` table stretched past its own columns — white,
  // with no rule around it. The paper belongs under the grid, and the grid is
  // the rows.
  it('paints the rows, not the box they sit in', () => {
    const css = documentSurfaceCss('#ffffff');
    expect(css).not.toContain(`.${TABLE_SHEET_CLASS}{`);
    expect(css).toContain(`.${TABLE_SHEET_CLASS} tr`);
  });

  // Regression: `bgcolor` is a presentational hint, and presentational hints
  // lose to EVERY author rule — `!important` or not. An unguarded `.sheet tr`
  // would silently repaint every `<tr bgcolor="#eee">` header band in the
  // message the colour of the page.
  it('leaves a row that declared its own background alone', () => {
    const css = documentSurfaceCss('#ffffff');
    expect(css).toContain(':not([bgcolor])');
    expect(css).toContain(':not([style*="background"])');
  });

  // Regression: the cells are deliberately NOT painted. A transparent cell
  // already shows the row's paper through it, while an opaque white square on
  // the cell would cover both a `bgcolor` the sender put on that cell and the
  // colour of the row behind a cell that declared nothing.
  it('leaves the cells transparent so the row shows through', () => {
    const css = documentSurfaceCss('#ffffff');
    expect(css).not.toContain(`.${TABLE_SHEET_CLASS} td`);
    expect(css).not.toContain(`.${TABLE_SHEET_CLASS} th`);
  });
});
