
package com.yashwin.appstore;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.util.Collections;

public class MainActivity extends Activity {
    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private AppUpdateBridge updateBridge;

    private boolean isTrustedLocalUrl(Uri uri) {
        return uri != null
                && "https".equals(uri.getScheme())
                && "appassets.androidplatform.net".equals(uri.getHost())
                && uri.getPath() != null
                && uri.getPath().startsWith("/assets/");
    }

    private boolean handleNavigation(Uri uri) {
        if (isTrustedLocalUrl(uri)) return false;

        if (uri != null) {
            String scheme = uri.getScheme();
            if ("https".equals(scheme) || "http".equals(scheme)) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {}
            }
        }
        return true;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler(
                        "/assets/",
                        new WebViewAssetLoader.AssetsPathHandler(this)
                )
                .build();

        webView = new WebView(this);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(
                WebSettings.MIXED_CONTENT_NEVER_ALLOW
        );

        updateBridge = new AppUpdateBridge(this);

        if (!WebViewFeature.isFeatureSupported(
                WebViewFeature.WEB_MESSAGE_LISTENER)) {
            throw new IllegalStateException(
                    "Secure WebMessageListener is not supported by this WebView."
            );
        }

        WebViewCompat.addWebMessageListener(
                webView,
                "YashwinNative",
                Collections.singleton("https://appassets.androidplatform.net"),
                (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                    if (!isMainFrame
                            || sourceOrigin == null
                            || !"https".equals(sourceOrigin.getScheme())
                            || !"appassets.androidplatform.net".equals(
                                    sourceOrigin.getHost())) {
                        return;
                    }

                    updateBridge.handleMessage(
                            message.getData(),
                            replyProxy
                    );
                }
        );

        webView.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view,
                    WebResourceRequest request
            ) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(
                    WebView view,
                    WebResourceRequest request
            ) {
                Uri uri = request.getUrl();

                if (!request.isForMainFrame()) {
                    return !isTrustedLocalUrl(uri);
                }

                return handleNavigation(uri);
            }

            @Override
            public boolean shouldOverrideUrlLoading(
                    WebView view,
                    String url
            ) {
                return handleNavigation(Uri.parse(url));
            }
        });

        setContentView(webView);

        webView.loadUrl(
                "https://appassets.androidplatform.net/assets/www/index.html"
        );
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (updateBridge != null) updateBridge.onHostResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            WebViewCompat.removeWebMessageListener(
                    webView,
                    "YashwinNative"
            );
            webView.destroy();
            webView = null;
        }

        if (updateBridge != null) {
            updateBridge.shutdown();
            updateBridge = null;
        }

        super.onDestroy();
    }
}
