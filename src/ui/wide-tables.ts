/**
 * Make a table that is wider than the message READ rather than be cut off.
 *
 * A body is rendered in a clipping frame, so a table wider than the frame is
 * not scrolled but LOST: the reader sees it sliced off at the edge with nothing
 * on screen to say there is more. Two steps fix that, in this order, and both
 * act only on a table MEASURED to overflow — a fact rather than a
 * data-table-vs-layout-shell guess, which is what lets marketing mail built out
 * of table shells through untouched.
 *
 * **Step one is to let it FIT.** Most of these tables do not need to be wide at
 * all. An Excel range pasted through Outlook carries a pixel width on the table
 * and `white-space:nowrap` on every cell (80 of them in the message that
 * prompted this), so it cannot reflow and runs to whatever its longest cell
 * needs — several times the width of the pane, for text that would wrap
 * happily. Relaxing that is enough for the common case, and it is the better
 * outcome: the whole table is visible at once.
 *
 * **Step two, only for a table still too wide once its text can wrap** — a
 * sheet with genuinely many columns — is a horizontal scrollbar on that ONE
 * table. Restructuring it (`display:block`) is what makes it a scroll
 * container, which is why it is reserved for the tables that have earned it:
 * doing it to every table takes apart the layout shells that designed mail is
 * built from.
 *
 * Both steps need `!important` because what they override is inline
 * `style="width:578pt"` on the table and inline `white-space:nowrap` on the
 * cells, which a normal author declaration cannot reach.
 *
 * Shared, because a host that renders bodies in its own reading pane has
 * exactly this problem too. Nothing here assumes the chat frame: it measures
 * the document it is given and toggles two classes, so the only thing a host
 * owes it is `WIDE_TABLE_CSS` in the stylesheet it injects.
 */

/** Marks a table whose cells have been allowed to wrap. */
export const TABLE_REFLOW_CLASS = 'sec-table-reflow';

/** Marks a table that wrapping could not save, and which scrolls on its own. */
export const TABLE_SCROLL_CLASS = 'sec-table-scroll';

/**
 * Records the body width a table's decision was made at.
 *
 * This is what keeps the pass idempotent. `fitWideTables` runs from a
 * measurement callback that an observer re-triggers on the very mutations it
 * makes, so without a record of "already decided, at this width" a table would
 * have its classes toggled forever. Storing the WIDTH rather than a flag means
 * the decision is still revisited when the pane is resized, which is the one
 * time it can legitimately change.
 */
const DECIDED_AT = 'data-sec-fit-at';

/** Whether `table` still sticks out past `available` px. */
function overflows(table: Element, available: number): boolean {
  // `scrollWidth`, not the border box: once a table has been made a scroll
  // container its own box is clamped to the space available and only its
  // content width still tells the truth.
  //
  // +1px of slack: a table sized to exactly the body rounds a fraction either
  // way, and restyling a table that fits is worse than leaving it as authored.
  return table.scrollWidth > available + 1;
}

/** Fit every top-level table in `doc` that is wider than the body. */
export function fitWideTables(doc: Document | null | undefined): void {
  const available = doc?.body?.clientWidth ?? 0;
  // Before first layout — and while the pane is collapsed — every width reads 0
  // and every table would look like it overflows. Do nothing, and let the next
  // measurement decide, rather than restyling the entire message.
  if (!doc || available <= 0) return;

  for (const table of Array.from(doc.querySelectorAll('table'))) {
    // A nested table is laid out inside its parent's cell, so its own width
    // says nothing about what the reader can see — and giving it a scroll
    // region inside the shell's means scrolling one moves the other. The
    // outermost table is the one that has to fit, and reflowing it wraps the
    // inner one with it.
    if (table.parentElement?.closest('table')) continue;
    if (table.getAttribute(DECIDED_AT) === String(available)) continue;
    table.setAttribute(DECIDED_AT, String(available));

    // Measured from the sender's own layout, never from a previous decision.
    table.classList.remove(TABLE_REFLOW_CLASS, TABLE_SCROLL_CLASS);
    if (!overflows(table, available)) continue;

    table.classList.add(TABLE_REFLOW_CLASS);
    // Reading the width back forces layout, so this is the width AFTER the text
    // is allowed to wrap. Deciding on the authored width instead would give
    // every nowrap table a scrollbar it no longer needs, and the reflow would
    // have changed nothing the reader can see.
    if (!overflows(table, available)) continue;

    table.classList.remove(TABLE_REFLOW_CLASS);
    table.classList.add(TABLE_SCROLL_CLASS);
  }
}

/** The rules the two classes switch on, injected into the host's stylesheet. */
export const WIDE_TABLE_CSS = [
  `.${TABLE_REFLOW_CLASS}{width:auto!important;max-width:100%!important;`,
  // `display:table` matters for a host whose stylesheet has already made tables
  // scrollable: left as `block` the table keeps its unwrapped width however
  // freely its cells are allowed to wrap.
  'display:table!important;table-layout:auto!important;}',
  // The cells AND their contents: the nowrap an authoring tool stamps sits on
  // the `<td>`, on the `<div>` it wraps the cell's text in, or on both.
  `.${TABLE_REFLOW_CLASS} td,.${TABLE_REFLOW_CLASS} th,`,
  `.${TABLE_REFLOW_CLASS} td *,.${TABLE_REFLOW_CLASS} th *{`,
  'white-space:normal!important;word-break:break-word;}',
  // `display:block` is what makes the table a scroll container; its rows and
  // cells go on generating anonymous table boxes, so it still lays out as a
  // table. `width:max-content` restores the shrink-to-fit that `display:block`
  // would otherwise cost it.
  `.${TABLE_SCROLL_CLASS}{display:block!important;width:max-content!important;`,
  'max-width:100%!important;overflow-x:auto!important;}',
].join('');
