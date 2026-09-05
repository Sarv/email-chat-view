/**
 * A hover tooltip.
 *
 * There is one here rather than a `title` attribute for one measurable reason:
 * the native tooltip has a fixed delay of roughly half a second that no page
 * can change, which is long enough that people never discover it. And there is
 * one here rather than a tooltip dependency because the whole component is
 * forty lines, and its only real job — stay inside the viewport — is one
 * clamp.
 *
 * Positioned `fixed` against the trigger's measured rect, so it is not clipped
 * by an ancestor's `overflow: hidden`, which in a scrolling message list is
 * every ancestor.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/** Gap between the trigger and the tooltip, and from the viewport edge. */
const OFFSET = 6;
const VIEWPORT_PADDING = 8;

export interface TooltipProps {
  /** The trigger. */
  children: ReactNode;
  /** The tooltip's content. Nothing renders when this is empty. */
  content?: ReactNode;
  /** Hover delay in ms. Short on purpose — the point is to feel instant. */
  delayMs?: number;
  /** Wrap beyond this width (px) instead of staying on one line. */
  maxWidth?: number;
  /** Class for the inline-block wrapper around the trigger. */
  className?: string;
}

export function Tooltip({ children, content, delayMs = 40, maxWidth, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // A tooltip whose trigger unmounts mid-delay (a message re-rendering under
  // the cursor, a thread switching) would otherwise open over nothing.
  useEffect(() => cancel, [cancel]);

  const show = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => setOpen(true), delayMs);
  }, [cancel, delayMs]);

  const hide = useCallback(() => {
    cancel();
    setOpen(false);
    setPosition(null);
  }, [cancel]);

  // Measured after the tooltip has rendered, because clamping it into the
  // viewport needs its real width — which depends on the content and the
  // reader's font size, neither of which can be known in advance.
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current?.getBoundingClientRect();
    const bubble = bubbleRef.current?.getBoundingClientRect();
    if (!trigger || !bubble) return;

    let top = trigger.bottom + OFFSET;
    let left = trigger.left + (trigger.width - bubble.width) / 2;

    const maxLeft = window.innerWidth - bubble.width - VIEWPORT_PADDING;
    if (left > maxLeft) left = maxLeft;
    if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;
    // Flip above the trigger when there is no room below, rather than letting
    // it hang off the bottom of a scrolled list where it cannot be read.
    if (top + bubble.height > window.innerHeight - VIEWPORT_PADDING) {
      top = trigger.top - bubble.height - OFFSET;
    }

    setPosition({ top, left });
  }, [open]);

  return (
    <span
      ref={triggerRef}
      className={className ? `sec-tooltip-host ${className}` : 'sec-tooltip-host'}
      onMouseEnter={show}
      onMouseLeave={hide}
      // Keyboard and touch reach the same content: focus opens it, blur closes.
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && content ? (
        <span
          ref={bubbleRef}
          role="tooltip"
          className="sec-tooltip"
          style={{
            // Rendered off-screen for the first paint so the measurement above
            // happens on the real box without the reader seeing it jump.
            top: position ? position.top : -9999,
            left: position ? position.left : -9999,
            maxWidth: maxWidth ? `${maxWidth}px` : undefined,
            whiteSpace: maxWidth ? 'normal' : 'nowrap',
          }}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
