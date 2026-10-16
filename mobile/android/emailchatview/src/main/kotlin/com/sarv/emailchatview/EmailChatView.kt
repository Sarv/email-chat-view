package com.sarv.emailchatview

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.AttributeSet
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONException

private const val TAG = "EmailChatView"

/**
 * The chat view: a [WebView] running the bundled page, driven by [render] and
 * reporting reader actions through [onEvent].
 *
 * ```kotlin
 * val chat = EmailChatView(context)
 * chat.onEvent = { event ->
 *     when (event) {
 *         is ChatEvent.OpenLink -> startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(event.url)))
 *         is ChatEvent.VisibleRange -> store.fetchBodies(event.mailIds)
 *         else -> Unit
 *     }
 * }
 * chat.render(ThreadState(mails = mails, currentUserAddress = listOf("me@acme.com")))
 * ```
 *
 * Call [destroy] when the host is done with the view (an Activity's
 * `onDestroy`, a Compose `onRelease`).
 */
class EmailChatView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : FrameLayout(context, attrs) {
    /** Reader actions. Called on the main thread. */
    var onEvent: ((ChatEvent) -> Unit)? = null

    private val mainThread = Handler(Looper.getMainLooper())
    private var webView = createWebView()
    private var isReady = false

    /** The latest state, held until the page says `ready`. */
    private var pending: ThreadState? = null
    private var rendered: ThreadState? = null

    /**
     * Show [state]. Safe to call before the page has loaded: the latest state
     * is held and rendered as soon as it is ready, and an unchanged state is
     * not sent twice. Main thread only.
     */
    fun render(state: ThreadState) {
        pending = state
        flush()
    }

    /** Release the WebView. The view cannot be used afterwards. */
    fun destroy() {
        onEvent = null
        removeView(webView)
        webView.destroy()
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun createWebView(): WebView = WebView(context).apply {
        settings.javaScriptEnabled = true
        // The page is a bundled asset and every message frame is `srcdoc`;
        // nothing here needs the file system or content providers.
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        // No white flash before the page paints in dark mode.
        setBackgroundColor(Color.TRANSPARENT)
        addJavascriptInterface(PageBridge(), Bridge.INTERFACE_NAME)
        webViewClient = ChatWebViewClient()
        this@EmailChatView.addView(this, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        loadUrl(Bridge.PAGE_URL)
    }

    private fun flush() {
        if (!isReady) return
        val state = pending ?: return
        pending = null
        if (state == rendered) return
        rendered = state
        webView.evaluateJavascript(Bridge.renderScript(state)) { result ->
            if (result != "\"ok\"") Log.e(TAG, "render failed: $result")
        }
    }

    private fun receive(json: String) {
        val event = try {
            Bridge.decodeEvent(json)
        } catch (error: JSONException) {
            Log.e(TAG, "unreadable chat event: $json", error)
            return
        }
        if (event == ChatEvent.Ready) {
            isReady = true
            // A reload (after the renderer died) starts from an empty page, so
            // the last state must go again.
            pending = pending ?: rendered
            rendered = null
            flush()
            return
        }
        onEvent?.invoke(event)
    }

    /** What the page calls as `window.EmailChatViewAndroid.postMessage(json)`. */
    private inner class PageBridge {
        // Called on a WebView background thread; everything else here is main-thread.
        @JavascriptInterface
        fun postMessage(json: String) {
            mainThread.post { receive(json) }
        }
    }

    private inner class ChatWebViewClient : WebViewClient() {
        /** Any navigation away from the page is a link, handed to the app. */
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (url.toString() == Bridge.PAGE_URL || url.scheme == "about") return false
            onEvent?.invoke(ChatEvent.OpenLink(url.toString()))
            return true
        }

        /**
         * The renderer was killed (memory pressure) or crashed. A WebView is
         * unusable after this, so build a fresh one; its `ready` re-sends the
         * last state. Returning true keeps the app process alive.
         */
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Log.w(TAG, "renderer gone (crashed: ${detail.didCrash()}); reloading")
            }
            removeView(view)
            view.destroy()
            isReady = false
            webView = createWebView()
            return true
        }
    }
}
