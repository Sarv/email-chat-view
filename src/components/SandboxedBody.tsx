/**
 * A rich message body, rendered inside a sandboxed iframe.
 *
 * The frame is not a stylistic choice. A designed email carries its own CSS,
 * frequently with `!important` and element selectors like `td` or `a`, and
 * injected into the host application's DOM that CSS does not stay in the
 * bubble — it restyles the app. The frame is a separate document, so it cannot.
 *
 * What the frame is allowed to do is described in `ui/frame.ts`; what the
 * component does is the wiring the policy needs:
 *
 *   - it is sized to its content, because a scrollbar inside a chat bubble is
 *     unusable — you cannot scroll a message without the list scrolling too;
 *   - it stays invisible until the first real measurement lands, so the reader
 *     never sees the estimated height snap to the true one;
 *   - clicks on links are intercepted and handed to the host, because a mail
 *     client opens them in the browser, not in the message.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildFrameDocument,
  clickedHref,
  estimateFrameHeight,
  measureFrameHeight,
  readFrameTheme,
  type FrameTheme,
} from '../ui/frame.js';
import type { ViewLabels } from '../ui/labels.js';
import { sanitizeFrameHtml } from '../ui/sanitize.js';
import { ImageOffIcon } from './icons.js';

export interface SandboxedBodyProps {
  /** The message body, unsanitized — this component sanitizes it. */
  html: string;
  labels: ViewLabels;
  /** Withhold network images until the reader asks. Default true. */
  blockRemoteImages?: boolean;
  /** Whether this body has any, i.e. whether to offer the banner at all. */
  hasRemoteImages?: boolean;
  /** Where a clicked link goes. Without it, links are inert rather than unsafe. */
  onOpenLink?: (url: string) => void;
}

export function SandboxedBody({
  html,
  labels,
  blockRemoteImages = true,
  hasRemoteImages = false,
  onOpenLink,
}: SandboxedBodyProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const [theme, setTheme] = useState<FrameTheme | null>(null);
  const [height, setHeight] = useState(() => estimateFrameHeight(html));
  const [measured, setMeasured] = useState(false);
  const [imagesAllowed, setImagesAllowed] = useState(false);

  const blocked = blockRemoteImages && !imagesAllowed;
  const sanitized = useMemo(() => sanitizeFrameHtml(html), [html]);

  // The frame inherits nothing from the page, so the host's tokens have to be
  // read out of the cascade and copied in. Done once, before the frame is
  // rendered at all: building the document with fallback colours first and the
  // real ones a tick later would load the frame twice per message.
  useEffect(() => {
    setTheme(readFrameTheme(hostRef.current));
  }, []);

  const srcDoc = useMemo(
    () =>
      theme
        ? buildFrameDocument({ html: sanitized, theme, blockRemoteImages: blocked })
        : null,
    [sanitized, theme, blocked],
  );

  const handleFrameClick = useCallback(
    (event: Event) => {
      const href = clickedHref(event.target);
      if (!href) return;
      // Prevented whether or not there is a handler: without one, the default
      // action would navigate the frame itself, replacing the message with the
      // link's target inside the bubble.
      event.preventDefault();
      onOpenLink?.(href);
    },
    [onOpenLink],
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !srcDoc) return;

    let observer: ResizeObserver | null = null;
    let watched: Document | null = null;

    const measure = () => {
      const next = measureFrameHeight(frame.contentDocument);
      if (next <= 0) return;
      setHeight(next);
      setMeasured(true);
    };

    const attach = () => {
      measure();
      const doc = frame.contentDocument;
      if (!doc) return;
      watched = doc;
      doc.addEventListener('click', handleFrameClick);
      // Images finishing, a web font swapping, the reader resizing the window:
      // all of them reflow the content after the first measurement. Without an
      // observer the frame keeps the old height and clips.
      if (doc.body && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(measure);
        observer.observe(doc.body);
      }
    };

    frame.addEventListener('load', attach);
    return () => {
      frame.removeEventListener('load', attach);
      observer?.disconnect();
      watched?.removeEventListener('click', handleFrameClick);
    };
  }, [srcDoc, handleFrameClick]);

  return (
    <div className="sec-frame-host" ref={hostRef}>
      {blocked && hasRemoteImages ? (
        <div className="sec-note sec-note--images">
          <ImageOffIcon />
          <span className="sec-note__text">{labels.remoteImagesBlocked}</span>
          <button type="button" className="sec-link-btn" onClick={() => setImagesAllowed(true)}>
            {labels.loadImages}
          </button>
        </div>
      ) : null}
      {srcDoc ? (
        <iframe
          ref={frameRef}
          className="sec-frame"
          title={labels.bodyFrameTitle}
          srcDoc={srcDoc}
          // See ui/frame.ts: no `allow-scripts`, which is what makes
          // `allow-same-origin` safe. Change one and you have changed both.
          sandbox="allow-same-origin allow-popups"
          scrolling="no"
          // Off-screen bubbles in a long thread cost nothing until they are
          // scrolled near: without this, opening a 50-message thread lays out
          // 50 documents before the first paint.
          loading="lazy"
          style={{ height: `${height}px`, opacity: measured ? 1 : 0 }}
        />
      ) : null}
    </div>
  );
}
