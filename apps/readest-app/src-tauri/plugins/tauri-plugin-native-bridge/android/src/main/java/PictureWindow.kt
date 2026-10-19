package com.readest.native_bridge

import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.InputDevice
import android.view.KeyCharacterMap
import android.view.MotionEvent
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Mirrors `PictureWindowRequest` in the plugin's models.rs. */
@InvokeArg
class PictureWindowArgs {
    // open | eval | state | tap | type | status | hide | close
    var action: String? = null
    var url: String? = null
    var title: String? = null
    var expression: String? = null
    var x: Double? = null
    var y: Double? = null
    // The page's CSS viewport width, to turn CSS pixels into view pixels.
    var viewportWidth: Double? = null
    var text: String? = null
}

/**
 * ShortReader's picture window on Android: Google Flow or Grok Imagine in a
 * WebView of the app's own, full screen, where the reader signs in once
 * (cookies persist). The JS side (services/imagegen/androidWindow.ts) drives
 * the page with the same page scripts the desktop app uses: it evaluates
 * scripts here, taps with real touch events (some buttons ignore scripted
 * clicks), and types with real key events.
 *
 * Google may refuse Google-account sign-in inside an app's WebView; nothing
 * here tries to get around that.
 */
class PictureWindow(private val activity: Activity) {
    private val main = Handler(Looper.getMainLooper())
    private var dialog: Dialog? = null
    private var webView: WebView? = null
    private var statusView: TextView? = null
    // Evaluations waiting for their page script to call back.
    private val pending = ConcurrentHashMap<String, Invoke>()

    private inner class Bridge {
        @JavascriptInterface
        fun done(id: String, json: String) {
            pending.remove(id)?.let { invoke ->
                val ret = JSObject()
                ret.put("json", json)
                invoke.resolve(ret)
            }
        }
    }

    fun handle(invoke: Invoke, args: PictureWindowArgs) {
        main.post {
            try {
                when (args.action) {
                    "open" -> open(invoke, args)
                    "eval" -> evaluate(invoke, args.expression ?: "null")
                    "state" -> state(invoke)
                    "tap" -> tap(invoke, args)
                    "type" -> type(invoke, args.text ?: "")
                    "status" -> {
                        statusView?.text = args.text ?: ""
                        invoke.resolve(JSObject())
                    }
                    // Out of sight but loaded, so the next picture starts at once.
                    "hide" -> {
                        CookieManager.getInstance().flush()
                        dialog?.dismiss()
                        invoke.resolve(JSObject())
                    }
                    "close" -> {
                        close()
                        invoke.resolve(JSObject())
                    }
                    else -> invoke.reject("Unknown picture window action ${args.action}")
                }
            } catch (e: Exception) {
                invoke.reject("Picture window: ${e.message}")
            }
        }
    }

    private fun open(invoke: Invoke, args: PictureWindowArgs) {
        val wv = webView ?: createWindow()
        args.title?.let { statusView?.text = it }
        val url = args.url
        if (url != null && (wv.url.isNullOrEmpty() || wv.url == "about:blank")) {
            wv.loadUrl(url)
        }
        dialog?.show()
        invoke.resolve(JSObject())
    }

    private fun createWindow(): WebView {
        val wv = WebView(activity)
        wv.settings.javaScriptEnabled = true
        wv.settings.domStorageEnabled = true
        wv.settings.databaseEnabled = true
        wv.settings.mediaPlaybackRequiresUserGesture = false
        wv.settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)
        // Keep every navigation (sign-in included) inside this window.
        wv.webViewClient = WebViewClient()
        wv.webChromeClient = WebChromeClient()
        wv.addJavascriptInterface(Bridge(), "ShortReaderPicture")

        val status = TextView(activity).apply {
            setTextColor(Color.WHITE)
            textSize = 14f
            setPadding(32, 24, 16, 24)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        val hide = Button(activity).apply {
            text = "Close"
            setOnClickListener { dialog?.dismiss() }
        }
        val bar = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#202124"))
            addView(status)
            addView(hide)
        }
        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(wv, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        val d = Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        d.setContentView(root)
        d.setOnBackPressedFallback(wv)
        // Closing the window (button or back) stops any wait in progress.
        d.setOnDismissListener { failPending("The picture window was closed.") }

        webView = wv
        statusView = status
        dialog = d
        return wv
    }

    private fun Dialog.setOnBackPressedFallback(wv: WebView) {
        setOnKeyListener { _, keyCode, event ->
            if (keyCode == android.view.KeyEvent.KEYCODE_BACK &&
                event.action == android.view.KeyEvent.ACTION_UP && wv.canGoBack()
            ) {
                wv.goBack()
                true
            } else {
                false
            }
        }
    }

    /** Run an (async) expression in the page; resolves `{ json }` with
     * `{ ok, value }` or `{ ok: false, error }`. */
    private fun evaluate(invoke: Invoke, expression: String) {
        val wv = webView ?: return invoke.reject("The picture window is not open")
        val id = UUID.randomUUID().toString()
        pending[id] = invoke
        val script = """
            (async () => {
              const send = (r) => window.ShortReaderPicture.done('$id', JSON.stringify(r));
              try {
                const value = await ($expression);
                send({ ok: true, value: value === undefined ? null : value });
              } catch (e) {
                send({ ok: false, error: String((e && e.message) || e) });
              }
            })();
        """.trimIndent()
        wv.evaluateJavascript(script, null)
    }

    private fun state(invoke: Invoke) {
        val ret = JSObject()
        ret.put("url", webView?.url ?: "")
        ret.put("open", dialog?.isShowing == true)
        invoke.resolve(ret)
    }

    /** A real touch at CSS pixel (x, y): some buttons ignore scripted clicks. */
    private fun tap(invoke: Invoke, args: PictureWindowArgs) {
        val wv = webView ?: return invoke.reject("The picture window is not open")
        val cssWidth = args.viewportWidth ?: 0.0
        val scale = if (cssWidth > 0) wv.width / cssWidth else activity.resources.displayMetrics.density.toDouble()
        val x = ((args.x ?: 0.0) * scale).toFloat()
        val y = ((args.y ?: 0.0) * scale).toFloat()
        val downAt = SystemClock.uptimeMillis()
        val down = MotionEvent.obtain(downAt, downAt, MotionEvent.ACTION_DOWN, x, y, 0)
        down.source = InputDevice.SOURCE_TOUCHSCREEN
        wv.dispatchTouchEvent(down)
        down.recycle()
        main.postDelayed({
            val upAt = SystemClock.uptimeMillis()
            val up = MotionEvent.obtain(downAt, upAt, MotionEvent.ACTION_UP, x, y, 0)
            up.source = InputDevice.SOURCE_TOUCHSCREEN
            wv.dispatchTouchEvent(up)
            up.recycle()
            invoke.resolve(JSObject())
        }, 60)
    }

    /** Type with real key events, as a keyboard would. Resolves `{ typed }`:
     * false when some character has no key (the caller falls back). */
    private fun type(invoke: Invoke, text: String) {
        val wv = webView ?: return invoke.reject("The picture window is not open")
        val events = KeyCharacterMap.load(KeyCharacterMap.VIRTUAL_KEYBOARD).getEvents(text.toCharArray())
        val ret = JSObject()
        if (events == null) {
            ret.put("typed", false)
            invoke.resolve(ret)
            return
        }
        wv.requestFocus()
        for (event in events) wv.dispatchKeyEvent(event)
        ret.put("typed", true)
        invoke.resolve(ret)
    }

    private fun failPending(message: String) {
        val ids = pending.keys.toList()
        for (id in ids) pending.remove(id)?.reject(message)
    }

    fun close() {
        CookieManager.getInstance().flush()
        failPending("The picture window was closed.")
        dialog?.setOnDismissListener(null)
        dialog?.dismiss()
        webView?.let {
            it.stopLoading()
            it.destroy()
        }
        dialog = null
        webView = null
        statusView = null
    }
}
