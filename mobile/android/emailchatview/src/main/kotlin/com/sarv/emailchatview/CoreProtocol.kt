package com.sarv.emailchatview

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * The wire protocol with `email-chat-core.js` in a JavaScript isolate, as pure
 * functions. [EmailChatCore] only runs what these build.
 *
 * The isolate takes code and returns results through binder transactions of
 * bounded size, so a large string — the core script itself, a long thread, a
 * raw message with attachments — never crosses in one evaluation. It is
 * appended to a global in [CHUNK_CHARS] pieces, and a large result is held in
 * another global and read back in slices.
 */
internal object CoreProtocol {
    /** The bundled core, an asset shared with the iOS package. */
    const val ASSET = "email-chat-core.js"

    /**
     * Characters per evaluation. A quoted chunk is at most six times this
     * (`\u0000`), comfortably inside a binder transaction.
     */
    const val CHUNK_CHARS = 64 * 1024

    private const val INPUT = "globalThis.__emailChatCoreInput"
    private const val OUTPUT = "globalThis.__emailChatCoreOutput"

    const val CLEAR_INPUT = "$INPUT='';"

    /** Run the accumulated input as a script, at global scope. */
    const val RUN_INPUT = "(0,eval)($INPUT);$INPUT='';"

    /** Transform the accumulated request and hold the reply; evaluates to its length. */
    const val HOLD_MESSAGES = "$OUTPUT=EmailChatCore.messages($INPUT);$INPUT='';String($OUTPUT.length)"

    /** Hold the settled parse; evaluates to its length. */
    const val HOLD_PARSED = "$OUTPUT=EmailChatCore.takeParsedMail();String($OUTPUT.length)"

    const val RELEASE_OUTPUT = "$OUTPUT='';"

    /** `text` in pieces of at most [size] chars, never splitting a surrogate pair. */
    fun chunks(text: String, size: Int = CHUNK_CHARS): List<String> =
        generateSequence(0) { start -> chunkEnd(text, start, size).takeIf { it < text.length } }
            .takeWhile { it < text.length }
            .map { start -> text.substring(start, chunkEnd(text, start, size)) }
            .toList()

    private fun chunkEnd(text: String, start: Int, size: Int): Int {
        val end = minOf(start + size, text.length)
        return if (end < text.length && end - start > 1 && text[end - 1].isHighSurrogate()) end - 1 else end
    }

    /** Append one chunk, as a JSON string literal so no content can break out. */
    fun appendInput(chunk: String) = "$INPUT+=${JSONObject.quote(chunk)};"

    /** Start parsing the accumulated binary string. */
    fun startParse(requestJson: String) =
        "EmailChatCore.startParseRawMail($INPUT,${JSONObject.quote(requestJson)});$INPUT='';"

    /**
     * Up to [size] chars of the held reply from [start], one fewer when that
     * would split a surrogate pair. The caller advances by what comes back.
     */
    fun readOutput(start: Int, size: Int = CHUNK_CHARS) =
        "(function(s,a,b){var c=s.charCodeAt(b-1);" +
            "return s.slice(a,b<s.length&&b-a>1&&c>=0xD800&&c<=0xDBFF?b-1:b);})" +
            "($OUTPUT,$start,${start + size})"

    fun messagesRequest(
        mails: List<Mail>,
        currentUserAddress: List<String>,
        bodyFormat: BodyFormat,
        containsThreadStart: Boolean,
        includeDrafts: Boolean,
    ): String = JSONObject()
        .put("mails", JSONArray(mails.map { it.toJson() }))
        .put("currentUserAddress", JSONArray(currentUserAddress))
        .put("bodyFormat", bodyFormat.wire)
        .put("containsThreadStart", containsThreadStart)
        .put("includeDrafts", includeDrafts)
        .toString()

    fun parseRequest(id: String?, inlineImages: Boolean): String =
        JSONObject().putOpt("id", id).put("inlineImages", inlineImages).toString()

    /** The messages in a reply, or its error thrown. */
    fun messagesOf(reply: String): List<ChatMessage> {
        val value = valueOf(reply) as? JSONArray ?: throw EmailChatCoreException("the core returned no messages")
        return List(value.length()) { index -> chatMessageOf(value.getJSONObject(index)) }
    }

    /**
     * The mail in a reply, or its error thrown. A null date — a raw message with
     * neither a `Date:` nor a `Received:` header — becomes 0, which the
     * transform reads back as an unknown date rather than 1970.
     */
    fun mailOf(reply: String): Mail {
        val json = valueOf(reply) as? JSONObject ?: throw EmailChatCoreException("the core returned no mail")
        return Mail(
            id = json.getString("id"),
            fromAddress = json.getString("fromAddress"),
            dateMillis = if (json.isNull("date")) 0 else json.getLong("date"),
            fromName = json.stringOrNull("fromName"),
            toAddress = json.stringOrNull("toAddress"),
            ccAddress = json.stringOrNull("ccAddress"),
            body = json.stringOrNull("body"),
            attachments = attachmentsOf(json),
            messageId = json.stringOrNull("messageId"),
        )
    }

    private fun valueOf(reply: String): Any? {
        val envelope = try {
            JSONObject(reply)
        } catch (error: JSONException) {
            throw EmailChatCoreException("unreadable reply from the core: ${error.message}")
        }
        if (!envelope.optBoolean("ok")) {
            throw EmailChatCoreException(envelope.optString("error", "the core failed without saying why"))
        }
        return envelope.opt("value")
    }

    private fun chatMessageOf(json: JSONObject) = ChatMessage(
        id = json.getString("id"),
        fromAddress = json.getString("fromAddress"),
        // An unreadable date is NaN in JavaScript, which JSON writes as null.
        dateMillis = if (json.isNull("date")) null else json.getLong("date"),
        body = json.getString("body"),
        fromName = json.stringOrNull("fromName"),
        toAddress = json.stringOrNull("toAddress"),
        toNames = json.stringOrNull("toNames"),
        ccAddress = json.stringOrNull("ccAddress"),
        ccNames = json.stringOrNull("ccNames"),
        dateApprox = json.optBoolean("dateApprox"),
        attachments = attachmentsOf(json),
        isFromMe = if (json.isNull("isFromMe")) null else json.getBoolean("isFromMe"),
        bodyPending = json.optBoolean("bodyPending"),
        bodyFailed = json.optBoolean("bodyFailed"),
        applied = json.optJSONArray("applied")?.let { array -> List(array.length()) { array.getString(it) } }
            ?: emptyList(),
        sourceId = json.stringOrNull("sourceId"),
    )

    private fun attachmentsOf(json: JSONObject): List<Attachment> {
        val array = json.optJSONArray("attachments") ?: return emptyList()
        return List(array.length()) { index -> Bridge.attachmentOf(array.getJSONObject(index)) }
    }

    /** A string field, or null when it is absent or JSON null. */
    private fun JSONObject.stringOrNull(key: String): String? = if (isNull(key)) null else getString(key)
}
