import Foundation
import JavaScriptCore

/// A failure inside the core: a request it could not read, or a raw message it
/// could not parse.
public struct EmailChatCoreError: LocalizedError, Equatable, Sendable {
    public let message: String

    public var errorDescription: String? { message }
}

/// The transform without the view — chat messages as data, for an app that
/// draws its own bubbles.
///
/// It runs the very code the chat view runs, in JavaScriptCore with no web
/// view: `email-chat-core.js`, bundled with this package. So a native list and
/// ``EmailChatWebView`` can never disagree about what a message says.
///
/// ```swift
/// let core = try EmailChatCore()
/// let mail = try await core.parseRawMail(emlData)
/// let messages = try await core.messages(from: [mail], bodyFormat: .text)
/// ```
///
/// Keep one instance for the screen's lifetime: it remembers every body it has
/// cleaned, so re-sending the whole thread when one body arrives only cleans
/// that body. An actor, so calls are serialized and safe from any task.
public actor EmailChatCore {
    private let context: JSContext
    private let core: JSValue
    private let errors: ExceptionLog

    /// Loads the bundled core into a fresh JavaScript context.
    public init() throws {
        guard let url = Bundle.module.url(forResource: "email-chat-core", withExtension: "js") else {
            throw EmailChatCoreError(message: "email-chat-core.js is missing from the package resources")
        }
        guard let context = JSContext() else {
            throw EmailChatCoreError(message: "JavaScriptCore could not create a context")
        }
        let errors = ExceptionLog()
        context.exceptionHandler = { _, exception in errors.record(exception) }
        context.evaluateScript(try String(contentsOf: url, encoding: .utf8), withSourceURL: url)
        try errors.throwIfAny()
        guard let core = context.objectForKeyedSubscript("EmailChatCore"), core.isObject else {
            throw EmailChatCoreError(message: "email-chat-core.js did not define EmailChatCore")
        }
        self.context = context
        self.core = core
        self.errors = errors
    }

    /// The thread as chat messages, oldest first.
    ///
    /// - Parameters:
    ///   - mails: The thread, in any order.
    ///   - currentUserAddress: The reader's address(es). Their messages get
    ///     `isFromMe == true`; with none given, `isFromMe` stays nil.
    ///   - bodyFormat: HTML (the default) or plain text.
    ///   - containsThreadStart: The oldest mail is the real start of the
    ///     thread, so its quoted history is kept. Default true.
    ///   - includeDrafts: Keep drafts in the thread. Default false.
    public func messages(
        from mails: [Mail],
        currentUserAddress: [String] = [],
        bodyFormat: BodyFormat = .html,
        containsThreadStart: Bool = true,
        includeDrafts: Bool = false
    ) throws -> [ChatMessage] {
        let request = MessagesRequest(
            mails: mails,
            currentUserAddress: currentUserAddress,
            bodyFormat: bodyFormat,
            containsThreadStart: containsThreadStart,
            includeDrafts: includeDrafts
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        let json = String(decoding: try encoder.encode(request), as: UTF8.self)
        return try Self.unwrap(try call("messages", json))
    }

    /// A raw RFC 822 message — an `.eml` file, an IMAP `BODY[]` — as a ``Mail``.
    ///
    /// The body is the HTML part, or the text part as HTML when there is no
    /// HTML part. With `inlineImages` (the default) `cid:` images point at
    /// the attached image as a `data:` URI. A mail with no readable date gets
    /// the epoch, which ``messages(from:currentUserAddress:bodyFormat:containsThreadStart:includeDrafts:)``
    /// reports as an unknown (nil) date.
    ///
    /// - Parameters:
    ///   - data: The message's bytes, exactly as stored.
    ///   - id: The mail's id in the thread. Defaults to its Message-ID.
    ///   - inlineImages: Resolve `cid:` image references. Default true.
    public func parseRawMail(_ data: Data, id: String? = nil, inlineImages: Bool = true) throws -> Mail {
        // One char per byte. Latin-1 maps every byte, so this never fails and
        // the core reads the bytes back exactly.
        let binary = String(decoding: data.map { UInt16($0) }, as: UTF16.self)
        let request = String(decoding: try JSONEncoder().encode(ParseRequest(id: id, inlineImages: inlineImages)), as: UTF8.self)
        _ = try call("startParseRawMail", binary, request)
        // The parse settles in microtasks, which JavaScriptCore drains as the
        // call above returns, so the result is already waiting.
        return try Self.unwrap(try call("takeParsedMail"))
    }

    private func call(_ name: String, _ arguments: String...) throws -> String {
        let result = core.objectForKeyedSubscript(name).call(withArguments: arguments)
        try errors.throwIfAny()
        return result?.toString() ?? ""
    }

    /// The value of a reply envelope, or its error thrown.
    static func unwrap<Value: Decodable>(_ json: String) throws -> Value {
        let envelope = try JSONDecoder().decode(Envelope<Value>.self, from: Data(json.utf8))
        guard envelope.ok, let value = envelope.value else {
            throw EmailChatCoreError(message: envelope.error ?? "the core returned no value")
        }
        return value
    }
}

private struct MessagesRequest: Encodable {
    let mails: [Mail]
    let currentUserAddress: [String]
    let bodyFormat: BodyFormat
    let containsThreadStart: Bool
    let includeDrafts: Bool
}

private struct ParseRequest: Encodable {
    let id: String?
    let inlineImages: Bool
}

/// The core's reply: `{ok: true, value}` or `{ok: false, error}`.
struct Envelope<Value: Decodable>: Decodable {
    let ok: Bool
    let value: Value?
    let error: String?
}

/// Uncaught JavaScript exceptions, collected by the context's handler and
/// rethrown by the call that raised them.
private final class ExceptionLog: @unchecked Sendable {
    private var pending: String?

    func record(_ exception: JSValue?) {
        pending = exception?.toString() ?? "unknown JavaScript exception"
    }

    func throwIfAny() throws {
        guard let message = pending else { return }
        pending = nil
        throw EmailChatCoreError(message: message)
    }
}
