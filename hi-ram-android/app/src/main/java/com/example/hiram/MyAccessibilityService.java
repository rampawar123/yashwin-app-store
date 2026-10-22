
package com.example.hiram;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.List;

public class MyAccessibilityService extends AccessibilityService {

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Screen events can be handled here when a supported command needs them.
    }

    @Override
    public void onInterrupt() {
        // Called when the accessibility service is interrupted.
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
            List<AccessibilityNodeInfo> nodes =
                    rootNode.findAccessibilityNodeInfosByText(textToClick);

            if (nodes == null) {
                return false;
            }

            for (AccessibilityNodeInfo node : nodes) {
                if (node != null && node.isClickable()) {
                    return node.performAction(
                            AccessibilityNodeInfo.ACTION_CLICK);
                }
            }

            return false;
        } finally {
            rootNode.recycle();
        }
    }
}
