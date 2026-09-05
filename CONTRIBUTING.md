# Contributing to email-chat-view

Thanks for being here. This package strips parts of people's email away before
anyone reads it, so the bar for a change is "prove it on markup a real client
produced" rather than "it looks right" — but the surface you have to touch to
contribute is deliberately tiny. Most contributions are **one plain object and
one test case**, and never open the engine at all.

- **npm:** <https://www.npmjs.com/package/email-chat-view>
- **Source:** <https://github.com/Sarv/email-chat-view>
- **Issues:** <https://github.com/Sarv/email-chat-view/issues>

---

## Contents

- [What helps most](#what-helps-most)
- [Getting set up](#getting-set-up)
- [Examples](#examples)
- [The map](#the-map) — what every file is for
- [How a body is cleaned](#how-a-body-is-cleaned)
- [Adding a rule](#adding-a-rule)
- [README media](#readme-media) — regenerating the GIF and screenshots
- [Working on the view](#working-on-the-view)
- [Tests](#tests)
- [Code style](#code-style)
- [Commits and pull requests](#commits-and-pull-requests)
- [Releasing](#releasing)
- [Reporting bugs](#reporting-bugs)

---

## What helps most

In rough order of value:

1. **A non-English marker rule.** Every rule in `src/rules/marker.ts` is
   English. Gmail, Outlook and Apple Mail all localize `On … wrote:`, so a
   German, French, Spanish, Hindi or Japanese reply currently keeps its entire
   quoted history in the bubble. If you have real mail in a language we do not
   cover, that is the single highest-value patch this package can take.
2. **A provider we do not know.** A signature or quote container from a client
   nobody here has seen — regional webmail, an in-house client, a newer Outlook
   build.
3. **A misfire.** A rule that removes something a person actually wrote. Those
   are worse than a rule that misses, and they get fixed first.
4. **An ESP or an automated-mail signal** for `src/classify/signals.ts`.
5. **Docs.** If a paragraph in the README sent you the wrong way, say so — it
   sent someone else the wrong way too.

You do not need to ask before opening a PR for any of the above. For anything
that changes the public API or adds a dependency, open an issue first so the
discussion happens before you write the code.

---

## Getting set up

Node 18+ and pnpm 8 (the version is pinned in `packageManager`, so
`corepack enable` gives you the right one automatically).

```sh
git clone https://github.com/Sarv/email-chat-view.git
cd email-chat-view
pnpm install
pnpm test
```

| Script | What it does |
| --- | --- |
| `pnpm test` | Vitest, once. Node environment, linkedom injected |
| `pnpm test:watch` | the same, watching |
| `pnpm test:coverage` | coverage, **enforced at 100%** lines/branches/functions/statements |
| `pnpm type-check` | `tsc --noEmit` over `src`, `test` **and** `examples` |
| `pnpm build` | tsup → ESM + CJS + `.d.ts`/`.d.cts` + `dist/style.css` |
| `pnpm dev` | build in watch mode |
| `pnpm clean` | remove `dist/` |
| `pnpm media` | rebuild, then regenerate the README GIF and screenshots — see [README media](#readme-media) |

CI runs `type-check`, `test:coverage` and `build` on Ubuntu, macOS and Windows
against Node 18, 20 and 22 — coverage rather than a plain test run, because the
100% thresholds only bite when the coverage reporter runs. Run those three
locally before pushing and there should be no surprises.

To try a change inside a real app, point the app at your checkout:

```sh
pnpm add file:../email-chat-view    # in the consuming app
pnpm dev                            # in this repo, so dist/ rebuilds as you edit
```

---

## Examples

[`examples/`](./examples) holds three: the Node transform, a custom rule set, and
the React view wired like a real client. Two of them run from a clone
(`pnpm build && node examples/node-transform/thread-to-chat.mjs`), and they are
the fastest way to see a change you made actually behave.

If your change alters the public surface, update the example that uses it — an
example that no longer compiles is worse than no example, because it is the
first thing people copy. **`pnpm type-check` covers `examples/` too**, so a
change that breaks the React example fails CI rather than being found by the
next person who copies it. The example imports `email-chat-view` by its
published specifier, mapped back to `src/` by `paths` in `tsconfig.json`, so
what is checked is exactly what a consumer would paste.

The `.mjs` examples are deliberately outside that check (no `allowJs`): they
import the BUILT `dist/`, which does not exist when `type-check` runs. Run them
by hand after `pnpm build` when you touch what they use.

---

## The map

Three layers, and the boundaries between them are the whole design: the
transform must not need React, the view must not need to know what a mail is,
and the provider conventions must be data rather than code.

### Entry points

| File | What it is for |
| --- | --- |
| `src/index.ts` | package root. Re-exports transform + view, nothing else |
| `src/transform.ts` | the `email-chat-view/transform` entry — everything reachable from here is React-free and DOM-injectable, which is what makes a Node pipeline possible |
| `src/view.ts` | the React entry. Components plus the pure UI helpers, exported individually so a host with its own list can use the parts |
| `src/types.ts` | the public data contract: `Mail` (what a mail store gives you) and `ChatMessage` (one bubble's worth of resolved content). The gap between those two shapes is what the transform closes |
| `src/dom.ts` | `resolveParser`, `hasGlobalDomParser`, `NoDomParserError`. The parser is injected rather than assumed so the same code runs in a browser, in Node and in the suite |

### `src/rules/` — provider conventions, as data

Adding a provider should be a five-line object reviewable by someone who has
never read an engine. That is why these are separate from `src/transform/`.

| File | Contains |
| --- | --- |
| `rules/types.ts` | the three rule contracts: `DomRule`, `MarkerRule`, `DisclaimerRule`. Read this first |
| `rules/signature.ts` | signature containers — Gmail, Apple Mail, Thunderbird, Outlook mobile/desktop, a guarded generic |
| `rules/quote.ts` | quoted-history containers — `.gmail_quote`, `blockquote[type=cite]`, Thunderbird, Outlook classic and OWA, a bare-`<blockquote>` catch-all |
| `rules/marker.ts` | prose boundaries — `On … wrote:`, forwarded banners, `-----Original Message-----`, the Outlook `From:/Sent:/To:` block. **All English today** |
| `rules/disclaimer.ts` | trailing legal boilerplate, matched on weighted evidence rather than one phrase |

### `src/transform/` — the engines

| File | Owns |
| --- | --- |
| `transform/apply-dom-rules.ts` | runs `DomRule`s over a parsed tree: selector match, `maxTextLength` guard, `test` veto, `boundary` sibling removal |
| `transform/apply-marker-rules.ts` | truncates the serialized HTML at the **earliest** match across all marker rules, so rule order can never change another rule's result |
| `transform/apply-disclaimer-rules.ts` | the two disclaimer strategies — after an `<hr>`, and the trailing-block walk |
| `transform/node-utils.ts` | `normalizedText`, `meaningfulChildren`, `safeMatches`, `safeQueryAll` … the shared answer to "which children actually count?". Every pass uses these so they cannot drift apart |
| `transform/strip.ts` | the public strip API. `cleanReplyBody` parses **once** and hands the same tree to every DOM pass |
| `transform/mails-to-messages.ts` | `Mail[]` → `ChatMessage[]`: sort, drop drafts, resolve sender, normalize dates, clean bodies, and the LRU body cache keyed on `(id, body)` |

### `src/classify/`

| File | Owns |
| --- | --- |
| `classify/signals.ts` | the weighted signal registry — headers, ESP `Message-ID` domains, tracking pixels, unrendered merge tags |
| `classify/classify-mail.ts` | the engine: normalize the input once, sum weights, compare to the threshold. Adding a signal never touches this file |

### `src/ui/` — pure view logic, no JSX

Kept out of the components so the interesting decisions are testable without
rendering anything.

| File | Owns |
| --- | --- |
| `ui/dates.ts` | timestamps through `Intl`, in the reader's locale and zone. No date library, no format strings |
| `ui/grouping.ts` | day groups (date separators) and sender runs |
| `ui/recipients.ts` | who a message is from and to, parsed with the `email-addresses` RFC 5322 grammar rather than a comma split |
| `ui/sender-colors.ts` | a stable per-participant colour, hue-rotated when two participants in one thread would clash |
| `ui/body-shape.ts` | inline text vs. real document — decides whether a body renders in the bubble or in a frame |
| `ui/sanitize.ts` | the two DOMPurify policies: a narrow inline allowlist, and the wider frame policy |
| `ui/frame.ts` | the sandboxed frame — its CSP, its document, its height measurement, its link interception |
| `ui/attachments.ts` | chip text and which types offer a preview |
| `ui/labels.ts` | every string the view can render, overridable by the host |

### `src/components/`

| File | Owns |
| --- | --- |
| `components/MailChatView.tsx` | the composed thread: separators, runs, colours, scroll anchoring, the DOM ceiling, visible-range reporting |
| `components/ChatBubble.tsx` | one message. Exported on its own for hosts with their own list |
| `components/MessageBody.tsx` | the five body states — content, pending, failed, empty, quoted-only |
| `components/SandboxedBody.tsx` | the iframe wiring for a rich body |
| `components/AttachmentChip.tsx` | one attachment chip; reports clicks, never fetches |
| `components/Avatar.tsx`, `DateSeparator.tsx`, `ChatSkeleton.tsx`, `Tooltip.tsx`, `icons.tsx` | the primitives. Icons are traced inline rather than imported from a library |

### Everything else

| Path | What it is |
| --- | --- |
| `src/styles/index.css` | the `--sec-*` token layer, compiled to `dist/style.css` |
| `test/` | one file per module, mirroring `src/`; `test/helpers/` holds the linkedom parser, message fixtures and observer stubs |
| `examples/` | runnable Node examples and a React reference integration, type-checked with the rest — see [Examples](#examples) |
| `scripts/media/` | the README media generator: `thread.mjs` is the demo thread, `render.mjs` renders and screenshots it — see [README media](#readme-media) |
| `docs/media/` | the generated GIF and screenshots the README links to, plus the Sarv lockup used to watermark them |
| `tsup.config.ts` | the build: two JS entries plus a CSS entry, ESM + CJS + types |
| `vitest.config.ts` | Node environment by default, coverage thresholds |
| `.github/workflows/ci.yml` | type-check, test **with coverage thresholds**, build — on every push and PR |
| `.github/workflows/publish.yml` | publish to npm on a `v*` tag, with provenance |

Every source file opens with a docblock stating the decision it encodes and the
bug that decision prevents. If you are about to change a file, that docblock is
the argument you have to answer — and if you change the behaviour, update it.

---

## How a body is cleaned

`cleanReplyBody` runs four passes in a fixed order:

```text
signature rules  →  quote rules  →  marker rules  →  disclaimer rules
   (selector)       (selector)      (regex cut)      (weighted evidence)
```

The order is load-bearing. The disclaimer pass is the only one that reasons
about the *trailing edge* of a message, so it has to run after the marker pass
has cut the plain-text history off the end — otherwise the footer sits buried
mid-document where the trailing-block walk never looks.

Every rule that actually removed something is reported in
`ChatMessage.applied` as `family:name`. Nothing is ever removed silently.

Two invariants to preserve in any change:

- **Degrade toward removing less.** Leftover boilerplate is cosmetic; a deleted
  paragraph is the sender's words. Where a rule is uncertain, it should not fire.
- **Never let a rule break the render.** An unparseable selector degrades to
  "matched nothing", a throwing `test` vetoes its match, a throwing signal is
  skipped.

---

## Adding a rule

The anatomy of all four rule kinds — with a worked example of each — is in the
README under [Writing your own rule][writing]. This section is what is different
when the rule is going upstream rather than into your own app.

[writing]: ./README.md#writing-your-own-rule

**1. Put it in the right file, and export it.** `src/rules/signature.ts`,
`quote.ts`, `marker.ts` or `disclaimer.ts`. Export the rule on its own *and* add
it to the default array — the individual export is what lets a consumer drop or
reorder it without forking.

**2. Name it after the provider, not the markup.** `outlook-mobile`, not
`div-id-signature`. The name is what shows up in someone's `applied` array when
they are trying to work out what ate their text, and `provider` should say which
client and roughly which version emits it.

**3. Test it against markup a real client produced.** Send yourself a mail from
the client, then "show original" / "view source" and paste the actual body into
the test — do not type an idealized version. Real clients HTML-escape addresses
as `&lt;bob@x.com&gt;`, wrap boundaries in `<div>`s, and emit attributes in
whatever order they feel like. A marker pattern written against `<bob@x.com>`
matches your fixture and nothing else in the world.

Strip anything private from the sample before committing it: real addresses,
names, subjects, message IDs. `alice@acme.example` and `bob@acme.example` are
the placeholders used throughout the suite.

**4. Add the case to the existing table.** Most rule tests are `it.each` tables
in `test/strip.test.ts` — one row is usually the whole patch:

```ts
['Acme Mail', '<div class="acme-sig">Regards</div>', 'acme'],
```

Then add the negative case that proves it is narrow enough: a message that
*looks* like it should match and must not. A rule with only a positive test is a
rule nobody can safely tighten later.

**5. Bound every quantifier.** `[^<]{4,200}`, `[\s\S]{0,2000}?` — never
`[\s\S]*?`. Mail bodies are the most hostile input a client ever sees, and an
unbounded quantifier on a 5 MB marketing email is a ReDoS.

**6. Guard the loose ones.** If a selector could match a wrapper rather than the
block you mean, set `maxTextLength`. `div[id*="signature" i]` matches Outlook's
entire reply wrapper on some mail; unguarded it deletes the whole message.

---

## README media

The GIF and the two screenshots in the README are generated, not drawn:

```sh
pnpm media          # builds, then writes docs/media/*.gif and *.png
```

`scripts/media/render.mjs` renders the real `MailChatView` from `dist/` with the
shipped `dist/style.css`, fed by the real transform, and puts the untouched
`mails` array beside it as the "before" side. The rule labels in the animation
are read out of `message.applied`, so the picture cannot claim a rule that did
not fire. Change a bubble and the picture changes with it — which is the whole
reason it is not a mockup.

Regenerate it when the view's appearance changes, and commit the outputs: the
README points at `raw.githubusercontent.com` so the images render on npmjs.com
too, and npm serves the README from the published tarball, not from GitHub.

It needs Google Chrome and `ffmpeg` locally, and two things about the capture are
deliberate: headless Chrome inherits the machine's light/dark appearance, so the
run forces `preferredColorScheme=1` — otherwise a contributor on a dark-mode Mac
regenerates the media with dark-mode ink on the light demo panel. And Chrome
writes the PNG without always exiting, so each screenshot is polled for and the
process killed rather than waited on.

The demo thread lives in `scripts/media/thread.mjs`. Every address is on a
reserved `.example` domain; never point it at a real message or a real mailbox.

## Working on the view

- **Never hard-code a colour, radius, spacing or font.** Every value is a
  `--sec-*` variable in `src/styles/index.css`, and every one of those resolves
  through the host's own token first (`--sec-brand: var(--brand, #3069b0)`). A
  literal hex in a component is a bug.
- **Class names stay `sec-` prefixed** so they cannot collide with the host app's.
- **No new runtime dependency for something small.** The icons are traced inline
  and the tooltip is forty lines for exactly this reason: a component library
  that imports an icon set forces that choice on every consumer.
- **The host owns every side effect.** Opening a link, fetching a body, saving
  an attachment — all callbacks. A component that reached for `window.open` or
  an Electron IPC channel would work in exactly one application.
- **Keep the logic out of the JSX.** If a component is deciding something —
  which colour, which day label, which body shape — that decision belongs in
  `src/ui/` as a pure function with its own test.
- **Accessibility is part of the change**, not a follow-up: a separator gets an
  accessible name, an interactive element is reachable by keyboard, an icon-only
  control has a label.

---

## Tests

```sh
pnpm test:coverage
```

**Coverage is enforced at 100%** — lines, branches, functions and statements —
and CI fails below it. That is not a vanity number: every rule in here can
silently delete part of somebody's email, so an untested branch is a branch
nobody has checked cannot eat a paragraph.

Conventions the suite follows, and PRs are expected to follow:

- **Each test carries a one-line comment naming the regression it prevents.** A
  test whose purpose is not stated gets deleted by someone later as redundant,
  and the protection goes with it.
- **The default environment is `node`, with linkedom injected explicitly**
  (`test/helpers/parser.ts`). No ambient DOM: that is what proves the
  server-side story works, and it makes any code that quietly reaches for a
  global `DOMParser` fail in the suite rather than in someone's Node process.
- **Component tests opt into jsdom per file** with a
  `// @vitest-environment jsdom` docblock on line 1 — per file rather than by
  glob, so a transform test can never quietly start depending on a browser DOM.
- **Dates in fixtures are built with the local-time `Date` constructor**, never
  a UTC millisecond literal. Every date decision in the view is about the
  reader's calendar day, so a fixture pinned to an instant passes in London and
  fails in Auckland.
- Reusable fixtures and stubs live in `test/helpers/`. Add to those rather than
  re-declaring a message shape in a new file.

---

## Code style

There is no linter in the repo; match the surrounding code, which is consistent:

- **TypeScript, ESM, `.js` extensions on relative imports** (`./labels.js`) —
  required for the emitted ESM to resolve.
- `const`/`let`, `async`/`await`, no callbacks, template literals, `?.`/`??`.
- **Pure functions, no mutated module state, side effects at the edges.**
  Anything that is not a React component should be callable twice with the same
  input and give the same answer.
- camelCase for values, PascalCase for components and types,
  UPPER_SNAKE_CASE for true constants.
- **Comments explain *why*, not *what*.** The house style is a file-level
  docblock stating the decision and the bug it prevents, and inline comments
  only where the code would otherwise read as arbitrary. Match the density
  around you.
- Prefer a well-maintained library over hand-rolling a solved problem — the
  address grammar and the byte formatter are both libraries for that reason —
  but check the bundle cost, and note that anything ESM-only has to be bundled
  in `tsup.config.ts` or it breaks the CJS build.

---

## Commits and pull requests

Commit messages are **single-line** conventional commits:

```text
<type>(<scope>): <subject>
```

- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.
- Subject in present-tense imperative — "add", not "added".
- Scope is optional; use it when the change is scoped to one module.

```text
feat(rules): add German wrote-attribution marker
fix(disclaimer): stop the hr strategy eating a trailing signature
test(frame): cover the height-measurement retry
```

Prefer several small, logically grouped commits over one large one — a rule and
its test together, docs on their own.

For the PR itself:

1. Branch off `main`.
2. `pnpm type-check && pnpm test:coverage && pnpm build` all green.
3. In the description, say **what mail this was tested against** — which client,
   which language, whether the sample was real. For a rule, paste the before and
   after of one body.
4. Note anything you deliberately did not handle. A known gap stated in the PR
   is worth more than a rule that quietly half-works.

Do not bump the version or edit `dist/` in a PR — releases are cut separately
and `dist/` is generated and git-ignored.

---

## Releasing

Maintainers only, and fully automated: pushing a `v*` tag builds and publishes
to npm with provenance. The tag is the source of truth — the workflow writes
that version into `package.json` itself, so there is nothing to remember to bump
first and no manual `npm publish`.

```sh
git tag v0.1.0
git push --tags
```

It rejects a non-semver tag up front, then runs `type-check`, the suite and
`build` before anything leaves the building. Full detail — including the
one-time `NPM_TOKEN` setup on a fork — is in the README under
[Releasing](./README.md#releasing).

---

## Reporting bugs

For a rule that removed something it should not have, or left something it
should have taken, include:

- the **`applied` array** from the affected message — it names the rule;
- the **client and version** the mail was sent from;
- a **minimal HTML body** that reproduces it, with private details replaced;
- what you expected the bubble to show.

That is usually enough to turn a report straight into a failing test.

Please report anything security-relevant — a sanitizer bypass, a way out of the
sandboxed frame, a ReDoS in a rule pattern — privately to the maintainers rather
than in a public issue, so a fix can ship before the details are public.

---

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE), the same as the rest of the project.
