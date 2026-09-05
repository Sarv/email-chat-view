# email-chat-view

[![npm version](https://img.shields.io/npm/v/email-chat-view.svg)](https://www.npmjs.com/package/email-chat-view)
[![npm downloads](https://img.shields.io/npm/dm/email-chat-view.svg)](https://www.npmjs.com/package/email-chat-view)
[![CI](https://github.com/Sarv/email-chat-view/actions/workflows/ci.yml/badge.svg)](https://github.com/Sarv/email-chat-view/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/email-chat-view.svg)](./LICENSE)

Turn an email thread into a chat-style conversation.

**npm:** [`email-chat-view`](https://www.npmjs.com/package/email-chat-view) ·
**source:** [Sarv/email-chat-view](https://github.com/Sarv/email-chat-view) ·
**examples:** [runnable examples](./examples) ·
**issues:** [report one](https://github.com/Sarv/email-chat-view/issues) ·
**contributing:** [CONTRIBUTING.md](./CONTRIBUTING.md)

You supply the mails. It gives you back one bubble's worth of content per turn —
quoted history, signatures and legal footers already removed — so a thread reads
like a chat instead of like fourteen nested copies of itself.

<p align="center">
  <img src="https://raw.githubusercontent.com/Sarv/email-chat-view/main/docs/media/thread-to-chat.gif"
       alt="A four-message email thread: each signature, quoted copy and legal footer is tagged with the rule that matches it, collapses away, and the remainder becomes one chat bubble per turn"
       width="880">
</p>

<p align="center">
  <em>Every removal above is a named rule &mdash; the labels in the animation are the
  strings the library hands back in <code>message.applied</code>.</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Sarv/email-chat-view/main/docs/media/before-after.png"
       alt="Side by side: the raw thread with quoted history, signatures and a confidentiality footer, and the same thread as a chat"
       width="880">
</p>

**Zero required dependencies.** No React needed for the transform, no DOM
assumed, no `mode` flag, nothing global. TypeScript throughout, ESM and CJS,
100% line and branch coverage on every rule.

---

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Examples](#examples)
- [Running outside a browser](#running-outside-a-browser)
- [Dates: say which unit you have](#dates-say-which-unit-you-have)
- [Big threads: how mails are supplied](#big-threads-how-mails-are-supplied)
- [Why part of my email disappeared](#why-part-of-my-email-disappeared)
- [The rules](#the-rules)
- [Writing your own rule](#writing-your-own-rule)
- [Classifying automated mail](#classifying-automated-mail)
- [API](#api)
- [Project structure](#project-structure)
- [Development](#development)
- [Contributing](#contributing)
- [Releasing](#releasing)

---

## Install

```sh
npm install email-chat-view
# or
pnpm add email-chat-view
```

From a local checkout — a fork you are working on, or a patched build:

```sh
pnpm add file:../email-chat-view
```

React and react-dom are **optional** peers, needed only for the view. Nothing
under `email-chat-view/transform` imports them.

### Entry points

| Import | Contains | Needs React |
| --- | --- | --- |
| `email-chat-view` | everything, view included | yes |
| `email-chat-view/transform` | the mail → message transform, rules, classification | no |
| `email-chat-view/style.css` | the compiled stylesheet | — |

Both ESM and CJS ship, with matching type declarations for each:

```js
import { mailsToMessages } from 'email-chat-view/transform';   // ESM
const { mailsToMessages } = require('email-chat-view/transform'); // CJS
```

> **Status.** Published on npm and complete end to end: the transform layer,
> the rule registry, the classifier and the React view (`MailChatView` and every
> part below it) all ship in the current release. The version is still `0.x`, so
> the surface can change on a minor bump — anything that does will be called out
> in the release notes.

---

## Quick start

### Just the data

```ts
import { mailsToMessages } from 'email-chat-view/transform';

const messages = mailsToMessages(mails, {
  currentUserAddress: 'me@example.com',
  dateUnit: 's', // IMAP stores usually hand you epoch SECONDS — see below
});

// [
//   { id: '1', fromAddress: 'alice@acme.example',
//     body: '<p>Hi — are we still on for Tuesday?</p>',
//     date: 1740994800000, isFromMe: false,
//     applied: ['signature:gmail', 'quote:gmail', 'disclaimer:english-corporate'] },
//   { id: '2', fromAddress: 'me@example.com', body: '<p>Yes, 10am works.</p>', ... },
// ]
```

`mailsToMessages` is pure and synchronous. It sorts oldest-first, drops drafts,
resolves who each message is from, normalizes every date to epoch milliseconds,
and cleans each body.

### The view

```tsx
import { MailChatView } from 'email-chat-view';
import 'email-chat-view/style.css';

<MailChatView messages={messages} />;
```

<p align="center">
  <img src="https://raw.githubusercontent.com/Sarv/email-chat-view/main/docs/media/chat-view.png"
       alt="The MailChatView component: day separators, per-participant colours, an attachment chip, and the reader's own messages right-aligned"
       width="880">
</p>

The view takes `ChatMessage[]` and nothing else mandatory. It does not know what
a mail is, so anything that produces per-turn content — the transform above, an
LLM extraction pass, your own parser — feeds the same component. **That is why
there is no `mode` prop anywhere in this package:** the view renders messages,
and where they came from is your business.

---

## Examples

Working code for each of the three ways this gets used, in [`examples/`](./examples):

| Example | Shows |
| --- | --- |
| [`node-transform`](./examples/node-transform/thread-to-chat.mjs) | a thread → chat messages in Node — injected parser, `dateUnit`, the body cache, a pending body |
| [`custom-rules`](./examples/custom-rules/acme-signature.mjs) | adding a rule for an unknown client, adding a German marker, dropping a shipped rule that is too loose |
| [`react-thread`](./examples/react-thread/MailThread.tsx) | the view wired like a real mail client — streaming bodies, visible-range prioritisation, upward paging |

The first two run straight from a clone:

```sh
pnpm install && pnpm build
node examples/node-transform/thread-to-chat.mjs
```

---

## Running outside a browser

The transform needs to parse HTML. In a browser it uses the global `DOMParser`
automatically. Anywhere else — Node, a worker, a test, a server-side digest
builder — pass one in:

```ts
import { parseHTML } from 'linkedom';
import { mailsToMessages } from 'email-chat-view/transform';

const parser = (html) => parseHTML(`<html><body>${html}</body></html>`).document;

mailsToMessages(mails, { parser });
```

> ### The `<html><body>` wrapper is load-bearing
>
> An email body is almost always a *fragment* (`<div>Hi</div>`), not a document.
> The browser `DOMParser` hoists a bare fragment into `document.body`; **linkedom
> does not** — it leaves `document.body` empty and puts the nodes somewhere the
> passes never look.
>
> Without the wrapper nothing throws and nothing is logged. Every strip pass
> simply sees an empty document and returns your input unchanged, so bodies come
> out with their signatures and quoted history intact and it looks like the rules
> are broken. Wrap it.

No parser and no global `DOMParser` throws `NoDomParserError`, whose message
repeats the snippet above. `hasGlobalDomParser()` tells you which environment
you are in; `resolveParser(maybeParser)` is the resolution the transform itself
uses, exported for anyone building a pass of their own.

The suite deliberately runs with `environment: 'node'` and injects linkedom, so
any code that quietly reaches for a global DOM fails there rather than in your
Node process.

---

## Dates: say which unit you have

```ts
mailsToMessages(mails, { dateUnit: 's' }); // epoch seconds
mailsToMessages(mails, { dateUnit: 'ms' }); // epoch milliseconds (default)
```

Declared, never guessed. IMAP internal dates are frequently kept as epoch
seconds while everything in JavaScript is milliseconds, and a silent
factor-of-1000 error does not crash — it puts every message in 1970, sorts the
thread wrongly, and produces date separators nobody notices are wrong for
months.

A date that cannot be read (zero, negative, `NaN`, `Infinity`) is kept as `NaN`
and sorted **last**, so the view can group those under an explicit heading. The
alternative — dropping the message, or planting it at the top of the thread in
1970 — loses mail or corrupts the order.

Output `date` is always epoch milliseconds. Render it in the reader's zone at
render time (`toLocaleString(undefined, …)`); the library never formats a date
for you and never stores a local one.

---

## Big threads: how mails are supplied

A 200-message thread is not available all at once, and pretending otherwise is
what makes mail clients freeze on the threads that matter most. So the library
never asks for a complete thread, and never fetches anything itself.

**You own the fetching. The library is told what you have so far.**

Three properties on `Mail` carry that, and each maps to a bubble the reader can
act on:

| State | Set | Bubble shows |
| --- | --- | --- |
| body available | `body: '<p>…</p>'` | the content |
| body still downloading | `bodyPending: true` | a spinner |
| body permanently failed | `bodyFailed: true` | a retry affordance |

A pending message does **no transform work at all** — cleaning an empty string
costs a parse per message, and on a freshly-opened large thread that is every
message. So the usual sequence is: metadata for the whole thread arrives first
and renders immediately as a column of headers and spinners; bodies stream in
one at a time and fill themselves in.

### Re-running the transform is cheap, if you pass a cache

```ts
import { createBodyCache, mailsToMessages } from 'email-chat-view/transform';

const cache = createBodyCache(); // once, outside render. Default capacity 500.

// Called again on every body that arrives — 200 times for a 200-message thread.
const messages = mailsToMessages(mails, { cache, dateUnit: 's' });
```

The cache is keyed on `(id, body content)`, not on the id alone. So:

- a body that arrived is cleaned **once** and reused on every later call;
- when a pending body finally arrives the key changes, so exactly **one**
  message is re-cleaned and the other 199 are served from the cache;
- a stale empty result can never be served for a message whose body has since
  loaded, which is the bug where a message renders forever blank.

Eviction is least-recently-used, so a long session browsing thousands of
messages does not retain every body it ever rendered.

For a single message — a retry, one arriving body — `mailToMessage` transforms
one mail without touching the rest of the thread.

### Paging older messages

Threads are rendered newest-at-the-bottom, so paging goes *upward*. The view
takes:

```tsx
<MailChatView
  messages={messages}
  hasOlder={hasOlder}                       // is there more history to fetch?
  onLoadOlder={loadOlderPage}               // called when the top sentinel is seen
  onVisibleRangeChange={prioritizeBodies}   // which bodies to fetch FIRST
  maxRendered={50}                          // DOM ceiling; older ones unmount
/>
```

`onVisibleRangeChange` is the important one and the reason the library reports
visibility rather than hiding it: only the view knows which messages are on
screen, and only you can fetch them. It lets you fetch the bodies the reader is
actually looking at before the 180 they scrolled past, which is the difference
between a thread that feels instant and one that fills in from the top while the
reader waits at the bottom.

Full windowing (react-virtuoso) is a follow-up; `maxRendered` is the interim
ceiling.

---

## Why part of my email disappeared

Every message carries the list of rules that shaped it:

```ts
messages[0].applied;
// ['signature:gmail', 'quote:bare-blockquote', 'disclaimer:english-corporate']
```

Names are namespaced by family, and a rule appears **only if it actually removed
something**. Content vanishing with no explanation is a mail client's worst
failure mode, so this is the audit trail that makes it answerable: paste the
array into a bug report and the culprit is named.

If a rule is too aggressive for your corpus, drop it — every family is
independently replaceable, and a rule is a plain object:

```ts
import { cleanReplyBody, quoteRules, bareBlockquote } from 'email-chat-view/transform';

cleanReplyBody(html, {
  // A corpus full of genuine pull-quotes? Lose the loosest rule, keep the rest.
  quoteRules: quoteRules.filter((rule) => rule !== bareBlockquote),
});
```

---

## The rules

Provider conventions are **data**, not code. Four kinds, each with its own tiny
engine, and each pass is separately callable:

| Family | Removes | Engine | Also as |
| --- | --- | --- | --- |
| `signatureRules` | signature blocks (`.gmail_signature`, `#Signature`, …) | CSS selectors | `stripSignature(html, opts)` |
| `quoteRules` | quoted-history containers (`.gmail_quote`, `blockquote[type=cite]`, …) | CSS selectors | `stripQuote(html, opts)` |
| `markerRules` | everything after a prose boundary (`On … wrote:`, `-----Original Message-----`) | regex on the serialized string | `stripMarkers(html, opts)` |
| `disclaimerRules` | trailing legal boilerplate | weighted evidence | `stripDisclaimer(html, opts)` |

`cleanReplyBody` runs all four, in that order. The order matters: the disclaimer
pass is the only one that reasons about the *trailing edge* of a message, so it
has to run after the marker pass has cut the plain-text history off the end —
otherwise the footer sits buried mid-document where the trailing-block walk
never looks, and survives into the bubble.

Shipped rules today:

- **Signature** — Gmail, Apple Mail, Thunderbird, Outlook mobile, Outlook
  desktop, plus a guarded generic rule.
- **Quote** — Gmail, `blockquote[type="cite"]` (Apple Mail and followers),
  Thunderbird, Outlook classic, Outlook new/OWA, one webmail container, and a
  bare `<blockquote>` catch-all.
- **Marker** — `On … wrote:`, forwarded-message banners,
  `-----Original Message-----`, the Outlook `From:/Sent:/To:` header block, the
  Outlook underscore separator.
- **Disclaimer** — English corporate boilerplate, and an `<hr>`-delimited rule.

Three details worth knowing, because each was a real bug:

- **`maxTextLength`** guards the loose rules. `div[id*="signature" i]` matches
  Outlook's entire reply wrapper on some mail; unguarded, it deletes the whole
  message. The limit is measured on whitespace-collapsed text, so Word's
  mountains of markup cannot push a short signature over it.
- **`boundary: true`** means "remove this element *and every following
  sibling*". Outlook's `appendonsend` and `divRplyFwdMsg` do not *contain* the
  quoted thread — the history follows them as siblings. Removing only the
  element deletes the `From:` header and leaves the entire conversation on
  screen, which looks like the stripper ran and worked.
- **Earliest match wins** among marker rules, and **the latest `<hr>` wins**
  among disclaimer dividers. Both make the result order-independent and both
  degrade toward removing *less* — leftover boilerplate is cosmetic, a deleted
  paragraph is the sender's words.

---

## Writing your own rule

A rule is a plain object, so a new one is **one object and one test** — no
engine changes, no reading the rest of the set. Pass it at call time for a
corpus only you have; open a PR when the provider is one other people also
receive mail from ([CONTRIBUTING.md](./CONTRIBUTING.md) walks through that).

Say your client wraps signatures in `<div class="acme-sig">`:

```ts
import type { DomRule } from 'email-chat-view/transform';

export const acmeSignature: DomRule = {
  name: 'acme',                    // appears in `applied` as 'signature:acme'
  provider: 'Acme Mail 4.x',       // who emits this, so the next reader knows
  selectors: ['div.acme-sig'],
  maxTextLength: 500,              // optional: only when the match is short
  test: (element) => true,         // optional: for what a selector cannot say
};
```

Then either pass it (`{ signatureRules: [...signatureRules, acmeSignature] }`)
or open a PR adding it to `src/rules/signature.ts` with a test.

**Test it against markup a real client produces, not markup you typed.** A
marker rule tested against prettier input than the wild produces is a rule that
does not fire: real clients HTML-escape addresses as `&lt;bob@x.com&gt;`, and a
pattern written against `<bob@x.com>` matches the fixture and nothing else.

The other three kinds:

```ts
// Prose boundary: everything from the match onward is history. This is the
// shipped `wroteAttribution` rule.
const marker: MarkerRule = {
  name: 'wrote-attribution',
  provider: 'Gmail / multi-client',
  language: 'en',                  // so a non-English corpus can filter the set
  patterns: [
    /<div[^>]*>\s*On\s+[^<]{4,200}\s+wrote\s*:/i,  // the markup form, if wrapped
    /On\s+[^\n<]{4,200}\s+wrote\s*:/i,             // and the bare-text form
  ],
};

// Trailing boilerplate: evidence-based, never a single phrase. Trimmed from the
// shipped `englishDisclaimer` — the real one carries ten signals.
const disclaimer: DisclaimerRule = {
  name: 'english-corporate',
  language: 'en',
  opens: /^(?:this (?:e-?mail|message)|confidentiality notice)/i, // must OPEN like boilerplate
  signals: [/\bconfidential(?:ity)?\b/i, /intended (?:recipient|solely)/i, /\bprivileged\b/i],
  minSignals: 2,                   // default 2 — one phrase is not proof
  minTextLength: 120,              // default 120 — shorter than this is a sign-off
};
```

`opens` is the load-bearing part of a disclaimer rule. It anchors to the
**start** of the block's text, so a paragraph that merely mentions
confidentiality cannot match, and neither can a wrapper holding real content
followed by a footer — the engine descends into that wrapper instead of deleting
the lot.

Patterns use **bounded** quantifiers (`[^<]{4,200}`, `[\s\S]{0,2000}?` — never
`[\s\S]*?`). An unbounded one on a 5 MB marketing email is a ReDoS waiting to
happen, and mail bodies are the most hostile input a client ever sees. Match
against both the markup form and the bare-text form: whether the boundary is
still wrapped in a `<div>` by the time the pass sees it depends on which earlier
rules fired.

Rules cannot break the render. An unparseable selector degrades to "matched
nothing", a throwing `test` vetoes the match, a throwing classification signal is
skipped — a bad rule shows an unstripped signature, never an unrendered message.

Rules that belong upstream — a provider convention, a non-English marker — are
the most valuable contribution this package takes. See
[CONTRIBUTING.md](./CONTRIBUTING.md#adding-a-rule) for where the file goes, what
the test has to prove, and how to capture real markup to test it against.

---

## Classifying automated mail

A newsletter is not a conversation, and rendering one as a chat bubble reads as
nonsense. `classifyMail` says which one you have:

```ts
import { classifyMail, isConversational } from 'email-chat-view/transform';

classifyMail({
  body,
  messageId: '<abc@mail123.mcsv.net>',
  fromAddress: 'news@brand.example',
  headers: { 'List-Unsubscribe': '<mailto:u@brand.example>' },
});
// { kind: 'automated', score: 6, signals: ['list-unsubscribe-header', 'esp-message-id'] }
```

Signals are **weighted**, and the verdict flips at a score of 3. Weight 3
decides on its own (`List-Unsubscribe`, `Auto-Submitted`, `Precedence: bulk`, a
tracking pixel, an unrendered `{{merge_tag}}`, an ESP `Message-ID`, a
`no-reply@` sender); weight 2 needs corroboration. That distinction exists for
one case above all: a genuine human reply whose corporate footer says
"unsubscribe" must not be reclassified because of its footer.

Deliberately **not** signals: "the HTML looks designed" and "low
text-to-markup ratio". Both flag every mail sent from a company with a template,
including the ones a person actually wrote.

`score` and `signals` come back on every call, so a misclassification is
tunable rather than mysterious.

---

## API

Everything below is exported from `email-chat-view/transform` and, for
convenience, from the package root.

### Transform

| Export | Description |
| --- | --- |
| `mailsToMessages(mails, options?)` | `Mail[]` → `ChatMessage[]`: sorted, drafts dropped, dates normalized, bodies cleaned |
| `mailToMessage(mail, context)` | one mail, for a retry or a single arriving body |
| `createBodyCache(capacity?)` | LRU memo keyed on `(id, body)`. Default capacity 500 |
| `cleanReplyBody(html, options?)` | all four passes → `{ html, applied }` |
| `stripSignature` / `stripQuote` / `stripMarkers` / `stripDisclaimer` | one family each |

`MailsToMessagesOptions`: `parser`, `currentUserAddress` (string or array),
`dateUnit`, `cache`, `includeDrafts`, plus any `cleanReplyBody` option
(`signatureRules`, `quoteRules`, `markerRules`, `disclaimerRules`,
`keepQuotedHistory`).

The thread's **oldest** message keeps its quoted history automatically: it has
no history behind it, so there is nothing to cut and only genuine content a
quote pass could damage.

### Rules

`signatureRules`, `quoteRules`, `markerRules`, `disclaimerRules` — the default
sets. Every individual rule is exported too (`gmailQuote`, `bareBlockquote`,
`outlookModernQuote`, `wroteAttribution`, `englishDisclaimer`, …), so composing
your own set is array-literal syntax, not an API.

Types: `DomRule`, `MarkerRule`, `DisclaimerRule`, `StripOptions`, `StripResult`.

### Engines

`applyDomRules(root, rules)`, `applyMarkerRules(html, rules)`,
`applyDisclaimerRules(root, rules)` — run one pass over a document you have
already parsed, with no serialize/reparse round trip. `applyDomRules` accepts a
**detached** subtree, so you can strip inside a fragment.

### Classification

`classifyMail`, `isConversational`, `automatedSignals`, `AUTOMATED_THRESHOLD`,
`ESP_MESSAGE_ID_DOMAINS`, `hasEspMessageIdDomain`. Types: `AutomatedSignal`,
`MailClassification`, `MailClassificationInput`.

### DOM

`resolveParser`, `hasGlobalDomParser`, `NoDomParserError`, type `HtmlParser`.

### Node helpers

`normalizedText`, `isIgnorableNode`, `meaningfulChildren`,
`lastMeaningfulChild`, `isElement`, `safeMatches`, `safeQueryAll` — small and
unglamorous, but a contributed rule's `test` hook needs them, and
re-implementing "does this element have meaningful children" per rule is exactly
how the hand-rolled strippers this package replaces drifted apart.

### Data contract

`Mail`, `ChatMessage`, `Attachment`, `DateUnit` — every field documented inline,
so your editor explains them without a trip back here.

---

## Project structure

Three layers, and the boundaries between them are the design. Each one is
importable without the one above it, which is what lets a Node pipeline use the
transform with no React and a host with its own list use the bubble without the
view around it.

```text
src/
  index.ts          package root — re-exports transform + view
  transform.ts      'email-chat-view/transform' entry — no React, no DOM assumed
  view.ts           React entry — components and the pure UI helpers
  types.ts          the public data contract: Mail, ChatMessage, Attachment
  dom.ts            injectable HTML parser (resolveParser, NoDomParserError)
  rules/            provider conventions AS DATA — signature/quote/marker/disclaimer
  transform/        the engines that apply those rules, and mailsToMessages
  classify/         automated-vs-conversational scoring
  ui/               pure view logic: dates, colours, grouping, sanitize, frame
  components/       the React components
  styles/index.css  the --sec-* token layer, compiled to dist/style.css
test/               one file per module, mirroring src/
.github/workflows/  ci.yml (every push/PR) and publish.yml (v* tags)
```

A file-by-file map — what each module owns and why it is separate — is in
[CONTRIBUTING.md](./CONTRIBUTING.md#the-map), next to the guide for changing
them. Every source file also opens with a docblock stating the decision it
encodes, so the file itself is the second place to look.

---

## Development

```sh
pnpm install
pnpm test           # vitest, Node environment, linkedom injected
pnpm test:coverage  # enforced at 100% lines AND branches
pnpm type-check
pnpm build          # ESM + CJS + .d.ts/.d.cts + dist/style.css
```

The coverage threshold is 100% and enforced, not aspirational. Every rule in
here can silently delete part of somebody's email, so an untested branch is not
a cosmetic gap. Each test carries a one-line comment naming the regression it
prevents; a test whose purpose isn't stated gets deleted by someone later, and
the protection goes with it.

Styling is a hand-authored token layer, not Tailwind — Tailwind generates CSS by
scanning source for class names, which cannot work for components that ship
pre-built in `dist/`, and its preflight reset would leak into your app. Every
value is a `--sec-*` variable that resolves through your own design token first,
so overriding one thing is one variable on any ancestor:

```css
.my-thread { --sec-bubble-mine-bg: #0b57d0; }
```

---

## Contributing

Contributions are welcome, and rules are the ones that help most: a provider
whose signature markup nobody here has seen, or a non-English `On … wrote:`
marker — currently every marker rule is English, which is the single biggest gap
in the package.

Read **[CONTRIBUTING.md](./CONTRIBUTING.md)** before opening a PR. It covers the
local setup, the file-by-file map of the codebase, how to add each of the four
rule kinds, what the tests have to prove (coverage is enforced at 100%), and the
commit and PR conventions.

- Bugs and rule misfires: [open an issue](https://github.com/Sarv/email-chat-view/issues)
  and paste the message's `applied` array — it names the rule that ate your text.
- Security-relevant findings (sanitizer bypass, frame escape): please report
  them privately rather than in a public issue.

---

## Releasing

Publishing is automated and **the tag is the source of truth**: pushing `v0.1.0`
publishes 0.1.0. The version is written into `package.json` by the workflow, so
a release is one command and there is no second place to keep in sync.

```sh
git tag v0.1.0
git push --tags
```

`npm version patch && git push --follow-tags` works too, and still does the
right thing — it writes `package.json` and the matching tag together. Either
way the workflow publishes what the tag says, warning in the log if
`package.json` was behind.

A tag that isn't semver (`v2.0`, `vfinal`) is rejected up front rather than
three minutes later. Then it runs `type-check`, the whole suite and `build`
before anything leaves the building — a published version can't be un-published
after 72 hours, and can never be re-published at the same number.

There is no manual `npm publish` step, and there shouldn't be — a hand publish
from a laptop skips that gate and ships whatever `dist/` happened to be lying
around.

Tarballs go out with [npm provenance][provenance], so every release carries a
signed record of which workflow, commit and repo produced it.

One-time setup on a fork: add an `NPM_TOKEN` repository secret (Settings →
Secrets and variables → Actions) holding an npm **automation** token. Granular
or classic both work, but it must be the automation kind — any other token type
prompts for 2FA, which no CI runner can answer.

[provenance]: https://docs.npmjs.com/generating-provenance-statements

## License

MIT
