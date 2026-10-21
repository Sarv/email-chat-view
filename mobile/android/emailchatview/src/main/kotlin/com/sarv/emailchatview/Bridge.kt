package com.sarv.emailchatview

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** The wire protocol with the page, as pure functions. Mirrors `src/mobile/bridge.ts`. */
internal object Bridge {
    /** The `@JavascriptInterface` object name the page posts to. */
    const val INTERFACE_NAME = "EmailChatViewAndroid"

    /** The bundled page. `android_asset` stays readable with file access off. */
    const val PAGE_URL = "file:///android_asset/email-chat-view.html"

    /**
     * The JavaScript that renders [state].
     *
     * The state crosses as a JSON STRING literal the page parses, not as an
     * object literal: quoting escapes every quote, backslash, control character
     * and `</`, so no mail body can break out of it. Wrapped in a try because
     * `evaluateJavascript` reports a thrown error as a plain `null`, which would
     * make a rejected state indistinguishable from a rendered one.
     */
    fun renderScript(state: ThreadState): String {
        val literal = JSONObject.quote(state.toJson().toString())
        return "(function(){try{window.EmailChatView.render($literal);return 'ok';}" +
            "catch(e){return 'error: '+e;}})()"
    }

    /** One event posted by the page. */
    @Throws(JSONException::class)
    fun decodeEvent(json: String): ChatEvent {
        val event = JSONObject(json)
        return when (val type = event.getString("type")) {
            "ready" -> ChatEvent.Ready
            "openLink" -> ChatEvent.OpenLink(event.getString("url"))
            "retryBody" -> ChatEvent.RetryBody(event.getString("mailId"))
            "previewAttachment" ->
                ChatEvent.PreviewAttachment(event.getString("mailId"), attachmentOf(event.getJSONObject("attachment")))
            "downloadAttachment" ->
                ChatEvent.DownloadAttachment(event.getString("mailId"), attachmentOf(event.getJSONObject("attachment")))
            "loadOlder" -> ChatEvent.LoadOlder
            "visibleRange" -> ChatEvent.VisibleRange(stringsOf(event.getJSONArray("mailIds")))
            else -> throw JSONException("Unknown chat event type '$type'")
        }
    }

    fun attachmentOf(json: JSONObject) = Attachment(
        filename = json.getString("filename"),
        sizeBytes = if (json.has("sizeBytes")) json.getLong("sizeBytes") else null,
        mimeType = json.optString("mimeType").takeIf { json.has("mimeType") },
        inline = if (json.has("inline")) json.getBoolean("inline") else null,
    )

    private fun stringsOf(array: JSONArray) = List(array.length()) { index -> array.getString(index) }
}

internal fun ThreadState.toJson(): JSONObject = JSONObject()
    .put("mails", JSONArray(mails.map { it.toJson() }))
    .put("currentUserAddress", JSONArray(currentUserAddress))
    .putOpt("locale", locale)
    .put("blockRemoteImages", blockRemoteImages)
    .put("hasOlder", hasOlder)
    .put("loadingOlder", loadingOlder)
    .put("loading", loading)
    .put("tokens", JSONObject(tokens))
    .put("labels", JSONObject(labels))
    // Mail.dateMillis is milliseconds by name; say so, so the page never guesses.
    .put("dateUnit", "ms")

internal fun Mail.toJson(): JSONObject = JSONObject()
    .put("id", id)
    .put("fromAddress", fromAddress)
    .put("date", dateMillis)
    .putOpt("fromName", fromName)
    .putOpt("toAddress", toAddress)
    .putOpt("toNames", toNames)
    .putOpt("ccAddress", ccAddress)
    .putOpt("ccNames", ccNames)
    .putOpt("body", body)
    .putOpt("messageId", messageId)
    .put("attachments", JSONArray(attachments.map { it.toJson() }))
    .put("bodyPending", bodyPending)
    .put("bodyFailed", bodyFailed)
    .put("isDraft", isDraft)

internal fun Attachment.toJson(): JSONObject = JSONObject()
    .put("filename", filename)
    .putOpt("sizeBytes", sizeBytes)
    .putOpt("mimeType", mimeType)
    .putOpt("inline", inline)
