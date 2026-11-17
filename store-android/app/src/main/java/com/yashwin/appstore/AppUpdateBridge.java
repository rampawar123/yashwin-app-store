
package com.yashwin.appstore;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.webkit.JavaScriptReplyProxy;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

public class AppUpdateBridge {
    private final Activity activity;
    private final ExecutorService executor =
            Executors.newSingleThreadExecutor();
    private volatile boolean closed = false;
    private volatile boolean installing = false;
    private volatile File pendingInstallerFile;

    private static class AppInfo {
        final String packageName;
        final String apkFile;
        final String cert;

        AppInfo(String packageName, String apkFile, String cert) {
            this.packageName = packageName;
            this.apkFile = apkFile;
            this.cert = cert;
        }
    }

    private final Map<String, AppInfo> apps = new HashMap<>();

    public AppUpdateBridge(Activity activity) {
        this.activity = activity;

        apps.put("calculator", new AppInfo(
                "com.yashwin.calculator",
                "VANSH-CALCULATOR.apk",
                "7dc0c5364c5512b60ddaef3fa43da15d7b0d0410eaf530d3c48faa333c2b06f7"
        ));

        apps.put("cric-yuva", new AppInfo(
                "com.yashwin.cricyuva",
                "CRIC-YUVA.apk",
                "53d2b1acab2a6238193ae9c1daf1b30165ff4f099a03ef7c3f366bdda98f8207"
        ));

        apps.put("hi-ram", new AppInfo(
                "com.example.hiram",
                "HI-RAM.apk",
                "7d3d74d5309c85ece9efef44ed8ff68286b1b5400652bcea35967b171ced891b"
        ));
    }

    public void handleMessage(
            String message,
            JavaScriptReplyProxy replyProxy
    ) {
        JSONObject response = new JSONObject();

        try {
            JSONObject request = new JSONObject(message);
            String action = request.optString("action");
            String requestId = request.optString("requestId");

            response.put("requestId", requestId);
            response.put("ok", true);

            if ("getInstalledApps".equals(action)) {
                response.put(
                        "data",
                        new JSONArray(getInstalledAppsJson())
                );
            } else if ("installApp".equals(action)) {
                String appId = request.optString("appId");

                if (!apps.containsKey(appId)) {
                    throw new Exception("Unknown app selection.");
                }

                installApp(appId);
                response.put("data", "started");
            } else {
                throw new Exception("Unknown native action.");
            }

        } catch (Exception e) {
            try {
                response.put("ok", false);
                response.put("error", e.getMessage() == null
                        ? "Native request failed."
                        : e.getMessage());
            } catch (Exception ignored) {}
        }

        if (!closed) {
            replyProxy.postMessage(response.toString());
        }
    }

    public String getInstalledAppsJson() {
        JSONArray result = new JSONArray();
        PackageManager pm = activity.getPackageManager();

        for (Map.Entry<String, AppInfo> entry : apps.entrySet()) {
            JSONObject item = new JSONObject();
            AppInfo app = entry.getValue();

            try {
                PackageInfo info = pm.getPackageInfo(app.packageName, 0);

                item.put("id", entry.getKey());
                item.put("installed", true);
                item.put("packageName", app.packageName);
                item.put("versionCode", Build.VERSION.SDK_INT >= 28
                        ? info.getLongVersionCode()
                        : info.versionCode);
                item.put("versionName",
                        info.versionName == null ? "" : info.versionName);

            } catch (PackageManager.NameNotFoundException e) {
                try {
                    item.put("id", entry.getKey());
                    item.put("installed", false);
                    item.put("packageName", app.packageName);
                    item.put("versionCode", 0);
                    item.put("versionName", "");
                } catch (Exception ignored) {}
            } catch (Exception ignored) {}

            result.put(item);
        }

        return result.toString();
    }

    public void installApp(String appId) {
        final AppInfo app = apps.get(appId);

        if (app == null) {
            showMessage("Unknown app selection.");
            return;
        }

        if (closed) {
            showMessage("Store is closing. Please try again.");
            return;
        }

        if (installing) {
            showMessage("An APK installation is already in progress.");
            return;
        }

        installing = true;

        try {
            executor.execute(() -> downloadAndInstall(app));
        } catch (RejectedExecutionException e) {
            installing = false;
            showMessage("Update service is unavailable. Please reopen Store.");
        }
    }

    private void downloadAndInstall(AppInfo app) {
        File apk = null;
        HttpURLConnection connection = null;

        try {
            URL url = new URL(
                    "https://raw.githubusercontent.com/rampawar123/yashwin-app-store/main/"
                            + app.apkFile
            );

            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(60000);
            connection.setInstanceFollowRedirects(true);
            connection.connect();

            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new Exception(
                        "APK download failed: HTTP "
                                + connection.getResponseCode()
                );
            }

            int length = connection.getContentLength();

            if (length > 100 * 1024 * 1024) {
                throw new Exception("APK file is too large.");
            }

            File externalDirectory = activity.getExternalFilesDir(null);

            if (externalDirectory == null || closed) {
                throw new Exception("App storage is unavailable.");
            }

            File directory = new File(externalDirectory, "updates");

            if (!directory.exists() && !directory.mkdirs()) {
                throw new Exception("Cannot create download folder.");
            }

            apk = new File(directory, app.apkFile + ".download");

            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(apk)) {

                byte[] buffer = new byte[8192];
                int count;
                long total = 0;

                while ((count = input.read(buffer)) != -1) {
                    if (closed) {
                        throw new Exception("Store is closing.");
                    }

                    total += count;

                    if (total > 100L * 1024L * 1024L) {
                        throw new Exception("APK exceeds the 100 MB limit.");
                    }

                    output.write(buffer, 0, count);
                }

                output.getFD().sync();
            }

            verifyApk(apk, app);

            if (closed) {
                throw new Exception("Store is closing.");
            }

            File ready = new File(directory, app.apkFile);

            if (ready.exists() && !ready.delete()) {
                throw new Exception("Cannot replace temporary APK.");
            }

            if (!apk.renameTo(ready)) {
                throw new Exception("Cannot finalize APK download.");
            }

            apk = ready;

            final Uri uri = FileProvider.getUriForFile(
                    activity,
                    activity.getPackageName() + ".fileprovider",
                    ready
            );

            activity.runOnUiThread(() -> {
                try {
                    if (closed) return;

                    if (Build.VERSION.SDK_INT >= 26
                            && !activity.getPackageManager()
                            .canRequestPackageInstalls()) {
                        pendingInstallerFile = ready;
                        Intent settings = new Intent(
                                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + activity.getPackageName())
                        );
                        activity.startActivity(settings);
                        Toast.makeText(
                                activity,
                                "Allow installs. The downloaded APK will open automatically.",
                                Toast.LENGTH_LONG
                        ).show();
                        return;
                    }

                    launchInstaller(ready);

                } catch (Exception e) {
                    showMessage(
                            "Could not open Android installer: "
                                    + e.getMessage()
                    );
                } finally {
                    installing = false;
                }
            });

        } catch (Exception e) {
            if (apk != null && apk.exists()) {
                apk.delete();
            }

            installing = false;
            showMessage("Update failed: " + e.getMessage());

        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    public void onHostResume() {
        if (closed || Build.VERSION.SDK_INT < 26
                || !activity.getPackageManager().canRequestPackageInstalls()) {
            return;
        }
        File pending = pendingInstallerFile;
        if (pending == null) return;
        pendingInstallerFile = null;
        if (!pending.isFile()) {
            showMessage("Downloaded APK is missing. Please retry the update.");
            return;
        }
        launchInstaller(pending);
    }

    private void launchInstaller(File apk) {
        try {
            if (closed || !apk.isFile()) {
                throw new Exception("Verified APK is unavailable.");
            }
            Uri uri = FileProvider.getUriForFile(
                    activity,
                    activity.getPackageName() + ".fileprovider",
                    apk
            );
            Intent installer = new Intent(Intent.ACTION_VIEW);
            installer.setDataAndType(
                    uri, "application/vnd.android.package-archive");
            installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            installer.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(installer);
        } catch (Exception e) {
            showMessage("Could not open Android installer: " + e.getMessage());
        }
    }

    private void verifyApk(File apk, AppInfo expected) throws Exception {
        PackageManager pm = activity.getPackageManager();
        PackageInfo info;

        if (Build.VERSION.SDK_INT >= 28) {
            info = pm.getPackageArchiveInfo(
                    apk.getAbsolutePath(),
                    PackageManager.GET_SIGNING_CERTIFICATES
            );
        } else {
            info = pm.getPackageArchiveInfo(
                    apk.getAbsolutePath(),
                    PackageManager.GET_SIGNATURES
            );
        }

        if (info == null
                || !expected.packageName.equals(info.packageName)) {
            throw new Exception("APK package name verification failed.");
        }

        if (Build.VERSION.SDK_INT >= 28) {
            if (info.signingInfo == null) {
                throw new Exception("APK signing information missing.");
            }

            android.content.pm.Signature[] signatures =
                    info.signingInfo.getApkContentsSigners();

            if (signatures.length != 1
                    || !expected.cert.equals(
                            sha256(signatures[0].toByteArray()))) {
                throw new Exception("APK signing certificate mismatch.");
            }

        } else {
            if (info.signatures == null
                    || info.signatures.length != 1
                    || !expected.cert.equals(
                            sha256(info.signatures[0].toByteArray()))) {
                throw new Exception("APK signing certificate mismatch.");
            }
        }

        PackageInfo installed = null;

        try {
            installed = pm.getPackageInfo(expected.packageName, 0);
        } catch (PackageManager.NameNotFoundException ignored) {}

        long newVersion = Build.VERSION.SDK_INT >= 28
                ? info.getLongVersionCode()
                : info.versionCode;

        if (installed != null) {
            long oldVersion = Build.VERSION.SDK_INT >= 28
                    ? installed.getLongVersionCode()
                    : installed.versionCode;

            if (newVersion <= oldVersion) {
                throw new Exception(
                        "Downloaded APK is not newer than installed version."
                );
            }
        }
    }

    private String sha256(byte[] data) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder result = new StringBuilder();

        for (byte b : digest) {
            result.append(String.format("%02x", b & 0xff));
        }

        return result.toString();
    }

    public void shutdown() {
        closed = true;
        executor.shutdownNow();
    }

    private void showMessage(String message) {
        if (closed) return;

        activity.runOnUiThread(() -> {
            if (!closed) {
                Toast.makeText(
                        activity,
                        message,
                        Toast.LENGTH_LONG
                ).show();
            }
        });
    }
}
