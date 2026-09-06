# Integrating email-chat-view

A step-by-step guide for someone who has never used this package. It assumes
you have mail rows in *some* store — IMAP sync, a database, an API, a JSON file
— and you want them on screen as a chat.

The [README](../README.md) is the reference: every option, every rule, every
export. This is the path through it, in order, with the things that go wrong on
a first integration called out where you would hit them.

**Contents**

- [Before you start](#before-you-start)
- [Step 1 — Install](#step-1--install)
- [Step 2 — Shape your rows as `Mail[]`](#step-2--shape-your-rows-as-mail)
- [Step 3 — Transform: which function do I call?](#step-3--transform-which-function-do-i-call)
- [Step 4 — Render](#step-4--render)
- [Step 5 — Add your own buttons](#step-5--add-your-own-buttons)
- [Framework recipes](#framework-recipes)
- [TypeScript setup](#typescript-setup)
- [No browser? Give it a parser](#no-browser-give-it-a-parser)
- [Before you ship: threads that are big or slow](#before-you-ship-threads-that-are-big-or-slow)
- [Troubleshooting](#troubleshooting)
- [Integration checklist](#integration-checklist)

---

## Before you start

| You need | Why |
| --- | --- |
| **Node 18 or newer** | declared in `engines`; the build targets it |
| **React 18.2+ or 19** *(optional)* | only for the view. The transform has no React in it |
| **A bundler that can import CSS** *(optional)* | only for the view — Vite, Next, webpack, Parcel and esbuild all can |
| **An HTML parser** *(only outside a browser)* | see [No browser?](#no-browser-give-it-a-parser). In a browser this is automatic |

The package brings three small runtime dependencies of its own — `dompurify`
(sanitizing bodies before they render), `email-addresses` (RFC-5322 address
parsing) and `chrono-node` (reading dates out of quote attribution lines). You
do not install or configure any of them. React is a **peer** dependency and an
optional one, so `npm install` will not pull React into a backend project that
only uses the transform.

---

## Step 1 — Install

```sh
npm install email-chat-view
# or: pnpm add email-chat-view / yarn add email-chat-view
```

There are three things you can import, and picking the right one is the first
decision:

```ts
import { MailChatView } from 'email-chat-view';            // the React view (+ everything else)
import { mailsToMessages } from 'email-chat-view/transform'; // no React, no DOM assumed
import 'email-chat-view/style.css';                         // the compiled stylesheet
```

Use `email-chat-view/transform` in anything that is not a browser component —
a server, a worker, a cron job, a test. It cannot accidentally pull React in.

---

## Step 2 — Shape your rows as `Mail[]`

This is the only real work. Everything downstream is a function call.

`Mail` is a plain object. **Four fields are required**, the rest are there for
when your store has them:

```ts
import type { Mail } from 'email-chat-view/transform';

const mails: Mail[] = [
  {
    id: '1',                                   // required — unique within the thread
    fromAddress: 'alice@acme.example',         // required — bare address, no display name
    date: 1740994800,                          // required — see dateUnit below
    body: '<p>Hi — are we still on for Tuesday?</p>', // required in practice; see bodyPending
  },
];
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | **Required.** Unique within the thread; used as the React key and handed back to every callback |
| `fromAddress` | `string` | **Required.** Bare address. `"Alice <alice@x.com>"` goes in `fromName` + `fromAddress`, not here |
| `date` | `number` | **Required.** Epoch **seconds or milliseconds** — you declare which. See below |
| `body` | `string \| null` | HTML or plain text. Optional because metadata usually arrives before bodies do |
| `fromName` | `string \| null` | Display name, when known |
| `toAddress` / `ccAddress` | `string \| null` | Comma-separated address lists, as received |
| `toNames` / `ccNames` | `string \| null` | Display names, positionally matching the address list |
| `messageId` | `string \| null` | RFC 5322 `Message-ID`. Used only for de-duplication |
| `attachments` | `Attachment[]` | `{ filename, sizeBytes?, mimeType?, inline? }` |
| `bodyPending` | `boolean` | `true` while the body is still downloading → bubble shows a spinner |
| `bodyFailed` | `boolean` | `true` when the fetch failed for good → bubble shows a retry affordance |
| `isDraft` | `boolean` | Drafts are excluded from the rendered thread |

A typical mapping from a database row:

```ts
const toMail = (row: EmailRow): Mail => ({
  id: row.id,
  messageId: row.message_id,
  fromAddress: row.from_address,
  fromName: row.from_name,
  toAddress: row.to_address,
  ccAddress: row.cc_address,
  date: row.internal_date,          // epoch SECONDS from IMAP → dateUnit: 's'
  body: row.html_body ?? row.text_body,
  attachments: JSON.parse(row.attachments ?? '[]'),
  isDraft: row.is_draft === 1,
});
```

### The one thing to get right: `dateUnit`

IMAP internal dates are usually epoch **seconds**. JavaScript is
**milliseconds**. The library never guesses — you declare it:

```ts
mailsToMessages(mails, { dateUnit: 's' });   // epoch seconds
mailsToMessages(mails, { dateUnit: 'ms' });  // milliseconds (the default)
```

Get it wrong and nothing throws. Every message lands in **January 1970**, the
thread sorts wrongly, and the date separators are quietly nonsense. If your
first render shows 1970, this is why.

### You do not need every body up front

A thread's metadata almost always arrives before its bodies. Send what you have
and mark the rest — the library does **no** transform work on a pending body,
so a 200-message thread renders instantly as headers and spinners and fills in
as bodies stream:

```ts
{ id: '7', fromAddress: 'bob@x.example', date: 1740994800, bodyPending: true }
```

---

## Step 3 — Transform: which function do I call?

Two functions, same signature, same return type. Pick with one question:
**does your store hold every message of the conversation?**

```ts
import { mailsToMessages, threadToMessages } from 'email-chat-view/transform';

const messages = mailsToMessages(mails, { currentUserAddress: 'me@example.com', dateUnit: 's' });
```

| Use | When | What you get |
| --- | --- | --- |
| `mailsToMessages` | you have every message as its own row | **one bubble per mail** |
| `threadToMessages` | threads get forwarded in, joined halfway, or pasted between people | one bubble per mail **plus** a bubble for each message that exists only as quoted text inside another mail |

If you are unsure, start with `mailsToMessages` — it is the simpler mental
model — and move to `threadToMessages` the first time you see a conversation
with holes in it. Nothing else in your code changes.

Both are **pure and synchronous**. They sort oldest-first, drop drafts, resolve
who each message is from, normalize every date to epoch milliseconds, and clean
each body of quoted history, signatures, banners and legal footers.

`currentUserAddress` is what decides which bubbles are "mine" (right-aligned).
Pass an array if the user has several addresses — otherwise their own replies
render as if a stranger sent them.

---

## Step 4 — Render

```tsx
import { MailChatView } from 'email-chat-view';
import 'email-chat-view/style.css';   // once, anywhere in your app

export function Thread({ mails }: { mails: Mail[] }) {
  const messages = mailsToMessages(mails, {
    currentUserAddress: 'me@example.com',
    dateUnit: 's',
  });

  return <MailChatView messages={messages} currentUserAddress="me@example.com" />;
}
```

`messages` is the only required prop. **If you forget the stylesheet the view
still renders** — as unstyled stacked text, which looks broken rather than
missing. That is the single most common first-run surprise.

Useful defaults, so you know what you are getting without reading the whole
props table:

| Prop | Default | Meaning |
| --- | --- | --- |
| `maxRendered` | `50` | bubbles in the DOM at once; the rest sit behind "show earlier" |
| `autoScroll` | `true` | jump to the newest message when it changes |
| `blockRemoteImages` | `true` | remote images are blocked by CSP until you opt in |
| `locale` | the reader's | dates are formatted in the reader's own zone, at render time |
| `senderRunWindowMs` | `5 min` | consecutive messages from one sender inside this window render compact |

Bodies are sanitized (DOMPurify) and rendered inside a sandboxed frame with a
strict CSP, so a hostile mail cannot script your page or phone home.

---

## Step 5 — Add your own buttons

The view ships **no** actions — no star, no menu, no reply button. Those are
your product's, wired to your store. It gives you two slots and positions them:

```tsx
<MailChatView
  messages={messages}
  renderActions={(message) => <StarButton id={message.id} />}   // outer edge of the row
  renderFooter={(message) => <InlineReply id={message.id} />}   // inside, under the body
/>
```

Pass neither and nothing extra renders — just the thread. See
[Per-bubble actions](../README.md#per-bubble-actions-menus-star-reply) in the
README for the picture of where each slot lands.

One gotcha with `threadToMessages`: a **recovered** message (one found inside
someone else's quote) has no mail of its own to act on. Its id is
`<mailId>#<segmentIndex>` and it carries `sourceId` pointing at the mail it came
from. So resolve actions against `message.sourceId ?? message.id`, and return
`null` from `renderActions` when there is nothing to act on.

---

## Framework recipes

### Vite / plain React

Nothing special. Import the CSS anywhere — `main.tsx` is the usual place.

### Next.js (app router)

`MailChatView` uses hooks and effects, so it is a **client** component:

```tsx
'use client';
import { MailChatView } from 'email-chat-view';
```

Import the stylesheet in a layout or in the client component itself:

```tsx
import 'email-chat-view/style.css';
```

Run the transform wherever you like — it is pure and has no DOM requirement of
its own **if** you give it a parser (see the next section). A common split is:
transform on the server (with `linkedom`), send `ChatMessage[]` to the client,
render there.

### Electron renderer

Import from the root as normal. The transform uses the renderer's own
`DOMParser`, so no parser option is needed. If your bundler is Vite and you
upgrade the package in place, see the stale-cache row in
[Troubleshooting](#troubleshooting).

### Backend / worker / cron (no React)

Import only `email-chat-view/transform` and pass a parser. Nothing in that
entry point touches React or the DOM globals.

---

## TypeScript setup

Subpath exports (`email-chat-view/transform`) need a modern module resolution.
If your editor says *"Cannot find module 'email-chat-view/transform' or its
corresponding type declarations"*, this is why:

```jsonc
{
  "compilerOptions": {
    "moduleResolution": "bundler"  // or "node16" / "nodenext"
  }
}
```

The old `"node"` resolution ignores the `exports` map and only finds the
package root. Types ship for both ESM and CJS, so either module format gets
full type information once resolution is right.

---

## No browser? Give it a parser

The transform parses HTML. In a browser it picks up the global `DOMParser` by
itself. Anywhere else — Node, a worker, a test, SSR — pass one:

```ts
import { parseHTML } from 'linkedom';
import { mailsToMessages } from 'email-chat-view/transform';

const parser = (html) => parseHTML(`<html><body>${html}</body></html>`).document;

mailsToMessages(mails, { parser, dateUnit: 's' });
```

**The `<html><body>` wrapper is load-bearing.** Email bodies are fragments, and
linkedom will not hoist a bare fragment into `document.body` the way a browser
does. Without the wrapper nothing throws — every pass just sees an empty
document and hands your input back untouched, so bodies come out with their
signatures and quoted history intact and it looks like the rules are broken.

With no parser and no global `DOMParser` you get `NoDomParserError`, whose
message repeats that snippet. `hasGlobalDomParser()` tells you which
environment you are in.

---

## Before you ship: threads that are big or slow

Three things, all optional, all worth doing before a real mailbox hits your
code:

1. **Pass a cache.** Bodies arrive one at a time, so you call the transform
   again on every arrival. A cache means only the newly-arrived body is
   cleaned instead of all 200:

   ```ts
   const cache = createBodyCache();          // once, outside render
   mailsToMessages(mails, { cache, dateUnit: 's' });
   ```

   `threadToMessages` takes `createSegmentCache()` in the same place and wants
   it more — splitting is the most expensive thing the package does.

2. **Mark pending and failed bodies** (`bodyPending`, `bodyFailed`) instead of
   passing empty strings. A spinner that never resolves is the worst state for
   a reader, because they cannot tell whether to wait.

3. **Wire paging** if threads can be long: `hasOlder`, `onLoadOlder`, and
   `onVisibleRangeChange` so you fetch the bodies that are actually on screen
   first.

### Pass the whole thread, always

A fair worry at this point: *oldest-first — so I have to hand it every mail?*

Yes, and you want to. The transform is pure per message and the cache is keyed
on `(id, body)`, so calling it with all 200 mails after one body arrives cleans
that one message and reuses the other 199. There is no work to save by slicing.

Slicing breaks it unless you say so. The oldest mail in whatever array you pass
is treated as the thread's opener and keeps its quoted history — correct for a
real opener, which has nothing behind it to strip. Hand it page 2 without a word
and that page's first message renders with the whole conversation inside it.
Nothing throws.

```ts
// Page 2: there is no opener in here, so strip every message's quotes.
mailsToMessages(pageTwoMails, { dateUnit: 's', containsThreadStart: false });
```

Paginate the parts that actually cost something:

- **bodies you have not fetched yet** → include the mail with
  `bodyPending: true`. It costs no transform work at all, so the thread opens
  as headers and spinners and fills in.
- **the DOM** → `maxRendered`, plus `hasOlder` / `onLoadOlder` to page upward.

The same rule holds for `threadToMessages`, doubly: it de-duplicates quoted
copies against the real messages across the whole array, so a thread split
across calls gives you duplicate bubbles.

Going one mail at a time — a retry, a single arriving body? `mailToMessage`
transforms one mail and takes `isOldest` directly, so set it `true` only for the
thread's genuine first message. Concatenate in date order afterwards.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Text renders but looks unstyled | stylesheet never imported | `import 'email-chat-view/style.css'` |
| Every message dated **1970** | `date` is in seconds, transform assumed ms | pass `dateUnit: 's'` |
| Dates thousands of years in the future | the opposite — ms values with `dateUnit: 's'` | drop the option (`'ms'` is the default) |
| `NoDomParserError` | no DOM and no `parser` | pass `linkedom` (see above) |
| Signatures/quotes NOT stripped in Node | the `<html><body>` wrapper is missing | wrap the fragment |
| One bubble contains the whole conversation | you passed a page, not the thread — its first mail was treated as the opener and kept its quotes | pass every mail you have, or `containsThreadStart: false` for a real page |
| Duplicate bubbles from `threadToMessages` | de-duplication only sees the array you pass | pass the whole thread in one call |
| `ReferenceError: document is not defined` | the **view** rendered during SSR | mark the component `'use client'`, or render it in an effect |
| My own replies appear left-aligned | `currentUserAddress` missing or a different alias | pass every address the user sends from |
| Cannot find module `email-chat-view/transform` (types) | old `moduleResolution` | set `"bundler"` / `"node16"` |
| `does not provide an export named 'X'` after an upgrade | your bundler's pre-bundled dep cache is stale — Vite keys it on the lockfile, so a hand-copied `dist/` does not invalidate it | delete `node_modules/.vite` (or run with `--force`) and restart the dev server |
| Remote images do not load | `blockRemoteImages` defaults to `true` | pass `blockRemoteImages={false}` once you have decided that is safe |
| Part of a message vanished | a rule matched real content | see [Why part of my email disappeared](../README.md#why-part-of-my-email-disappeared) — `message.applied` names the rule that cut it |

Every removal is attributable: `message.applied` is an array of rule names such
as `['signature:gmail', 'quote:outlook']`. If content disappeared, log that
array first — it tells you which rule to turn off or narrow.

---

## Integration checklist

- [ ] Rows mapped to `Mail[]`, with `id`, `fromAddress`, `date`
- [ ] `dateUnit` matches what your store holds (check one rendered date)
- [ ] `currentUserAddress` covers every alias the user sends from
- [ ] `mailsToMessages` vs `threadToMessages` chosen deliberately
- [ ] Stylesheet imported once
- [ ] A parser passed anywhere that is not a browser
- [ ] `bodyPending` / `bodyFailed` set instead of empty bodies
- [ ] A cache created outside render
- [ ] `renderActions` / `renderFooter` returning `null` when there is nothing to act on
- [ ] Checked `message.applied` on a real thread to see what the rules removed

---

Something here wrong, missing, or harder than it should be?
[Open an issue](https://github.com/Sarv/email-chat-view/issues) — a confusing
integration is a bug in this document.
