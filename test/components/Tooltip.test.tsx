// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Tooltip } from '../../src/components/Tooltip.js';

const ZERO: DOMRect = {
  top: 0,
  left: 0,
  bottom: 0,
  right: 0,
  width: 0,
  height: 0,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};

/**
 * Give the trigger and the tooltip measurable boxes.
 *
 * jsdom lays nothing out, so every rect is zero unless it is stubbed — which
 * also means these tests can hand the component a geometry a real browser
 * would take a specific window size and font to reproduce (a trigger at the
 * right edge, a viewport too short to fit the tooltip below), and the
 * unmeasurable element that the early return exists for.
 *
 * `null` for either box means "this element cannot be measured".
 */
function stubRects(rects: { trigger?: Partial<DOMRect> | null; bubble?: Partial<DOMRect> | null }) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const rect = this.classList.contains('sec-tooltip') ? rects.bubble : rects.trigger;
    if (rect === null) return undefined as unknown as DOMRect;
    return { ...ZERO, ...rect };
  });
}

function sizeViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
}

/** Hover the trigger and let the open delay elapse. */
function hover(trigger: HTMLElement, ms = 50) {
  fireEvent.mouseEnter(trigger);
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function triggerOf(container: HTMLElement) {
  return container.querySelector('.sec-tooltip-host') as HTMLElement;
}

function bubblePosition() {
  const bubble = screen.getByRole('tooltip') as HTMLElement;
  return { top: bubble.style.top, left: bubble.style.left };
}

beforeEach(() => {
  vi.useFakeTimers();
  sizeViewport(1000, 800);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Tooltip', () => {
  // Regression: THE reason this component exists instead of a `title`
  // attribute. The native tooltip's delay is ~500ms and no page can change it,
  // which is long enough that people never find out an icon button has a name.
  it('opens after its short delay and not before', () => {
    const { container } = render(<Tooltip content="Download">icon</Tooltip>);
    const trigger = triggerOf(container);

    fireEvent.mouseEnter(trigger);
    act(() => {
      vi.advanceTimersByTime(30);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(screen.getByRole('tooltip').textContent).toBe('Download');
  });

  it('honours a caller’s own delay', () => {
    const { container } = render(
      <Tooltip content="Download" delayMs={500}>
        icon
      </Tooltip>,
    );
    hover(triggerOf(container), 100);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByRole('tooltip')).not.toBeNull();
  });

  it('closes when the pointer leaves', () => {
    const { container } = render(<Tooltip content="Download">icon</Tooltip>);
    const trigger = triggerOf(container);
    hover(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeNull();

    act(() => {
      fireEvent.mouseLeave(trigger);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  // Regression: an icon button whose name is only reachable by hovering a mouse
  // is unreachable by keyboard and by touch — which is most of the ways people
  // actually use a mail client.
  it('opens on focus and closes on blur', () => {
    const { container } = render(<Tooltip content="Download">icon</Tooltip>);
    const trigger = triggerOf(container);

    // React binds `onFocus`/`onBlur` to the bubbling `focusin`/`focusout`
    // events, not to the non-bubbling `focus`/`blur` pair.
    fireEvent.focusIn(trigger);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByRole('tooltip')).not.toBeNull();

    act(() => {
      fireEvent.focusOut(trigger);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  // Regression: `AttachmentChip` and the bubble header pass content that can be
  // absent. An empty tooltip must render nothing at all rather than an empty
  // floating box under the cursor.
  it('renders nothing when there is no content', () => {
    const { container } = render(<Tooltip>icon</Tooltip>);
    hover(triggerOf(container));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('centres itself under the trigger', () => {
    stubRects({
      trigger: { left: 100, width: 20, top: 30, bottom: 50 },
      bubble: { width: 100, height: 20 },
    });
    const { container } = render(<Tooltip content="Download">icon</Tooltip>);
    hover(triggerOf(container));
    // 100 + (20 - 100) / 2 = 60, and 6px under the trigger's bottom edge.
    expect(bubblePosition()).toEqual({ top: '56px', left: '60px' });
  });

  // Regression: the tooltip is positioned `fixed`, so nothing clips it back
  // into view — an icon button in the last column would put its tooltip half
  // off the window, and the half that is cut off is the end of the sentence.
  it('clamps itself inside the right edge', () => {
    stubRects({
      trigger: { left: 980, width: 20, top: 30, bottom: 50 },
      bubble: { width: 100, height: 20 },
    });
    const { container } = render(<Tooltip content="Download">icon</Tooltip>);
    hover(triggerOf(container));
    // 1000 - 100 - 8 = 892.
    expect(bubblePosition().left).toBe('892px');
  });

  it('clamps itself inside the left edge', () => {
    stubRects({
      trigger: { left: 0, width: 20, top: 30, bottom: 50 },
      bubble: { width: 100, height: 20 },
    });
    const { container } = render(<Tooltip content="Download">icon</Tooltip>);
    hover(triggerOf(container));
    expect(bubblePosition().left).toBe('8px');
  });

  // Regression: a bubble near the bottom of a scrolling thread has no room
  // below it, and a tooltip hanging past the viewport cannot be read at all —
  // the list scrolls, the tooltip does not.
  it('flips above the trigger when there is no room below', () => {
    sizeViewport(1000, 60);
    stubRects({
      trigger: { left: 100, width: 20, top: 30, bottom: 50 },
      bubble: { width: 100, height: 20 },
    });
    const { container } = render(<Tooltip content="Download">icon</Tooltip>);
    hover(triggerOf(container));
    // 30 - 20 - 6 = 4, and the horizontal centring is untouched by the flip.
    expect(bubblePosition()).toEqual({ top: '4px', left: '60px' });
  });

  // Regression: the first paint deliberately parks the tooltip off-screen so
  // the reader never sees it jump from a guess to the measured spot. If a box
  // cannot be measured it must STAY parked, not land at `NaN` — which resolves
  // to the top-left corner of the window, nowhere near the trigger.
  it('stays off-screen when the trigger cannot be measured', () => {
    stubRects({ trigger: null, bubble: { width: 100, height: 20 } });
    const { container } = render(<Tooltip content="Download">icon</Tooltip>);
    hover(triggerOf(container));
    expect(bubblePosition()).toEqual({ top: '-9999px', left: '-9999px' });
  });

  it('stays off-screen when the tooltip itself cannot be measured', () => {
    stubRects({ trigger: { left: 100, width: 20, top: 30, bottom: 50 }, bubble: null });
    const { container } = render(<Tooltip content="Download">icon</Tooltip>);
    hover(triggerOf(container));
    expect(bubblePosition()).toEqual({ top: '-9999px', left: '-9999px' });
  });

  // Regression: a message re-rendering under the cursor, or the reader
  // switching threads mid-hover, unmounts the trigger while the timer is still
  // pending. Left running, it opens a tooltip anchored to an element that is no
  // longer in the document.
  it('cancels a pending open when the trigger unmounts', () => {
    const { container, unmount } = render(<Tooltip content="Download">icon</Tooltip>);
    fireEvent.mouseEnter(triggerOf(container));
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('has nothing to cancel when the pointer leaves without hovering', () => {
    const { container } = render(<Tooltip content="Download">icon</Tooltip>);
    act(() => {
      fireEvent.mouseLeave(triggerOf(container));
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  // Regression: the recipients summary is a paragraph, not a label. On one line
  // it would run the width of the window; the header's short names, in
  // contrast, must not wrap into two lines for a two-word tooltip.
  it('wraps only when given a maximum width', () => {
    const { container, unmount } = render(<Tooltip content="Download">icon</Tooltip>);
    hover(triggerOf(container));
    const oneLine = screen.getByRole('tooltip') as HTMLElement;
    expect(oneLine.style.whiteSpace).toBe('nowrap');
    expect(oneLine.style.maxWidth).toBe('');
    unmount();

    const wide = render(
      <Tooltip content="Download" maxWidth={420}>
        icon
      </Tooltip>,
    );
    hover(triggerOf(wide.container));
    const wrapped = screen.getByRole('tooltip') as HTMLElement;
    expect(wrapped.style.whiteSpace).toBe('normal');
    expect(wrapped.style.maxWidth).toBe('420px');
  });

  it('keeps the caller’s class alongside its own', () => {
    const plain = render(<Tooltip content="x">icon</Tooltip>);
    expect(triggerOf(plain.container).className).toBe('sec-tooltip-host');
    plain.unmount();

    const classed = render(
      <Tooltip content="x" className="sec-head__who">
        icon
      </Tooltip>,
    );
    expect(triggerOf(classed.container).className).toBe('sec-tooltip-host sec-head__who');
  });
});
