package com.sarv.emailchatview

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class CoreProtocolTest {
    @Test
    fun chunksCoverTheTextExactly() {
        assertEquals(emptyList<String>(), CoreProtocol.chunks(""))
        assertEquals(listOf("abc", "de"), CoreProtocol.chunks("abcde", size = 3))
    }

    // Regression: half a surrogate pair is not a character. Sent on its own it
    // is mangled in transit, and the emoji it belonged to is lost.
    @Test
    fun chunksNeverSplitASurrogatePair() {
        val text = "ab😀cd"
        val pieces = CoreProtocol.chunks(text, size = 3)
        assertEquals(listOf("ab", "😀c", "d"), pieces)
        assertEquals(text, pieces.joinToString(""))
    }

    @Test
    fun aFailedReplyThrowsTheCoresMessage() {
        val failed = assertThrows(EmailChatCoreException::class.java) {
            CoreProtocol.messagesOf("""{"ok":false,"error":"Unexpected token"}""")
        }
        assertEquals("Unexpected token", failed.message)
        assertThrows(EmailChatCoreException::class.java) { CoreProtocol.mailOf("""{"ok":true}""") }
        assertThrows(EmailChatCoreException::class.java) { CoreProtocol.messagesOf("""{"ok":true,"value":{}}""") }
        assertThrows(EmailChatCoreException::class.java) { CoreProtocol.mailOf("not json") }
    }

    @Test
    fun readsEveryChatMessageField() {
        val reply = """{"ok":true,"value":[{"id":"m1","fromAddress":"a@x","date":null,"body":"Hi",
            "fromName":"Ann","toAddress":"b@x","toNames":"Bob","ccAddress":null,"dateApprox":true,
            "attachments":[{"filename":"q.pdf","sizeBytes":3}],"isFromMe":false,"bodyPending":true,
            "applied":["marker:wrote-attribution"],"sourceId":"m0"}]}"""
        val message = CoreProtocol.messagesOf(reply).single()
        assertEquals(
            ChatMessage(
                id = "m1",
                fromAddress = "a@x",
                dateMillis = null,
                body = "Hi",
                fromName = "Ann",
                toAddress = "b@x",
                toNames = "Bob",
                dateApprox = true,
                attachments = listOf(Attachment("q.pdf", sizeBytes = 3)),
                isFromMe = false,
                bodyPending = true,
                applied = listOf("marker:wrote-attribution"),
                sourceId = "m0",
            ),
            message,
        )
        assertNull(CoreProtocol.messagesOf("""{"ok":true,"value":[{"id":"m","fromAddress":"a","date":1,"body":""}]}""").single().isFromMe)
    }
}
