/**
 * Placeholder bubbles for a thread whose messages have not arrived yet.
 *
 * Ghost bubbles rather than a spinner, because they say something a spinner
 * cannot: that what is coming is a conversation, roughly this long, laid out
 * this way. The reader's eye settles before the content lands instead of after.
 */

/** Widths chosen to look like real turns rather than a loading bar. */
const GHOST_WIDTHS = ['62%', '78%', '46%'];

export interface ChatSkeletonProps {
  /** How many ghost bubbles. Default three. */
  rows?: number;
}

export function ChatSkeleton({ rows = GHOST_WIDTHS.length }: ChatSkeletonProps) {
  return (
    <div className="sec-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_unused, index) => (
        <div
          key={index}
          className={`sec-ghost${index % 2 === 1 ? ' sec-ghost--mine' : ''}`}
          style={{ width: GHOST_WIDTHS[index % GHOST_WIDTHS.length] }}
        />
      ))}
    </div>
  );
}
