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
/// meaning of each field.
public struct Mail: Encodable, Equatable, Sendable {
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
