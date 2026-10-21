import XCTest

@testable import EmailChatView

/// The bundled core, run in JavaScriptCore exactly as an app runs it.
final class EmailChatCoreTests: XCTestCase {
    private let march3 = Date(timeIntervalSince1970: 1_740_996_000)

    /// A Latin-1 plain-text message whose sender's name holds a comma.
    private let latin1Eml: Data = {
        let text = [
            #"From: "Lee, Ann" <ann@acme.example>"#,
            "To: me@acme.example",
            "Date: Tue, 06 Oct 2026 10:00:00 +0000",
            "Message-ID: <lunch-1@acme.example>",
            "Content-Type: text/plain; charset=iso-8859-1",
            "",
            "Caf\u{e9} at one?",
            "",
        ].joined(separator: "\r\n")
        return text.data(using: .isoLatin1)!
    }()

    func testMessagesAreRichTextByDefault() async throws {
        let core = try EmailChatCore()
        let mail = Mail(id: "m1", fromAddress: "ann@acme.example", date: march3, body: "<div>Hello <b>there</b></div>")
        let messages = try await core.messages(from: [mail])
        XCTAssertEqual(messages.map(\.body), ["<div>Hello <b>there</b></div>"])
        XCTAssertEqual(messages.first?.date, march3)
        XCTAssertNil(messages.first?.isFromMe)
    }

    func testMessagesCanBePlainTextWithTheQuoteRemoved() async throws {
        let core = try EmailChatCore()
        let reply = Mail(
            id: "m2",
            fromAddress: "me@acme.example",
            date: march3.addingTimeInterval(60),
            body: #"<div>Sure</div><div class="gmail_quote">On Mon, Ann wrote:<blockquote>Lunch?</blockquote></div>"#
        )
        let messages = try await core.messages(
            from: [reply],
            currentUserAddress: ["me@acme.example"],
            bodyFormat: .text,
            containsThreadStart: false
        )
        XCTAssertEqual(messages.map(\.body), ["Sure"])
        XCTAssertEqual(messages.first?.isFromMe, true)
    }

    // Regression: the parse settles in promise jobs. If JavaScriptCore did not
    // drain them as the starting call returns, every parse would come back
    // "pending".
    func testParsesARawMessageInOneCall() async throws {
        let core = try EmailChatCore()
        let mail = try await core.parseRawMail(latin1Eml)
        XCTAssertEqual(mail.id, "<lunch-1@acme.example>")
        XCTAssertEqual(mail.fromName, "Lee, Ann")
        XCTAssertEqual(mail.fromAddress, "ann@acme.example")
        XCTAssertEqual(mail.body, "<div>Caf\u{e9} at one?</div>")
        XCTAssertEqual(mail.date, Date(timeIntervalSince1970: 1_791_280_800))
    }

    func testAParsedMailFeedsTheTransform() async throws {
        let core = try EmailChatCore()
        let mail = try await core.parseRawMail(latin1Eml, id: "eml-1")
        let messages = try await core.messages(from: [mail], bodyFormat: .text)
        XCTAssertEqual(messages.map(\.id), ["eml-1"])
        XCTAssertEqual(messages.map(\.body), ["Caf\u{e9} at one?"])
    }

    // Regression: an undated raw mail must not be filed under 1970. It comes
    // back as the epoch and goes through the transform as an unknown date.
    func testAnUndatedMailComesOutWithNoDate() async throws {
        let core = try EmailChatCore()
        let undated = try await core.parseRawMail(Data("From: ann@acme.example\r\n\r\nhi".utf8))
        XCTAssertEqual(undated.date, Date(timeIntervalSince1970: 0))
        let messages = try await core.messages(from: [undated])
        XCTAssertEqual(messages.count, 1)
        XCTAssertNil(messages.first?.date)
    }

    // Regression: a failure inside the engine has to reach the app as an
    // error it can show, not as an empty list.
    func testAFailedReplyThrowsTheCoresMessage() throws {
        XCTAssertThrowsError(try EmailChatCore.unwrap(#"{"ok":false,"error":"Unexpected token"}"#) as [ChatMessage]) {
            XCTAssertEqual($0 as? EmailChatCoreError, EmailChatCoreError(message: "Unexpected token"))
        }
        XCTAssertThrowsError(try EmailChatCore.unwrap(#"{"ok":true}"#) as Mail) {
            XCTAssertEqual($0.localizedDescription, "the core returned no value")
        }
    }
}
