package com.example.hiram;

import android.accessibilityservice.AccessibilityService;
import android.os.Build;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.lang.ref.WeakReference;
import java.util.List;
import java.util.Locale;

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
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Required method override
    }

    @Override
    public void onInterrupt() {
        // Required method override
    }

    @Override
    public void onDestroy() {
        instanceRef.clear();
        super.onDestroy();
    }

    public boolean goHome() {
        return performGlobalAction(GLOBAL_ACTION_HOME);
    }

    public boolean goBack() {
        return performGlobalAction(GLOBAL_ACTION_BACK);
    }

    public boolean showRecents() {
        return performGlobalAction(GLOBAL_ACTION_RECENTS);
    }

    public boolean openNotifications() {
        return performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
    }

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
                        boolean clicked = performClickOnNodeOrAncestor(node);
                        node.recycle();
                        if (clicked) return true;
                    }
                }
            }
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

        if (match && performClickOnNodeOrAncestor(node)) {
            return true;
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
                boolean success = current.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                if (success) return true;
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
