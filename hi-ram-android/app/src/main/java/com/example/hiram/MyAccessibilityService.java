package com.example.hiram;

import android.accessibilityservice.AccessibilityService;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MyAccessibilityService extends AccessibilityService {

    private static final String TAG = "HiRamAccessibility";

    private static WeakReference<MyAccessibilityService> instanceRef =
            new WeakReference<>(null);

    private static class NodeMatch {
        AccessibilityNodeInfo node;
        int score;
        int count;

        NodeMatch() {
            score = 0;
            count = 0;
        }
    }

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
        Log.i(TAG, "Accessibility service connected");
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Screen content is not collected or stored.
    }

    @Override
    public void onInterrupt() {
        Log.w(TAG, "Accessibility service interrupted");
    }

    @Override
    public void onDestroy() {
        if (instanceRef.get() == this) {
            instanceRef.clear();
        }
        super.onDestroy();
        Log.i(TAG, "Accessibility service destroyed");
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

    private String normalize(String value) {
        if (value == null) return "";
        return value.trim().toLowerCase(Locale.ROOT);
    }

    private String getNodeText(AccessibilityNodeInfo node) {
        if (node == null) return "";

        StringBuilder value = new StringBuilder();

        if (node.getText() != null) {
            value.append(node.getText()).append(" ");
        }

        if (node.getContentDescription() != null) {
            value.append(node.getContentDescription()).append(" ");
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && node.getHintText() != null) {
            value.append(node.getHintText()).append(" ");
        }

        if (node.getViewIdResourceName() != null) {
            value.append(node.getViewIdResourceName());
        }

        return normalize(value.toString());
    }

    private int matchScore(String searchable, String query) {
        if (searchable.isEmpty() || query.isEmpty()) return 0;

        if (searchable.equals(query)) return 100;

        if (searchable.contains(query)) return 60;

        return 0;
    }

    public boolean clickByText(String textToClick) {
        String query = normalize(textToClick);

        if (query.isEmpty()) return false;

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;

        NodeMatch match = new NodeMatch();

        try {
            collectClickMatches(root, query, match);

            // Do not click when multiple equally good matches exist.
            if (match.node == null || match.count != 1) {
                Log.w(TAG, "Click target missing or ambiguous: " + query);
                return false;
            }

            return performClickOnNodeOrAncestor(match.node);

        } catch (Exception e) {
            Log.e(TAG, "Click by text failed", e);
            return false;
        } finally {
            if (match.node != null) match.node.recycle();
            root.recycle();
        }
    }

    private void collectClickMatches(
            AccessibilityNodeInfo node,
            String query,
            NodeMatch best
    ) {
        if (node == null) return;

        int score = matchScore(getNodeText(node), query);

        if (score > 0) {
            if (score > best.score) {
                if (best.node != null) best.node.recycle();

                best.node = AccessibilityNodeInfo.obtain(node);
                best.score = score;
                best.count = 1;

            } else if (score == best.score) {
                best.count++;
            }
        }

        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;

            try {
                collectClickMatches(child, query, best);
            } finally {
                child.recycle();
            }
        }
    }

    private boolean performClickOnNodeOrAncestor(
            AccessibilityNodeInfo node
    ) {
        if (node == null) return false;

        AccessibilityNodeInfo current =
                AccessibilityNodeInfo.obtain(node);

        while (current != null) {
            AccessibilityNodeInfo parent = null;

            try {
                if (current.isClickable()
                        && current.performAction(
                        AccessibilityNodeInfo.ACTION_CLICK)) {
                    return true;
                }

                parent = current.getParent();

            } finally {
                current.recycle();
            }

            current = parent;
        }

        return false;
    }

    public boolean focusEditableField(String fieldName) {
        String query = normalize(fieldName);

        if (query.isEmpty()) return false;

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;

        NodeMatch match = new NodeMatch();
        List<AccessibilityNodeInfo> editableNodes = new ArrayList<>();

        try {
            collectEditableNodes(root, query, match, editableNodes);

            AccessibilityNodeInfo target = null;

            if (match.node != null && match.count == 1) {
                target = AccessibilityNodeInfo.obtain(match.node);
            } else if (match.node == null && editableNodes.size() == 1) {
                // Safe fallback only when exactly one editable field exists.
                target = AccessibilityNodeInfo.obtain(editableNodes.get(0));
            }

            if (target == null) {
                Log.w(TAG, "Input field missing or ambiguous: " + query);
                return false;
            }

            try {
                target.performAction(AccessibilityNodeInfo.ACTION_CLICK);

                boolean focused = target.performAction(
                        AccessibilityNodeInfo.ACTION_FOCUS
                );

                return focused || target.isFocused();

            } finally {
                target.recycle();
            }

        } catch (Exception e) {
            Log.e(TAG, "Finding input field failed", e);
            return false;

        } finally {
            if (match.node != null) match.node.recycle();

            for (AccessibilityNodeInfo item : editableNodes) {
                item.recycle();
            }

            root.recycle();
        }
    }

    private void collectEditableNodes(
            AccessibilityNodeInfo node,
            String query,
            NodeMatch best,
            List<AccessibilityNodeInfo> editableNodes
    ) {
        if (node == null) return;

        if (node.isEditable()) {
            editableNodes.add(AccessibilityNodeInfo.obtain(node));

            int score = matchScore(getNodeText(node), query);

            if (score > 0) {
                if (score > best.score) {
                    if (best.node != null) best.node.recycle();

                    best.node = AccessibilityNodeInfo.obtain(node);
                    best.score = score;
                    best.count = 1;

                } else if (score == best.score) {
                    best.count++;
                }
            }
        }

        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;

            try {
                collectEditableNodes(child, query, best, editableNodes);
            } finally {
                child.recycle();
            }
        }
    }

    public boolean submitSearch() {
        // ACTION_IME_ENTER is available from Android 11 (API 30).
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            Log.w(TAG, "IME search action requires Android 11 or newer");
            return false;
        }

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;

        AccessibilityNodeInfo focused = null;

        try {
            focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);

            if (focused == null || !focused.isEditable()) {
                Log.w(TAG, "No focused editable field for search");
                return false;
            }

            int searchActionId =
                    AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.getId();

            boolean supported = false;

            for (AccessibilityNodeInfo.AccessibilityAction action
                    : focused.getActionList()) {
                if (action.getId() == searchActionId) {
                    supported = true;
                    break;
                }
            }

            if (!supported) {
                Log.w(TAG, "Focused field does not support IME search action");
                return false;
            }

            return focused.performAction(searchActionId);

        } catch (Exception e) {
            Log.e(TAG, "Submit search failed", e);
            return false;
        } finally {
            if (focused != null) focused.recycle();
            root.recycle();
        }
    }

    public boolean typeText(String text) {
        if (text == null) return false;

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;

        AccessibilityNodeInfo focused = null;

        try {
            focused = root.findFocus(
                    AccessibilityNodeInfo.FOCUS_INPUT
            );

            if (focused == null || !focused.isEditable()) {
                return false;
            }

            Bundle args = new Bundle();
            args.putCharSequence(
                    AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                    text
            );

            return focused.performAction(
                    AccessibilityNodeInfo.ACTION_SET_TEXT,
                    args
            );

        } catch (Exception e) {
            Log.e(TAG, "Voice typing failed", e);
            return false;

        } finally {
            if (focused != null) focused.recycle();
            root.recycle();
        }
    }

    public boolean scrollScreen(boolean forward) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;

        try {
            return scrollNode(root, forward);

        } catch (Exception e) {
            Log.e(TAG, "Scroll failed", e);
            return false;

        } finally {
            root.recycle();
        }
    }

    private boolean scrollNode(
            AccessibilityNodeInfo node,
            boolean forward
    ) {
        if (node == null) return false;

        if (node.isScrollable()) {
            int action = forward
                    ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                    : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD;

            if (node.performAction(action)) {
                return true;
            }
        }

        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;

            boolean scrolled;

            try {
                scrolled = scrollNode(child, forward);
            } finally {
                child.recycle();
            }

            if (scrolled) return true;
        }

        return false;
    }
}
