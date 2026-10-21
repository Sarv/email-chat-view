/**
 * Entry of the native data bundle (`email-chat-core.js`, built by
 * `pnpm build:mobile`). Puts {@link createCore} on `globalThis.EmailChatCore`
 * for the Swift and Kotlin `EmailChatCore` classes to call.
 *
 * There is no DOM in a bare engine, so HTML is parsed with linkedom — the same
 * parser the whole test suite runs the transform against.
 */
import './engine-globals.js';

import { parseHTML } from 'linkedom';

import { createCore } from './core.js';

// The `<html><body>` wrapper is load-bearing: linkedom leaves a bare fragment
// out of `document.body`. See the README's "Running outside a browser".
(globalThis as { EmailChatCore?: unknown }).EmailChatCore = createCore(
  (html) => parseHTML(`<html><body>${html}</body></html>`).document,
);
