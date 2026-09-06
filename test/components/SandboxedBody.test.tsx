// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SandboxedBody } from '../../src/components/SandboxedBody.js';
import { DEFAULT_LABELS } from '../../src/ui/labels.js';
import { settleFrameLoad } from '../helpers/frames.js';
import { FakeResizeObserver, installResizeObserver } from '../helpers/observers.js';

interface FakeFrameDoc {
  body: { scrollHeight: number; getBoundingClientRect: () => { top: number } } | null;
  documentElement: { scrollHeight: number };
  createRange: () => unknown;
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener: ReturnType<typeof vi.fn>;
  clickListeners: ((event: unknown) => void)[];
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
  const clickListeners: ((event: unknown) => void)[] = [];
  return {
    body:
      body === 'missing'
        ? null
        : { scrollHeight: height, getBoundingClientRect: () => ({ top: 0 }) },
    documentElement: { scrollHeight: height },
    createRange: () => ({
      selectNodeContents: () => undefined,
      getBoundingClientRect: () => ({ bottom: height }),
    }),
    addEventListener: (type, listener) => {
      if (type === 'click') clickListeners.push(listener);
    },
    removeEventListener: vi.fn(),
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
  });
});
