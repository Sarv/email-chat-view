# Changelog

What changed in each release of `@sarv-in/email-chat-view`, for a host
upgrading. This file starts at 0.2.7; for an earlier release, read the commits
between its tag and the one before it (`git log v0.2.5..v0.2.6`, say).

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

[0.2.7]: https://github.com/Sarv/email-chat-view/compare/v0.2.6...v0.2.7
