package com.example.hiram;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.AudioManager;
import android.os.BatteryManager;
import android.util.Log;

import java.util.Locale;
import java.util.List;

public class VoiceCommandProcessor {

    private static final String TAG = "VoiceCommandProcessor";

    public enum CommandAction {
        OPEN_YOUTUBE, SEARCH_YOUTUBE, OPEN_WHATSAPP, PLAY_MUSIC,
        HOME_SCREEN, BACK, RECENT_APPS, NOTIFICATIONS,
        FLASHLIGHT_ON, FLASHLIGHT_OFF, BATTERY_STATUS,
        VOLUME_UP, VOLUME_DOWN, VOLUME_MUTE,
        FIND_CONTACT, CALL_CONTACT, SELECT_CONTACT, OPEN_CAMERA, OPEN_SETTINGS,
        CLICK_SCREEN_ELEMENT, OPEN_APP, TYPE_TEXT, SCROLL_UP, SCROLL_DOWN,
        OPEN_WIFI_SETTINGS, OPEN_BLUETOOTH_SETTINGS, END_CONVERSATION, UNKNOWN
    }

    public static class CommandResult {
        public final CommandAction action;
        public final String argument;
        public final boolean success;
        public final String feedbackMessage;
        public final boolean requiresConfirmation;

        public CommandResult(CommandAction action, String argument,
                             boolean success, String feedbackMessage,
                             boolean requiresConfirmation) {
            this.action = action;
            this.argument = argument;
            this.success = success;
            this.feedbackMessage = feedbackMessage;
            this.requiresConfirmation = requiresConfirmation;
        }
    }

    private final Context context;
    private final AppLauncher appLauncher;
    private final ContactHelper contactHelper;
    private boolean isTorchOn = false;

    public VoiceCommandProcessor(Context context) {
        this.context = context.getApplicationContext();
        this.appLauncher = new AppLauncher(this.context);
        this.contactHelper = new ContactHelper(this.context);
    }

    public String cleanCommandText(String spokenText) {
        if (spokenText == null) return "";

        return spokenText
                .replaceAll("(?i)^(hi ram|hey ram|hai ram|हाय राम|हे राम)[,\\s]*", "")
                .trim();
    }

    private String normalize(String text) {
        return text.toLowerCase(Locale.ROOT)
                .replaceAll("[,!?।]", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private CommandResult result(CommandAction action, String argument,
                                 boolean success, String message,
                                 boolean confirmation) {
        return new CommandResult(action, argument, success, message, confirmation);
    }

    public CommandResult executeCommand(String spokenText) {
        String command = cleanCommandText(spokenText);

        if (command.isEmpty()) {
            return result(CommandAction.UNKNOWN, "", false,
                    "Kripya command boliye.", false);
        }

        String lower = normalize(command);

        // Stop listening / conversation
        if (lower.matches(".*\\b(stop listening|end conversation|goodbye|bas|ruko|ruk jao|band karo)\\b.*")
                || lower.contains("बातचीत बंद")
                || lower.equals("बस")
                || lower.equals("रुको")
                || lower.equals("बंद करो")) {
            return result(CommandAction.END_CONVERSATION, "", true,
                    "Theek hai. Dobara bulane ke liye Hi Ram boliye.", false);
        }

        // YouTube: open or search
        if (lower.contains("youtube") || lower.contains("यूट्यूब")) {
            String query = command
                    .replaceAll("(?i)youtube|यूट्यूब", " ")
                    .replaceAll("(?i)\\b(open|kholo|khol do|chalao|search karo|search|khojo|dhundo|mein|me|par|video|play)\\b", " ")
                    .replaceAll("में|पर|खोजो|ढूंढो|सर्च करो|सर्च|खोलो|खोल दो|चलाओ", " ")
                    .replaceAll("\\s+", " ")
                    .trim();

            boolean searching = !query.isEmpty();
            boolean ok = appLauncher.openYouTube(searching ? query : "");

            return result(
                    searching ? CommandAction.SEARCH_YOUTUBE : CommandAction.OPEN_YOUTUBE,
                    query, ok,
                    ok ? (searching
                            ? "YouTube par " + query + " search kar raha hoon."
                            : "YouTube khol raha hoon.")
                       : "YouTube nahi khul saka.",
                    false
            );
        }

        // WhatsApp: open app only; do not claim a chat was opened
        if (lower.contains("whatsapp") || lower.contains("व्हाट्सएप")) {
            boolean ok = appLauncher.openWhatsApp();
            return result(CommandAction.OPEN_WHATSAPP, "", ok,
                    ok ? "WhatsApp khol raha hoon. Chat ka naam bolne ke baad use screen par select kar sakte hain."
                       : "WhatsApp nahi khul saka.",
                    false);
        }

        // Music
        if (lower.contains("music") || lower.contains("gana")
                || lower.contains("गाना") || lower.contains("song")
                || lower.contains("संगीत")) {
            boolean ok = appLauncher.playMusic();
            return result(CommandAction.PLAY_MUSIC, "", ok,
                    ok ? "Music app khol raha hoon." : "Music app nahi khul saka.",
                    false);
        }

        // Camera
        if (lower.contains("camera") || lower.contains("कैमरा")) {
            boolean ok = appLauncher.openCamera();
            return result(CommandAction.OPEN_CAMERA, "", ok,
                    ok ? "Camera khol raha hoon." : "Camera nahi khul saka.", false);
        }

        // Home
        if (lower.contains("home screen") || lower.contains("होम स्क्रीन")
                || lower.equals("home") || lower.contains("go home")
                || lower.contains("घर जाओ")) {
            MyAccessibilityService service = MyAccessibilityService.getInstance();
            boolean ok;

            if (service != null) {
                ok = service.goHome();
            } else {
                try {
                    Intent intent = new Intent(Intent.ACTION_MAIN);
                    intent.addCategory(Intent.CATEGORY_HOME);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(intent);
                    ok = true;
                } catch (Exception e) {
                    Log.e(TAG, "Home error", e);
                    ok = false;
                }
            }

            return result(CommandAction.HOME_SCREEN, "", ok,
                    ok ? "Home screen par ja rahe hain."
                       : "Home screen nahi khul saki.", false);
        }

        // Back
        if (lower.matches(".*\\b(back|go back)\\b.*")
                || lower.contains("पीछे जाओ")
                || lower.contains("वापस जाओ")
                || lower.equals("पीछे")
                || lower.equals("वापस")) {
            MyAccessibilityService service = MyAccessibilityService.getInstance();
            boolean ok = service != null && service.goBack();

            return result(CommandAction.BACK, "", ok,
                    ok ? "Back ja rahe hain."
                       : "Accessibility service ON karein.", false);
        }

        // Recent apps
        if (lower.contains("recent apps") || lower.contains("हाल के ऐप")
                || lower.contains("recent kholo")) {
            MyAccessibilityService service = MyAccessibilityService.getInstance();
            boolean ok = service != null && service.showRecents();

            return result(CommandAction.RECENT_APPS, "", ok,
                    ok ? "Recent apps khol diye."
                       : "Accessibility service ON karein.", false);
        }

        // Notifications
        if (lower.contains("notification") || lower.contains("नोटिफिकेशन")
                || lower.contains("सूचनाएं")) {
            MyAccessibilityService service = MyAccessibilityService.getInstance();
            boolean ok = service != null && service.openNotifications();

            return result(CommandAction.NOTIFICATIONS, "", ok,
                    ok ? "Notifications khol diye."
                       : "Accessibility service ON karein.", false);
        }

        // Wi-Fi settings
        if (lower.contains("wifi") || lower.contains("wi-fi")
                || lower.contains("वाईफाई") || lower.contains("वाई फाई")) {
            boolean ok = appLauncher.openWifiSettings();
            return result(CommandAction.OPEN_WIFI_SETTINGS, "", ok,
                    ok ? "Wi-Fi settings khol raha hoon."
                       : "Wi-Fi settings nahi khul sakin.", false);
        }

        // Bluetooth settings
        if (lower.contains("bluetooth") || lower.contains("ब्लूटूथ")) {
            boolean ok = appLauncher.openBluetoothSettings();
            return result(CommandAction.OPEN_BLUETOOTH_SETTINGS, "", ok,
                    ok ? "Bluetooth settings khol raha hoon."
                       : "Bluetooth settings nahi khul sakin.", false);
        }

        // General settings
        if (lower.equals("settings kholo") || lower.equals("open settings")
                || lower.equals("setting kholo")
                || lower.equals("सेटिंग खोलो")) {
            boolean ok = appLauncher.openSettings();
            return result(CommandAction.OPEN_SETTINGS, "", ok,
                    ok ? "Settings khol raha hoon."
                       : "Settings nahi khul sakin.", false);
        }

        // Flashlight
        if (lower.contains("flashlight") || lower.contains("torch")
                || lower.contains("टॉर्च")) {
            boolean turnOff = lower.contains("off") || lower.contains("band")
                    || lower.contains("बंद");

            boolean ok = setFlashlight(!turnOff);

            return result(turnOff ? CommandAction.FLASHLIGHT_OFF
                                  : CommandAction.FLASHLIGHT_ON,
                    "", ok,
                    ok ? (turnOff ? "Flashlight band kar di hai."
                                  : "Flashlight on kar di hai.")
                       : "Flashlight control nahi ho saki.",
                    false);
        }

        // Battery
        if (lower.contains("battery") || lower.contains("बैटरी")
                || lower.contains("charge kitna")) {
            return result(CommandAction.BATTERY_STATUS, "", true,
                    getBatteryStatus(), false);
        }

        // Volume
        if (lower.contains("volume") || lower.contains("awaaz")
                || lower.contains("आवाज") || lower.contains("वॉल्यूम")) {

            if (lower.contains("mute") || lower.contains("silent")
                    || lower.contains("बंद आवाज")) {
                boolean ok = adjustVolume(AudioManager.ADJUST_MUTE);
                return result(CommandAction.VOLUME_MUTE, "", ok,
                        ok ? "Media volume mute kar diya."
                           : "Volume mute nahi ho saka.", false);
            }

            boolean down = lower.contains("kam") || lower.contains("down")
                    || lower.contains("कम") || lower.contains("घटाओ");

            int direction = down
                    ? AudioManager.ADJUST_LOWER
                    : AudioManager.ADJUST_RAISE;

            boolean ok = adjustVolume(direction);

            return result(down ? CommandAction.VOLUME_DOWN
                               : CommandAction.VOLUME_UP,
                    "", ok,
                    ok ? "Volume adjust kar diya."
                       : "Volume adjust nahi ho saka.", false);
        }

        // Call contact: always require confirmation
        if (lower.contains("call") || lower.contains("कॉल")
                || lower.contains("फोन करो") || lower.contains("फोन लगाओ")) {

            String targetName = command
                    .replaceAll("(?i)\\b(contact|search|call|please|lagao|milao)\\b", " ")
                    .replaceAll("कॉल|फोन करो|फोन लगाओ|को कॉल करो|को फोन लगाओ", " ")
                    .trim();

            if (targetName.isEmpty()) {
                return result(CommandAction.FIND_CONTACT, "", false,
                        "Kis contact ko call karna hai?", false);
            }

            if (!contactHelper.hasContactsPermission()) {
                return result(CommandAction.SELECT_CONTACT, targetName, true,
                        "Contacts permission required hai.",
                        false);
            }

            List<ContactHelper.ContactInfo> matches =
                    contactHelper.findContacts(targetName);

            if (matches.isEmpty()) {
                return result(CommandAction.FIND_CONTACT, targetName, false,
                        "Contact nahi mila: " + targetName
                                + ". Contacts permission check karein.", false);
            }

            ContactHelper.ContactInfo contact =
                    contactHelper.findContact(targetName);

            if (contact != null) {
                return result(CommandAction.CALL_CONTACT, contact.number, true,
                        contact.name + " ko call karne ke liye confirmation chahiye.",
                        true);
            }

            return result(CommandAction.SELECT_CONTACT, targetName, true,
                    "Ek se zyada matching contacts mile. Sahi contact select karein.",
                    false);
        }

        // Accessibility service required for screen actions
        MyAccessibilityService accessibility = MyAccessibilityService.getInstance();

        // Scroll up
        if (lower.contains("scroll up") || lower.contains("upar scroll")
                || lower.contains("ऊपर स्क्रॉल") || lower.contains("ऊपर करो")) {
            boolean ok = accessibility != null && accessibility.scrollScreen(false);
            return result(CommandAction.SCROLL_UP, "", ok,
                    ok ? "Upar scroll kar diya."
                       : "Screen scroll nahi ho saki. Accessibility ON karein.", false);
        }

        // Scroll down
        if (lower.contains("scroll down") || lower.contains("neeche scroll")
                || lower.contains("नीचे स्क्रॉल") || lower.contains("नीचे करो")) {
            boolean ok = accessibility != null && accessibility.scrollScreen(true);
            return result(CommandAction.SCROLL_DOWN, "", ok,
                    ok ? "Neeche scroll kar diya."
                       : "Screen scroll nahi ho saki. Accessibility ON karein.", false);
        }

        // Focus search or text field
        String fieldName = null;

        if (lower.equals("search field kholo")
                || lower.equals("search box kholo")
                || lower.equals("search kholo")
                || lower.equals("text field kholo")
                || lower.equals("search field select karo")
                || lower.equals("search box select karo")
                || lower.equals("सर्च बॉक्स खोलो")
                || lower.equals("सर्च फील्ड खोलो")) {
            fieldName = "search";
        } else {
            String[] fieldPrefixes = {
                    "search field ", "search box ", "text field ",
                    "input field ", "field kholo ", "box kholo ",
                    "सर्च बॉक्स ", "सर्च फील्ड ", "टेक्स्ट बॉक्स "
            };

            for (String prefix : fieldPrefixes) {
                if (lower.startsWith(prefix)) {
                    fieldName = command.substring(prefix.length()).trim();
                    break;
                }
            }
        }

        if (fieldName != null && !fieldName.isEmpty()) {
            boolean ok = accessibility != null
                    && accessibility.focusEditableField(fieldName);

            return result(CommandAction.TYPE_TEXT, fieldName, ok,
                    ok ? fieldName + " field select ho gaya."
                       : "Field nahi mila. Accessibility ON rakhein.", false);
        }

        // Type text into the currently focused field
        String typingText = null;
        String[] typingPrefixes = {
                "isme likho ", "is mein likho ", "type ",
                "likho ", "इसमें लिखो ", "इसमें टाइप करो "
        };

        for (String prefix : typingPrefixes) {
            if (lower.startsWith(prefix)) {
                typingText = command.substring(prefix.length()).trim();
                break;
            }
        }

        if (typingText != null && !typingText.isEmpty()) {
            boolean ok = accessibility != null
                    && accessibility.typeText(typingText);

            return result(CommandAction.TYPE_TEXT, typingText, ok,
                    ok ? "Text likh diya."
                       : "Text box select karein aur Accessibility ON rakhein.",
                    false);
        }

        // Click / tap screen element
        String clickTarget = null;
        String[] clickPrefixes = {
                "click on ", "click ", "tap on ", "tap ",
                "button dabao ", "dabao ", "पर क्लिक करो "
        };

        for (String prefix : clickPrefixes) {
            if (lower.startsWith(prefix)) {
                clickTarget = command.substring(prefix.length()).trim();
                break;
            }
        }

        if (clickTarget == null && lower.endsWith(" par click karo")) {
            clickTarget = command.substring(0,
                    command.length() - " par click karo".length()).trim();
        }

        if (clickTarget == null && lower.endsWith(" पर क्लिक करो")) {
            clickTarget = command.substring(0,
                    command.length() - " पर क्लिक करो".length()).trim();
        }

        if (clickTarget != null && !clickTarget.isEmpty()) {
            boolean ok = accessibility != null
                    && accessibility.clickByText(clickTarget);

            return result(CommandAction.CLICK_SCREEN_ELEMENT,
                    clickTarget, ok,
                    ok ? clickTarget + " par click kar diya."
                       : "Element nahi mila. Accessibility ON karein.",
                    true);
        }

        // Open an installed app by name
        String appName = null;

        String[] appPrefixes = {
                "open app ", "open ", "launch ",
                "kholo ", "khol do ", "खोलो ", "ऐप खोलो "
        };

        for (String prefix : appPrefixes) {
            if (lower.startsWith(prefix)) {
                appName = command.substring(prefix.length()).trim();
                break;
            }
        }

        if (appName == null) {
            String[] appSuffixes = {
                    " kholo", " khol do", " open karo",
                    " खोलो", " खोल दो", " ओपन करो"
            };

            for (String suffix : appSuffixes) {
                if (lower.endsWith(suffix)
                        && lower.length() > suffix.length()) {
                    appName = command.substring(0,
                            command.length() - suffix.length()).trim();
                    break;
                }
            }
        }

        if (appName != null && !appName.isEmpty()) {
            boolean ok = appLauncher.openAppByName(appName);

            return result(CommandAction.OPEN_APP, appName, ok,
                    ok ? appName + " khol raha hoon."
                       : appName + " app nahi mila.",
                    false);
        }

        return result(CommandAction.UNKNOWN, command, false,
                "Mujhe '" + command + "' samajh nahi aaya.", false);
    }

    private boolean setFlashlight(boolean enable) {
        try {
            CameraManager manager = (CameraManager)
                    context.getSystemService(Context.CAMERA_SERVICE);

            if (manager != null) {
                for (String id : manager.getCameraIdList()) {
                    CameraCharacteristics characteristics =
                            manager.getCameraCharacteristics(id);

                    Boolean flash = characteristics.get(
                            CameraCharacteristics.FLASH_INFO_AVAILABLE);

                    if (Boolean.TRUE.equals(flash)) {
                        manager.setTorchMode(id, enable);
                        isTorchOn = enable;
                        return true;
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Flashlight error", e);
        }

        return false;
    }

    private String getBatteryStatus() {
        try {
            IntentFilter filter =
                    new IntentFilter(Intent.ACTION_BATTERY_CHANGED);

            Intent status = context.registerReceiver(null, filter);

            if (status != null) {
                int level = status.getIntExtra(
                        BatteryManager.EXTRA_LEVEL, -1);

                int scale = status.getIntExtra(
                        BatteryManager.EXTRA_SCALE, -1);

                if (level >= 0 && scale > 0) {
                    int percentage = (int) ((level / (float) scale) * 100);
                    return "Battery " + percentage + "% hai.";
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Battery error", e);
        }

        return "Battery status nahi mil saka.";
    }

    private boolean adjustVolume(int direction) {
        try {
            AudioManager manager = (AudioManager)
                    context.getSystemService(Context.AUDIO_SERVICE);

            if (manager != null) {
                manager.adjustStreamVolume(
                        AudioManager.STREAM_MUSIC,
                        direction,
                        AudioManager.FLAG_SHOW_UI
                );
                return true;
            }
        } catch (Exception e) {
            Log.e(TAG, "Volume error", e);
        }

        return false;
    }
}
