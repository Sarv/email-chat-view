/**
 * jsdom's own `srcdoc` load, flushed deliberately.
 *
 * Anything that renders a rich body gets an iframe, and jsdom queues a real
 * `load` for it on a later task. Measured outside React's batching that load
 * produces nothing but act(...) warnings — so every test that renders a frame
 * flushes it here, while the frame still holds jsdom's own empty document,
 * which measures zero and therefore changes no state.
 */
import { act } from '@testing-library/react';
import { vi } from 'vitest';

export async function settleFrameLoad(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * The frame's own document, once jsdom has loaded it, holding `markup`.
 *
 * jsdom does not render `srcdoc`, but it does give the frame a real document
 * with a real window — and a real `Selection` — which is what a right-click
 * inside a body needs to be tested against. Filled by hand after the load, so
 * it is the document the component has already attached its listeners to.
 */
export async function loadedFrameDocument(
  frame: HTMLIFrameElement,
  markup: string,
): Promise<Document> {
  await settleFrameLoad();
  const doc = frame.contentDocument as Document;
  doc.body.innerHTML = markup;
  return doc;
}

/**
 * Put the frame on the host page: its box at (`left`, `top`) with a
 * `border`-pixel border, which is where its own viewport starts inside.
 * jsdom lays nothing out, so without this every frame is at (0, 0).
 */
export function placeFrame(frame: HTMLIFrameElement, left: number, top: number, border = 0) {
  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({ left, top } as DOMRect);
  Object.defineProperty(frame, 'clientLeft', { value: border, configurable: true });
  Object.defineProperty(frame, 'clientTop', { value: border, configurable: true });
}

/**
 * A right-click on `target`, at a point in ITS document's viewport.
 *
 * Built from the target's own window: an event from the host realm is a
 * foreign object to a frame's document. Returned so a test can read
 * `defaultPrevented` — whether the browser's own menu would still open.
 */
export function rightClick(target: Element, clientX: number, clientY: number): MouseEvent {
  const view = target.ownerDocument.defaultView as Window & typeof globalThis;
  const event = new view.MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  });
  target.dispatchEvent(event);
  return event;
}
