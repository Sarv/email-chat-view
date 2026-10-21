/**
 * The JavaScript half of the native DATA API — the transform without the view.
 *
 * For iOS and Android apps that draw their own bubbles: they hand mails (or raw
 * `.eml` bytes) to `EmailChatCore` in Swift or Kotlin and get typed messages
 * back, with no WebView anywhere. Underneath, the same transform the chat view
 * runs executes in the platform's bare JavaScript engine — JavaScriptCore on
 * iOS, a V8 isolate on Android — so a native list and the WebView view can
 * never disagree about what a message says.
 *
 * Everything crosses as strings, because a string is the one value both
 * engines' host APIs pass reliably:
 *
 *   - requests and replies are JSON, and every reply is an envelope
 *     (`{ok, value}` / `{ok, error}`) so a failure arrives as data rather than
 *     as an exception the host API may not surface;
 *   - raw mail bytes cross as a "binary string", one char per byte (Latin-1 on
 *     the native side), which is lossless and needs no base64 on either end.
 *
 * Android's isolate passes values through a binder transaction of bounded size,
 * so its wrapper moves large strings in pieces through a global of its own (see
 * `CoreProtocol.kt`); that stays out of here because the core script itself has
 * to arrive that way, before this module exists.
 */
import type { HtmlParser } from '../dom.js';
import { parseRawMail } from '../raw/parse-raw-mail.js';
import {
  type BodyFormat,
  createBodyCache,
  mailsToMessages,
} from '../transform/mails-to-messages.js';
import type { Mail } from '../types.js';

/** What native sends to {@link EmailChatCore.messages}. */
export interface MessagesRequest {
  mails: Mail[];
  currentUserAddress?: string[];
  bodyFormat?: BodyFormat;
  includeDrafts?: boolean;
  containsThreadStart?: boolean;
}

/** What native sends alongside raw bytes to {@link EmailChatCore.startParseRawMail}. */
export interface ParseRequest {
  id?: string;
  inlineImages?: boolean;
}

/** The functions the core bundle puts on `globalThis.EmailChatCore`. */
export interface EmailChatCore {
  /** A {@link MessagesRequest} in, an envelope of `ChatMessage[]` out. */
  messages(requestJson: string): string;
  /** Begin parsing one raw message; collect it with {@link takeParsedMail}. */
  startParseRawMail(binary: string, requestJson: string): void;
  /**
   * The envelope of the last parse. Parsing settles in microtasks, which both
   * engines drain before returning to native, so this is ready on the very
   * next call; `pending` only if a host calls it before starting a parse.
   */
  takeParsedMail(): string;
}

type Envelope = { ok: true; value: unknown } | { ok: false; error: string };

const PENDING: Envelope = { ok: false, error: 'pending: no parse has settled' };

function failure(error: unknown): Envelope {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

/** One char per byte back to the bytes it stands for. */
export function bytesFromBinary(binary: string): Uint8Array {
  return Uint8Array.from({ length: binary.length }, (_, index) => binary.charCodeAt(index) & 0xff);
}

/**
 * The core, parsing HTML with `parser`.
 *
 * Holds one body cache for its lifetime, so a native app that re-sends the
 * whole thread every time a body arrives re-cleans only that body — the same
 * economy the WebView page gets.
 */
export function createCore(parser: HtmlParser): EmailChatCore {
  const cache = createBodyCache();
  let parsed: Envelope = PENDING;

  return {
    messages(requestJson) {
      try {
        const request = JSON.parse(requestJson) as MessagesRequest;
        const value = mailsToMessages(request.mails, {
          parser,
          cache,
          currentUserAddress: request.currentUserAddress,
          bodyFormat: request.bodyFormat,
          includeDrafts: request.includeDrafts,
          containsThreadStart: request.containsThreadStart,
        });
        return JSON.stringify({ ok: true, value });
      } catch (error) {
        return JSON.stringify(failure(error));
      }
    },

    startParseRawMail(binary, requestJson) {
      parsed = PENDING;
      try {
        const request = JSON.parse(requestJson) as ParseRequest;
        parseRawMail(bytesFromBinary(binary), request).then(
          (value) => {
            parsed = { ok: true, value };
          },
          (error: unknown) => {
            parsed = failure(error);
          },
        );
      } catch (error) {
        parsed = failure(error);
      }
    },

    takeParsedMail() {
      const reply = parsed;
      parsed = PENDING;
      return JSON.stringify(reply);
    },
  };
}
