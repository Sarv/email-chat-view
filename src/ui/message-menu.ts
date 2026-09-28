/**
 * What a right-click on a message tells the host.
 *
 * The view draws no context menu of its own, for the same reason it draws no
 * reply button: which items belong in it (reply, forward, copy link, "open in
 * browser") and how it is drawn — a native Electron menu, a React popover — are
 * the host's decisions. What the view owns is the one part a host cannot do for
 * itself: a message body in a sandboxed frame is a SEPARATE document, so a
 * right-click inside it never reaches the host's DOM at all, and its
 * coordinates are in the frame's viewport rather than the page's. Everything
 * here exists to hand the host one request shape for both kinds of body, in
 * one coordinate space.
 *
 * Pure functions over already-captured DOM objects, so the decisions — which
 * link was under the pointer, whether a selection belongs to this message,
 * where the frame's viewport starts — are testable without a browser.
 */

import { clickedHref } from './frame.js';

/** A right-click on a message, as the host needs it to open a menu. */
export interface MessageMenuRequest {
  /**
   * Where the pointer was, in the HOST page's viewport coordinates — for a
   * click inside a framed body too, which has been translated out of the
   * frame's own viewport. Position a menu with these directly.
   */
  clientX: number;
  clientY: number;
  /**
   * The link under the pointer (`http:`, `https:` or `mailto:`), or `null`.
   * The same test a left-click uses, so a menu never offers "Copy link" for a
   * link that a click would refuse to open.
   */
  href: string | null;
  /**
   * The reader's selected text, trimmed — but only when the WHOLE selection
   * lies inside this message; otherwise `''`. A selection left over in another
   * bubble is not what the reader right-clicked on, and offering "Copy" for it
   * here would copy words from a different message.
   */
  selectionText: string;
}

/** A point, in some viewport. */
export interface ViewportPoint {
  left: number;
  top: number;
}

/** The host page's own viewport has no offset from itself. */
const PAGE_ORIGIN: ViewportPoint = { left: 0, top: 0 };

/**
 * Everything the reader types into. `contenteditable="false"` is an island
 * inside an editor, not an editor, so it is left to `closest` to find the
 * editor around it.
 */
const EDITABLE = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

/**
 * Whether a right-click landed in something the reader types into — an inline
 * reply box in the host's footer, say.
 *
 * A text field's own menu (paste, spelling suggestions, undo) is what the
 * reader right-clicked it for, and a message menu opening in its place takes
 * all of that away. Typed as loosely as `clickedHref`'s target, for the same
 * reason: a node from another document is not an `instanceof Element` here.
 */
export function isEditableTarget(target: unknown): boolean {
  const element = target as { closest?: (selector: string) => Element | null } | null;
  return Boolean(element?.closest?.(EDITABLE));
}

/**
 * The selected text, if every range of the selection lies inside `scope`.
 *
 * Checked on each range's common ancestor rather than on its two ends' text,
 * so a selection that starts in this message and runs into the next one is
 * reported as not this message's: its common ancestor is the thread.
 */
export function selectionTextWithin(selection: Selection | null | undefined, scope: Node): string {
  if (!selection?.rangeCount) return '';
  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (!scope.contains(selection.getRangeAt(index).commonAncestorContainer)) return '';
  }
  return selection.toString().trim();
}

/**
 * Where a frame's own viewport begins, in the viewport of the page holding it.
 *
 * A `contextmenu` inside the frame reports `clientX`/`clientY` from the
 * frame's top-left corner. Its border sits between the element's box and that
 * corner, which is what `clientLeft`/`clientTop` measure — so leaving them out
 * puts a menu off by the border width on a host that styles one.
 */
export function frameViewportOrigin(frame: Element): ViewportPoint {
  const rect = frame.getBoundingClientRect();
  return { left: rect.left + frame.clientLeft, top: rect.top + frame.clientTop };
}

/**
 * The request for one right-click.
 *
 * `origin` is where the event's own viewport starts in the host page — the
 * page itself for an inline body, {@link frameViewportOrigin} for a framed one.
 */
export function messageMenuRequest(
  event: Pick<MouseEvent, 'target' | 'clientX' | 'clientY'>,
  selection: Selection | null | undefined,
  scope: Node,
  origin: ViewportPoint = PAGE_ORIGIN,
): MessageMenuRequest {
  return {
    clientX: origin.left + event.clientX,
    clientY: origin.top + event.clientY,
    href: clickedHref(event.target),
    selectionText: selectionTextWithin(selection, scope),
  };
}
