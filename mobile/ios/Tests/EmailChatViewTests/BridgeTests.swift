import XCTest

@testable import EmailChatView

final class BridgeTests: XCTestCase {
    /// The JSON string the render script carries, decoded back out of the literal.
    private func renderedState(_ state: ThreadState) throws -> [String: Any] {
        let script = try Bridge.renderScript(for: state)
        XCTAssertTrue(script.hasPrefix("window.EmailChatView.render(\""))
        let literal = script.dropFirst("window.EmailChatView.render(".count).dropLast(2)
        let json = try JSONDecoder().decode(String.self, from: Data(literal.utf8))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
    }

    func testDatesCrossAsMillisecondsWithTheirUnit() throws {
        let mail = Mail(id: "m1", fromAddress: "a@acme.example", date: Date(timeIntervalSince1970: 1_700_000_000))
        let state = try renderedState(ThreadState(mails: [mail]))
        XCTAssertEqual(state["dateUnit"] as? String, "ms")
        let mails = try XCTUnwrap(state["mails"] as? [[String: Any]])
        XCTAssertEqual(mails.first?["date"] as? Double, 1_700_000_000_000)
    }

    func testABodyCannotBreakOutOfTheScript() throws {
        let hostile = #"</script>"); alert(1); ("\u{2028}"#
        let mail = Mail(id: "m1", fromAddress: "a@acme.example", date: Date(), body: hostile)
        let state = try renderedState(ThreadState(mails: [mail], tokens: ["brand": "#0b57d0"]))
        let mails = try XCTUnwrap(state["mails"] as? [[String: Any]])
        XCTAssertEqual(mails.first?["body"] as? String, hostile)
        XCTAssertEqual((state["tokens"] as? [String: String])?["brand"], "#0b57d0")
    }

    func testDecodesEveryEvent() throws {
        let attachment = Attachment(filename: "q1.pdf", sizeBytes: 10)
        let cases: [(String, ChatEvent)] = [
            (#"{"type":"ready"}"#, .ready),
            (#"{"type":"openLink","url":"https://example.com/a"}"#, .openLink(URL(string: "https://example.com/a")!)),
            (#"{"type":"retryBody","mailId":"m1"}"#, .retryBody(mailId: "m1")),
            (
                #"{"type":"previewAttachment","mailId":"m1","attachment":{"filename":"q1.pdf","sizeBytes":10}}"#,
                .previewAttachment(attachment, mailId: "m1")
            ),
            (
                #"{"type":"downloadAttachment","mailId":"m1","attachment":{"filename":"q1.pdf","sizeBytes":10}}"#,
                .downloadAttachment(attachment, mailId: "m1")
            ),
            (#"{"type":"loadOlder"}"#, .loadOlder),
            (#"{"type":"visibleRange","mailIds":["m1","m2"]}"#, .visibleRange(mailIds: ["m1", "m2"])),
        ]
        for (json, expected) in cases {
            XCTAssertEqual(try Bridge.decodeEvent(json), expected, json)
        }
    }

    func testRejectsUnknownEventsAndNonStrings() {
        XCTAssertThrowsError(try Bridge.decodeEvent(#"{"type":"explode"}"#))
        XCTAssertThrowsError(try Bridge.decodeEvent(["type": "ready"]))
    }
}
