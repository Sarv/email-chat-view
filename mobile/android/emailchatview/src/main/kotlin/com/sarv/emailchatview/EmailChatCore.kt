package com.sarv.emailchatview

import android.content.Context
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.concurrent.futures.await
import androidx.javascriptengine.JavaScriptIsolate
import androidx.javascriptengine.JavaScriptSandbox
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** A failure inside the core: a request it could not read, or a raw message it could not parse. */
class EmailChatCoreException(message: String) : Exception(message)

/** Somewhere to run JavaScript and read back the result as a string. */
internal interface ScriptEngine : AutoCloseable {
    suspend fun evaluate(script: String): String
}

/**
 * The transform without the view — chat messages as data, for an app that
 * draws its own bubbles.
 *
 * It runs the very code the chat view runs, in a JavaScript isolate with no
 * WebView: `email-chat-core.js`, bundled with this library, in the sandboxed
 * V8 that `androidx.javascriptengine` provides. So a native list and
 * [EmailChatView] can never disagree about what a message says.
 *
 * ```kotlin
 * if (EmailChatCore.isSupported()) {
 *     EmailChatCore.create(context).use { core ->
 *         val mail = core.parseRawMail(emlBytes)
 *         val messages = core.messages(listOf(mail), bodyFormat = BodyFormat.TEXT)
 *     }
 * }
 * ```
 *
 * Keep one instance for the screen's lifetime and [close] it after: it holds
 * an isolate, and it remembers every body it has cleaned, so re-sending the
 * whole thread when one body arrives only cleans that body. Calls are
 * serialized, so it is safe from any coroutine.
 */
class EmailChatCore internal constructor(private val engine: ScriptEngine) : AutoCloseable {
    private val lock = Mutex()

    /**
     * The thread as chat messages, oldest first.
     *
     * @param mails The thread, in any order.
     * @param currentUserAddress The reader's address(es). Their messages get
     *   `isFromMe == true`; with none given, `isFromMe` stays null.
     * @param bodyFormat HTML (the default) or plain text.
     * @param containsThreadStart The oldest mail is the real start of the
     *   thread, so its quoted history is kept.
     * @param includeDrafts Keep drafts in the thread.
     */
    suspend fun messages(
        mails: List<Mail>,
        currentUserAddress: List<String> = emptyList(),
        bodyFormat: BodyFormat = BodyFormat.HTML,
        containsThreadStart: Boolean = true,
        includeDrafts: Boolean = false,
    ): List<ChatMessage> = lock.withLock {
        send(CoreProtocol.messagesRequest(mails, currentUserAddress, bodyFormat, containsThreadStart, includeDrafts))
        CoreProtocol.messagesOf(receive(CoreProtocol.HOLD_MESSAGES))
    }

    /**
     * A raw RFC 822 message — an `.eml` file, an IMAP `BODY[]` — as a [Mail].
     *
     * The body is the HTML part, or the text part as HTML when there is no HTML
     * part. With [inlineImages] `cid:` images point at the attached image as a
     * `data:` URI. A mail with no readable date gets `dateMillis == 0`, which
     * [messages] reports as an unknown (null) date.
     *
     * @param bytes The message exactly as stored.
     * @param id The mail's id in the thread. Defaults to its Message-ID.
     */
    suspend fun parseRawMail(bytes: ByteArray, id: String? = null, inlineImages: Boolean = true): Mail =
        lock.withLock {
            // One char per byte. Latin-1 maps every byte, so the core reads
            // the bytes back exactly.
            send(String(bytes, Charsets.ISO_8859_1))
            engine.evaluate(CoreProtocol.startParse(CoreProtocol.parseRequest(id, inlineImages)))
            // The parse settles in promise jobs, which the isolate runs once
            // the starting evaluation returns, so it is waiting by now.
            CoreProtocol.mailOf(receive(CoreProtocol.HOLD_PARSED))
        }

    override fun close() = engine.close()

    private suspend fun send(text: String) {
        engine.evaluate(CoreProtocol.CLEAR_INPUT)
        CoreProtocol.chunks(text).forEach { chunk -> engine.evaluate(CoreProtocol.appendInput(chunk)) }
    }

    private suspend fun receive(holdScript: String): String {
        val length = engine.evaluate(holdScript).toInt()
        val reply = StringBuilder(length)
        while (reply.length < length) reply.append(engine.evaluate(CoreProtocol.readOutput(reply.length)))
        engine.evaluate(CoreProtocol.RELEASE_OUTPUT)
        return reply.toString()
    }

    companion object {
        /**
         * Whether this device can run the core: Android 8.0 (API 26) or later,
         * with a WebView recent enough to provide the JavaScript sandbox.
         */
        fun isSupported(): Boolean =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && JavaScriptSandbox.isSupported()

        /**
         * Start a sandbox and load the core into it. Check [isSupported]
         * first; on a device without the sandbox this throws.
         */
        @RequiresApi(Build.VERSION_CODES.O)
        suspend fun create(context: Context): EmailChatCore {
            val source = withContext(Dispatchers.IO) {
                context.assets.open(CoreProtocol.ASSET).bufferedReader().use { it.readText() }
            }
            return load(SandboxEngine.connect(context.applicationContext), source)
        }

        /** The core, once [source] has run in [engine]. Closes the engine if it fails to. */
        internal suspend fun load(engine: ScriptEngine, source: String): EmailChatCore {
            val core = EmailChatCore(engine)
            try {
                core.send(source)
                engine.evaluate(CoreProtocol.RUN_INPUT)
            } catch (error: Exception) {
                engine.close()
                throw error
            }
            return core
        }
    }
}

/** A [ScriptEngine] on `androidx.javascriptengine`: one sandbox, one isolate. */
@RequiresApi(Build.VERSION_CODES.O)
private class SandboxEngine(
    private val sandbox: JavaScriptSandbox,
    private val isolate: JavaScriptIsolate,
) : ScriptEngine {
    override suspend fun evaluate(script: String): String = isolate.evaluateJavaScriptAsync(script).await()

    override fun close() {
        isolate.close()
        sandbox.close()
    }

    companion object {
        suspend fun connect(context: Context): SandboxEngine {
            val sandbox = JavaScriptSandbox.createConnectedInstanceAsync(context).await()
            return SandboxEngine(sandbox, sandbox.createIsolate())
        }
    }
}
