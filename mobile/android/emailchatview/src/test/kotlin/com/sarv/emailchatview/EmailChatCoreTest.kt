package com.sarv.emailchatview

import java.io.File
import kotlinx.coroutines.runBlocking
import org.graalvm.polyglot.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The bundled core through [EmailChatCore]'s transport, in GraalJS.
 *
 * The real isolate exists only on a device. GraalJS is another bare engine —
 * no TextDecoder, Blob or atob — so the core's own stand-ins are what run, as
 * in the isolate, and every string crosses in the same chunks.
 */
class EmailChatCoreTest {
    /** A [ScriptEngine] on GraalJS that records the largest script it was sent. */
    private class GraalEngine : ScriptEngine {
        private val context = Context.newBuilder("js").option("engine.WarnInterpreterOnly", "false").build()
        var largestScript = 0
            private set
        var closed = false
            private set

        override suspend fun evaluate(script: String): String {
            largestScript = maxOf(largestScript, script.length)
            val result = context.eval("js", script)
            return if (result.isString) result.asString() else ""
        }

        override fun close() {
            closed = true
            context.close()
        }
    }

    private val source = File("../../ios/Sources/EmailChatView/Resources/email-chat-core.js").readText()

    private fun withCore(test: suspend (EmailChatCore, GraalEngine) -> Unit) = runBlocking {
        val engine = GraalEngine()
        EmailChatCore.load(engine, source).use { core -> test(core, engine) }
    }

    private val march3 = 1_740_996_000_000L

    private val latin1Eml = listOf(
        "From: \"Lee, Ann\" <ann@acme.example>",
        "To: me@acme.example",
        "Date: Tue, 06 Oct 2026 10:00:00 +0000",
        "Message-ID: <lunch-1@acme.example>",
        "Content-Type: text/plain; charset=iso-8859-1",
        "",
        "Café at one?",
        "",
    ).joinToString("\r\n").toByteArray(Charsets.ISO_8859_1)

    @Test
    fun messagesAreRichTextByDefault() = withCore { core, _ ->
        val mail = Mail(id = "m1", fromAddress = "ann@acme.example", dateMillis = march3, body = "<div>Hello <b>there</b></div>")
        val messages = core.messages(listOf(mail))
        assertEquals(listOf("<div>Hello <b>there</b></div>"), messages.map { it.body })
        assertEquals(march3, messages.single().dateMillis)
        assertNull(messages.single().isFromMe)
    }

    @Test
    fun messagesCanBePlainTextWithTheQuoteRemoved() = withCore { core, _ ->
        val reply = Mail(
            id = "m2",
            fromAddress = "me@acme.example",
            dateMillis = march3 + 60_000,
            body = "<div>Sure</div><div class=\"gmail_quote\">On Mon, Ann wrote:<blockquote>Lunch?</blockquote></div>",
        )
        val messages = core.messages(
            listOf(reply),
            currentUserAddress = listOf("me@acme.example"),
            bodyFormat = BodyFormat.TEXT,
            containsThreadStart = false,
        )
        assertEquals(listOf("Sure"), messages.map { it.body })
        assertEquals(true, messages.single().isFromMe)
    }

    @Test
    fun parsesARawMessage() = withCore { core, _ ->
        val mail = core.parseRawMail(latin1Eml)
        assertEquals("<lunch-1@acme.example>", mail.id)
        assertEquals("Lee, Ann", mail.fromName)
        assertEquals("<div>Café at one?</div>", mail.body)
        assertEquals(1_791_280_800_000L, mail.dateMillis)
    }

    @Test
    fun aParsedMailFeedsTheTransform() = withCore { core, _ ->
        val mail = core.parseRawMail(latin1Eml, id = "eml-1")
        val messages = core.messages(listOf(mail), bodyFormat = BodyFormat.TEXT)
        assertEquals(listOf("eml-1"), messages.map { it.id })
        assertEquals(listOf("Café at one?"), messages.map { it.body })
    }

    // Regression: an undated raw mail must not be filed under 1970.
    @Test
    fun anUndatedMailComesOutWithNoDate() = withCore { core, _ ->
        val undated = core.parseRawMail("From: ann@acme.example\r\n\r\nhi".toByteArray())
        assertEquals(0L, undated.dateMillis)
        assertNull(core.messages(listOf(undated)).single().dateMillis)
    }

    // Regression: the isolate refuses an evaluation larger than a binder
    // transaction. A thread with a big body — and the core script itself —
    // must cross in pieces, in and out, and arrive whole.
    @Test
    fun largeStringsCrossInChunksAndArriveWhole() = withCore { core, engine ->
        val big = "😀 café ".repeat(40_000)
        val mail = Mail(id = "m1", fromAddress = "ann@acme.example", dateMillis = march3, body = "<div>$big</div>")
        val messages = core.messages(listOf(mail), bodyFormat = BodyFormat.TEXT)
        assertEquals(big.trim(), messages.single().body)
        assertTrue(engine.largestScript <= CoreProtocol.CHUNK_CHARS * 6 + 64)
    }

    @Test
    fun aCoreThatFailsToLoadClosesItsEngine() {
        val engine = GraalEngine()
        assertThrows(Exception::class.java) { runBlocking { EmailChatCore.load(engine, "throw new Error('broken')") } }
        assertTrue(engine.closed)
    }
}
