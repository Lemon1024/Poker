package org.rivernotes.poker;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.content.res.AssetManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/index.html";
    private static final String EQUITY = "https://" + HOST + "/equity.html";
    private static final String PREFLOP = "https://" + HOST + "/preflop/index.html";
    private static final String TRAINING = "https://" + HOST + "/training/index.html";
    private static final String STRATEGY = "https://" + HOST + "/strategy/index.html";
    private static final int BACKGROUND = 0xff101b19;
    private WebView browser;
    private HistoryStore history;

    @Override
    protected void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        boolean debug = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debug);
        browser = new WebView(this);
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        browser.setWebViewClient(new OfflineClient(getAssets()));
        history = new HistoryStore(getApplicationContext());
        browser.addJavascriptInterface(history, "RiverHistory");

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        browser.setBackgroundColor(BACKGROUND);
        root.addView(browser);
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets edges = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(edges.left, edges.top, edges.right, edges.bottom);
                return WindowInsets.CONSUMED;
            });
        } else {
            getWindow().setStatusBarColor(BACKGROUND);
            getWindow().setNavigationBarColor(BACKGROUND);
        }
        setContentView(root);
        browser.loadUrl(HOME);
    }

    private static final class OfflineClient extends WebViewClient {
        private final AssetManager assets;
        private final boolean hasStrategy;

        OfflineClient(AssetManager assets) {
            this.assets = assets;
            boolean installed = false;
            try {
                String[] files = assets.list("strategy");
                installed = files != null && Arrays.asList(files).contains("index.html");
            } catch (IOException unavailable) {
                // The equity edition has no strategy assets.
            }
            hasStrategy = installed;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String url = request.getUrl().buildUpon().fragment(null).build().toString();
            return !request.isForMainFrame() || !(HOME.equals(url) || EQUITY.equals(url)
                    || PREFLOP.equals(url) || TRAINING.equals(url)
                    || (hasStrategy && STRATEGY.equals(url)));
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (hasStrategy && HOME.equals(Uri.parse(url).buildUpon().fragment(null).build().toString())) {
                view.evaluateJavascript("var link=document.getElementById('open-strategy');"
                        + "if(link)link.hidden=false;", null);
            }
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!"GET".equals(request.getMethod()) || !"https".equals(uri.getScheme())
                    || !HOST.equals(uri.getEncodedAuthority()) || uri.getQuery() != null) {
                return emptyResponse(403, "Forbidden");
            }
            String path = uri.getEncodedPath();
            if (path == null) return emptyResponse(404, "Not Found");
            String mime;
            switch (path) {
                case "/index.html":
                case "/equity.html":
                case "/preflop/index.html":
                case "/training/index.html":
                case "/strategy/index.html": mime = "text/html"; break;
                case "/web/style.css":
                case "/web/camp.css":
                case "/preflop/style.css":
                case "/training/style.css":
                case "/strategy/style.css": mime = "text/css"; break;
                case "/preflop/ranges.js":
                case "/preflop/advice.js":
                case "/preflop/ui.js":
                case "/training/session.js":
                case "/training/ui.js":
                case "/web/home.js":
                case "/strategy/evaluate.js":
                case "/strategy/insights.js":
                case "/strategy/runner.js":
                case "/strategy/solver.js":
                case "/strategy/ui.js":
                case "/web/equity.js":
                case "/web/runner.js":
                case "/web/app.js": mime = "application/javascript"; break;
                case "/favicon.ico": return emptyResponse(204, "No Content");
                default: return emptyResponse(404, "Not Found");
            }
            try {
                InputStream stream = assets.open(path.substring(1));
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-store");
                headers.put("X-Content-Type-Options", "nosniff");
                if ("text/html".equals(mime)) {
                    headers.put("Content-Security-Policy", "default-src 'none'; script-src 'self'; "
                            + "style-src 'self' 'unsafe-inline'; worker-src blob:; child-src blob:; "
                            + "frame-src 'none'; img-src 'self' data:; base-uri 'none'; form-action 'none'");
                }
                return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, stream);
            } catch (IOException unavailable) {
                return emptyResponse(404, "Not Found");
            }
        }

        private static WebResourceResponse emptyResponse(int status, String reason) {
            return new WebResourceResponse("text/plain", "UTF-8", status, reason, null, null);
        }
    }

    @Override
    public void onBackPressed() {
        // Both the card picker and the saved-hand list use a native HTML dialog.
        WebView current = browser;
        current.evaluateJavascript("(function(){var d=document.querySelector('dialog[open]');"
                + "if(d){d.close();return true;}return false;})()", handled -> {
            if (browser != current || isFinishing() || "true".equals(handled)) return;
            if (current.canGoBack()) current.goBack();
            else finish();
        });
    }

    @Override
    protected void onPause() {
        browser.evaluateJavascript("(function(){var b=document.getElementById('gto-pause')"
                + "||document.getElementById('cancel');if(b&&!b.hidden&&!b.disabled)b.click();})()", null);
        browser.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        browser.onResume();
    }

    @Override
    protected void onDestroy() {
        browser.stopLoading();
        ((ViewGroup) browser.getParent()).removeView(browser);
        browser.destroy();
        history.close();
        browser = null;
        super.onDestroy();
    }
}
