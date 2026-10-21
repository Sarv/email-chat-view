import Foundation

/// A file attached to a mail.
public struct Attachment: Codable, Equatable, Sendable {
    /// Filename as received. The display label and the download name.
    public var filename: String
    /// Size in bytes, when the store knows it.
    public var sizeBytes: Int?
    /// MIME type, when known. Drives the preview affordance.
    public var mimeType: String?
    /// A `cid:` image that belongs to the body rather than being a real
    /// attachment. Excluded from the attachment row.
    public var inline: Bool?

    public init(filename: String, sizeBytes: Int? = nil, mimeType: String? = nil, inline: Bool? = nil) {
        self.filename = filename
        self.sizeBytes = sizeBytes
        self.mimeType = mimeType
        self.inline = inline
    }
}

/// A raw message from the mail store, exactly as the transform takes it.
///
/// Mirrors `Mail` in the package's `src/types.ts`; see that file for the
/// meaning of each field. Decodable too, because ``EmailChatCore/parseRawMail(_:id:inlineImages:)``
/// hands one back.
public struct Mail: Codable, Equatable, Sendable {
    /// Stable unique id within the thread. Every ``ChatEvent`` names this id.
    public var id: String
    public var messageId: String?
    /// Bare sender address, no display name.
    public var fromAddress: String
    public var fromName: String?
    /// Comma-separated, as received.
    public var toAddress: String?
    /// Comma-separated, positionally matching `toAddress`.
    public var toNames: String?
    public var ccAddress: String?
    public var ccNames: String?
    /// Sent as epoch milliseconds; there is no unit to get wrong on this side.
    public var date: Date
    /// Raw HTML or plain-text body. Nil while it has not been fetched.
    public var body: String?
    public var attachments: [Attachment]
    /// The body is still downloading: the bubble shows a spinner.
    public var bodyPending: Bool
    /// The body fetch failed for good: the bubble offers a retry.
    public var bodyFailed: Bool
    /// Drafts are left out of the thread.
    public var isDraft: Bool

    public init(
        id: String,
        fromAddress: String,
        date: Date,
        fromName: String? = nil,
        toAddress: String? = nil,
        toNames: String? = nil,
        ccAddress: String? = nil,
        ccNames: String? = nil,
        body: String? = nil,
        attachments: [Attachment] = [],
        messageId: String? = nil,
        bodyPending: Bool = false,
        bodyFailed: Bool = false,
        isDraft: Bool = false
    ) {
        self.id = id
        self.messageId = messageId
        self.fromAddress = fromAddress
        self.fromName = fromName
        self.toAddress = toAddress
        self.toNames = toNames
        self.ccAddress = ccAddress
        self.ccNames = ccNames
        self.date = date
        self.body = body
        self.attachments = attachments
        self.bodyPending = bodyPending
        self.bodyFailed = bodyFailed
        self.isDraft = isDraft
    }

    /// Reads the core's JSON, where only `id`, `fromAddress` and `date` are
    /// always present and `date` is epoch milliseconds or null.
    ///
    /// A null date — a raw mail with neither a `Date:` nor a `Received:`
    /// header — becomes the epoch. The transform reads any date at or before
    /// the epoch as unknown, so the mail still renders under "unknown date"
    /// when it goes back in, rather than in 1970.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        messageId = try container.decodeIfPresent(String.self, forKey: .messageId)
        fromAddress = try container.decode(String.self, forKey: .fromAddress)
        fromName = try container.decodeIfPresent(String.self, forKey: .fromName)
        toAddress = try container.decodeIfPresent(String.self, forKey: .toAddress)
        toNames = try container.decodeIfPresent(String.self, forKey: .toNames)
        ccAddress = try container.decodeIfPresent(String.self, forKey: .ccAddress)
        ccNames = try container.decodeIfPresent(String.self, forKey: .ccNames)
        date = Date(timeIntervalSince1970: (try container.decodeIfPresent(Double.self, forKey: .date) ?? 0) / 1000)
        body = try container.decodeIfPresent(String.self, forKey: .body)
        attachments = try container.decodeIfPresent([Attachment].self, forKey: .attachments) ?? []
        bodyPending = try container.decodeIfPresent(Bool.self, forKey: .bodyPending) ?? false
        bodyFailed = try container.decodeIfPresent(Bool.self, forKey: .bodyFailed) ?? false
        isDraft = try container.decodeIfPresent(Bool.self, forKey: .isDraft) ?? false
    }
}

/// What a message body is returned as.
public enum BodyFormat: String, Codable, Sendable {
    /// Displayable HTML, as the chat view renders it. The default.
    case html
    /// Plain text with line breaks, for a native text view.
    case text
}

/// One chat bubble: a mail, or a message recovered from its quoted history,
/// with the quoted history and signature already removed.
///
/// Mirrors `ChatMessage` in the package's `src/types.ts`.
public struct ChatMessage: Decodable, Equatable, Sendable {
    public var id: String
    public var fromAddress: String
    public var fromName: String?
    /// Header form: `"Lee, Ann" <ann@acme.example>, bob@acme.example`.
    public var toAddress: String?
    public var toNames: String?
    public var ccAddress: String?
    public var ccNames: String?
    /// When it was sent. Nil when no date could be read: show it under an
    /// "unknown date" heading rather than inventing one.
    public var date: Date?
    /// The date was inferred from the mail that quoted this message.
    public var dateApprox: Bool
    /// This turn only: HTML, or plain text when asked for ``BodyFormat/text``.
    public var body: String
    /// Real attachments; images the body shows inline are already left out.
    public var attachments: [Attachment]
    /// Sent by the reader. Nil when the reader's address was not given.
    public var isFromMe: Bool?
    public var bodyPending: Bool
    public var bodyFailed: Bool
    /// The cleaning steps that changed the body, for diagnostics.
    public var applied: [String]
    /// For a message recovered from quoted history, the mail it came from.
    public var sourceId: String?

    private enum CodingKeys: String, CodingKey {
        case id, fromAddress, fromName, toAddress, toNames, ccAddress, ccNames, date, dateApprox, body
        case attachments, isFromMe, bodyPending, bodyFailed, applied, sourceId
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        fromAddress = try container.decode(String.self, forKey: .fromAddress)
        fromName = try container.decodeIfPresent(String.self, forKey: .fromName)
        toAddress = try container.decodeIfPresent(String.self, forKey: .toAddress)
        toNames = try container.decodeIfPresent(String.self, forKey: .toNames)
        ccAddress = try container.decodeIfPresent(String.self, forKey: .ccAddress)
        ccNames = try container.decodeIfPresent(String.self, forKey: .ccNames)
        // An unreadable date is NaN in JavaScript, which JSON writes as null.
        date = try container.decodeIfPresent(Double.self, forKey: .date).map { Date(timeIntervalSince1970: $0 / 1000) }
        dateApprox = try container.decodeIfPresent(Bool.self, forKey: .dateApprox) ?? false
        body = try container.decode(String.self, forKey: .body)
        attachments = try container.decodeIfPresent([Attachment].self, forKey: .attachments) ?? []
        isFromMe = try container.decodeIfPresent(Bool.self, forKey: .isFromMe)
        bodyPending = try container.decodeIfPresent(Bool.self, forKey: .bodyPending) ?? false
        bodyFailed = try container.decodeIfPresent(Bool.self, forKey: .bodyFailed) ?? false
        applied = try container.decodeIfPresent([String].self, forKey: .applied) ?? []
        sourceId = try container.decodeIfPresent(String.self, forKey: .sourceId)
    }
}

/// Everything the chat view shows, sent whole on every change.
///
/// There is no patching: change what you need and render the whole state
/// again. Bodies the page has already cleaned are cached by content, so
/// re-sending an unchanged thread costs almost nothing.
public struct ThreadState: Encodable, Equatable, Sendable {
    /// The thread, in any order. The page sorts it.
    public var mails: [Mail]
    /// The reader's address(es): their messages sit on the right.
    public var currentUserAddress: [String]
    /// BCP 47 locale for dates. Nil follows the device.
    public var locale: String?
    /// Withhold remote images until the reader taps "load images". Default true.
    public var blockRemoteImages: Bool
    /// There is older history to fetch; reaching the top sends ``ChatEvent/loadOlder``.
    public var hasOlder: Bool
    /// That fetch is in flight.
    public var loadingOlder: Bool
    /// Show placeholder bubbles instead of an empty thread.
    public var loading: Bool
    /// Design-token overrides without the leading dashes, e.g. `["brand": "#0b57d0"]`.
    public var tokens: [String: String]
    /// Overrides for the view's strings, keyed as `ViewLabels` in `src/ui/labels.ts`.
    public var labels: [String: String]

    public init(
        mails: [Mail] = [],
        currentUserAddress: [String] = [],
        locale: String? = nil,
        blockRemoteImages: Bool = true,
        hasOlder: Bool = false,
        loadingOlder: Bool = false,
        loading: Bool = false,
        tokens: [String: String] = [:],
        labels: [String: String] = [:]
    ) {
        self.mails = mails
        self.currentUserAddress = currentUserAddress
        self.locale = locale
        self.blockRemoteImages = blockRemoteImages
        self.hasOlder = hasOlder
        self.loadingOlder = loadingOlder
        self.loading = loading
        self.tokens = tokens
        self.labels = labels
    }

    private enum CodingKeys: String, CodingKey {
        case mails, currentUserAddress, locale, blockRemoteImages, hasOlder, loadingOlder, loading, tokens, labels
        case dateUnit
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(mails, forKey: .mails)
        try container.encode(currentUserAddress, forKey: .currentUserAddress)
        try container.encodeIfPresent(locale, forKey: .locale)
        try container.encode(blockRemoteImages, forKey: .blockRemoteImages)
        try container.encode(hasOlder, forKey: .hasOlder)
        try container.encode(loadingOlder, forKey: .loadingOlder)
        try container.encode(loading, forKey: .loading)
        try container.encode(tokens, forKey: .tokens)
        try container.encode(labels, forKey: .labels)
        // Paired with the encoder's millisecond date strategy in `Bridge`.
        try container.encode("ms", forKey: .dateUnit)
    }
}
