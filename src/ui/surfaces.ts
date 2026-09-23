/**
 * What a designed mail assumes it is printed on, reconciled with the page it is
 * actually printed on.
 *
 * Mail is written for a white page. In a chat bubble it is printed on the
 * SENDER's colour instead, and two things then go wrong — both of them white
 * sitting on that colour, but for opposite reasons:
 *
 *   - Word and Outlook stamp `background:white` onto ordinary paragraphs and
 *     wrappers. That is not design, it is an artifact of the editor's own page,
 *     and left alone it lands as a white slab over part of the sender's colour
 *     while the rest of the message shows it. So it is dropped.
 *   - a ruled data table IS design: it is drawn as a sheet of paper with lines
 *     on it, and a table whose rows have gone the colour of the page around it
 *     stops reading as a table. So its sheet is restored.
 *
 * Both decisions need the COMPUTED background or border, which no selector can
 * test — `[style*="background"]` finds the candidates but cannot tell white
 * from teal. They are therefore made here, from the host's measurement pass,
 * and recorded as a class the frame's stylesheet acts on.
 */

/** Marks a wrapper whose white is the editor's, not the sender's. */
export const PAPER_CLASS = 'sec-paper';

/**
 * Marks a table that reads as a ruled grid, whose ROWS keep a sheet to sit on.
 *
 * The paper goes under the GRID, and the grid is the rows — not the `<table>`
 * box around them and not the cells inside them.
 *
 * Not the box, because a table box is a rectangle and the grid inside it need
 * not fill one: a `display:block` table is stretched to its container while its
 * columns are not, so paper under the box shows through beside the grid as
 * white with no rule around it.
 *
 * Not the cells either, and that is the subtler half. A cell that declares
 * nothing is transparent, so the row's paper already shows through it — while
 * painting the cell instead would put an opaque white square over two things
 * the sender chose: a `bgcolor` on the cell, which is a presentational hint and
 * loses to any author rule, and the colour of the ROW behind a cell that
 * declares nothing. Leaving the cells alone keeps both with one declaration.
 *
 * A row paints only BEHIND ITS CELLS, though, so this can do nothing about a
 * slot with no cell in it — which is why `completeRuledGrid` puts a cell there
 * before the sheet is asked to cover it.
 */
export const TABLE_SHEET_CLASS = 'sec-table-sheet';

/**
 * Records that an element has been looked at — one marker per decision, since
 * a table is asked both questions and the answers are independent.
 *
 * Neither decision depends on the width the mail is laid out at, so unlike the
 * wide-table fit they are made ONCE. That also keeps the repeat passes the
 * host's resize observer triggers down to an attribute check, instead of a
 * style recalculation per candidate on every reflow.
 */
const DECIDED_PAPER = 'data-sec-paper';
const DECIDED_SHEET = 'data-sec-sheet';

/** The only elements worth asking about: the ones that declare a background. */
const DECLARES_BACKGROUND = '[bgcolor],[style*="background"]';

/** A cell's declared colour is softened against the page, never dropped. */
const CELLS = new Set(['TD', 'TH']);

/**
 * How near to white still counts as the editor's white.
 *
 * Tight on purpose. `#fefefe` is the same artifact as `#ffffff`; `#f5f5f5` is
 * somebody's choice of a light grey panel, and dropping that would be editing
 * the sender's design rather than undoing their editor's.
 */
const WHITE_FLOOR = 250;

/** Cells sampled before deciding whether a table is ruled. */
const SAMPLE = 12;

/** How many of them must be ruled for the table to be a grid. */
const RULED_SHARE = 2 / 3;

/** Marks a cell added to square off a grid, rather than one the sender wrote. */
const FILLER = 'data-sec-filler';

/** Marks a cell widened to the columns its row left empty. */
const STRETCHED = 'data-sec-stretched';

/** A single row of coloured cells is a banner, not a table with rows. */
const MIN_ROWS = 2;

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

function computed(element: Element): CSSStyleDeclaration | null {
  // Null for a document that was parsed but never given a window — nothing has
  // been laid out, so there is no measurement to decide on and the element is
  // left exactly as the sender wrote it.
  const view = element.ownerDocument.defaultView;
  return view ? view.getComputedStyle(element) : null;
}

/** Whether some ancestor is itself a table. */
function isNested(table: Element): boolean {
  for (let parent = table.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === 'TABLE') return true;
  }
  return false;
}

/** A computed colour, split into the two things anything here asks about. */
interface Color {
  channels: number[];
  opacity: number;
}

function parseColor(color: string | null | undefined): Color | null {
  const inside = /^rgba?\(([^)]*)\)$/i.exec((color ?? '').trim())?.[1];
  if (!inside) return null;
  // Both the legacy `rgb(1, 2, 3)` and the modern `rgb(1 2 3 / 50%)` spellings;
  // which one `getComputedStyle` returns is the engine's business, not ours.
  const parts = inside.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channels = parts.slice(0, 3).map((part) => Number.parseFloat(part));
  const alpha = parts[3] ?? '1';
  // `50%` is half, not fifty — a percentage that happens to parse as a number
  // is exactly how a translucent white gets mistaken for an opaque one.
  const opacity = Number.parseFloat(alpha) / (alpha.endsWith('%') ? 100 : 1);
  if (!channels.every(Number.isFinite) || !Number.isFinite(opacity)) return null;
  return { channels, opacity };
}

/** Opaque, and indistinguishable from the page a mail editor assumes. */
export function isEditorWhite(color: string | null | undefined): boolean {
  const parsed = parseColor(color);
  if (!parsed) return false;
  // Translucent white is already letting the page through; leave it be.
  return parsed.opacity >= 0.99 && parsed.channels.every((channel) => channel >= WHITE_FLOOR);
}

/**
 * Whether the sender put a colour on this cell.
 *
 * Colour only, never `background-image`: the host washes EVERY cell with a
 * `linear-gradient` to tint it, so an image test would report the whole table
 * as painted and hand every short row the banner treatment.
 */
function isPainted(cell: Element): boolean {
  // Checked as an attribute, not through the cascade: `bgcolor` is how Word
  // spells a banner, and it is a presentational hint — an engine that does not
  // implement hints resolves it to transparent and the band reads as a data row.
  if (cell.hasAttribute('bgcolor')) return true;
  // A document with no window resolves to nothing here, which `parseColor`
  // reads as no colour — the same answer, and the case cannot arise anyway:
  // a table only reaches this pass by having been measured as ruled.
  const parsed = parseColor(computed(cell)?.backgroundColor);
  return parsed !== null && parsed.opacity > 0;
}

function dropEditorPaper(doc: Document): void {
  for (const element of Array.from(doc.querySelectorAll(DECLARES_BACKGROUND))) {
    if (element.hasAttribute(DECIDED_PAPER)) continue;
    element.setAttribute(DECIDED_PAPER, '');
    if (CELLS.has(element.tagName)) continue;

    const style = computed(element);
    if (!style) continue;
    // An image behind the colour makes the colour part of a picture, and the
    // picture is the sender's.
    const image = style.backgroundImage;
    if (image && image !== 'none') continue;
    if (!isEditorWhite(style.backgroundColor)) continue;

    element.classList.add(PAPER_CLASS);
  }
}

function isRuled(cell: Element): boolean {
  const style = computed(cell);
  if (!style) return false;
  return SIDES.some((side) => {
    const lineStyle = style.getPropertyValue(`border-${side}-style`);
    if (!lineStyle || lineStyle === 'none' || lineStyle === 'hidden') return false;
    const width = Number.parseFloat(style.getPropertyValue(`border-${side}-width`));
    return Number.isFinite(width) && width > 0;
  });
}

/**
 * Give a ruled grid the cells its own geometry says it has.
 *
 * A `<tr>` with three `<td>`s in a four-column table leaves a slot with no cell
 * in it, and a slot with no cell is not a gap the sender drew — it is the shape
 * HTML gives a row that simply stopped early, which Word emits all the time.
 * The renderer draws nothing there: no rule around it, and no row background
 * either, because CSS paints a row's background BEHIND its cells and leaves an
 * absent one to the table underneath. So the corner of a ruled table reads as a
 * bite taken out of it.
 *
 * Filling that slot from the stylesheet is not possible — there is no box to
 * style — so the DOM is repaired, and the geometry is read the way the sender
 * declared it: a `colspan` covers that many columns, and a `rowspan` reaches
 * DOWN into the rows below, which is what tells a row that is genuinely short
 * apart from one already covered from above. Getting that second part wrong
 * would push a cell into a slot the row above owns and skew the whole table.
 *
 * There are two different things a short row can mean, and guessing one for
 * both is what looks odd:
 *
 *   a COLOURED BAND — the title strip across the top of a table, the pair of
 *     group headings under it — is a row the sender painted and then stopped,
 *     because in their editor it already reached the far edge. The repair is to
 *     WIDEN the last cell over the empty columns, which is the `colspan` they
 *     would have written. Padding it instead leaves their colour ending in
 *     mid-table with blank cells after it.
 *
 *   a DATA ROW that ran out of values is short by accident, and the repair is
 *     the missing cells, so the grid closes with rules where rules belong.
 *
 * The colour is the signal, and it is the sender's own: a band is painted, and
 * a row of ordinary cells declares nothing. Widening is also restricted to a
 * deficit that runs to the END of the row and to a cell that does not itself
 * span downwards — anything else means the free slots are not the ones the last
 * cell would grow into, and a wrong `colspan` skews far worse than a notch.
 *
 * Only for tables already judged ruled grids. Rebuilding a layout shell — which
 * is what designed mail is built from — would be rearranging the sender's page.
 */
function completeRuledGrid(table: HTMLTableElement): void {
  const rows = Array.from(table.rows);
  const taken = new Set<string>();
  const slot = (row: number, column: number): string => `${row}:${column}`;
  /** Each row paired with the column its own cells stopped at. */
  const fits: Array<{ row: HTMLTableRowElement; end: number }> = [];
  let columns = 0;

  rows.forEach((row, index) => {
    let column = 0;
    for (const cell of Array.from(row.cells)) {
      // Step over what a rowspan from an earlier row already owns here.
      while (taken.has(slot(index, column))) column += 1;
      // `rowspan="0"` means "to the end of the row group"; every other value
      // arrives already clamped by the parser.
      const down = cell.rowSpan === 0 ? rows.length - index : cell.rowSpan;
      const last = Math.min(rows.length, index + down);
      for (let r = index; r < last; r += 1) {
        for (let c = column; c < column + cell.colSpan; c += 1) taken.add(slot(r, c));
      }
      column += cell.colSpan;
    }
    fits.push({ row, end: column });
    if (column > columns) columns = column;
  });

  fits.forEach(({ row, end }, index) => {
    let empty = 0;
    for (let c = 0; c < columns; c += 1) {
      if (!taken.has(slot(index, c))) empty += 1;
    }
    if (empty === 0) return;

    const cells = Array.from(row.cells);
    const last = cells[cells.length - 1];
    // Every empty slot sits after this row's own cells — which is the only
    // shape the last cell can grow into. Short of that, a rowspan from above
    // holds part of the tail and widening would collide with it.
    const runsToTheEnd = empty === columns - end;

    if (last && runsToTheEnd && last.rowSpan === 1 && cells.every(isPainted)) {
      last.colSpan += empty;
      last.setAttribute(STRETCHED, '');
      return;
    }

    // Appended, wherever the hole is: a cell with no coordinates of its own
    // lands in the first free slot of its row, which is the hole.
    for (let i = 0; i < empty; i += 1) {
      const filler = row.ownerDocument.createElement('td');
      filler.setAttribute(FILLER, '');
      row.appendChild(filler);
    }
  });
}

function markRuledTables(doc: Document): void {
  for (const table of Array.from(doc.querySelectorAll('table'))) {
    // A nested table is a cell's contents, and it sits on whatever sheet the
    // table around it was already given.
    if (isNested(table)) continue;
    if (table.hasAttribute(DECIDED_SHEET)) continue;
    table.setAttribute(DECIDED_SHEET, '');

    if (table.querySelectorAll('tr').length < MIN_ROWS) continue;

    const cells = Array.from(table.querySelectorAll('td,th')).slice(0, SAMPLE);
    if (cells.length === 0) continue;
    if (cells.filter(isRuled).length / cells.length < RULED_SHARE) continue;

    // Repaired first, and the class added after: the repair asks each cell what
    // colour the SENDER gave it, and every rule this module brings has to be
    // out of the picture when it does.
    completeRuledGrid(table as HTMLTableElement);
    table.classList.add(TABLE_SHEET_CLASS);
  }
}

/**
 * Decide both, over a whole document. Safe to call on every measurement.
 */
export function fitDocumentSurfaces(doc: Document | null | undefined): void {
  if (!doc?.body) return;
  // Independent, now that the sheet is painted on the rows: a ruled table that
  // declared white ON ITSELF is declaring the editor's page like any other
  // wrapper, and blanking that box is what stops it showing beside the grid.
  // Its rows keep their paper either way.
  //
  // Marking first also matters: marking is what squares the grid off, and a
  // filler cell added afterwards would never be looked at by the paper pass.
  markRuledTables(doc);
  dropEditorPaper(doc);
}

/**
 * The styling half, which needs the host's own surface colour baked in — the
 * frame is a separate document and cannot read the app's custom properties.
 *
 * `!important` on the paper rule for the same reason the cell wash carries it:
 * what it overrides is an inline `style="background:white"` on the sender's own
 * element, which a normal author declaration cannot outrank. The sheet must NOT
 * carry it — it is a page put UNDER the sender's design, and anything of theirs
 * has to win over it.
 *
 * Which is also why the row rule excludes a row that declared a background of
 * its own. `!important` is not the only way to lose that argument: `bgcolor` is
 * a presentational hint, and presentational hints lose to EVERY author rule,
 * `!important` or not. A plain `.sheet tr{...}` would quietly repaint every
 * `<tr bgcolor="#eee">` in the message. The `:not()` pair is the guard, and it
 * only has to detect that a declaration EXISTS — unlike the paper decision,
 * which needs the resolved colour and so cannot be done in a selector at all.
 */
export function documentSurfaceCss(sheet: string): string {
  return [
    `.${PAPER_CLASS}{background-color:transparent!important;}`,
    `.${TABLE_SHEET_CLASS} tr:not([bgcolor]):not([style*="background"])` +
      `{background-color:${sheet};}`,
  ].join('');
}
