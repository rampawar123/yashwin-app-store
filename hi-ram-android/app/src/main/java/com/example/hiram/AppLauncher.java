
package com.example.hiram;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;

public class AppLauncher {

    private final Context context;

    public AppLauncher(Context context) {
        this.context = context;
    }

    public boolean openApp(String packageName) {
        if (packageName == null || packageName.trim().isEmpty()) {
            return false;
        }

        PackageManager pm = context.getPackageManager();
        Intent launchIntent = pm.getLaunchIntentForPackage(packageName);

        if (launchIntent == null) {
            return false;
        }

        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(launchIntent);
        return true;
    }

    public boolean openYouTubeSearch(String query) {
        if (query == null || query.trim().isEmpty()) {
            return openApp("com.google.android.youtube");
        }

        Intent intent = new Intent(
                Intent.ACTION_VIEW,
                Uri.parse("https://www.youtube.com/results?search_query="
                        + Uri.encode(query.trim())));

        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        if (intent.resolveActivity(context.getPackageManager()) != null) {
            context.startActivity(intent);
            return true;
        }

        return false;
    }
}
