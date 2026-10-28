package com.example.hiram;

import android.util.Log;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * AiCommandEngine - Optional Gemini-Compatible AI Interpretation Layer
 *
 * Security Architecture:
 * 1. API Keys are kept on a secure backend proxy; NEVER hardcoded in the APK.
 * 2. Incoming structured actions are validated locally against a strict security whitelist.
 * 3. Arbitrary shell commands or attempts to bypass Android security sandboxes are rejected immediately.
 * 4. Sensitive actions require explicit user confirmation.
 */
public class AiCommandEngine {

    private static final String TAG = "AiCommandEngine";

    public static class StructuredAction {
        public final String actionType;
        public final String target;
        public final String parameter;
        public final boolean requiresConfirmation;
        public final String explanation;

        public StructuredAction(String actionType, String target, String parameter, boolean requiresConfirmation, String explanation) {
            this.actionType = actionType;
            this.target = target;
            this.parameter = parameter;
            this.requiresConfirmation = requiresConfirmation;
            this.explanation = explanation;
        }
    }

    // Strict whitelist of permitted high-level mobile operations
    private static final Set<String> ALLOWED_ACTIONS = new HashSet<>(Arrays.asList(
            "OPEN_YOUTUBE",
            "SEARCH_YOUTUBE",
            "OPEN_WHATSAPP",
            "PLAY_MUSIC",
            "FLASHLIGHT_ON",
            "FLASHLIGHT_OFF",
            "BATTERY_STATUS",
            "HOME_SCREEN",
            "VOLUME_UP",
            "VOLUME_DOWN",
            "VOLUME_MUTE",
            "FIND_CONTACT",
            "CALL_CONTACT",
            "OPEN_CAMERA",
            "OPEN_SETTINGS",
            "CLICK_ELEMENT",
            "UNKNOWN"
    ));

    private static final Set<String> SENSITIVE_ACTIONS = new HashSet<>(Arrays.asList(
            "CALL_CONTACT",
            "SEND_MESSAGE",
            "CLICK_ELEMENT"
    ));

    /**
     * Parses and locally validates a structured JSON response from an AI backend.
     */
    public StructuredAction parseAndValidate(String jsonResponse) {
        if (jsonResponse == null || jsonResponse.trim().isEmpty()) {
            return new StructuredAction("UNKNOWN", "", "", false, "Empty AI response");
        }

        try {
            JSONObject obj = new JSONObject(jsonResponse);
            String rawAction = obj.optString("action", "UNKNOWN").toUpperCase();
            String target = obj.optString("target", "");
            String parameter = obj.optString("parameter", "");
            String explanation = obj.optString("explanation", "Command parsed by AI");
            boolean confirmation = obj.optBoolean("requiresConfirmation", false);

            // 1. Local Whitelist Validation
            if (!ALLOWED_ACTIONS.contains(rawAction)) {
                Log.w(TAG, "Security rejection: Action '" + rawAction + "' is not permitted in whitelist.");
                return new StructuredAction("UNKNOWN", "", "", false, "Unsupported or restricted AI action.");
            }

            // 2. Strict Shell Command Prevention: target/parameter cannot contain shell metacharacters
            if (containsShellMetacharacters(target) || containsShellMetacharacters(parameter)) {
                Log.e(TAG, "Security violation: Detected potential shell injection in AI arguments.");
                return new StructuredAction("UNKNOWN", "", "", false, "Command contains invalid characters.");
            }

            // 3. Enforce confirmation policy on sensitive actions
            if (SENSITIVE_ACTIONS.contains(rawAction)) {
                confirmation = true;
            }

            return new StructuredAction(rawAction, target, parameter, confirmation, explanation);

        } catch (Exception e) {
            Log.e(TAG, "Error parsing AI command JSON: " + e.getMessage());
            return new StructuredAction("UNKNOWN", "", "", false, "Failed to parse structured AI action.");
        }
    }

    private boolean containsShellMetacharacters(String str) {
        if (str == null) return false;
        return str.contains(";") || str.contains("&&") || str.contains("||") ||
               str.contains("`") || str.contains("$") || str.contains(">") || str.contains("<");
    }
}
