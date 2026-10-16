/**
 * The page a native WebView loads: `MailChatView`, driven over the bridge.
 *
 * Nothing here is a second implementation. The transform, the view and the
 * stylesheet are the same ones the npm package ships; this file only adapts
 * their inputs (a JSON state from native) and outputs (callbacks, turned into
 * {@link NativeEvent}s). A fix to a rule or a bubble therefore reaches iOS and
 * Android the moment the mobile bundle is rebuilt, with no Swift or Kotlin to
 * change.
 */
import { useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

import { MailChatView } from '../components/MailChatView.js';
import { createBodyCache, mailsToMessages } from '../transform/mails-to-messages.js';
import type { BodyCache } from '../transform/mails-to-messages.js';

import {
  domChannel,
  mailIdOf,
  nativeChannel,
  parseState,
  tokenDeclarations,
  visibleMailIds,
  type NativeHosts,
  type PostToNative,
  type ThreadState,
} from './bridge.js';

/**
 * Set native's token overrides on the page root, and take them off again when
 * they change. The root, not the thread element, because the stylesheet's
 * `--sec-*` tokens resolve `var(--brand, …)` where they are declared — on
 * `:root` — so a `--brand` set any lower is never read.
 */
function useRootTokens(tokens: Record<string, string> | undefined) {
  // Keyed by content: native sends a fresh object on every render, and an
  // identity dependency would clear and re-set every token each time.
  const key = JSON.stringify(tokenDeclarations(tokens));
  useEffect(() => {
    const declarations = JSON.parse(key) as [string, string][];
    const { style } = document.documentElement;
    declarations.forEach(([name, value]) => style.setProperty(name, value));
    return () => declarations.forEach(([name]) => style.removeProperty(name));
  }, [key]);
}

export interface MobileThreadProps {
  state: ThreadState;
  post: PostToNative;
  /** Kept across renders so re-sent bodies are not re-cleaned. */
  cache: BodyCache;
}

/** One render of native's state. */
export function MobileThread({ state, post, cache }: MobileThreadProps) {
  const { mails, messages: resolved, currentUserAddress, dateUnit, tokens } = state;
  const messages = useMemo(
    () => resolved ?? mailsToMessages(mails ?? [], { currentUserAddress, dateUnit, cache }),
    [resolved, mails, currentUserAddress, dateUnit, cache],
  );
  useRootTokens(tokens);

  return (
    <MailChatView
      messages={messages}
      currentUserAddress={currentUserAddress}
      locale={state.locale}
      labels={state.labels}
      blockRemoteImages={state.blockRemoteImages}
      hasOlder={state.hasOlder}
      loadingOlder={state.loadingOlder}
      loading={state.loading}
      onOpenLink={(url) => post({ type: 'openLink', url })}
      onRetryBody={(message) => post({ type: 'retryBody', mailId: mailIdOf(message) })}
      onPreviewAttachment={(attachment, message) =>
        post({ type: 'previewAttachment', mailId: mailIdOf(message), attachment })
      }
      onDownloadAttachment={(attachment, message) =>
        post({ type: 'downloadAttachment', mailId: mailIdOf(message), attachment })
      }
      onLoadOlder={() => post({ type: 'loadOlder' })}
      onVisibleRangeChange={(range) =>
        post({ type: 'visibleRange', mailIds: visibleMailIds(messages, range) })
      }
    />
  );
}

/** What the page exposes to native as `window.EmailChatView`. */
export interface MobileHostApi {
  /** Render a {@link ThreadState}, as a JSON string or an object. */
  render(state: unknown): void;
}

/** Mount the view into `container`, reporting actions through `post`. */
export function mountMobileHost(container: Element, post: PostToNative): MobileHostApi {
  const root = createRoot(container);
  const cache = createBodyCache();
  return {
    render: (input) =>
      root.render(<MobileThread state={parseState(input)} post={post} cache={cache} />),
  };
}

/**
 * Boot the page: mount into `#root`, publish the API, then say `ready`.
 *
 * `ready` goes out only AFTER `EmailChatView` is assigned, because it is
 * native's cue to call `render` — sent first, a fast bridge could deliver it
 * before the API it announces exists. Native buffers its state until then.
 */
export function bootMobileHost(win: Window): MobileHostApi {
  const container = win.document.getElementById('root');
  if (!container) throw new Error('email-chat-view mobile page has no #root element');
  const post = nativeChannel(win as unknown as NativeHosts) ?? domChannel(win);
  const api = mountMobileHost(container, post);
  (win as unknown as { EmailChatView: MobileHostApi }).EmailChatView = api;
  post({ type: 'ready' });
  return api;
}
