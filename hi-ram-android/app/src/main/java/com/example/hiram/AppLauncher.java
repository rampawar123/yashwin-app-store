package com.example.hiram;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Log;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class AppLauncher {

    private static final String TAG = "AppLauncher";
    private final Context context;

    public AppLauncher(Context context) {
        this.context = context.getApplicationContext();
    }

    public boolean openPackage(String packageName) {
        if (packageName == null || packageName.trim().isEmpty()) {
            return false;
        }

        try {
            PackageManager pm = context.getPackageManager();
            Intent launchIntent = pm.getLaunchIntentForPackage(
                    packageName.trim()
            );

            if (launchIntent == null) return false;

            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(launchIntent);
            return true;

        } catch (Exception e) {
            Log.e(TAG, "Error launching package: " + packageName, e);
            return false;
        }
    }

    public boolean openYouTube(String query) {
        String search = query == null ? "" : query.trim();

        if (search.isEmpty()) {
            if (openPackage("com.google.android.youtube")) return true;
        }

        try {
            String url = search.isEmpty()
                    ? "https://www.youtube.com"
                    : "https://www.youtube.com/results?search_query="
                            + Uri.encode(search);

            Intent intent = new Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse(url)
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return true;

        } catch (Exception e) {
            Log.e(TAG, "Failed to open YouTube", e);
            return false;
        }
    }

    public boolean openWhatsApp() {
        // Only report success when the actual WhatsApp app opens.
        return openPackage("com.whatsapp");
    }

    public boolean openCamera() {
        try {
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            if (intent.resolveActivity(
                    context.getPackageManager()) == null) {
                return false;
            }

            context.startActivity(intent);
            return true;

        } catch (Exception e) {
            Log.e(TAG, "Could not open camera", e);
            return false;
        }
    }

    public boolean playMusic() {
        try {
            Intent intent = new Intent(
                    MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            if (intent.resolveActivity(
                    context.getPackageManager()) != null) {
                context.startActivity(intent);
                return true;
            }

        } catch (Exception e) {
            Log.w(TAG, "Media search intent unavailable", e);
        }

        if (openPackage("com.google.android.apps.youtube.music")) return true;
        if (openPackage("com.spotify.music")) return true;
        if (openPackage("com.jio.media.jiobeats")) return true;

        return false;
    }

    public boolean openSettings() {
        return openSystemSettings(Settings.ACTION_SETTINGS);
    }

    public boolean openWifiSettings() {
        return openSystemSettings(Settings.ACTION_WIFI_SETTINGS);
    }

    public boolean openBluetoothSettings() {
        return openSystemSettings(Settings.ACTION_BLUETOOTH_SETTINGS);
    }

    public boolean openAccessibilitySettings() {
        return openSystemSettings(
                Settings.ACTION_ACCESSIBILITY_SETTINGS
        );
    }

    private boolean openSystemSettings(String action) {
        try {
            Intent intent = new Intent(action);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return true;

        } catch (Exception e) {
            Log.e(TAG, "Could not open settings: " + action, e);

            if (!Settings.ACTION_SETTINGS.equals(action)) {
                return openSettings();
            }

            return false;
        }
    }

    /**
     * Returns unique launcher apps visible to this application.
     * Android Package Visibility rules still apply.
     */
    public List<String> getInstalledAppNames() {
        Map<String, String> uniqueApps = new LinkedHashMap<>();

        try {
            PackageManager pm = context.getPackageManager();

            Intent mainIntent = new Intent(Intent.ACTION_MAIN);
            mainIntent.addCategory(Intent.CATEGORY_LAUNCHER);

            List<ResolveInfo> apps =
                    pm.queryIntentActivities(mainIntent, 0);

            for (ResolveInfo info : apps) {
                if (info == null || info.activityInfo == null) continue;

                String packageName = info.activityInfo.packageName;
                CharSequence label = info.loadLabel(pm);

                if (packageName == null || label == null) continue;

                uniqueApps.put(
                        packageName,
                        label.toString()
                );
            }

            List<String> names = new ArrayList<>(uniqueApps.values());
            Collections.sort(names, String.CASE_INSENSITIVE_ORDER);
            return names;

        } catch (Exception e) {
            Log.e(TAG, "Could not list launcher apps", e);
            return new ArrayList<>();
        }
    }

    public boolean openAppByName(String appName) {
        if (appName == null || appName.trim().isEmpty()) {
            return false;
        }

        String clean = normalize(appName);
        if (clean.isEmpty()) return false;

        if (clean.contains("youtube") || clean.contains("यूट्यूब")) {
            return openYouTube("");
        }

        if (clean.contains("whatsapp") || clean.contains("व्हाट्सएप")) {
            return openWhatsApp();
        }

        if (clean.contains("camera") || clean.contains("कैमरा")) {
            return openCamera();
        }

        // Check specific settings before generic settings.
        if (clean.contains("wifi") || clean.contains("wi-fi")
                || clean.contains("वाईफाई")) {
            return openWifiSettings();
        }

        if (clean.contains("bluetooth") || clean.contains("ब्लूटूथ")) {
            return openBluetoothSettings();
        }

        if (clean.contains("settings") || clean.contains("सेटिंग")) {
            return openSettings();
        }

        if (clean.contains("music")
                || clean.contains("गाना")
                || clean.contains("म्यूजिक")) {
            return playMusic();
        }

        try {
            PackageManager pm = context.getPackageManager();

            Intent mainIntent = new Intent(Intent.ACTION_MAIN);
            mainIntent.addCategory(Intent.CATEGORY_LAUNCHER);

            List<ResolveInfo> apps =
                    pm.queryIntentActivities(mainIntent, 0);

            List<ResolveInfo> exactMatches = new ArrayList<>();
            List<ResolveInfo> prefixMatches = new ArrayList<>();
            List<ResolveInfo> containsMatches = new ArrayList<>();

            for (ResolveInfo info : apps) {
                if (info == null || info.activityInfo == null) continue;

                CharSequence label = info.loadLabel(pm);
                if (label == null) continue;

                String appLabel = normalize(label.toString());

                if (appLabel.equals(clean)) {
                    exactMatches.add(info);
                } else if (appLabel.startsWith(clean)) {
                    prefixMatches.add(info);
                } else if (appLabel.contains(clean)) {
                    containsMatches.add(info);
                }
            }

            List<ResolveInfo> matches = !exactMatches.isEmpty()
                    ? exactMatches
                    : !prefixMatches.isEmpty()
                            ? prefixMatches
                            : containsMatches;

            if (matches.size() == 1) {
                return openPackage(
                        matches.get(0).activityInfo.packageName
                );
            }

            if (matches.size() > 1) {
                Log.w(TAG, "Ambiguous app name: " + appName
                        + " (" + matches.size() + " matches)");
                return false;
            }

            Log.w(TAG, "App not found: " + appName);
            return false;

        } catch (Exception e) {
            Log.e(TAG, "App search failed: " + appName, e);
            return false;
        }
    }

    private String normalize(String value) {
        if (value == null) return "";

        return value.trim()
                .toLowerCase(Locale.ROOT)
                .replaceAll("\\s+", " ");
    }
}
