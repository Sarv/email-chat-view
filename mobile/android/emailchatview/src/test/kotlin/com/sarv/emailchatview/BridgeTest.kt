package com.sarv.emailchatview

import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeTest {
    /** The state JSON the render script carries, read back out of its string literal. */
    private fun renderedState(state: ThreadState): JSONObject {
        val script = Bridge.renderScript(state)
        val start = script.indexOf("render(") + "render(".length
        val literal = JSONTokener(script.substring(start)).nextValue() as String
        return JSONObject(literal)
    }

    @Test
    fun datesCrossAsMillisecondsWithTheirUnit() {
        val state = renderedState(
            ThreadState(mails = listOf(Mail(id = "m1", fromAddress = "a@acme.example", dateMillis = 1_700_000_000_000))),
        )
        assertEquals("ms", state.getString("dateUnit"))
        assertEquals(1_700_000_000_000, state.getJSONArray("mails").getJSONObject(0).getLong("date"))
    }

    @Test
    fun aBodyCannotBreakOutOfTheScript() {
        val hostile = "</script>\"); alert(1); (\" "
        val script = Bridge.renderScript(
            ThreadState(mails = listOf(Mail(id = "m1", fromAddress = "a@acme.example", dateMillis = 0, body = hostile))),
        )
        assertFalse(script.contains("</script"))
        val mail = renderedState(
            ThreadState(mails = listOf(Mail(id = "m1", fromAddress = "a@acme.example", dateMillis = 0, body = hostile))),
        ).getJSONArray("mails").getJSONObject(0)
        assertEquals(hostile, mail.getString("body"))
    }

    @Test
    fun leavesUnsetOptionalFieldsOut() {
        val mail = renderedState(
            ThreadState(mails = listOf(Mail(id = "m1", fromAddress = "a@acme.example", dateMillis = 0))),
        ).getJSONArray("mails").getJSONObject(0)
        assertFalse(mail.has("body"))
        assertFalse(mail.has("fromName"))
        assertTrue(mail.has("bodyPending"))
    }

    @Test
    fun decodesEveryEvent() {
        val attachment = Attachment(filename = "q1.pdf", sizeBytes = 10)
        val cases = mapOf(
            """{"type":"ready"}""" to ChatEvent.Ready,
            """{"type":"openLink","url":"https://example.com/a"}""" to ChatEvent.OpenLink("https://example.com/a"),
            """{"type":"retryBody","mailId":"m1"}""" to ChatEvent.RetryBody("m1"),
            """{"type":"previewAttachment","mailId":"m1","attachment":{"filename":"q1.pdf","sizeBytes":10}}""" to
                ChatEvent.PreviewAttachment("m1", attachment),
            """{"type":"downloadAttachment","mailId":"m1","attachment":{"filename":"q1.pdf","sizeBytes":10}}""" to
                ChatEvent.DownloadAttachment("m1", attachment),
            """{"type":"loadOlder"}""" to ChatEvent.LoadOlder,
            """{"type":"visibleRange","mailIds":["m1","m2"]}""" to ChatEvent.VisibleRange(listOf("m1", "m2")),
        )
        cases.forEach { (json, expected) -> assertEquals(json, expected, Bridge.decodeEvent(json)) }
    }

    @Test
    fun rejectsUnknownEvents() {
        assertThrows(JSONException::class.java) { Bridge.decodeEvent("""{"type":"explode"}""") }
        assertThrows(JSONException::class.java) { Bridge.decodeEvent("not json") }
    }
}
