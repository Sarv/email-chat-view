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
 *     client opens them in the browser, not in the message;
 *   - a right-click is reported to the host too, translated into the page's
 *     own coordinates, because an event inside the frame never reaches the
 *     host's DOM and the host has no other way to see it.
 *
 * The listeners go on the frame's DOCUMENT, and that document is replaced on
 * every load, so they are attached per load — and the effect that owns them
 * depends on the document alone. The host's callbacks are read through refs:
 * an inline arrow function is a new identity every render, and an effect keyed
 * on one tore its listeners down and then waited for a `load` that had already
 * fired, leaving the frame's links and right-click dead until the body changed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildFrameDocument,
  clickedHref,
  estimateFrameHeight,
  isLoadedSrcdoc,
  measureFrameHeight,
  readFrameTheme,
  sameFrameTheme,
  type FrameTheme,
} from '../ui/frame.js';
import type { ViewLabels } from '../ui/labels.js';
import {
  frameViewportOrigin,
  messageMenuRequest,
  type MessageMenuRequest,
} from '../ui/message-menu.js';
import { sanitizeFrameHtml } from '../ui/sanitize.js';
import { fitDocumentSurfaces } from '../ui/surfaces.js';
import { watchHostTheme } from '../ui/theme-watch.js';
import { fitWideTables } from '../ui/wide-tables.js';

import { ImageOffIcon } from './icons.js';
import { useLatest } from './use-latest.js';

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
  /**
   * A right-click inside the frame, with the point already translated into
   * the HOST page's viewport. Return `false` to decline, and the frame's own
   * browser menu opens as usual; anything else suppresses it. Omit it and a
   * right-click is left entirely alone.
   *
   * Only the frame needs this: its document is separate, so the event never
   * reaches an ancestor's `onContextMenu`. `ChatBubble` wires it to
   * `onMessageMenu`.
   */
  onFrameMenu?: (request: MessageMenuRequest) => boolean | void;
}

export function SandboxedBody({
  html,
  labels,
  blockRemoteImages = true,
  hasRemoteImages = false,
  onOpenLink,
  onFrameMenu,
}: SandboxedBodyProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Read by the frame's listeners at event time — see the file header for why
  // the attach effect must not depend on these.
  const openLinkRef = useLatest(onOpenLink);
  const frameMenuRef = useLatest(onFrameMenu);
  // The document the listeners were last attached to, and the `srcDoc` it was
  // the load of — so a new `srcDoc` can tell the outgoing document from its
  // own. See the early attach at the end of the attach effect.
  const attachedRef = useRef<{ doc: Document; srcDoc: string } | null>(null);

  const [theme, setTheme] = useState<FrameTheme | null>(null);
  const [height, setHeight] = useState(() => estimateFrameHeight(html));
  const [measured, setMeasured] = useState(false);
  const [imagesAllowed, setImagesAllowed] = useState(false);

  const blocked = blockRemoteImages && !imagesAllowed;
  const sanitized = useMemo(() => sanitizeFrameHtml(html), [html]);

  // The frame inherits nothing from the page, so the host's tokens have to be
  // read out of the cascade and copied in. Read before the frame is rendered at
  // all: building the document with fallback colours first and the real ones a
  // tick later would load the frame twice per message.
  //
  // And read AGAIN whenever the page's theme may have changed, and whenever the
  // body does (a host that re-colours bodies for its dark mode restyles the
  // bubble around them in the same render). Reading once left a frame on screen
  // in the theme it was opened in. An unchanged read keeps the old object, so
  // the frame only reloads when a colour really moved.
  const refreshTheme = useCallback(() => {
    const next = readFrameTheme(hostRef.current);
    setTheme((current) => (current && sameFrameTheme(current, next) ? current : next));
  }, []);

  useEffect(() => {
    refreshTheme();
  }, [refreshTheme, html]);

  useEffect(() => watchHostTheme(hostRef.current, refreshTheme), [refreshTheme]);

  const srcDoc = useMemo(
    () =>
      theme ? buildFrameDocument({ html: sanitized, theme, blockRemoteImages: blocked }) : null,
    [sanitized, theme, blocked],
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !srcDoc) return;
    const source = srcDoc;

    let observer: ResizeObserver | null = null;
    let watched: Document | null = null;

    const measure = () => {
      // Before the height is taken, not after: letting a too-wide table wrap
      // makes it taller, so measuring first would size the frame to the
      // unwrapped layout and clip the rows the reflow added.
      fitWideTables(frame.contentDocument);
      // Also before the height: dropping the editor's white paper collapses the
      // margins it was holding open, which changes the height too.
      fitDocumentSurfaces(frame.contentDocument);
      const next = measureFrameHeight(frame.contentDocument);
      if (next <= 0) return;
      setHeight(next);
      setMeasured(true);
    };

    const handleClick = (event: Event) => {
      const href = clickedHref(event.target);
      if (!href) return;
      // Prevented whether or not there is a handler: without one, the default
      // action would navigate the frame itself, replacing the message with the
      // link's target inside the bubble.
      event.preventDefault();
      openLinkRef.current?.(href);
    };

    const handleContextMenu = (event: MouseEvent) => {
      const report = frameMenuRef.current;
      // No handler, no opinion: the browser's own menu is left alone.
      if (!report) return;
      const doc = event.currentTarget as Document;
      const request = messageMenuRequest(
        event,
        // The frame's OWN selection. A selection in the host page belongs to
        // some other message, and this document cannot see it anyway.
        doc.getSelection(),
        doc,
        frameViewportOrigin(frame),
      );
      // `false` is the host declining — a web host with no menu of its own
      // for links, say — and then the browser's menu must still open.
      if (report(request) === false) return;
      event.preventDefault();
    };

    const detach = () => {
      observer?.disconnect();
      observer = null;
      watched?.removeEventListener('click', handleClick);
      watched?.removeEventListener('contextmenu', handleContextMenu);
      watched = null;
    };

    const attach = () => {
      // Every load is a NEW document, and the old one's listeners and observer
      // would otherwise stay attached to a page nobody can see.
      detach();
      measure();
      const doc = frame.contentDocument;
      if (!doc) return;
      watched = doc;
      attachedRef.current = { doc, srcDoc: source };
      doc.addEventListener('click', handleClick);
      doc.addEventListener('contextmenu', handleContextMenu);
      // Images finishing, a web font swapping, the reader resizing the window:
      // all of them reflow the content after the first measurement. Without an
      // observer the frame keeps the old height and clips.
      if (doc.body && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(measure);
        observer.observe(doc.body);
      }
    };

    frame.addEventListener('load', attach);
    // The frame may have finished loading before this effect ran — a tiny
    // `srcdoc` can, since passive effects are flushed on a later task — and
    // then there is no `load` left to wait for. Attach now. Only to the
    // message's OWN document, though, and two others are "complete" too:
    //
    //   - the blank one a new frame starts with, which measured reveals the
    //     frame before the message is in it (see `isLoadedSrcdoc`);
    //   - on a NEW `srcDoc` (images allowed, a theme change), the previous
    //     one: the frame usually still holds it when this runs. It is a
    //     loaded srcdoc like any other, so it is told apart by being the
    //     document the last attach was for, under a different `srcDoc`.
    //     Attached to, it would be re-measured and observed until the new
    //     load moved everything over.
    //
    // The same document under the SAME `srcDoc` is attached again: that is
    // React re-creating this effect with nothing changed — a hidden subtree
    // shown again (`<Activity>`) — on a frame that loaded long ago. No load
    // is coming then, and skipping it would leave the frame with no listeners.
    const current = frame.contentDocument;
    const last = attachedRef.current;
    const outgoing = last !== null && last.doc === current && last.srcDoc !== source;
    if (isLoadedSrcdoc(current) && !outgoing) attach();
    return () => {
      frame.removeEventListener('load', attach);
      detach();
    };
  }, [srcDoc, openLinkRef, frameMenuRef]);

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
