package com.example.hiram;

import android.util.Log;

import org.json.JSONObject;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

public class AiCommandEngine {

    private static final String TAG = "AiCommandEngine";

    private static final int MAX_TARGET_LENGTH = 120;
    private static final int MAX_PARAMETER_LENGTH = 300;
    private static final int MAX_EXPLANATION_LENGTH = 500;
    private static final int MAX_RESPONSE_LENGTH = 4096;

    public static class StructuredAction {
        public final String actionType;
        public final String target;
        public final String parameter;
        public final boolean requiresConfirmation;
        public final String explanation;

        public StructuredAction(
                String actionType,
                String target,
                String parameter,
                boolean requiresConfirmation,
                String explanation
        ) {
            this.actionType = actionType;
            this.target = target;
            this.parameter = parameter;
            this.requiresConfirmation = requiresConfirmation;
            this.explanation = explanation;
        }
    }

    private static final Set<String> ALLOWED_ACTIONS =
            new HashSet<>(Arrays.asList(
                    "OPEN_APP",
                    "SEARCH_APP",
                    "OPEN_YOUTUBE",
                    "SEARCH_YOUTUBE",
                    "OPEN_WHATSAPP",
                    "PLAY_MUSIC",
                    "OPEN_CAMERA",
                    "OPEN_SETTINGS",
                    "OPEN_WIFI_SETTINGS",
                    "OPEN_BLUETOOTH_SETTINGS",
                    "HOME_SCREEN",
                    "BACK",
                    "RECENT_APPS",
                    "NOTIFICATIONS",
                    "CLICK_ELEMENT",
                    "TYPE_TEXT",
                    "SCROLL_UP",
                    "SCROLL_DOWN",
                    "FLASHLIGHT_ON",
                    "FLASHLIGHT_OFF",
                    "BATTERY_STATUS",
                    "VOLUME_UP",
                    "VOLUME_DOWN",
                    "VOLUME_MUTE",
                    "FIND_CONTACT",
                    "CALL_CONTACT",
                    "UNKNOWN"
            ));

    private static final Set<String> SENSITIVE_ACTIONS =
            new HashSet<>(Arrays.asList(
                    "CALL_CONTACT",
                    "CLICK_ELEMENT"
            ));

    public StructuredAction parseAndValidate(String jsonResponse) {

        if (jsonResponse == null
                || jsonResponse.trim().isEmpty()
                || jsonResponse.length() > MAX_RESPONSE_LENGTH) {
            return rejected("Invalid or oversized AI response");
        }

        try {
            JSONObject obj = new JSONObject(jsonResponse);

            String[] stringFields = {
                    "action", "target", "parameter", "explanation"
            };

            for (String field : stringFields) {
                Object value = obj.opt(field);

                if (value != null
                        && value != JSONObject.NULL
                        && !(value instanceof String)) {
                    return rejected("Invalid field type: " + field);
                }
            }

            String action = readString(obj, "action")
                    .toUpperCase(Locale.ROOT);

            String target = readString(obj, "target");
            String parameter = readString(obj, "parameter");
            String explanation = readString(obj, "explanation");

            if (action.isEmpty()) {
                return rejected("Action is missing");
            }

            if (action.length() > 40 || containsControlCharacters(action)) {
                return rejected("Invalid action field");
            }

            if (!ALLOWED_ACTIONS.contains(action)) {
                return rejected("Unsupported AI action");
            }

            if (target.length() > MAX_TARGET_LENGTH
                    || parameter.length() > MAX_PARAMETER_LENGTH
                    || explanation.length() > MAX_EXPLANATION_LENGTH) {
                return rejected("AI response field is too long");
            }

            if (containsControlCharacters(target)
                    || containsControlCharacters(parameter)
                    || containsControlCharacters(explanation)) {
                return rejected("Invalid control characters");
            }

            if (!hasRequiredFields(action, target, parameter)) {
                return rejected("Required action fields are missing");
            }

            Object confirmationValue =
                    obj.opt("requiresConfirmation");

            if (confirmationValue != null
                    && !(confirmationValue instanceof Boolean)) {
                return rejected("Invalid confirmation value");
            }

            boolean confirmation =
                    Boolean.TRUE.equals(confirmationValue);

            if (SENSITIVE_ACTIONS.contains(action)) {
                confirmation = true;
            }

            if ("UNKNOWN".equals(action)) {
                return rejected(
                        explanation.isEmpty()
                                ? "AI could not understand the command"
                                : explanation
                );
            }

            if (explanation.isEmpty()) {
                explanation = "Command ready";
            }

            return new StructuredAction(
                    action,
                    target,
                    parameter,
                    confirmation,
                    explanation
            );

        } catch (Exception e) {
            Log.e(TAG, "AI response validation failed", e);
            return rejected("Could not validate AI response");
        }
    }

    private String readString(JSONObject obj, String key) {
        Object value = obj.opt(key);

        if (value == null || value == JSONObject.NULL) {
            return "";
        }

        if (!(value instanceof String)) {
            return "";
        }

        return ((String) value).trim();
    }

    private boolean hasRequiredFields(
            String action,
            String target,
            String parameter
    ) {
        switch (action) {
            case "OPEN_APP":
            case "SEARCH_APP":
            case "CLICK_ELEMENT":
            case "FIND_CONTACT":
            case "CALL_CONTACT":
                return !target.isEmpty();

            case "SEARCH_YOUTUBE":
                return !parameter.isEmpty();

            case "TYPE_TEXT":
                return !parameter.isEmpty();

            case "OPEN_YOUTUBE":
            case "OPEN_WHATSAPP":
            case "PLAY_MUSIC":
            case "OPEN_CAMERA":
            case "OPEN_SETTINGS":
            case "OPEN_WIFI_SETTINGS":
            case "OPEN_BLUETOOTH_SETTINGS":
            case "HOME_SCREEN":
            case "BACK":
            case "RECENT_APPS":
            case "NOTIFICATIONS":
            case "SCROLL_UP":
            case "SCROLL_DOWN":
            case "FLASHLIGHT_ON":
            case "FLASHLIGHT_OFF":
            case "BATTERY_STATUS":
            case "VOLUME_UP":
            case "VOLUME_DOWN":
            case "VOLUME_MUTE":
                return true;

            default:
                return false;
        }
    }

    private boolean containsControlCharacters(String value) {
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);

            if (Character.isISOControl(c)
                    && c != '\n'
                    && c != '\t') {
                return true;
            }
        }

        return false;
    }

    private StructuredAction rejected(String reason) {
        return new StructuredAction(
                "UNKNOWN",
                "",
                "",
                false,
                reason
        );
    }
}
