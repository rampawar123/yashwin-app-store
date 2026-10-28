package com.example.hiram;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Log;

import java.util.List;
import java.util.Locale;

/**
 * AppLauncher - Handles intent dispatch for opening apps and system settings safely.
 */
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
            Intent launchIntent = pm.getLaunchIntentForPackage(packageName);

            if (launchIntent != null) {
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(launchIntent);
                return true;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error launching package: " + packageName, e);
        }
        return false;
    }

    public boolean openYouTube(String query) {
        if (query == null || query.trim().isEmpty()) {
            if (openPackage("com.google.android.youtube")) return true;
        }

        try {
            String url = (query != null && !query.trim().isEmpty())
                    ? "https://www.youtube.com/results?search_query=" + Uri.encode(query.trim())
                    : "https://www.youtube.com";
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Failed to open YouTube browser link", e);
            return false;
        }
    }

    public boolean openWhatsApp() {
        if (openPackage("com.whatsapp")) return true;
        // Fallback to web link
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://api.whatsapp.com/"));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public boolean openCamera() {
        try {
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (intent.resolveActivity(context.getPackageManager()) != null) {
                context.startActivity(intent);
                return true;
            }
        } catch (Exception e) {
            Log.e(TAG, "Could not open camera", e);
        }
        return false;
    }

    public boolean playMusic() {
        try {
            Intent intent = new Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (intent.resolveActivity(context.getPackageManager()) != null) {
                context.startActivity(intent);
                return true;
            }
        } catch (Exception ignored) {}

        // Fallback: try common music players or YouTube Music
        if (openPackage("com.google.android.apps.youtube.music")) return true;
        if (openPackage("com.spotify.music")) return true;
        if (openPackage("com.jio.media.jiobeats")) return true;
        return false;
    }

    public boolean openSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public boolean openWifiSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_WIFI_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return true;
        } catch (Exception e) {
            return openSettings();
        }
    }

    public boolean openBluetoothSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return true;
        } catch (Exception e) {
            return openSettings();
        }
    }

    public boolean openAccessibilitySettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public boolean openAppByName(String appName) {
        if (appName == null || appName.trim().isEmpty()) return false;
        String clean = appName.toLowerCase(Locale.ROOT).trim();

        if (clean.contains("youtube") || clean.contains("यूट्यूब")) return openYouTube("");
        if (clean.contains("whatsapp") || clean.contains("व्हाट्सएप")) return openWhatsApp();
        if (clean.contains("camera") || clean.contains("कैमरा")) return openCamera();
        if (clean.contains("music") || clean.contains("गाना") || clean.contains("म्यूजिक")) return playMusic();
        if (clean.contains("settings") || clean.contains("सेटिंग")) return openSettings();
        if (clean.contains("wifi") || clean.contains("वाईफाई")) return openWifiSettings();
        if (clean.contains("bluetooth") || clean.contains("ब्लूटूथ")) return openBluetoothSettings();

        // Search installed apps matching the label
        PackageManager pm = context.getPackageManager();
        Intent mainIntent = new Intent(Intent.ACTION_MAIN, null);
        mainIntent.addCategory(Intent.CATEGORY_LAUNCHER);

        List<ResolveInfo> apps = pm.queryIntentActivities(mainIntent, 0);
        for (ResolveInfo info : apps) {
            CharSequence label = info.loadLabel(pm);
            if (label != null && label.toString().toLowerCase(Locale.ROOT).contains(clean)) {
                return openPackage(info.activityInfo.packageName);
            }
        }

        return false;
    }
}
