/**
 * Node: an email thread -> chat messages, with no React and no browser.
 *
 * Run it from a checkout:
 *
 *     pnpm build && node examples/node-transform/thread-to-chat.mjs
 *
 * The import below points at the local build so this file runs straight from a
 * clone. IN YOUR APP it is the package specifier:
 *
 *     import { mailsToMessages } from '@sarv-in/email-chat-view/transform';
 */
import { parseHTML } from 'linkedom';

import { createBodyCache, mailsToMessages } from '../../dist/transform.js';

/**
 * The parser, injected because there is no global `DOMParser` in Node.
 *
 * The `<html><body>` wrapper is load-bearing: an email body is a FRAGMENT, and
 * linkedom — unlike the browser — will not hoist a bare fragment into
 * `document.body`. Without it every pass sees an empty document, returns your
 * input unchanged, and it looks like the rules are broken.
 */
const parser = (html) => parseHTML(`<html><body>${html}</body></html>`).document;

/** What a mail store hands you: raw bodies, quoted history and all. */
const mails = [
  {
    id: '1',
    fromAddress: 'alice@acme.example',
    fromName: 'Alice Chen',
    toAddress: 'me@example.com',
    // IMAP internal dates are frequently epoch SECONDS — see `dateUnit` below.
    date: 1740992400,
    body: '<p>Hi — are we still on for Tuesday?</p>',
  },
  {
    id: '2',
    fromAddress: 'me@example.com',
    toAddress: 'alice@acme.example',
    date: 1740994800,
    body: `
      <div>Yes, 10am works.</div>
      <div class="gmail_signature">--<br>Sent from my phone</div>
      <div class="gmail_quote">
        <blockquote>Hi — are we still on for Tuesday?</blockquote>
      </div>
      <p>CONFIDENTIALITY NOTICE: This email and any attachments are confidential
      and intended solely for the addressee. If you have received it in error,
      please notify the sender and delete it. Any unauthorised disclosure, use or
      distribution is prohibited and may be unlawful.</p>
    `,
  },
  {
    // A body that has not downloaded yet. No transform work is done for it —
    // the view renders a spinner, and the message fills itself in later.
    id: '3',
    fromAddress: 'alice@acme.example',
    toAddress: 'me@example.com',
    date: 1740998400,
    bodyPending: true,
  },
];

/**
 * Created ONCE and reused across calls. Keyed on `(id, body)`, so when message
 * 3's body finally arrives, exactly that one message is re-cleaned and the
 * others are served from the cache.
 */
const cache = createBodyCache();

const messages = mailsToMessages(mails, {
  parser,
  currentUserAddress: 'me@example.com',
  dateUnit: 's', // declared, never guessed — 'ms' is the default
  cache,
});

for (const message of messages) {
  const who = message.isFromMe ? 'me' : (message.fromName ?? message.fromAddress);
  // Render in the READER's zone, at render time. The library never formats a
  // date for you and never stores a local one.
  const when = Number.isNaN(message.date)
    ? 'unknown date'
    : new Date(message.date).toLocaleString();

  console.log(`\n[${when}] ${who}`);
  console.log(message.bodyPending ? '  (body still downloading)' : `  ${message.body}`);

  // Every rule that actually removed something is named here. Paste this array
  // into a bug report and the culprit is identified.
  if (message.applied?.length) console.log(`  applied: ${message.applied.join(', ')}`);
}
