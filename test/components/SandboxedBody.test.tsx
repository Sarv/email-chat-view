// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { SandboxedBody } from '../../src/components/SandboxedBody.js';
import { DEFAULT_LABELS } from '../../src/ui/labels.js';
import { loadedFrameDocument, placeFrame, rightClick, settleFrameLoad } from '../helpers/frames.js';
import { FakeResizeObserver, installResizeObserver } from '../helpers/observers.js';

type FakeListener = (event: unknown) => void;

interface FakeFrameDoc {
  readyState: DocumentReadyState;
  URL: string;
  body: { scrollHeight: number; getBoundingClientRect: () => { top: number } } | null;
  documentElement: { scrollHeight: number };
  querySelectorAll: (selector: string) => Element[];
  createRange: () => unknown;
  addEventListener: (type: string, listener: FakeListener) => void;
  removeEventListener: Mock<[type: string, listener: FakeListener], void>;
  /** What is attached right now, by event type. Removal really removes. */
  listeners: Record<string, FakeListener[]>;
  clickListeners: FakeListener[];
}

/**
 * A stand-in for the frame's own document.
 *
 * jsdom does not lay out and does not render `srcdoc`, so a frame here has no
 * height and no content to measure. Handing the component a document it can
 * measure is the only way to test the measure-and-reveal cycle at all — and it
 * also reaches the states a browser will not produce to order: a frame whose
 * document is missing, one with no body, one that measures zero.
 */
function fakeFrameDoc(height = 250, body: 'present' | 'missing' = 'present'): FakeFrameDoc {
  const listeners: Record<string, FakeListener[]> = {};
  const clickListeners: FakeListener[] = [];
  listeners.click = clickListeners;
  return {
    readyState: 'complete',
    URL: 'about:srcdoc',
    body:
      body === 'missing'
        ? null
        : { scrollHeight: height, getBoundingClientRect: () => ({ top: 0 }) },
    documentElement: { scrollHeight: height },
    // The measurement pass also decides which of the message's own surfaces
    // are the editor's white page and which are the sender's design. There is
    // no message here to decide anything about — but a document that cannot be
    // queried at all is not a document, and pretending otherwise would let a
    // real crash in that pass pass this suite.
    querySelectorAll: () => [],
    createRange: () => ({
      selectNodeContents: () => undefined,
      getBoundingClientRect: () => ({ bottom: height }),
    }),
    addEventListener: (type, listener) => {
      (listeners[type] ??= []).push(listener);
    },
    // Really removes, so a test can tell a listener that was taken off from
    // one that is still there — which is the bug a stale-effect teardown is.
    removeEventListener: vi.fn((type: string, listener: FakeListener) => {
      const list = listeners[type] ?? [];
      const at = list.indexOf(listener);
      if (at >= 0) list.splice(at, 1);
    }),
    listeners,
    clickListeners,
  };
}

/** Give the frame a document and fire the load event the browser would. */
async function loadFrame(container: HTMLElement, doc: FakeFrameDoc | null) {
  await settleFrameLoad();
  const frame = container.querySelector('iframe') as HTMLIFrameElement;
  Object.defineProperty(frame, 'contentDocument', { value: doc, configurable: true });
  fireEvent.load(frame);
  return frame;
}

function frameOf(container: HTMLElement) {
  return container.querySelector('iframe') as HTMLIFrameElement;
}

/** A real anchor, detached: `closest('a')` on an anchor returns itself. */
function anchorIn(href: string) {
  const anchor = document.createElement('a');
  anchor.setAttribute('href', href);
  return anchor;
}

afterEach(async () => {
  await settleFrameLoad();
  vi.unstubAllGlobals();
});

describe('SandboxedBody', () => {
  // Regression: the two independent locks on the frame, and they must stay
  // together. `allow-same-origin` is only safe BECAUSE `allow-scripts` is
  // absent — adding scripts back would give a sender's code the host's origin.
  it('renders the frame with both of its locks on', () => {
    const { container } = render(<SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />);
    const frame = frameOf(container);
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin allow-popups');
    expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'");
    // A scrollbar inside a chat bubble is unusable: you cannot scroll the
    // message without scrolling the thread.
    expect(frame.getAttribute('scrolling')).toBe('no');
    // 50 documents laid out before the first paint is what opening a long
    // thread costs without this.
    expect(frame.getAttribute('loading')).toBe('lazy');
    // Announced to a screen reader, which otherwise reads "frame".
    expect(frame.getAttribute('title')).toBe('Message body');
  });

  // Regression: the reader must never see the estimated height snap to the real
  // one. The frame stays invisible until a measurement lands, and is then sized
  // to its content — under-measuring CLIPS the message, because its own
  // scrollbar is off.
  it('stays invisible until it has been measured, then takes its content’s height', async () => {
    const { container } = render(<SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />);
    expect(frameOf(container).style.opacity).toBe('0');

    const frame = await loadFrame(container, fakeFrameDoc(250));
    expect(frame.style.height).toBe('250px');
    expect(frame.style.opacity).toBe('1');
  });

  // Regression: a frame that measures zero (still empty, images not in yet)
  // must keep its estimate. Sizing it to 0 collapses the bubble to nothing and
  // there is no second load event to recover from it.
  it('keeps its estimate when there is nothing to measure yet', async () => {
    const { container } = render(<SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />);
    const before = frameOf(container).style.height;
    const frame = await loadFrame(container, fakeFrameDoc(0));
    expect(frame.style.height).toBe(before);
    expect(frame.style.opacity).toBe('0');
  });

  it('survives a frame with no document at all', async () => {
    const { container } = render(<SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />);
    const frame = await loadFrame(container, null);
    expect(frame.style.opacity).toBe('0');
  });

  // Regression: a link inside the frame, left alone, replaces the MESSAGE with
  // the link's target inside the bubble — the reader loses the mail and has no
  // back button. Prevented with or without a handler.
  it('hands a clicked link to the host and never lets the frame navigate', async () => {
    const onOpenLink = vi.fn();
    const { container } = render(
      <SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} onOpenLink={onOpenLink} />,
    );
    const doc = fakeFrameDoc();
    await loadFrame(container, doc);

    const preventDefault = vi.fn();
    doc.clickListeners[0]?.({ target: anchorIn('https://x.example/a'), preventDefault });
    expect(onOpenLink).toHaveBeenCalledWith('https://x.example/a');
    expect(preventDefault).toHaveBeenCalled();
  });

  it('ignores a click that was not on a link', async () => {
    const onOpenLink = vi.fn();
    const { container } = render(
      <SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} onOpenLink={onOpenLink} />,
    );
    const doc = fakeFrameDoc();
    await loadFrame(container, doc);

    const preventDefault = vi.fn();
    doc.clickListeners[0]?.({ target: document.createElement('p'), preventDefault });
    expect(onOpenLink).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('stops listening to a frame it is done with', async () => {
    const { container, unmount } = render(
      <SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />,
    );
    const doc = fakeFrameDoc();
    await loadFrame(container, doc);
    unmount();
    expect(doc.removeEventListener).toHaveBeenCalledWith('click', expect.any(Function));
  });

  // Regression: images finishing, a web font swapping, the window resizing —
  // all of them reflow the frame AFTER the first measurement. Without the
  // observer the frame keeps the old height and clips the bottom of the mail.
  it('re-measures when the frame’s content reflows', async () => {
    installResizeObserver();
    const { container, unmount } = render(
      <SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />,
    );
    const doc = fakeFrameDoc(250);
    const frame = await loadFrame(container, doc);
    expect(FakeResizeObserver.latest.targets).toEqual([doc.body]);

    // The images arrived and the document grew.
    if (doc.body) doc.body.scrollHeight = 700;
    doc.documentElement.scrollHeight = 700;
    fireEvent.load(frame);
    expect(frame.style.height).toBe('700px');

    unmount();
    expect(FakeResizeObserver.latest.disconnected).toBe(true);
  });

  it('measures once and gets on with it where there is no ResizeObserver', async () => {
    // jsdom implements neither observer, which is the default state here — the
    // same degradation an old embedded webview gets.
    expect(typeof ResizeObserver).toBe('undefined');
    const { container } = render(<SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />);
    expect((await loadFrame(container, fakeFrameDoc(250))).style.height).toBe('250px');
  });

  it('watches nothing when the frame document has no body', async () => {
    installResizeObserver();
    const { container } = render(<SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />);
    await settleFrameLoad();
    // jsdom's own empty frame document HAS a body and gets observed on that
    // first load; what is under test is only what happens for a document that
    // does not have one.
    FakeResizeObserver.instances = [];
    const doc = fakeFrameDoc(250, 'missing');
    await loadFrame(container, doc);
    expect(FakeResizeObserver.instances).toHaveLength(0);
    // The click listener still goes on: a bodyless document is measurable at
    // zero, not unusable.
    expect(doc.clickListeners).toHaveLength(1);
  });

  describe('a right-click inside the frame', () => {
    const LINKED = '<p id="p">Read <a href="https://x.example/a"><b>the plan</b></a></p>';

    afterEach(() => {
      vi.restoreAllMocks();
      window.getSelection()?.removeAllRanges();
    });

    // Regression: the frame is a separate document, so its right-click never
    // reaches the host's DOM — and its point is in the FRAME's viewport. Handed
    // over untranslated, a host menu opens at the page's top-left corner; the
    // border is in the sum because the frame's viewport starts inside it.
    it('reports it in the page’s coordinates, with the link and the frame’s own selection', async () => {
      const onFrameMenu = vi.fn();
      const { container } = render(
        <SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} onFrameMenu={onFrameMenu} />,
      );
      const frame = frameOf(container);
      const doc = await loadedFrameDocument(frame, LINKED);
      placeFrame(frame, 100, 200, 2);
      doc.getSelection()?.selectAllChildren(doc.getElementById('p') as HTMLElement);

      const event = rightClick(doc.querySelector('b') as Element, 10, 20);
      expect(onFrameMenu).toHaveBeenCalledWith({
        clientX: 112,
        clientY: 222,
        href: 'https://x.example/a',
        selectionText: 'Read the plan',
      });
      // The host's menu replaces the frame's; both opening is two menus.
      expect(event.defaultPrevented).toBe(true);
    });

    // Regression: a selection in the host page belongs to some OTHER message.
    // Reported here, "Copy" on this message would copy another one's words.
    it('does not report a selection made outside the frame', async () => {
      const onFrameMenu = vi.fn();
      const { container } = render(
        <SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} onFrameMenu={onFrameMenu} />,
      );
      const doc = await loadedFrameDocument(frameOf(container), LINKED);
      const elsewhere = document.createElement('p');
      elsewhere.textContent = 'another message';
      document.body.append(elsewhere);
      window.getSelection()?.selectAllChildren(elsewhere);

      rightClick(doc.getElementById('p') as Element, 1, 1);
      expect(onFrameMenu).toHaveBeenCalledWith(
        expect.objectContaining({ href: null, selectionText: '' }),
      );
    });

    // Regression: a host with nothing to offer declines, and then the frame's
    // own browser menu must still open — suppressed anyway, the reader gets no
    // menu at all.
    it('leaves the browser’s menu alone when the host declines', async () => {
      const onFrameMenu = vi.fn(() => false);
      const { container } = render(
        <SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} onFrameMenu={onFrameMenu} />,
      );
      const doc = await loadedFrameDocument(frameOf(container), LINKED);
      const event = rightClick(doc.querySelector('b') as Element, 1, 1);
      expect(onFrameMenu).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(false);
    });

    // Regression: a host that never asked for right-clicks must not lose the
    // browser's menu inside every framed message — nor have the listener throw
    // on every right-click calling a callback it was never given. A listener
    // that throws leaves the default alone too, so the default alone cannot
    // tell the two apart: what escaped the listener is checked as well.
    it('changes nothing without a handler', async () => {
      const { container } = render(<SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />);
      const doc = await loadedFrameDocument(frameOf(container), LINKED);
      const escaped = vi.fn();
      const frameWindow = doc.defaultView as Window;
      frameWindow.addEventListener('error', escaped);
      try {
        expect(rightClick(doc.querySelector('b') as Element, 1, 1).defaultPrevented).toBe(false);
      } finally {
        frameWindow.removeEventListener('error', escaped);
      }
      expect(escaped).not.toHaveBeenCalled();
    });

    // Regression: THE stale-listener bug. The attach effect used to depend on
    // the host's callbacks; an inline arrow function is a new identity every
    // render, so the next render tore the listeners off the document and then
    // waited for a `load` that had already fired. Links and right-click went
    // dead inside every frame after the thread's first re-render.
    it('keeps its listeners when the host’s callbacks change identity', async () => {
      const [firstMenu, secondMenu, firstOpen, secondOpen] = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
      const { container, rerender } = render(
        <SandboxedBody
          html="<p>hi</p>"
          labels={DEFAULT_LABELS}
          onFrameMenu={firstMenu}
          onOpenLink={firstOpen}
        />,
      );
      const doc = await loadedFrameDocument(frameOf(container), LINKED);
      const removed = vi.spyOn(doc, 'removeEventListener');

      rerender(
        <SandboxedBody
          html="<p>hi</p>"
          labels={DEFAULT_LABELS}
          onFrameMenu={secondMenu}
          onOpenLink={secondOpen}
        />,
      );
      expect(removed).not.toHaveBeenCalled();

      const link = doc.querySelector('b') as Element;
      rightClick(link, 1, 1);
      link.dispatchEvent(
        new (doc.defaultView as typeof window).MouseEvent('click', { bubbles: true }),
      );
      // The LATEST callbacks, not the ones the listeners were attached with.
      expect(secondMenu).toHaveBeenCalledTimes(1);
      expect(secondOpen).toHaveBeenCalledWith('https://x.example/a');
      expect(firstMenu).not.toHaveBeenCalled();
      expect(firstOpen).not.toHaveBeenCalled();
    });

    // Regression: a listener left on an unmounted frame's document keeps a
    // closure over the host's callbacks alive, and fires them for a message
    // that is no longer on screen.
    it('removes every listener when it unmounts', async () => {
      const onFrameMenu = vi.fn();
      const { container, unmount } = render(
        <SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} onFrameMenu={onFrameMenu} />,
      );
      const frame = frameOf(container);
      const doc = await loadedFrameDocument(frame, LINKED);
      const link = doc.querySelector('b') as Element;
      const fromDoc = vi.spyOn(doc, 'removeEventListener');
      const fromFrame = vi.spyOn(frame, 'removeEventListener');

      unmount();
      expect(fromDoc).toHaveBeenCalledWith('click', expect.any(Function));
      expect(fromDoc).toHaveBeenCalledWith('contextmenu', expect.any(Function));
      expect(fromFrame).toHaveBeenCalledWith('load', expect.any(Function));
      rightClick(link, 1, 1);
      expect(onFrameMenu).not.toHaveBeenCalled();
    });

    // Regression: every load is a NEW document. Attaching per load without
    // detaching left the old document's listeners and its ResizeObserver
    // running on a page nobody can see — one more observer per reload.
    it('moves its listeners and its observer to the new document on each load', async () => {
      installResizeObserver();
      const { container } = render(<SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />);
      const frame = frameOf(container);
      const first = await loadedFrameDocument(frame, LINKED);
      const firstObserver = FakeResizeObserver.latest;
      const removed = vi.spyOn(first, 'removeEventListener');

      const second = fakeFrameDoc(250);
      Object.defineProperty(frame, 'contentDocument', { value: second, configurable: true });
      fireEvent.load(frame);

      expect(removed).toHaveBeenCalledWith('click', expect.any(Function));
      expect(removed).toHaveBeenCalledWith('contextmenu', expect.any(Function));
      expect(firstObserver.disconnected).toBe(true);
      expect(second.listeners.click).toHaveLength(1);
      expect(second.listeners.contextmenu).toHaveLength(1);
      expect(FakeResizeObserver.latest.targets).toEqual([second.body]);
    });
  });

  describe('attaching to a frame that has already loaded', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Every frame reports `doc` as its document from the moment it exists. */
    const frameDocumentIs = (doc: FakeFrameDoc | null) =>
      vi
        .spyOn(HTMLIFrameElement.prototype, 'contentDocument', 'get')
        .mockReturnValue(doc as unknown as Document);

    // jsdom's own `load` for the frame is still queued, and it reads the stub
    // too. Flushed inside act at the end of each test, before any hook runs —
    // left to fire in the gap after the test, it is an unwrapped state update.

    // Regression: the attach race. Passive effects run on a later task, and a
    // small `srcdoc` can finish loading before this one does — after which no
    // `load` is coming, and a frame that only waited for one stayed unmeasured
    // (invisible) with dead links for good.
    it('attaches at once when the document is already complete', async () => {
      const doc = fakeFrameDoc(250);
      frameDocumentIs(doc);
      const { container } = render(<SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />);
      // Synchronously after mount: no load event has been fired yet.
      expect(doc.listeners.click).toHaveLength(1);
      expect(doc.listeners.contextmenu).toHaveLength(1);
      expect(frameOf(container).style.height).toBe('250px');
      expect(frameOf(container).style.opacity).toBe('1');
      await settleFrameLoad();
    });

    // The other half: a document still loading is not the message yet, and
    // is attached when its own load arrives.
    it('waits for the load while the document is still loading', async () => {
      const doc = fakeFrameDoc(250);
      doc.readyState = 'loading';
      frameDocumentIs(doc);
      const { container } = render(<SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />);
      expect(doc.listeners.contextmenu).toBeUndefined();
      expect(frameOf(container).style.opacity).toBe('0');

      fireEvent.load(frameOf(container));
      expect(doc.listeners.contextmenu).toHaveLength(1);
      expect(frameOf(container).style.opacity).toBe('1');
      await settleFrameLoad();
    });

    // Regression: found in Chromium. A new frame starts on `about:blank`,
    // ALSO "complete", whose quirks-mode body measures as tall as the frame.
    // Attaching to it revealed the frame at its estimate before the message
    // was in it — the snap the reveal exists to hide — and a lazy frame
    // off-screen sat on that blank document until scrolled near.
    it('does not attach early to the blank document a new frame starts with', async () => {
      const blank = fakeFrameDoc(40);
      blank.URL = 'about:blank';
      frameDocumentIs(blank);
      const { container } = render(<SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />);
      expect(blank.listeners.contextmenu).toBeUndefined();
      expect(frameOf(container).style.opacity).toBe('0');
      await settleFrameLoad();
    });

    // Regression: a frame with no document yet has nothing to measure or
    // listen on, and must wait for its load rather than be revealed at its
    // estimate.
    it('waits when the frame has no document yet', async () => {
      frameDocumentIs(null);
      const { container } = render(<SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />);
      expect(frameOf(container).style.opacity).toBe('0');
      await settleFrameLoad();
    });

    // Regression: on a NEW body (images allowed, a theme change) the frame
    // still holds the PREVIOUS message's document, complete and a srcdoc like
    // any other, when the effect runs. Attached early, the outgoing page got
    // the listeners and the observer and was re-measured, until the new load
    // moved them over.
    it('does not attach early to the outgoing document when the body changes', async () => {
      const doc = fakeFrameDoc(250);
      frameDocumentIs(doc);
      const { container, rerender } = render(
        <SandboxedBody html="<p>first</p>" labels={DEFAULT_LABELS} />,
      );
      expect(doc.listeners.contextmenu).toHaveLength(1);

      rerender(<SandboxedBody html="<p>second</p>" labels={DEFAULT_LABELS} />);
      expect(doc.listeners.click).toHaveLength(0);
      expect(doc.listeners.contextmenu).toHaveLength(0);

      // The new body's own load is what attaches.
      fireEvent.load(frameOf(container));
      expect(doc.listeners.contextmenu).toHaveLength(1);
      await settleFrameLoad();
    });

    // Regression: the other side of the outgoing-document check. If the new
    // body has ALREADY loaded when the effect runs — the race again, on a
    // body change — its document is a different one, and it is attached at
    // once: no `load` is coming for it.
    it('attaches at once to a new body’s document that has already loaded', async () => {
      const first = fakeFrameDoc(250);
      const spy = frameDocumentIs(first);
      const { rerender } = render(<SandboxedBody html="<p>first</p>" labels={DEFAULT_LABELS} />);

      const second = fakeFrameDoc(300);
      spy.mockReturnValue(second as unknown as Document);
      rerender(<SandboxedBody html="<p>second</p>" labels={DEFAULT_LABELS} />);
      expect(first.listeners.contextmenu).toHaveLength(0);
      expect(second.listeners.click).toHaveLength(1);
      expect(second.listeners.contextmenu).toHaveLength(1);
      await settleFrameLoad();
    });

    // Regression: a document is OUTGOING only under a different body. React
    // re-runs this effect for the SAME body on the SAME loaded document when a
    // hidden subtree is shown again (`<Activity>`), and no load is coming
    // then: a check on the document alone skipped it and left the frame with
    // dead links and no menu. React 18 has no public way to re-show a subtree
    // in a test, so the rule is pinned by the body flipping back to the one
    // the document was attached for.
    it('treats a document as outgoing only under a different body', async () => {
      const doc = fakeFrameDoc(250);
      frameDocumentIs(doc);
      const { rerender } = render(<SandboxedBody html="<p>first</p>" labels={DEFAULT_LABELS} />);
      rerender(<SandboxedBody html="<p>second</p>" labels={DEFAULT_LABELS} />);
      expect(doc.listeners.contextmenu).toHaveLength(0);

      rerender(<SandboxedBody html="<p>first</p>" labels={DEFAULT_LABELS} />);
      expect(doc.listeners.click).toHaveLength(1);
      expect(doc.listeners.contextmenu).toHaveLength(1);
      await settleFrameLoad();
    });

    // Regression: StrictMode mounts every component twice in a host's
    // development build. The frame only exists from the second render (its
    // theme is read first), so the double mount must neither leave a
    // second set of listeners on an already-loaded document nor none at all.
    it('attaches exactly once to a loaded frame under StrictMode', async () => {
      const doc = fakeFrameDoc(250);
      frameDocumentIs(doc);
      const { container } = render(
        <StrictMode>
          <SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />
        </StrictMode>,
      );
      expect(doc.listeners.click).toHaveLength(1);
      expect(doc.listeners.contextmenu).toHaveLength(1);
      expect(frameOf(container).style.opacity).toBe('1');
      await settleFrameLoad();
    });
  });

  // Regression: the frame is where a body is sanitized, so this is where a
  // layout attribute is kept or lost. A Google Sheets range pasted into Gmail
  // lost its `<col width>` here and collapsed to one pixel wide, with every
  // row thousands of pixels tall: a bubble of blank space under "Please find
  // the latest update below".
  it('hands the frame a pasted spreadsheet with its column widths intact', () => {
    const { container } = render(
      <SandboxedBody
        html={
          '<table style="table-layout:fixed;width:0px"><colgroup><col width="64">' +
          '<col width="215"></colgroup><tbody><tr><td colspan="2">Defects</td></tr>' +
          '</tbody></table>'
        }
        labels={DEFAULT_LABELS}
      />,
    );
    const srcdoc = frameOf(container).getAttribute('srcdoc');
    expect(srcdoc).toContain('<col width="64"><col width="215">');
    expect(srcdoc).toContain('<td colspan="2">Defects</td>');
  });

  describe('the host theme', () => {
    /** Make every computed style report these values, whatever the element. */
    const reportStyle = (values: Record<string, string>) => {
      const real = window.getComputedStyle.bind(window);
      return vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
        const style = real(element);
        return {
          ...style,
          getPropertyValue: (name: string) => values[name] ?? style.getPropertyValue(name),
        } as CSSStyleDeclaration;
      });
    };

    /** Switch a class on <html> and let the observer's re-read land. */
    const setRootClass = async (className: string) => {
      await act(async () => {
        document.documentElement.className = className;
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };

    afterEach(async () => {
      // Inside act: the frame is still mounted and hears this change too.
      await setRootClass('');
      vi.restoreAllMocks();
    });

    // Regression: the frame document must declare the scheme its iframe
    // element inherits. A dark host around an undeclared (light) document is
    // painted an opaque white backdrop — the slab beside a table in dark mode.
    it('hands the frame the host’s colour scheme', () => {
      reportStyle({ 'color-scheme': 'dark' });
      const { container } = render(<SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />);
      expect(frameOf(container).getAttribute('srcdoc')).toContain(':root{color-scheme:dark;}');
    });

    // Regression: the theme was read once, on mount, so switching the app's
    // theme left every open frame in the old colours — dark table rows inside
    // a page that had just turned light.
    it('rebuilds the frame when the page switches theme', async () => {
      const style = { '--sec-ink': 'rgb(1, 1, 1)' };
      reportStyle(style);
      const { container } = render(<SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />);
      expect(frameOf(container).getAttribute('srcdoc')).toContain('rgb(1, 1, 1)');
      style['--sec-ink'] = 'rgb(2, 2, 2)';
      await setRootClass('dark');
      expect(frameOf(container).getAttribute('srcdoc')).toContain('rgb(2, 2, 2)');
    });

    // Regression: a host that re-colours bodies for its dark mode restyles the
    // bubble in the same render as the new body, with no page attribute
    // changing — the new body must be framed with the new colours.
    it('re-reads the theme when the body changes', () => {
      const style = { '--sec-ink': 'rgb(1, 1, 1)' };
      reportStyle(style);
      const { container, rerender } = render(
        <SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />,
      );
      style['--sec-ink'] = 'rgb(3, 3, 3)';
      rerender(<SandboxedBody html="<p>hello</p>" labels={DEFAULT_LABELS} />);
      expect(frameOf(container).getAttribute('srcdoc')).toContain('rgb(3, 3, 3)');
    });

    // Regression: most page-attribute changes are not theme changes; one that
    // handed the frame a different document would reload and re-measure every
    // frame in the thread.
    it('leaves the frame alone when nothing in the theme moved', async () => {
      reportStyle({ '--sec-ink': 'rgb(1, 1, 1)' });
      const { container } = render(<SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />);
      const frame = frameOf(container);
      const before = frame.getAttribute('srcdoc');
      await setRootClass('unrelated');
      expect(frameOf(container)).toBe(frame);
      expect(frame.getAttribute('srcdoc')).toBe(before);
    });
  });

  describe('remote images', () => {
    // Regression: the tracking-pixel protection is a CSP policy inside the
    // frame, not a rewriting pass over `src` attributes — so the proof is in
    // the policy, and the banner is only the way the reader lifts it.
    it('withholds them until the reader asks, then lets them through', () => {
      const { container } = render(
        <SandboxedBody
          html='<img src="https://x.example/p.gif">'
          labels={DEFAULT_LABELS}
          hasRemoteImages
        />,
      );
      expect(frameOf(container).getAttribute('srcdoc')).toContain('img-src data: cid:;');

      fireEvent.click(screen.getByRole('button', { name: 'Load images' }));
      expect(frameOf(container).getAttribute('srcdoc')).toContain(
        'img-src data: cid: https: http:',
      );
      // Once lifted, the banner has nothing left to offer.
      expect(screen.queryByRole('button', { name: 'Load images' })).toBeNull();
    });

    it('says nothing when there are no remote images to withhold', () => {
      render(<SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />);
      expect(screen.queryByRole('button', { name: 'Load images' })).toBeNull();
    });

    // Regression: the protection must not be conditional on the banner. A body
    // whose remote images the inspection MISSED still has to be blocked by the
    // policy — the banner's absence means "nothing to tell the reader", never
    // "the frame is open".
    it('still blocks what it did not know about', () => {
      const { container } = render(<SandboxedBody html="<p>hi</p>" labels={DEFAULT_LABELS} />);
      expect(frameOf(container).getAttribute('srcdoc')).toContain('img-src data: cid:;');
    });

    it('leaves them alone when the host does not want them blocked', () => {
      const { container } = render(
        <SandboxedBody
          html='<img src="https://x.example/p.gif">'
          labels={DEFAULT_LABELS}
          hasRemoteImages
          blockRemoteImages={false}
        />,
      );
      expect(screen.queryByRole('button', { name: 'Load images' })).toBeNull();
      expect(frameOf(container).getAttribute('srcdoc')).toContain(
        'img-src data: cid: https: http:',
      );
    });

    describe('telling the host', () => {
      const html = '<img src="https://x.example/p.gif">';

      // Regression: found in Sarv Inbox. The banner told nobody, so a host that
      // remembers senders never heard of the click: this bubble loaded, the
      // sender was not remembered, and their next mail was blocked again.
      it('reports the click once this frame’s own images are let through', () => {
        const onFrameLoadImages = vi.fn();
        const { container } = render(
          <SandboxedBody
            html={html}
            labels={DEFAULT_LABELS}
            hasRemoteImages
            onFrameLoadImages={onFrameLoadImages}
          />,
        );
        expect(onFrameLoadImages).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Load images' }));
        expect(onFrameLoadImages).toHaveBeenCalledTimes(1);
        expect(onFrameLoadImages).toHaveBeenCalledWith();
        expect(frameOf(container).getAttribute('srcdoc')).toContain(
          'img-src data: cid: https: http:',
        );
      });

      // Regression: the reader asked for THESE images. A host whose bookkeeping
      // fails — a storage write that throws — must not cost them that, so the
      // frame is unblocked before the host is called, never after.
      it('lets the images through even when the host’s callback throws', () => {
        // React rethrows a handler's error out of its root listener, and jsdom
        // reports that as an uncaught window error. Caught here, so the suite
        // sees the frame's behaviour rather than an unhandled-error failure.
        const swallow = (event: ErrorEvent) => event.preventDefault();
        window.addEventListener('error', swallow);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
          const { container } = render(
            <SandboxedBody
              html={html}
              labels={DEFAULT_LABELS}
              hasRemoteImages
              onFrameLoadImages={() => {
                throw new Error('allowlist write failed');
              }}
            />,
          );
          fireEvent.click(screen.getByRole('button', { name: 'Load images' }));
          expect(frameOf(container).getAttribute('srcdoc')).toContain(
            'img-src data: cid: https: http:',
          );
        } finally {
          window.removeEventListener('error', swallow);
          consoleError.mockRestore();
        }
      });

      // Regression: hosts pass inline arrow functions, a new identity every
      // render. The callback is read at click time, so a re-render neither
      // rebuilds the frame nor leaves the banner calling the stale function.
      it('calls the latest callback without rebuilding the frame for a new one', () => {
        const [first, second] = [vi.fn(), vi.fn()];
        const { container, rerender } = render(
          <SandboxedBody
            html={html}
            labels={DEFAULT_LABELS}
            hasRemoteImages
            onFrameLoadImages={first}
          />,
        );
        const frame = frameOf(container);
        const before = frame.getAttribute('srcdoc');

        rerender(
          <SandboxedBody
            html={html}
            labels={DEFAULT_LABELS}
            hasRemoteImages
            onFrameLoadImages={second}
          />,
        );
        expect(frameOf(container)).toBe(frame);
        expect(frame.getAttribute('srcdoc')).toBe(before);

        fireEvent.click(screen.getByRole('button', { name: 'Load images' }));
        expect(second).toHaveBeenCalledTimes(1);
        expect(first).not.toHaveBeenCalled();
      });

      // Regression: a host usually answers the click by unblocking the sender,
      // which turns `blockRemoteImages` off for this very bubble a render
      // later. The frame is already unblocked, so that must not load it again.
      it('does not reload when the host answers by unblocking this bubble', () => {
        const { container, rerender } = render(
          <SandboxedBody
            html={html}
            labels={DEFAULT_LABELS}
            hasRemoteImages
            onFrameLoadImages={() => undefined}
          />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Load images' }));
        const frame = frameOf(container);
        const unblocked = frame.getAttribute('srcdoc');

        rerender(
          <SandboxedBody
            html={html}
            labels={DEFAULT_LABELS}
            hasRemoteImages
            blockRemoteImages={false}
            onFrameLoadImages={() => undefined}
          />,
        );
        expect(frameOf(container)).toBe(frame);
        expect(frame.getAttribute('srcdoc')).toBe(unblocked);
      });
    });
  });
});
