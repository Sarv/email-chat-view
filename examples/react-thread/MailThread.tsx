/**
 * React: a real thread, wired the way a mail client actually loads one.
 *
 * Reference code — copy it into an app rather than running it here; it needs a
 * bundler and a React root. Everything it does is deliberate:
 *
 *   - metadata for the whole thread renders immediately, bodies stream in;
 *   - the bodies fetched FIRST are the ones on screen, not the first 200 in the
 *     list — that is what `onVisibleRangeChange` is for;
 *   - the transform is memoized and cached, so one arriving body re-cleans one
 *     message rather than the whole thread;
 *   - every side effect (opening a link, saving an attachment, retrying) is the
 *     host's, because a component that reached for `window.open` or an Electron
 *     IPC channel of its own would work in exactly one application.
 */
import { useCallback, useMemo, useState } from 'react';

import {
  createBodyCache,
  MailChatView,
  mailsToMessages,
  type Attachment,
  type Mail,
  type VisibleRange,
} from 'email-chat-view';
import 'email-chat-view/style.css';

export interface MailThreadProps {
  /** Whatever your mail store gives you, in any order. */
  mails: readonly Mail[];
  /** The reader — used for `isFromMe` and excluded from identity colouring. */
  myAddress: string;
  /** Is there older history left to page in? */
  hasOlder: boolean;
  /** Fetch the next page of older messages. */
  onLoadOlder: () => void;
  /** Fetch these bodies next — the ones the reader is looking at. */
  prioritizeBodies: (ids: readonly string[]) => void;
  /** Re-fetch one body that failed. */
  refetchBody: (id: string) => void;
}

export function MailThread({
  mails,
  myAddress,
  hasOlder,
  onLoadOlder,
  prioritizeBodies,
  refetchBody,
}: MailThreadProps) {
  const [loadingOlder, setLoadingOlder] = useState(false);

  /**
   * One cache for the life of the component, NOT one per render.
   *
   * It is keyed on `(id, body)`, so a body arriving for message 3 changes only
   * message 3's key: that one is re-cleaned and the other 199 are served from
   * the cache. A cache recreated each render would re-clean all 200 every time
   * a body lands, which on a large thread is the whole cost of the feature.
   *
   * `useState` with a lazy initialiser rather than a ref: the function runs
   * once, the value never changes, and nothing reads a ref during render.
   */
  const [cache] = useState(createBodyCache);

  const messages = useMemo(
    () =>
      mailsToMessages(mails, {
        currentUserAddress: myAddress,
        // Declared, never guessed. IMAP stores usually hand you epoch SECONDS,
        // and a silent factor-of-1000 error does not crash — it puts every
        // message in 1970 and sorts the thread wrongly.
        dateUnit: 's',
        cache,
      }),
    [mails, myAddress, cache],
  );

  const handleLoadOlder = useCallback(async () => {
    setLoadingOlder(true);
    try {
      await onLoadOlder();
    } finally {
      setLoadingOlder(false);
    }
  }, [onLoadOlder]);

  /**
   * Which messages are on screen. Only the view knows this and only you can
   * fetch, which is why the library reports it instead of hiding it: fetching
   * the visible bodies before the 180 the reader scrolled past is the
   * difference between a thread that feels instant and one that fills in from
   * the top while the reader waits at the bottom.
   */
  const handleVisibleRange = useCallback(
    ({ ids }: VisibleRange) => {
      const byId = new Map(messages.map((message) => [message.id, message]));
      const pending = ids.filter((id) => byId.get(id)?.bodyPending);
      if (pending.length) prioritizeBodies(pending);
    },
    [messages, prioritizeBodies],
  );

  // A mail client opens links in the browser, not inside the message. The view
  // intercepts the click and hands you the URL; where it goes is your call.
  const handleOpenLink = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const handleDownload = useCallback((attachment: Attachment) => {
    // Your IPC call, your signed URL — the library never fetches the bytes.
    console.log('download', attachment.filename);
  }, []);

  return (
    <MailChatView
      messages={messages}
      currentUserAddress={myAddress}
      hasOlder={hasOlder}
      onLoadOlder={handleLoadOlder}
      loadingOlder={loadingOlder}
      onVisibleRangeChange={handleVisibleRange}
      // DOM ceiling: older bubbles are held behind a "show earlier" button
      // rather than kept in the document forever.
      maxRendered={50}
      onOpenLink={handleOpenLink}
      onRetryBody={(message) => refetchBody(message.id)}
      onDownloadAttachment={handleDownload}
      // Placeholder bubbles while the thread's metadata is still arriving —
      // they say what a spinner cannot: that a conversation is coming, roughly
      // this long, laid out this way.
      loading={mails.length === 0}
      // Every string the view renders is overridable; dates are not here,
      // because those go through `Intl` in the reader's own locale.
      labels={{ today: 'Today' }}
      className="my-thread"
    />
  );
}

/**
 * Restyling is one variable on any ancestor — no `!important`, no fork:
 *
 *   .my-thread { --sec-bubble-mine-bg: #0b57d0; }
 *
 * Every value the components use is a `--sec-*` token that resolves through
 * your own design token of the same meaning first, so an app that already has a
 * design system inherits it and one that does not gets sensible defaults.
 */
