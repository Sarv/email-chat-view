/**
 * One message's content, in whichever of its five states it is in.
 *
 * The three non-content states are as important as the two content ones, and
 * getting them wrong is what makes a mail client feel broken. A body that is
 * still downloading must say so; a body that has permanently failed must offer
 * a retry, because a spinner that never stops is the worst outcome — the reader
 * cannot tell whether to wait; and a message that genuinely carried no words of
 * its own (a bare forward, a reply with only quoted text) must say THAT, rather
 * than render an empty bubble that looks like a bug.
 */
import { useCallback, useMemo } from 'react';
import type { MouseEvent } from 'react';

import type { ChatMessage } from '../types.js';
import type { BodyShape } from '../ui/body-shape.js';
import { clickedHref } from '../ui/frame.js';
import type { ViewLabels } from '../ui/labels.js';
import { sanitizeInlineHtml } from '../ui/sanitize.js';

import { AlertTriangleIcon, SpinnerIcon } from './icons.js';
import { SandboxedBody } from './SandboxedBody.js';

export interface MessageBodyProps {
  message: ChatMessage;
  /** The single body inspection, done once by the bubble. */
  shape: BodyShape;
  labels: ViewLabels;
  blockRemoteImages?: boolean;
  onOpenLink?: (url: string) => void;
  /** Offered on a permanently failed body. Omit and no retry appears. */
  onRetryBody?: (message: ChatMessage) => void;
}

export function MessageBody({
  message,
  shape,
  labels,
  blockRemoteImages,
  onOpenLink,
  onRetryBody,
}: MessageBodyProps) {
  const inlineHtml = useMemo(
    // `shape.html`, never `message.body`: the shape carries the body with its
    // trailing dead space already removed, and a bubble hugs its content, so
    // rendering the original puts a stack of empty wrappers back under the last
    // line. Only the inline path is sanitized here; the frame path sanitizes
    // with its own, much wider policy. Doing both would run two passes over
    // every body.
    () => (shape.kind === 'simple' ? sanitizeInlineHtml(shape.html) : ''),
    [shape.kind, shape.html],
  );

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const href = clickedHref(event.target);
      if (!href) return;
      // A link inside a message must never navigate the application away from
      // itself, handler or no handler.
      event.preventDefault();
      onOpenLink?.(href);
    },
    [onOpenLink],
  );

  if (!message.body && message.bodyPending) {
    return (
      <div className="sec-note" role="status">
        <SpinnerIcon />
        <span className="sec-note__text">{labels.bodyLoading}</span>
      </div>
    );
  }

  if (!message.body && message.bodyFailed) {
    return (
      <div className="sec-note sec-note--danger">
        <AlertTriangleIcon />
        <span className="sec-note__text">{labels.bodyFailed}</span>
        {onRetryBody ? (
          <button type="button" className="sec-link-btn" onClick={() => onRetryBody(message)}>
            {labels.retry}
          </button>
        ) : null}
      </div>
    );
  }

  if (shape.kind === 'rich') {
    return (
      <SandboxedBody
        html={shape.html}
        labels={labels}
        blockRemoteImages={blockRemoteImages}
        hasRemoteImages={shape.hasRemoteImages}
        onOpenLink={onOpenLink}
      />
    );
  }

  // `simple` with nothing left after sanitizing means the sanitizer removed
  // everything — markup that was entirely disallowed, or no DOM to sanitize
  // with at all. Falls through to the same honest note as an empty body rather
  // than rendering the unsanitized original.
  if (shape.kind === 'empty' || !inlineHtml) {
    return <div className="sec-note sec-note--quiet">{labels.noContent}</div>;
  }

  return (
    <div
      className="sec-body"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: inlineHtml }}
    />
  );
}
