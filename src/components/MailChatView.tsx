/**
 * The thread, as a chat.
 *
 * Takes `ChatMessage[]` and nothing else mandatory. It does not know what a
 * mail is, does not fetch anything, and does not care whether the messages came
 * out of this package's transform, an LLM extraction pass, or something the
 * host wrote itself — which is why there is no `mode` prop anywhere in this
 * package.
 *
 * What it does own is everything a long thread needs and a `map` over bubbles
 * does not: day separators, sender runs, identity colours assigned so no two
 * participants clash, scroll anchoring that does not fight the reader, a DOM
 * ceiling, and — the important one — telling the host which messages are on
 * screen, so the bodies being fetched are the ones somebody is looking at.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { HtmlParser } from '../dom.js';
import type { Attachment, ChatMessage } from '../types.js';
import { DEFAULT_SENDER_RUN_MS, groupMessagesByDate, isSameSenderRun } from '../ui/grouping.js';
import { fillTemplate, resolveLabels, type ViewLabels } from '../ui/labels.js';
import { buildSenderColorMap, resolveSenderColor } from '../ui/sender-colors.js';

import { ChatBubble } from './ChatBubble.js';
import { ChatSkeleton } from './ChatSkeleton.js';
import { DateSeparator } from './DateSeparator.js';
import { ChevronUpIcon, SpinnerIcon } from './icons.js';

/** Which messages the reader can currently see. Indices are into `messages`. */
export interface VisibleRange {
  firstIndex: number;
  lastIndex: number;
  /** The ids in that span — usually what a host actually wants. */
  ids: string[];
}

/** Default DOM ceiling. Older bubbles stay one click away. */
const DEFAULT_MAX_RENDERED = 50;

/**
 * Keep the latest value of something in a ref.
 *
 * So an effect can USE a callback without DEPENDING on it. Host callbacks are
 * almost always inline arrow functions, whose identity changes on every render;
 * an effect that listed one in its dependencies would tear down and rebuild its
 * observers on every render, which for an IntersectionObserver means it never
 * settles long enough to report anything.
 *
 * The write is in an effect, not in the render body. A render can be thrown
 * away before it commits, and a ref written by a discarded render would then
 * hold a value the reader never saw. Every consumer here reads `.current` from
 * an observer callback — asynchronous, long after commit — and this hook is
 * called above the effects that use it, so the ref is always current by then.
 */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export interface MailChatViewProps {
  /** The thread, oldest first. */
  messages: readonly ChatMessage[];
  /** The reader's address(es) — excluded from identity colouring. */
  currentUserAddress?: string | readonly string[];
  /** Partial label overrides; see {@link ViewLabels}. */
  labels?: Partial<ViewLabels>;
  /** BCP 47 locale for dates. Defaults to the reader's own. */
  locale?: string | string[];
  /** "Now", for the relative day labels. Injectable so tests are not clock-dependent. */
  now?: number;
  /** HTML parser, for environments with no global `DOMParser`. */
  parser?: HtmlParser;
  /** Sender-run window. `0` gives every message its own header. */
  senderRunWindowMs?: number;
  /** Withhold network images until the reader asks. Default true. */
  blockRemoteImages?: boolean;
  onOpenLink?: (url: string) => void;
  onRetryBody?: (message: ChatMessage) => void;
  onPreviewAttachment?: (attachment: Attachment, message: ChatMessage) => void;
  onDownloadAttachment?: (attachment: Attachment, message: ChatMessage) => void;
  /** Per-bubble controls at the outer edge: menus, star, an AI re-run. */
  renderActions?: (message: ChatMessage) => ReactNode;
  /** Per-bubble content below the body: a reply box, a translation notice. */
  renderFooter?: (message: ChatMessage) => ReactNode;
  /** Is there older history the host could fetch? */
  hasOlder?: boolean;
  /** Fetch it. Called when the top of the thread comes into view. */
  onLoadOlder?: () => void;
  /** True while that fetch is in flight. */
  loadingOlder?: boolean;
  /** Which messages are on screen — use it to prioritise body fetches. */
  onVisibleRangeChange?: (range: VisibleRange) => void;
  /** DOM ceiling; older bubbles are held behind a "show earlier" button. */
  maxRendered?: number;
  /** Follow new messages to the bottom. Default true. */
  autoScroll?: boolean;
  /** Show placeholder bubbles instead of an empty thread. */
  loading?: boolean;
  /** Replaces the built-in "no messages" text. */
  emptyState?: ReactNode;
  className?: string;
}

export function MailChatView({
  messages,
  currentUserAddress,
  labels,
  locale,
  now,
  parser,
  senderRunWindowMs = DEFAULT_SENDER_RUN_MS,
  blockRemoteImages,
  onOpenLink,
  onRetryBody,
  onPreviewAttachment,
  onDownloadAttachment,
  renderActions,
  renderFooter,
  hasOlder = false,
  onLoadOlder,
  loadingOlder = false,
  onVisibleRangeChange,
  maxRendered = DEFAULT_MAX_RENDERED,
  autoScroll = true,
  loading = false,
  emptyState,
  className,
}: MailChatViewProps) {
  // Memoised on the prop, so a host that passes a stable `labels` object (or
  // none) gets one resolved object for the life of the view. Everything keyed
  // off the labels — the date grouping, every bubble — then keeps its identity
  // too. A host that writes `labels={{ ... }}` inline opts out of all of it.
  const resolvedLabels = useMemo(() => resolveLabels(labels), [labels]);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [revealedExtra, setRevealedExtra] = useState(0);
  const ceiling = maxRendered > 0 ? maxRendered + revealedExtra : messages.length;
  const withheld = Math.max(0, messages.length - ceiling);
  const rendered = useMemo(
    () => (withheld > 0 ? messages.slice(withheld) : messages),
    [messages, withheld],
  );

  const colors = useMemo(() => {
    const own =
      currentUserAddress === undefined
        ? []
        : Array.isArray(currentUserAddress)
          ? currentUserAddress
          : [currentUserAddress as string];
    // Built from the WHOLE thread, not the rendered slice, so a participant's
    // colour does not change when older messages are revealed.
    return buildSenderColorMap(
      messages.map((message) => message.fromAddress),
      own,
    );
  }, [messages, currentUserAddress]);

  const groups = useMemo(
    () => groupMessagesByDate(rendered, resolvedLabels, locale, now),
    [rendered, resolvedLabels, locale, now],
  );

  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (!autoScroll) return;
    // Keyed on the LAST id, deliberately not on the count: prepending a page of
    // older history changes the count, and scrolling to the bottom then would
    // throw the reader out of the history they just asked for.
    //
    // Optional call because `scrollIntoView` is not implemented in every DOM
    // (jsdom, some embedded webviews) and an unconditional call would take the
    // whole thread down on mount.
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [autoScroll, lastMessageId]);

  const rangeCallback = useLatest(onVisibleRangeChange);
  const renderedRef = useLatest(rendered);
  const withheldRef = useLatest(withheld);
  const wantsRange = Boolean(onVisibleRangeChange);

  useEffect(() => {
    const container = listRef.current;
    // No IntersectionObserver (an old webview, a jsdom test that did not stub
    // one) simply means the host is never told about visibility. Everything
    // else keeps working, which is the right degradation for a hint.
    if (!container || !wantsRange || typeof IntersectionObserver === 'undefined') return;

    const visible = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.secIndex);
          if (!Number.isInteger(index)) continue;
          if (entry.isIntersecting) visible.add(index);
          else visible.delete(index);
        }
        if (!visible.size) return;
        const sorted = [...visible].sort((left, right) => left - right);
        const firstIndex = sorted[0]!;
        const lastIndex = sorted[sorted.length - 1]!;
        const ids: string[] = [];
        // The whole span, not just the intersecting entries: the host wants to
        // fetch the bodies BETWEEN the first and last visible message too,
        // including any whose own callback has not fired yet.
        for (let index = firstIndex; index <= lastIndex; index += 1) {
          const message = renderedRef.current[index - withheldRef.current];
          if (message) ids.push(message.id);
        }
        rangeCallback.current?.({ firstIndex, lastIndex, ids });
      },
      { root: container },
    );

    container.querySelectorAll('[data-sec-index]').forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [wantsRange, rendered, rangeCallback, renderedRef, withheldRef]);

  const loadOlderCallback = useLatest(onLoadOlder);
  const topRef = useRef<HTMLDivElement>(null);
  // Not while messages are being withheld locally: fetching more history from
  // the network while a "show earlier" button is still hiding what we already
  // have would grow the thread the reader cannot see.
  const canLoadOlder = Boolean(hasOlder && onLoadOlder) && withheld === 0;

  useEffect(() => {
    const sentinel = topRef.current;
    if (!sentinel || !canLoadOlder || loadingOlder || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadOlderCallback.current?.();
      },
      { root: listRef.current },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canLoadOlder, loadingOlder, loadOlderCallback]);

  const rootClasses = ['sec-thread', className].filter(Boolean).join(' ');

  if (loading && !messages.length) {
    return (
      <div className={rootClasses} ref={listRef}>
        <ChatSkeleton />
      </div>
    );
  }

  if (!messages.length) {
    return (
      <div className={rootClasses} ref={listRef}>
        {emptyState ?? <div className="sec-empty">{resolvedLabels.empty}</div>}
      </div>
    );
  }

  return (
    <div className={rootClasses} ref={listRef}>
      {withheld > 0 ? (
        <button
          type="button"
          className="sec-more"
          onClick={() => setRevealedExtra((extra) => extra + Math.max(1, maxRendered))}
        >
          <ChevronUpIcon />
          {fillTemplate(resolvedLabels.showEarlier, { count: withheld })}
        </button>
      ) : canLoadOlder ? (
        <div className="sec-top" ref={topRef}>
          <button type="button" className="sec-more" onClick={onLoadOlder} disabled={loadingOlder}>
            {loadingOlder ? <SpinnerIcon /> : <ChevronUpIcon />}
            {loadingOlder ? resolvedLabels.loadingOlder : resolvedLabels.loadOlder}
          </button>
        </div>
      ) : null}

      {groups.map((group) => (
        // The day key alone is NOT unique: grouping is consecutive-only, so a
        // thread that crosses midnight and comes back (a message dated out of
        // order, a resent copy) legitimately produces two groups for the same
        // calendar day. Two React children sharing one key silently drops one
        // of them — hence the start index, which is unique by construction.
        <div className="sec-day" key={`${group.key}#${group.startIndex}`}>
          <DateSeparator label={group.label} />
          {group.messages.map((message, indexInGroup) => {
            const previous = indexInGroup > 0 ? group.messages[indexInGroup - 1] : null;
            const compact = isSameSenderRun(previous, message, senderRunWindowMs);
            const absoluteIndex = withheld + group.startIndex + indexInGroup;
            return (
              <div
                // Absolute index, so the visibility report is in terms of the
                // caller's own array rather than of the rendered slice.
                data-sec-index={absoluteIndex}
                className={compact ? 'sec-item sec-item--run' : 'sec-item'}
                key={message.id}
              >
                <ChatBubble
                  message={message}
                  color={resolveSenderColor(colors, message.fromAddress)}
                  compact={compact}
                  labels={resolvedLabels}
                  locale={locale}
                  now={now}
                  parser={parser}
                  blockRemoteImages={blockRemoteImages}
                  onOpenLink={onOpenLink}
                  onRetryBody={onRetryBody}
                  onPreviewAttachment={onPreviewAttachment}
                  onDownloadAttachment={onDownloadAttachment}
                  renderActions={renderActions}
                  renderFooter={renderFooter}
                />
              </div>
            );
          })}
        </div>
      ))}

      <div className="sec-bottom" ref={bottomRef} />
    </div>
  );
}
