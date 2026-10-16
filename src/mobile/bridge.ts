/**
 * The wire protocol between a native app and the chat view in its WebView.
 *
 * The mobile build is this package's own React view, bundled into one HTML
 * page that an iOS `WKWebView` or an Android `WebView` loads. Native talks to
 * it in exactly two directions, and both carry JSON STRINGS rather than
 * objects, because a string is the one type both bridges pass through
 * unchanged — WebKit turns an object into an `NSDictionary`, Android's
 * `@JavascriptInterface` cannot receive one at all:
 *
 *   native -> page   `window.EmailChatView.render(json)`, the WHOLE state each
 *                    time. No patch protocol: the transform keeps a body cache,
 *                    so re-sending a thread whose bodies have not changed costs
 *                    a lookup per mail, not a re-parse.
 *   page -> native   one {@link NativeEvent} per user action, posted to
 *                    whichever bridge the platform installed.
 *
 * Everything that crosses back to native is keyed by MAIL id, never by message
 * id. A bottom-quoted email is split into several messages, and native only
 * knows the mails it fetched — "retry message m1#2" is meaningless to it,
 * "retry mail m1" is the call it can actually make.
 */
import type { VisibleRange } from '../components/MailChatView.js';
import type { Attachment, ChatMessage, DateUnit, Mail } from '../types.js';
import type { ViewLabels } from '../ui/labels.js';

/** Everything the page renders, sent whole by native on every change. */
export interface ThreadState {
  /** The thread as the mail store has it. Ignored when `messages` is given. */
  mails?: Mail[];
  /** Already-resolved messages, for a host that runs its own extraction. */
  messages?: ChatMessage[];
  currentUserAddress?: string | string[];
  dateUnit?: DateUnit;
  /** BCP 47 locale for dates. Defaults to the WebView's own. */
  locale?: string;
  labels?: Partial<ViewLabels>;
  blockRemoteImages?: boolean;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  loading?: boolean;
  /**
   * Design-token overrides, by name without the leading dashes:
   * `{ "brand": "#0b57d0" }` sets `--brand` on the page root, which every
   * `--sec-*` token already resolves through first. This is how an app hands
   * its own colours to the view without shipping a stylesheet.
   */
  tokens?: Record<string, string>;
}

/** One user action, reported to native. */
export type NativeEvent =
  | { type: 'ready' }
  | { type: 'openLink'; url: string }
  | { type: 'retryBody'; mailId: string }
  | { type: 'previewAttachment'; mailId: string; attachment: Attachment }
  | { type: 'downloadAttachment'; mailId: string; attachment: Attachment }
  | { type: 'loadOlder' }
  | { type: 'visibleRange'; mailIds: string[] };

export type PostToNative = (event: NativeEvent) => void;

/** Name of the `WKScriptMessageHandler` the Swift wrapper registers. */
export const IOS_HANDLER = 'emailChatView';
/** Name of the `@JavascriptInterface` object the Kotlin wrapper adds. */
export const ANDROID_INTERFACE = 'EmailChatViewAndroid';
/** DOM event dispatched when neither bridge is present (a desktop preview). */
export const DOM_EVENT = 'emailchatview';

interface StringSink {
  postMessage(message: string): void;
}

/** The globals the two native wrappers install, as the page sees them. */
export interface NativeHosts {
  webkit?: { messageHandlers?: Record<string, StringSink | undefined> };
  [ANDROID_INTERFACE]?: StringSink;
}

/** The native bridge on this page, or null when it runs in a plain browser. */
export function nativeChannel(host: NativeHosts): PostToNative | null {
  const sink = host.webkit?.messageHandlers?.[IOS_HANDLER] ?? host[ANDROID_INTERFACE];
  if (!sink) return null;
  return (event) => sink.postMessage(JSON.stringify(event));
}

/**
 * Fallback channel: a DOM event per action. Lets the page be driven and
 * inspected in a desktop browser, where no native bridge exists, without the
 * view behaving any differently.
 */
export function domChannel(target: EventTarget): PostToNative {
  return (event) => target.dispatchEvent(new CustomEvent(DOM_EVENT, { detail: event }));
}

/**
 * Read native's state. Throws rather than rendering nothing, so a malformed
 * payload surfaces as an error in native's `evaluateJavaScript` callback
 * instead of as a silently empty thread.
 */
export function parseState(input: unknown): ThreadState {
  const value: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('EmailChatView.render expects a JSON object');
  }
  return value as ThreadState;
}

/** Token names native may set: a lowercase custom-property name, nothing else. */
const TOKEN_NAME = /^[a-z][a-z0-9-]*$/;

/** `[--name, value]` pairs for the valid entries of {@link ThreadState.tokens}. */
export function tokenDeclarations(tokens: Record<string, string> = {}): [string, string][] {
  return Object.entries(tokens)
    .filter(([name, value]) => TOKEN_NAME.test(name) && typeof value === 'string')
    .map(([name, value]) => [`--${name}`, value]);
}

/** The mail a message came from — itself, unless it was split out of one. */
export function mailIdOf(message: ChatMessage): string {
  return message.sourceId ?? message.id;
}

/** The distinct mails behind the messages on screen, in thread order. */
export function visibleMailIds(
  messages: readonly ChatMessage[],
  range: Pick<VisibleRange, 'firstIndex' | 'lastIndex'>,
): string[] {
  const onScreen = messages.slice(range.firstIndex, range.lastIndex + 1).map(mailIdOf);
  return [...new Set(onScreen)];
}
