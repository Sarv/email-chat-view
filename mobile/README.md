# email-chat-view on iOS and Android

The chat view from this package, in a native app. It is not a port. The
transform, the React view and the stylesheet are the ones the npm package
ships, bundled into one HTML page that a `WKWebView` (iOS) or `WebView`
(Android) loads from the app bundle, with no network. A thin native wrapper on
each platform gives you typed models in and typed events out.

```
src/ (TypeScript)
  └─ pnpm build:mobile ─▶ email-chat-view.html  (React + view + transform + CSS, one file)
                            ├─ iOS      Swift package   EmailChatThread / EmailChatWebView
                            └─ Android  library module  EmailChatView
```

So a rule fix or a bubble change reaches web, iOS and Android together, and
there is no Swift or Kotlin reimplementation to keep in step.

## The model

- **In:** a `ThreadState`, sent whole on every change: the mails, the reader's
  address, paging flags, tokens. Nothing is patched. Change your mails and render
  again. Bodies the page has already cleaned are cached by content, so
  re-sending a thread costs almost nothing.
- **Out:** `ChatEvent`s. Every event names a **mail id**, never a bubble. One
  bottom-quoted mail can become several bubbles, and your app only knows the mails
  it fetched.

| Event | When | What the app does |
| --- | --- | --- |
| `openLink(url)` | a link in a message is tapped | open it (browser, in-app tab) |
| `visibleRange(mailIds)` | the visible bubbles change | fetch those bodies first |
| `loadOlder` | the top is reached while `hasOlder` | fetch older mails, render again |
| `retryBody(mailId)` | retry tapped on a failed body | refetch, render again |
| `previewAttachment(attachment, mailId)` | eye icon on an attachment | show a preview |
| `downloadAttachment(attachment, mailId)` | download icon | download it |

Bodies can arrive later. Send a mail with `bodyPending = true` and no body, and
its bubble shows a spinner until you render it again with the body.

## Integrating it, step by step

The same five steps on both platforms. The code for each platform follows.

1. **Add the dependency.** Swift Package Manager on iOS, JitPack on Android.
   Use the same version on both, so both apps ship the same page.
2. **Map your mail model to `Mail`.** One `Mail` per message in the thread,
   oldest first: `id` (any id that is stable for that message), `fromAddress`,
   `date`, and the HTML `body`. Add `fromName`, `toAddress`/`toNames`, `ccAddress`/`ccNames`,
   `messageId` and `attachments` when you have them. Do not pre-clean the HTML.
   Stripping quotes, signatures and tracking is the library's job.
3. **Build a `ThreadState` and render it.** Set `currentUserAddress` to every
   address the reader sends from, so their own messages show as "mine". Render
   again whenever anything changes: a body arrives, older mails load, paging
   flags flip. Always send the whole thread. Nothing is patched.
4. **Handle the events.** At minimum, `openLink` (nothing opens without it)
   and `visibleRange` (fetch those bodies). Add `loadOlder` if you page, and
   the attachment events if you show attachments. See the table above.
5. **Theme it (optional).** Pass `tokens` for brand colours and `labels` for
   translated strings. Dark mode needs nothing.

Bodies can be lazy. Send a mail with `bodyPending = true` and no `body`, fetch
it when `visibleRange` names its id, then render again with the body. If the
fetch fails, set `bodyFailed = true`. The bubble then offers retry, which comes
back as `retryBody`.

Checklist before you ship:

- [ ] Links open: `openLink` is handled. The view never navigates itself.
- [ ] Your own messages are on the right: `currentUserAddress` is set.
- [ ] Older mail loads: `hasOlder` and `loadingOlder` are set, and `loadOlder` is handled.
- [ ] Android: the view is destroyed with its screen (`destroy()`, or `onRelease` in Compose).
- [ ] Android release build: run it once minified and tap a link. If links do
      nothing, R8 stripped the bridge (see below).

## iOS (Swift)

Requires iOS 16.2+ (macOS 13.1+ also works).

**Install.** In Xcode, choose **File → Add Package Dependencies…**. Enter
`https://github.com/Sarv/email-chat-view.git`, choose **Up to Next Major
Version** from `0.3.0`, and add the `EmailChatView` library to your app target.
In a `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/Sarv/email-chat-view.git", from: "0.3.0"),
],
targets: [
    .target(name: "App", dependencies: [
        .product(name: "EmailChatView", package: "email-chat-view"),
    ]),
]
```

The package resolves straight from the git tag. The page is a bundled
resource, so there is nothing to download at run time and no Info.plist entry
to add.

**Map your model:**

```swift
import EmailChatView

extension Mail {
    init(_ message: StoredMessage) {          // StoredMessage: your own type
        self.init(
            id: message.uid,
            fromAddress: message.from.address,
            date: message.date,
            fromName: message.from.name,
            toAddress: message.to.map(\.address).joined(separator: ", "),
            body: message.html,                  // nil until fetched
            attachments: message.files.map {
                Attachment(filename: $0.name, sizeBytes: $0.size, mimeType: $0.type)
            },
            bodyPending: message.html == nil
        )
    }
}
```

SwiftUI:

```swift
import EmailChatView

struct ThreadScreen: View {
    @ObservedObject var store: ThreadStore
    @Environment(\.openURL) private var openURL

    var body: some View {
        EmailChatThread(
            state: ThreadState(
                mails: store.mails,              // [Mail]; `date` is a Date
                currentUserAddress: [store.me],
                hasOlder: store.hasOlder,
                loadingOlder: store.loadingOlder
            )
        ) { event in
            switch event {
            case .openLink(let url): openURL(url)
            case .visibleRange(let ids): store.fetchBodies(ids)
            case .loadOlder: store.loadOlder()
            case .retryBody(let id): store.fetchBodies([id])
            case .previewAttachment(let file, let id): store.preview(file, in: id)
            case .downloadAttachment(let file, let id): store.download(file, in: id)
            case .ready: break
            }
        }
        .ignoresSafeArea(edges: .bottom)
    }
}
```

UIKit: `EmailChatWebView` is a `UIView`. Set `onEvent`, call `render(_:)`.

## Android (Kotlin)

Requires minSdk 24 and a system WebView based on Chromium 111+. The WebView
updates through the Play Store, so this is nearly every device in use.

**Install.** The library is published on JitPack from each release tag. Add
the repository in `settings.gradle.kts`:

```kotlin
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        maven("https://jitpack.io")
    }
}
```

Then add the dependency in the app module's `build.gradle.kts`. The version is
the git tag, `v` included:

```kotlin
dependencies {
    implementation("com.github.Sarv:email-chat-view:v0.3.0")
}
```

The AAR carries the page as an asset and its own R8 rule. You add no
permissions: the page loads from the APK and makes no network requests.

To work against an unreleased checkout instead, include the module from source:

```kotlin
// settings.gradle.kts
include(":emailchatview")
project(":emailchatview").projectDir = file("../email-chat-view/mobile/android/emailchatview")
// app/build.gradle.kts
implementation(project(":emailchatview"))
```

**Map your model:**

```kotlin
import com.sarv.emailchatview.Attachment
import com.sarv.emailchatview.Mail

fun StoredMessage.toMail() = Mail(          // StoredMessage: your own type
    id = uid,
    fromAddress = from.address,
    fromName = from.name,
    toAddress = to.joinToString(", ") { it.address },
    dateMillis = date.toEpochMilli(),
    body = html,                            // null until fetched
    attachments = files.map { Attachment(it.name, it.size, it.type) },
    bodyPending = html == null,
)
```

Jetpack Compose:

```kotlin
@Composable
fun ThreadScreen(store: ThreadStore) {
    val context = LocalContext.current
    AndroidView(
        factory = { EmailChatView(it) },
        update = { view ->
            view.onEvent = { event ->
                when (event) {
                    is ChatEvent.OpenLink ->
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(event.url)))
                    is ChatEvent.VisibleRange -> store.fetchBodies(event.mailIds)
                    ChatEvent.LoadOlder -> store.loadOlder()
                    is ChatEvent.RetryBody -> store.fetchBodies(listOf(event.mailId))
                    is ChatEvent.PreviewAttachment -> store.preview(event.attachment, event.mailId)
                    is ChatEvent.DownloadAttachment -> store.download(event.attachment, event.mailId)
                    ChatEvent.Ready -> Unit
                }
            }
            view.render(
                ThreadState(
                    mails = store.mails,           // List<Mail>; dateMillis is epoch ms
                    currentUserAddress = listOf(store.me),
                    hasOlder = store.hasOlder,
                    loadingOlder = store.loadingOlder,
                ),
            )
        },
        onRelease = { it.destroy() },
    )
}
```

Views: `EmailChatView` is a `FrameLayout`. Set `onEvent`, call `render(...)`,
and call `destroy()` in `onDestroy`.

The module ships a consumer R8 rule that keeps the bridge method. Without it,
a minified release build would drop every event.

## Theming

- **Dark mode** follows the app. The page uses `prefers-color-scheme`, which
  both WebViews take from the app's current appearance.
- **Brand colours** go through `tokens`. The names are this package's CSS
  tokens without the leading dashes (`brand`, `surface`, `ink`, `border`,
  `sec-bubble-mine-bg`, …; see `src/styles/index.css`):

  ```swift
  ThreadState(mails: mails, tokens: ["brand": "#0b57d0"])
  ```

- **Strings** go through `labels`, keyed as `ViewLabels` in `src/ui/labels.ts`
  (`today`, `retry`, `loadImages`, …).

Remote images stay blocked until the reader taps "load images", as on the web.
Set `blockRemoteImages = false` to load them up front.

## Not available on mobile

The React-only props (`renderActions`, `renderHeaderMeta`, `renderFooter`) take
React elements, which cannot cross a WebView bridge. Put per-message controls
in native UI around the view, keyed by the mail ids the events report.

## Releasing

One tag releases npm, iOS and Android together:

```sh
npm version 0.3.0        # bumps package.json, rebuilds the mobile page, commits both, tags v0.3.0
git push --follow-tags   # the Publish workflow takes it from here
```

The `version` hook in `package.json` runs `pnpm build:mobile` and stages the
page, so the bump commit always carries a page built from the same source. The
Publish workflow then does the rest:

1. `swift test` on macOS, and the Android unit tests, lint and a local publish.
2. The usual type-check, 100% coverage and build. Then `pnpm check:mobile`
   fails the release if the committed page does not match `src/`.
3. npm publish.
4. JitPack builds `com.github.Sarv:email-chat-view:v0.3.0`. The workflow waits
   for the artifact and prints JitPack's build log if it fails.
5. A GitHub release with generated notes.

iOS needs no upload step: Swift Package Manager resolves the tag directly. CI
also runs `pnpm check:mobile`, `swift test` and the Android build on every push,
so a stale page is caught on the commit that caused it.

## Working on it

The page lives at `mobile/ios/Sources/EmailChatView/Resources/email-chat-view.html`.
It is generated, and it is committed because SwiftPM never runs npm. The
Android module reads its assets from the same folder. After changing anything
in `src/`:

```sh
pnpm build:mobile                # rebuild the page, then commit it with the change
swift test                       # iOS wrapper + the page in real WebKit at 390px wide
pnpm check:mobile                # fails if the committed page is stale
cd mobile/android && ./gradlew :emailchatview:testDebugUnitTest
```

`src/mobile/` is the page's side of the bridge (tested with the rest of the
suite). `Bridge.swift` and `Bridge.kt` mirror it on each platform.
