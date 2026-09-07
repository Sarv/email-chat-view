# Examples

Three, covering the three ways this package gets used. The first two run from a
clone; the third is reference code to copy into an app.

```sh
pnpm install
pnpm build            # the runnable examples import ../../dist
```

| Example | What it shows | Run it |
| --- | --- | --- |
| [`node-transform/thread-to-chat.mjs`](./node-transform/thread-to-chat.mjs) | a thread → chat messages in Node: injected parser, `dateUnit`, the body cache, a still-downloading body | `node examples/node-transform/thread-to-chat.mjs` |
| [`custom-rules/acme-signature.mjs`](./custom-rules/acme-signature.mjs) | adding a rule for a client we do not know, adding a German marker, and dropping a shipped rule that is too loose | `node examples/custom-rules/acme-signature.mjs` |
| [`react-thread/MailThread.tsx`](./react-thread/MailThread.tsx) | the view wired the way a mail client actually loads a thread: streaming bodies, visible-range prioritisation, upward paging, host-owned side effects | copy into your app |

The two runnable files import from `../../dist` so they work straight from a
checkout. **In your own app the import is the package specifier:**

```js
import { mailsToMessages } from '@sarv-in/email-chat-view/transform';   // no React
import { MailChatView } from '@sarv-in/email-chat-view';                // the view
import '@sarv-in/email-chat-view/style.css';
```

Expected output from `node-transform`, abbreviated — note the `applied` line,
which names every rule that removed something:

```text
[3/3/2025, 2:30:00 pm] Alice Chen
  <p>Hi — are we still on for Tuesday?</p>

[3/3/2025, 3:10:00 pm] me
  <div>Yes, 10am works.</div>
  applied: signature:gmail, quote:gmail, disclaimer:english-corporate

[3/3/2025, 4:10:00 pm] alice@acme.example
  (body still downloading)
```

## Adding an example

Same bar as the rest of the repo: it has to run, and the comments have to say
*why* a line is there rather than what it does — the `<html><body>` wrapper, the
cache living outside render, and `dateUnit` are all in these files because each
one is a bug somebody has already shipped. Keep sample addresses on
`example`/`acme.example` and never commit a real message.

A TypeScript example is type-checked with the rest of the repo — `pnpm
type-check` includes `examples/`, and `@sarv-in/email-chat-view` resolves back to `src/`
through `paths`, so the file can import the package by its real specifier and
still be verified. A `.mjs` example is not checked (it imports the built
`dist/`), so run it after `pnpm build` before you push.

See [../CONTRIBUTING.md](../CONTRIBUTING.md) for the rest.
