package com.yashwin.aitrading

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

/**
 * YASHWIN AI Trading — Native Android Container (Task 18)
 *
 * Security & Safety Invariants:
 * - Strictly PAPER MODE ONLY (BuildConfig.TRADING_MODE == "paper", BuildConfig.LIVE_TRADING_ENABLED == false)
 * - Zero embedded Angel One or Google AI credentials in APK, resources, or BuildConfig
 * - Strict TLS certificate validation (never calls SslErrorHandler.proceed())
 * - Zero unrestricted addJavascriptInterface bridges
 * - Same-origin navigation lock; external links open safely in system browser
 * - Back button navigates internal SPA / WebView history without accidental logout
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val PREFS_NAME = "yashwin_android_endpoint_prefs"
        private const val PREF_KEY_CUSTOM_BACKEND_URL = "custom_backend_url"
    }

    private lateinit var webView: WebView
    private lateinit var loadingOverlay: LinearLayout
    private lateinit var errorOverlay: LinearLayout
    private lateinit var errorDescriptionText: TextView
    private lateinit var errorDiagnosticText: TextView
    private lateinit var retryButton: Button

    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var hasFatalLoadError = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Enforce paper-only compile-time invariant
        check(BuildConfig.TRADING_MODE == "paper" && !BuildConfig.LIVE_TRADING_ENABLED) {
            "SAFETY_VIOLATION: Android build must remain strictly in PAPER mode with LIVE_TRADING_ENABLED=false."
        }

        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.tradingWebView)
        loadingOverlay = findViewById(R.id.loadingOverlay)
        errorOverlay = findViewById(R.id.errorOverlay)
        errorDescriptionText = findViewById(R.id.errorDescriptionText)
        errorDiagnosticText = findViewById(R.id.errorDiagnosticText)
        retryButton = findViewById(R.id.retryButton)

        configureSecureCookies()
        configureSecureWebView()
        configureBackNavigation()
        registerConnectivityMonitor()

        retryButton.setOnClickListener {
            loadBackendApplication()
        }

        retryButton.setOnLongClickListener {
            promptServerUrlOverride()
            true
        }

        errorDiagnosticText.setOnClickListener {
            promptServerUrlOverride()
        }

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            loadBackendApplication()
        }
    }

    private fun resolveTargetBackendUrl(): String {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val overrideUrl = prefs.getString(PREF_KEY_CUSTOM_BACKEND_URL, null)?.trim()
        if (!overrideUrl.isNullOrBlank()) {
            return overrideUrl
        }
        val configuredUrl = BuildConfig.BACKEND_BASE_URL.trim()
        // Guard against accidental localhost on physical devices
        return configuredUrl
    }

    private fun isValidSafeBackendUrl(candidate: String): Boolean {
        val trimmed = candidate.trim()
        if (trimmed.isEmpty()) return false
        if (trimmed.contains("localhost", ignoreCase = true) || trimmed.contains("127.0.0.1")) {
            return false
        }
        return trimmed.startsWith("https://", ignoreCase = true) ||
            trimmed.startsWith("http://10.0.2.2", ignoreCase = true)
    }

    private fun promptServerUrlOverride() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setText(resolveTargetBackendUrl())
            setSelection(text.length)
        }

        AlertDialog.Builder(this)
            .setTitle(R.string.configure_endpoint)
            .setMessage("Enter deployed HTTPS backend URL (or http://10.0.2.2:3000 for Android Emulator). Paper Mode Only.")
            .setView(input)
            .setPositiveButton("Save & Connect") { _, _ ->
                val entered = input.text?.toString()?.trim() ?: ""
                if (isValidSafeBackendUrl(entered)) {
                    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        .edit()
                        .putString(PREF_KEY_CUSTOM_BACKEND_URL, entered)
                        .apply()
                    loadBackendApplication()
                } else {
                    showRecoverableError(
                        "Invalid URL ($entered). Production physical devices require an https:// URL (never localhost or 127.0.0.1)."
                    )
                }
            }
            .setNeutralButton("Reset Default") { _, _ ->
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .remove(PREF_KEY_CUSTOM_BACKEND_URL)
                    .apply()
                loadBackendApplication()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun configureSecureCookies() {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, false)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureSecureWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.allowFileAccessFromFileURLs = false
        settings.allowUniversalAccessFromFileURLs = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mediaPlaybackRequiresUserGesture = false
        settings.setSupportZoom(false)

        // Append native container identifier for client diagnostics (zero secrets)
        val baseUa = settings.userAgentString ?: ""
        settings.userAgentString = "$baseUa YashwinAndroidAPK/${BuildConfig.VERSION_NAME} (PaperModeOnly)"

        webView.webChromeClient = WebChromeClient()

        webView.webViewClient = object : WebViewClient() {

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val requestUri = request?.url ?: return false
                val targetBaseUri = Uri.parse(resolveTargetBackendUrl())

                // Only allow same-origin navigation inside the trading WebView
                val isSameHost = requestUri.host.equals(targetBaseUri.host, ignoreCase = true)
                val isAllowedScheme = requestUri.scheme == "https" ||
                    (requestUri.scheme == "http" && requestUri.host == "10.0.2.2")

                if (isSameHost && isAllowedScheme) {
                    return false
                }

                // External links open safely in the system browser
                if (requestUri.scheme == "https" || requestUri.scheme == "http") {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, requestUri))
                    } catch (_: Exception) {}
                }
                return true
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                if (!hasFatalLoadError) {
                    errorOverlay.visibility = View.GONE
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                CookieManager.getInstance().flush()
                if (!hasFatalLoadError) {
                    loadingOverlay.visibility = View.GONE
                    errorOverlay.visibility = View.GONE
                    webView.visibility = View.VISIBLE
                }
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request != null && request.isForMainFrame) {
                    hasFatalLoadError = true
                    val desc = error?.description?.toString() ?: "Unable to reach server."
                    showRecoverableError(
                        "Connection to YASHWIN AI Trading server failed ($desc). No synthetic market prices or signals are displayed while offline."
                    )
                }
            }

            override fun onReceivedHttpError(
                view: WebView?,
                request: WebResourceRequest?,
                errorResponse: WebResourceResponse?
            ) {
                super.onReceivedHttpError(view, request, errorResponse)
                val statusCode = errorResponse?.statusCode ?: 0
                if (request != null && request.isForMainFrame && statusCode >= 400) {
                    hasFatalLoadError = true
                    val failedUrl = request.url?.toString() ?: resolveTargetBackendUrl()
                    showRecoverableError(
                        "Backend server returned HTTP $statusCode at $failedUrl. Ensure your YASHWIN backend service is deployed and running, or tap the diagnostic note below to update the HTTPS Backend URL."
                    )
                }
            }

            override fun onReceivedSslError(
                view: WebView?,
                handler: SslErrorHandler?,
                error: SslError?
            ) {
                // CRITICAL SECURITY RULE: Never bypass TLS certificate errors
                handler?.cancel()
                hasFatalLoadError = true
                showRecoverableError(
                    "TLS/SSL Certificate Validation Failed. Connection aborted to protect your session and paper-trading account."
                )
            }
        }
    }

    private fun configureBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (errorOverlay.visibility == View.VISIBLE) {
                    loadBackendApplication()
                    return
                }
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    // Ask the SPA to return to the Dashboard before minimizing the app
                    webView.evaluateJavascript(
                        "(function() { var active = window.state && (window.state.activePage || window.state.currentPage); if (typeof switchPage === 'function' && active && active !== 'dashboard') { switchPage('dashboard', { fromHistory: true }); return 'HANDLED'; } return 'ROOT'; })();"
                    ) { result ->
                        if (result != null && result.contains("HANDLED")) {
                            // Handled inside SPA
                        } else {
                            moveTaskToBack(true)
                        }
                    }
                }
            }
        })
    }

    private fun isNetworkAvailable(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun registerConnectivityMonitor() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        connectivityManager = cm
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                runOnUiThread {
                    if (hasFatalLoadError && errorOverlay.visibility == View.VISIBLE) {
                        loadBackendApplication()
                    }
                }
            }
        }
        networkCallback = callback
        try {
            cm.registerDefaultNetworkCallback(callback)
        } catch (_: Exception) {}
    }

    private fun loadBackendApplication() {
        val targetUrl = resolveTargetBackendUrl()

        if (targetUrl.contains("localhost") || targetUrl.contains("127.0.0.1")) {
            hasFatalLoadError = true
            showRecoverableError(
                "Invalid Backend URL ($targetUrl). On an Android phone, localhost refers to the phone itself. Configure the deployed HTTPS URL or 10.0.2.2 for Android Emulator."
            )
            return
        }

        if (!isNetworkAvailable()) {
            hasFatalLoadError = true
            showRecoverableError(
                "Device is currently offline. Connect to Wi-Fi or mobile data to access real-time market quotes and your isolated paper trading account."
            )
            return
        }

        hasFatalLoadError = false
        loadingOverlay.visibility = View.VISIBLE
        errorOverlay.visibility = View.GONE
        webView.loadUrl(targetUrl)
    }

    private fun showRecoverableError(message: String) {
        loadingOverlay.visibility = View.GONE
        webView.visibility = View.INVISIBLE
        errorOverlay.visibility = View.VISIBLE
        errorDescriptionText.text = message
        errorDiagnosticText.text = getString(R.string.localhost_warning_note)
    }

    /**
     * Clears WebView cookies and storage when explicit full sign-out is requested.
     */
    fun clearAndroidWebViewSessionOnLogout() {
        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().flush()
        WebStorage.getInstance().deleteAllData()
        webView.clearCache(true)
        webView.clearHistory()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        networkCallback?.let { cb ->
            try {
                connectivityManager?.unregisterNetworkCallback(cb)
            } catch (_: Exception) {}
        }
        webView.destroy()
        super.onDestroy()
    }
}
