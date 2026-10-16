import Foundation

/// The wire protocol with the page, as pure functions. Mirrors `src/mobile/bridge.ts`.
enum Bridge {
    /// The `WKScriptMessageHandler` name the page posts to.
    static let handlerName = "emailChatView"

    /// The bundled page.
    static var pageURL: URL? {
        Bundle.module.url(forResource: "email-chat-view", withExtension: "html")
    }

    /// The JavaScript that renders `state`.
    ///
    /// The state crosses as a JSON STRING literal that the page parses, not as
    /// a JavaScript object literal: JSON encoding a string escapes every quote,
    /// backslash and control character, so no mail body can break out of it.
    static func renderScript(for state: ThreadState) throws -> String {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        encoder.outputFormatting = .sortedKeys
        let json = String(decoding: try encoder.encode(state), as: UTF8.self)
        let literal = String(decoding: try JSONEncoder().encode(json), as: UTF8.self)
        return "window.EmailChatView.render(\(literal));"
    }

    /// One event posted by the page.
    static func decodeEvent(_ body: Any) throws -> ChatEvent {
        guard let json = body as? String else {
            throw DecodingError.typeMismatch(
                String.self,
                .init(codingPath: [], debugDescription: "Chat events arrive as JSON strings, got \(type(of: body))")
            )
        }
        return try JSONDecoder().decode(ChatEvent.self, from: Data(json.utf8))
    }
}
