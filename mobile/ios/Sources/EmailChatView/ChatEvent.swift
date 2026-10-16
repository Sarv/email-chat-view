import Foundation

/// A reader action in the chat view, for the app to act on.
///
/// Every event names a ``Mail/id``, never a bubble: one bottom-quoted mail can
/// become several bubbles, and the app only knows the mails it fetched.
public enum ChatEvent: Equatable, Sendable {
    /// The page has loaded. Handled by ``EmailChatWebView`` itself.
    case ready
    /// A link in a message was tapped. Open it however the app opens links.
    case openLink(URL)
    /// The reader asked to retry a body that failed to download.
    case retryBody(mailId: String)
    case previewAttachment(Attachment, mailId: String)
    case downloadAttachment(Attachment, mailId: String)
    /// The top of the thread came into view while ``ThreadState/hasOlder`` was true.
    case loadOlder
    /// The mails now on screen. Fetch these bodies first.
    case visibleRange(mailIds: [String])
}

extension ChatEvent: Decodable {
    private enum CodingKeys: String, CodingKey {
        case type, url, mailId, mailIds, attachment
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "ready":
            self = .ready
        case "openLink":
            self = .openLink(try container.decode(URL.self, forKey: .url))
        case "retryBody":
            self = .retryBody(mailId: try container.decode(String.self, forKey: .mailId))
        case "previewAttachment":
            self = .previewAttachment(
                try container.decode(Attachment.self, forKey: .attachment),
                mailId: try container.decode(String.self, forKey: .mailId)
            )
        case "downloadAttachment":
            self = .downloadAttachment(
                try container.decode(Attachment.self, forKey: .attachment),
                mailId: try container.decode(String.self, forKey: .mailId)
            )
        case "loadOlder":
            self = .loadOlder
        case "visibleRange":
            self = .visibleRange(mailIds: try container.decode([String].self, forKey: .mailIds))
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: container, debugDescription: "Unknown chat event type '\(type)'"
            )
        }
    }
}
