# Changelog

What changed in each release of `@sarv-in/email-chat-view`, for a host
upgrading. This file starts at 0.2.7; for an earlier release, read the commits
between its tag and the one before it (`git log v0.2.5..v0.2.6`, say).

## [Unreleased]

### Added

- **Plain text bodies: `bodyFormat: 'html' | 'text'`** on `mailsToMessages`,
  `mailToMessage` and `threadToMessages`. `'html'` (rich text) is the default
  and changes nothing. `'text'` returns the same cleaned body as readable plain
  text — line breaks, list bullets and `<pre>` kept, styles and images dropped —
  for a host that draws its own bubbles, a notification or a search snippet.
  It is derived from the cleaned HTML, so quoted history and signatures stay
  gone, and it is memoized in the existing body and segment caches.
- **`htmlToPlainText(html, parser?)`**, the conversion `'text'` uses, for a
  string you already hold.
- **`parseRawMail(raw, options?)`** reads a whole raw message — an `.eml` file,
  an IMAP `BODY[]` fetch, a Gmail `format=raw` payload — from a string,
  `ArrayBuffer`, `Uint8Array` or `Blob`/`File`, and returns a `Mail` for any of
  the transforms. Headers, charsets, attachments and their sizes are mapped;
  `cid:` images are inlined as `data:` URIs unless `inlineImages: false`; a mail
  with no `Date` header is dated from its `Received` header, and one with
  neither is `NaN` (an unknown date), never 1970. A web client such as
  SarvInbox can now render a dropped `.eml` or IMAP source without its own
  MIME code. MIME decoding is done by the new `postal-mime` dependency.
- **`EmailChatCore` for iOS and Android: the transform as data, no WebView.**
  For apps that build the chat UI natively. It runs the same transform in
  JavaScriptCore (iOS) or a sandboxed V8 isolate (Android, API 26+, check
  `EmailChatCore.isSupported()`) and returns typed `ChatMessage` values in
  rich or plain text, and parses raw `.eml` bytes into `Mail`. The Android
  library's `minSdk` stays 24; the view still works there. See
  [mobile/README.md](mobile/README.md#data-only-emailchatcore).

### Changed

- **The Swift package now supports iOS 15 and macOS 12** (it required iOS 16.2
  and macOS 13.1). Safari before 16.2 has no `color-mix()`, which the view
  used for two colours: a designed mail's page now prints on the plain surface
  there instead of turning transparent over the sender's tint, and the wash
  that softens a sender's coloured table cells is written as `rgba()`, which
  every browser reads. Nothing changes on newer browsers.
- The mobile README now lists each platform minimum, the reason for it, and
  what would have to change to go lower.
- The README has a "How it works" section with diagrams of the paths from raw
  mail or stored rows to a rendered bubble.

## [0.3.0]

### Added

- **iOS and Android packages.** The chat view in native apps, inside a WebView
  that loads one bundled page built from this source: a Swift package
  (`EmailChatThread` for SwiftUI, `EmailChatWebView` for UIKit) and an Android
  library on JitPack (`EmailChatView`). Typed `Mail` in, typed events out (link
  tapped, retry, attachment, load older, visible mails). See
  [mobile/README.md](mobile/README.md).

### Changed

- One version tag now releases npm, the Swift package and the JitPack library
  together, and a tag is refused if the committed mobile page is stale.

## [0.2.7]

### Added

- **`onLoadRemoteImages(message)`** on `MailChatView`, `ChatBubble` and
  `MessageBody` (and `onFrameLoadImages()`, without the message, on
  `SandboxedBody`). It fires when the reader clicks a bubble's "Load images"
  banner, after that bubble's own images have been let through, so a host can
  remember the sender and answer `blockRemoteImages` differently for their other
  bubbles and their future mail. Until now the banner told nobody: the one
  bubble loaded, and a host with a per-sender allowlist never learned of the
  click. Remembering has to re-render the view for the other bubbles to load:
  the predicate is only asked again when `MailChatView` renders, and the view
  does not watch the host's list. The callback is read at click time, so an
  inline arrow function never rebuilds a frame. Without it the banner behaves
  exactly as before.

### Changed

- **A follow-up in a sender run now has a slim header** with its own time,
  followed by the host's `renderHeaderMeta` marks — no avatar, name or
  recipients. It used to have no header at all, and when the host rendered a
  mark (a security shield), that mark sat alone on a row above the bubble with
  no time, which read as a broken message — most visibly when someone sends the
  same message twice. The time is the same `<time>` element a full header
  renders (UTC `dateTime`, full-date tooltip, `~` for an inferred date). A
  follow-up with no readable date and no marks still renders no header.
- The follower's header class is now `.sec-head.sec-head--run` (it was
  `.sec-head.sec-head--meta-only`, and only when there were marks). A host that
  styled `.sec-head--meta-only` should move the rule to `.sec-head--run`. Its
  row is centred rather than on a baseline, so the time sits level with a
  host's icon.
- `CHANGELOG.md` now ships in the npm package.

[Unreleased]: https://github.com/Sarv/email-chat-view/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Sarv/email-chat-view/compare/v0.2.7...v0.3.0
[0.2.7]: https://github.com/Sarv/email-chat-view/compare/v0.2.6...v0.2.7
