import Foundation
import os
import WebKit

#if canImport(UIKit)
import UIKit
public typealias EmailChatPlatformView = UIView
#else
import AppKit
public typealias EmailChatPlatformView = NSView
#endif

private let logger = Logger(subsystem: "com.sarv.EmailChatView", category: "bridge")

/// The chat view: a `WKWebView` running the bundled page, driven by
/// ``render(_:)`` and reporting reader actions through ``onEvent``.
///
/// ```swift
/// let chat = EmailChatWebView()
/// chat.onEvent = { event in
///     if case .openLink(let url) = event { UIApplication.shared.open(url) }
/// }
/// chat.render(ThreadState(mails: mails, currentUserAddress: ["me@acme.com"]))
/// ```
@MainActor
public final class EmailChatWebView: EmailChatPlatformView {
    /// Reader actions. Called on the main thread.
    public var onEvent: ((ChatEvent) -> Void)?

    let webView: WKWebView
    private var isReady = false
    /// The latest state, held until the page says `ready`.
    private var pending: ThreadState?
    private var rendered: ThreadState?

    public override init(frame: CGRect) {
        let configuration = WKWebViewConfiguration()
        webView = WKWebView(frame: CGRect(origin: .zero, size: frame.size), configuration: configuration)
        super.init(frame: frame)
        // Through a weak proxy: the content controller retains its handlers,
        // and this view owns the web view, so a direct `add(self, …)` would leak
        // both for the life of the app.
        configuration.userContentController.add(WeakMessageHandler(self), name: Bridge.handlerName)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        #if canImport(UIKit)
        // No white flash before the page paints in dark mode.
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        #else
        webView.autoresizingMask = [.width, .height]
        #endif
        #if DEBUG
        if #available(iOS 16.4, macOS 13.3, *) { webView.isInspectable = true }
        #endif
        addSubview(webView)
        loadPage()
    }

    public convenience init() {
        self.init(frame: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("EmailChatWebView is created in code")
    }

    /// Show `state`. Safe to call before the page has loaded: the latest state
    /// is held and rendered as soon as it is ready, and an unchanged state is
    /// not sent twice.
    public func render(_ state: ThreadState) {
        pending = state
        flush()
    }

    private func loadPage() {
        guard let url = Bridge.pageURL else {
            logger.fault("email-chat-view.html is missing from the bundle; run `pnpm build:mobile`")
            return
        }
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    private func flush() {
        guard isReady, let state = pending else { return }
        pending = nil
        guard state != rendered else { return }
        rendered = state
        do {
            webView.evaluateJavaScript(try Bridge.renderScript(for: state)) { _, error in
                if let error { logger.error("render failed: \(error.localizedDescription, privacy: .public)") }
            }
        } catch {
            logger.error("could not encode thread state: \(error.localizedDescription, privacy: .public)")
        }
    }

    fileprivate func receive(_ body: Any) {
        do {
            let event = try Bridge.decodeEvent(body)
            if event == .ready {
                isReady = true
                // A reload (the web process was killed in the background)
                // starts from an empty page, so the last state must go again.
                pending = pending ?? rendered
                rendered = nil
                flush()
                return
            }
            onEvent?(event)
        } catch {
            logger.error("unreadable chat event: \(error.localizedDescription, privacy: .public)")
        }
    }
}

extension EmailChatWebView: WKNavigationDelegate {
    /// The page itself and the message frames (`about:srcdoc`) load; anything
    /// else is a link, handed to the app instead of navigating the chat away.
    public func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
        // By name, not by URL equality: WebKit may report the file through a
        // resolved symlink (`/private/var/…` for `/var/…`). Read access is
        // confined to the resource folder, so the name is enough.
        let isPage = url.isFileURL && url.lastPathComponent == Bridge.pageURL?.lastPathComponent
        if isPage || url.scheme == "about" { return decisionHandler(.allow) }
        decisionHandler(.cancel)
        onEvent?(.openLink(url))
    }

    /// iOS kills a backgrounded web process under memory pressure. Reload, and
    /// `ready` re-sends the last state.
    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        isReady = false
        loadPage()
    }
}

extension EmailChatWebView: WKUIDelegate {
    /// A `target="_blank"` link asks for a new window; give the app the URL.
    public func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url { onEvent?(.openLink(url)) }
        return nil
    }
}

private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: EmailChatWebView?

    init(_ target: EmailChatWebView) {
        self.target = target
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        MainActor.assumeIsolated { target?.receive(message.body) }
    }
}
