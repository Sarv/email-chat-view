# The page calls `postMessage` by name through the WebView bridge. R8 cannot
# see that call, so without this an app's release build strips or renames the
# method and every chat event is silently lost.
-keepclassmembers class com.sarv.emailchatview.** {
    @android.webkit.JavascriptInterface <methods>;
}
