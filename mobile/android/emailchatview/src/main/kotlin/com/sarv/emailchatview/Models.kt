package com.sarv.emailchatview

/** A file attached to a mail. */
data class Attachment(
    /** Filename as received. The display label and the download name. */
    val filename: String,
    /** Size in bytes, when the store knows it. */
    val sizeBytes: Long? = null,
    /** MIME type, when known. Drives the preview affordance. */
    val mimeType: String? = null,
    /** A `cid:` image that belongs to the body, not a real attachment. */
    val inline: Boolean? = null,
)

/**
 * A raw message from the mail store, exactly as the transform takes it.
 *
 * Mirrors `Mail` in the package's `src/types.ts`; see that file for the
 * meaning of each field.
 */
data class Mail(
    /** Stable unique id within the thread. Every [ChatEvent] names this id. */
    val id: String,
    /** Bare sender address, no display name. */
    val fromAddress: String,
    /** Epoch MILLISECONDS — convert seconds-based store dates before passing them. */
    val dateMillis: Long,
    val fromName: String? = null,
    /** Comma-separated, as received. */
    val toAddress: String? = null,
    /** Comma-separated, positionally matching [toAddress]. */
    val toNames: String? = null,
    val ccAddress: String? = null,
    val ccNames: String? = null,
    /** Raw HTML or plain-text body. Null while it has not been fetched. */
    val body: String? = null,
    val attachments: List<Attachment> = emptyList(),
    val messageId: String? = null,
    /** The body is still downloading: the bubble shows a spinner. */
    val bodyPending: Boolean = false,
    /** The body fetch failed for good: the bubble offers a retry. */
    val bodyFailed: Boolean = false,
    /** Drafts are left out of the thread. */
    val isDraft: Boolean = false,
)

/**
 * Everything the chat view shows, sent whole on every change.
 *
 * There is no patching: copy what you need and render the whole state again.
 * Bodies the page has already cleaned are cached by content, so re-sending an
 * unchanged thread costs almost nothing.
 */
data class ThreadState(
    /** The thread, in any order. The page sorts it. */
    val mails: List<Mail> = emptyList(),
    /** The reader's address(es): their messages sit on the right. */
    val currentUserAddress: List<String> = emptyList(),
    /** BCP 47 locale for dates. Null follows the device. */
    val locale: String? = null,
    /** Withhold remote images until the reader taps "load images". */
    val blockRemoteImages: Boolean = true,
    /** There is older history; reaching the top sends [ChatEvent.LoadOlder]. */
    val hasOlder: Boolean = false,
    /** That fetch is in flight. */
    val loadingOlder: Boolean = false,
    /** Show placeholder bubbles instead of an empty thread. */
    val loading: Boolean = false,
    /** Design-token overrides without the leading dashes, e.g. `mapOf("brand" to "#0b57d0")`. */
    val tokens: Map<String, String> = emptyMap(),
    /** Overrides for the view's strings, keyed as `ViewLabels` in `src/ui/labels.ts`. */
    val labels: Map<String, String> = emptyMap(),
)

/**
 * A reader action in the chat view, for the app to act on.
 *
 * Every event names a [Mail.id], never a bubble: one bottom-quoted mail can
 * become several bubbles, and the app only knows the mails it fetched.
 */
sealed class ChatEvent {
    /** The page has loaded. Handled by [EmailChatView] itself. */
    data object Ready : ChatEvent()

    /** A link in a message was tapped. Open it however the app opens links. */
    data class OpenLink(val url: String) : ChatEvent()

    /** The reader asked to retry a body that failed to download. */
    data class RetryBody(val mailId: String) : ChatEvent()

    data class PreviewAttachment(val mailId: String, val attachment: Attachment) : ChatEvent()

    data class DownloadAttachment(val mailId: String, val attachment: Attachment) : ChatEvent()

    /** The top of the thread came into view while [ThreadState.hasOlder] was true. */
    data object LoadOlder : ChatEvent()

    /** The mails now on screen. Fetch these bodies first. */
    data class VisibleRange(val mailIds: List<String>) : ChatEvent()
}
