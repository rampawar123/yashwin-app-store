package com.example.hiram;

import android.accessibilityservice.AccessibilityService;
import android.os.Build;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.lang.ref.WeakReference;
import java.util.List;
import java.util.Locale;

/**
 * MyAccessibilityService - User-Enabled Android Mobile Operator
 *
 * Privacy & Safety Commitment:
 * 1. This service only acts upon explicit user voice commands.
 * 2. It DOES NOT monitor, store, or transmit screen content or passwords.
 * 3. It can be disabled by the user at any time in Android Accessibility Settings.
 */
public class MyAccessibilityService extends AccessibilityService {

    private static final String TAG = "HiRamAccessibility";
    private static WeakReference<MyAccessibilityService> instanceRef = new WeakReference<>(null);

    public static boolean isRunning() {
        return instanceRef.get() != null;
    }

    public static MyAccessibilityService getInstance() {
        return instanceRef.get();
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instanceRef = new WeakReference<>(this);
        Log.i(TAG, "Hi Ram Accessibility Service Connected.");
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // We do not record or monitor background screen events to uphold user privacy.
    }

    @Override
    public void onInterrupt() {
        Log.w(TAG, "Hi Ram Accessibility Service Interrupted.");
    }

    @Override
    public void onDestroy() {
        instanceRef.clear();
        super.onDestroy();
        Log.i(TAG, "Hi Ram Accessibility Service Destroyed.");
    }

    /**
     * Navigates to the Android Home screen.
     */
    public boolean goHome() {
        return performGlobalAction(GLOBAL_ACTION_HOME);
    }

    /**
     * Performs Android Back action.
     */
    public boolean goBack() {
        return performGlobalAction(GLOBAL_ACTION_BACK);
    }

    /**
     * Shows the Recent Apps screen.
     */
    public boolean showRecents() {
        return performGlobalAction(GLOBAL_ACTION_RECENTS);
    }

    /**
     * Pulls down the Android notification shade.
     */
    public boolean openNotifications() {
        return performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
    }

    /**
     * Opens Android Quick Settings.
     */
    public boolean openQuickSettings() {
        return performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS);
    }

    /**
     * Locks the phone screen (requires Android 9+).
     */
    public boolean lockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN);
        }
        return false;
    }

    /**
     * Finds and clicks an interactive screen element by its visible text or contentDescription.
     */
    public boolean clickByText(String textToClick) {
        if (textToClick == null || textToClick.trim().isEmpty()) {
            return false;
        }

        AccessibilityNodeInfo rootNode = getRootInActiveWindow();
        if (rootNode == null) {
            return false;
        }

        try {
            String query = textToClick.trim();
            List<AccessibilityNodeInfo> nodes = rootNode.findAccessibilityNodeInfosByText(query);

            if (nodes != null && !nodes.isEmpty()) {
                for (AccessibilityNodeInfo node : nodes) {
                    if (node != null) {
                        if (performClickOnNodeOrAncestor(node)) {
                            return true;
                        }
                    }
                }
            }

            // Fallback: recursive case-insensitive search across tree
            return searchAndClickRecursive(rootNode, query.toLowerCase(Locale.ROOT));
        } finally {
            rootNode.recycle();
        }
    }

    private boolean searchAndClickRecursive(AccessibilityNodeInfo node, String lowerQuery) {
        if (node == null) return false;

        CharSequence text = node.getText();
        CharSequence desc = node.getContentDescription();

        boolean match = (text != null && text.toString().toLowerCase(Locale.ROOT).contains(lowerQuery))
                || (desc != null && desc.toString().toLowerCase(Locale.ROOT).contains(lowerQuery));

        if (match) {
            if (performClickOnNodeOrAncestor(node)) {
                return true;
            }
        }

        int childCount = node.getChildCount();
        for (int i = 0; i < childCount; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                boolean clicked = searchAndClickRecursive(child, lowerQuery);
                child.recycle();
                if (clicked) return true;
            }
        }

        return false;
    }

    private boolean performClickOnNodeOrAncestor(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo current = node;
        while (current != null) {
            if (current.isClickable()) {
                return current.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            }
            AccessibilityNodeInfo parent = current.getParent();
            if (current != node) {
                current.recycle();
            }
            current = parent;
        }
        return false;
    }
}
