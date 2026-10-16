import WebKit
import XCTest

@testable import EmailChatView

#if canImport(AppKit)
import AppKit
#endif

/// The real page in real WebKit — the engine iOS uses — at a phone's width.
@MainActor
final class WebViewTests: XCTestCase {
    private static let phone = CGRect(x: 0, y: 0, width: 390, height: 844)

    private let mails = [
        Mail(
            id: "m1",
            fromAddress: "alice@acme.example",
            date: Date(timeIntervalSince1970: 1_741_000_000),
            fromName: "Alice Chen",
            toAddress: "me@acme.example",
            body: #"<div dir="ltr">Are we still on for Tuesday?</div>"#
                + #"<div class="gmail_signature">--<br>Alice Chen<br>Head of Finance, Acme</div>"#
        ),
        Mail(
            id: "m2",
            fromAddress: "me@acme.example",
            date: Date(timeIntervalSince1970: 1_741_003_600),
            toAddress: "alice@acme.example",
            body: #"<div>Yes, 10am works.</div><div class="gmail_quote">"#
                + #"<div class="gmail_attr">On Mon, Alice Chen wrote:</div>"#
                + #"<blockquote class="gmail_quote">Are we still on for Tuesday?</blockquote></div>"#,
            attachments: [Attachment(filename: "agenda.pdf", sizeBytes: 48_000, mimeType: "application/pdf")]
        ),
    ]

    private func makeChat() -> EmailChatWebView {
        let chat = EmailChatWebView(frame: Self.phone)
        #if canImport(AppKit)
        // On screen-less CI a window is still what gives the page a viewport.
        let window = NSWindow(contentRect: Self.phone, styleMask: [.borderless], backing: .buffered, defer: false)
        // Off by default for a window made in code, or `close()` releases it a
        // second time under ARC and the test process crashes.
        window.isReleasedWhenClosed = false
        window.contentView = chat
        addTeardownBlock { window.close() }
        #endif
        return chat
    }

    private func evaluate(_ chat: EmailChatWebView, _ script: String) async throws -> Any? {
        try await chat.webView.evaluateJavaScript(script)
    }

    /// Poll until `script` returns `expected`, or fail after `timeout`.
    private func waitFor(
        _ chat: EmailChatWebView, _ script: String, toEqual expected: Int, timeout: TimeInterval = 15
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        var last: Any?
        while Date() < deadline {
            last = try? await evaluate(chat, script)
            if (last as? Int) == expected { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("\(script) was \(String(describing: last)), expected \(expected)")
    }

    func testRendersTheThreadCleanedAtPhoneWidth() async throws {
        let chat = makeChat()
        // Sent before the page has loaded: it must be held, not dropped.
        chat.render(ThreadState(mails: mails, currentUserAddress: ["me@acme.example"], locale: "en-GB"))

        try await waitFor(chat, "document.querySelectorAll('[data-sec-index]').length", toEqual: 2)
        try await waitFor(chat, "document.querySelectorAll('.sec-bubble--mine').length", toEqual: 1)

        let text = try await evaluate(chat, "document.querySelector('.sec-thread').innerText") as? String ?? ""
        XCTAssertTrue(text.contains("Are we still on for Tuesday?"))
        XCTAssertTrue(text.contains("agenda.pdf"))
        XCTAssertFalse(text.contains("Head of Finance"), "signature should be stripped")
        XCTAssertFalse(text.contains("wrote:"), "quoted history should be stripped")

        // Nothing wider than the phone: the page must never scroll sideways.
        let width = try await evaluate(chat, "document.documentElement.scrollWidth") as? Int ?? .max
        XCTAssertLessThanOrEqual(width, Int(Self.phone.width))

        if let path = ProcessInfo.processInfo.environment["EMAIL_CHAT_VIEW_SNAPSHOT"] {
            try await saveSnapshot(chat, to: path)
        }
    }

    func testPageEventsReachTheApp() async throws {
        let chat = makeChat()
        let received = expectation(description: "loadOlder arrives")
        chat.onEvent = { event in
            if event == .loadOlder { received.fulfill() }
        }
        chat.render(ThreadState(mails: mails))
        try await waitFor(chat, "document.querySelectorAll('[data-sec-index]').length", toEqual: 2)

        _ = try await evaluate(
            chat, #"window.webkit.messageHandlers.emailChatView.postMessage('{"type":"loadOlder"}'); 0"#
        )
        await fulfillment(of: [received], timeout: 5)
    }

    func testTokensReachThePageRoot() async throws {
        let chat = makeChat()
        chat.render(ThreadState(mails: mails, tokens: ["brand": "rgb(1, 2, 3)"]))
        try await waitFor(chat, "document.querySelectorAll('[data-sec-index]').length", toEqual: 2)
        let brand = try await evaluate(
            chat, "getComputedStyle(document.documentElement).getPropertyValue('--sec-brand').trim()"
        ) as? String
        XCTAssertEqual(brand, "rgb(1, 2, 3)")
    }

    private func saveSnapshot(_ chat: EmailChatWebView, to path: String) async throws {
        // Let the message frames finish measuring before the picture is taken.
        try await Task.sleep(nanoseconds: 1_000_000_000)
        let image = try await chat.webView.takeSnapshot(configuration: nil)
        #if canImport(AppKit)
        let data = try XCTUnwrap(
            image.tiffRepresentation.flatMap { NSBitmapImageRep(data: $0)?.representation(using: .png, properties: [:]) }
        )
        #else
        let data = try XCTUnwrap(image.pngData())
        #endif
        try data.write(to: URL(fileURLWithPath: path))
    }
}
