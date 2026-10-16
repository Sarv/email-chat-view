import SwiftUI

/// SwiftUI wrapper around ``EmailChatWebView``.
///
/// ```swift
/// EmailChatThread(state: ThreadState(mails: mails, currentUserAddress: [me])) { event in
///     switch event {
///     case .openLink(let url): openURL(url)
///     case .visibleRange(let ids): store.fetchBodies(ids)
///     case .loadOlder: store.loadOlder()
///     default: break
///     }
/// }
/// ```
public struct EmailChatThread {
    public var state: ThreadState
    public var onEvent: (ChatEvent) -> Void

    public init(state: ThreadState, onEvent: @escaping (ChatEvent) -> Void = { _ in }) {
        self.state = state
        self.onEvent = onEvent
    }

    @MainActor
    fileprivate func update(_ view: EmailChatWebView) {
        view.onEvent = onEvent
        view.render(state)
    }
}

#if canImport(UIKit)
extension EmailChatThread: UIViewRepresentable {
    public func makeUIView(context: Context) -> EmailChatWebView { EmailChatWebView() }
    public func updateUIView(_ view: EmailChatWebView, context: Context) { update(view) }
}
#else
extension EmailChatThread: NSViewRepresentable {
    public func makeNSView(context: Context) -> EmailChatWebView { EmailChatWebView() }
    public func updateNSView(_ view: EmailChatWebView, context: Context) { update(view) }
}
#endif
