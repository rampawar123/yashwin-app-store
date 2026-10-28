package com.example.hiram;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.AudioManager;
import android.os.BatteryManager;
import android.os.Build;
import android.util.Log;

import java.util.Locale;

/**
 * VoiceCommandProcessor - Multilingual NLP Parser & Device Operator
 *
 * Handles natural language commands in Hindi (Devanagari & Romanized Hinglish) and English.
 * Dispatches to official Android APIs and provides clear vocal feedback.
 */
public class VoiceCommandProcessor {

    private static final String TAG = "VoiceCommandProcessor";

    public enum CommandAction {
        OPEN_YOUTUBE,
        SEARCH_YOUTUBE,
        OPEN_WHATSAPP,
        PLAY_MUSIC,
        HOME_SCREEN,
        BACK,
        RECENT_APPS,
        NOTIFICATIONS,
        FLASHLIGHT_ON,
        FLASHLIGHT_OFF,
        BATTERY_STATUS,
        VOLUME_UP,
        VOLUME_DOWN,
        VOLUME_MUTE,
        FIND_CONTACT,
        CALL_CONTACT,
        OPEN_CAMERA,
        OPEN_SETTINGS,
        CLICK_SCREEN_ELEMENT,
        UNKNOWN
    }

    public static class CommandResult {
        public final CommandAction action;
        public final String argument;
        public final boolean success;
        public final String feedbackMessage;
        public final boolean requiresConfirmation;

        public CommandResult(CommandAction action, String argument, boolean success, String feedbackMessage, boolean requiresConfirmation) {
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

    /**
     * Strips "Hi Ram" / "Hey Ram" wake prefix if present.
     */
    public String cleanCommandText(String spokenText) {
        if (spokenText == null) return "";
        return spokenText
                .replaceAll("(?i)^(hi ram|hey ram|hai ram|हाय राम|हे राम)[,\\s]*", "")
                .trim();
    }

    /**
     * Executes the voice command and returns the execution result and spoken feedback.
     */
    public CommandResult executeCommand(String spokenText) {
        String command = cleanCommandText(spokenText);
        if (command.isEmpty()) {
            return new CommandResult(CommandAction.UNKNOWN, "", false, "Kripya command boliye.", false);
        }

        String lower = command.toLowerCase(Locale.ROOT);

        // 1. YouTube Commands
        if (lower.contains("youtube") || lower.contains("यूट्यूब")) {
            String query = command
                    .replaceAll("(?i)(youtube|यूट्यूब|open|kholo|chalao|search|khojo|par|me|me\\s+chalao)", "")
                    .trim();

            if (!query.isEmpty()) {
                boolean ok = appLauncher.openYouTube(query);
                return new CommandResult(CommandAction.SEARCH_YOUTUBE, query, ok,
                        ok ? "YouTube par " + query + " search kar raha hoon." : "YouTube nahi khul saka.", false);
            } else {
                boolean ok = appLauncher.openYouTube("");
                return new CommandResult(CommandAction.OPEN_YOUTUBE, "", ok,
                        ok ? "YouTube khol raha hoon." : "YouTube open nahi ho saka.", false);
            }
        }

        // 2. WhatsApp Commands
        if (lower.contains("whatsapp") || lower.contains("व्हाट्सएप") || lower.contains("वाट्सएप")) {
            boolean ok = appLauncher.openWhatsApp();
            return new CommandResult(CommandAction.OPEN_WHATSAPP, "", ok,
                    ok ? "WhatsApp khol raha hoon." : "WhatsApp install nahi hai.", false);
        }

        // 3. Music / Media Commands
        if (lower.contains("music") || lower.contains("gana") || lower.contains("गाना") || lower.contains("गीत") || lower.contains("song")) {
            boolean ok = appLauncher.playMusic();
            return new CommandResult(CommandAction.PLAY_MUSIC, "", ok,
                    ok ? "Music chala raha hoon." : "Koi music player nahi mila.", false);
        }

        // 4. Home Screen Navigation
        if (lower.contains("home screen") || lower.contains("होम स्क्रीन") || lower.contains("home par jao") || lower.contains("go home")) {
            MyAccessibilityService service = MyAccessibilityService.getInstance();
            if (service != null) {
                boolean ok = service.goHome();
                return new CommandResult(CommandAction.HOME_SCREEN, "", ok,
                        ok ? "Home screen par ja rahe hain." : "Home action perform nahi hua.", false);
            } else {
                Intent startMain = new Intent(Intent.ACTION_MAIN);
                startMain.addCategory(Intent.CATEGORY_HOME);
                startMain.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(startMain);
                return new CommandResult(CommandAction.HOME_SCREEN, "", true, "Home screen khol di hai.", false);
            }
        }

        // 5. Back Navigation
        if (lower.equals("back") || lower.contains("back jao") || lower.contains("peeche jao") || lower.contains("पीछे जाओ")) {
            MyAccessibilityService service = MyAccessibilityService.getInstance();
            if (service != null && service.goBack()) {
                return new CommandResult(CommandAction.BACK, "", true, "Back ja rahe hain.", false);
            } else {
                return new CommandResult(CommandAction.BACK, "", false,
                        "Back action ke liye Accessibility Service enable karein.", false);
            }
        }

        // 6. Recent Apps
        if (lower.contains("recent apps") || lower.contains("recents") || lower.contains("recent app") || lower.contains("apps badlo")) {
            MyAccessibilityService service = MyAccessibilityService.getInstance();
            if (service != null && service.showRecents()) {
                return new CommandResult(CommandAction.RECENT_APPS, "", true, "Recent apps dikha raha hoon.", false);
            } else {
                return new CommandResult(CommandAction.RECENT_APPS, "", false,
                        "Recent apps ke liye Accessibility Service chalu karein.", false);
            }
        }

        // 7. Notification Shade
        if (lower.contains("notification") || lower.contains("नोटिफिकेशन") || lower.contains("notif")) {
            MyAccessibilityService service = MyAccessibilityService.getInstance();
            if (service != null && service.openNotifications()) {
                return new CommandResult(CommandAction.NOTIFICATIONS, "", true, "Notifications khol raha hoon.", false);
            } else {
                return new CommandResult(CommandAction.NOTIFICATIONS, "", false,
                        "Notification kholne ke liye Accessibility permission zaroori hai.", false);
            }
        }

        // 8. Flashlight / Torch
        if (lower.contains("flashlight") || lower.contains("torch") || lower.contains("फ्लैशलाइट") || lower.contains("टॉर्च")) {
            boolean turnOn = lower.contains("on") || lower.contains("chalu") || lower.contains("jalao") || lower.contains("चालू");
            boolean turnOff = lower.contains("off") || lower.contains("band") || lower.contains("bujhao") || lower.contains("बंद");

            if (turnOff) {
                boolean ok = setFlashlight(false);
                return new CommandResult(CommandAction.FLASHLIGHT_OFF, "", ok,
                        ok ? "Flashlight band kar di hai." : "Flashlight control nahi ho saki.", false);
            } else if (turnOn || !isTorchOn) {
                boolean ok = setFlashlight(true);
                return new CommandResult(CommandAction.FLASHLIGHT_ON, "", ok,
                        ok ? "Flashlight on kar di hai." : "Flashlight control nahi ho saki.", false);
            } else {
                boolean ok = setFlashlight(false);
                return new CommandResult(CommandAction.FLASHLIGHT_OFF, "", ok,
                        ok ? "Flashlight band kar di hai." : "Flashlight control nahi ho saki.", false);
            }
        }

        // 9. Battery Status
        if (lower.contains("battery") || lower.contains("बैटरी") || lower.contains("charge") || lower.contains("charging")) {
            String batteryInfo = getBatteryStatus();
            return new CommandResult(CommandAction.BATTERY_STATUS, "", true, batteryInfo, false);
        }

        // 10. Volume Controls
        if (lower.contains("volume") || lower.contains("awaaz") || lower.contains("आवाज")) {
            if (lower.contains("kam") || lower.contains("down") || lower.contains("ghatao") || lower.contains("कम")) {
                boolean ok = adjustVolume(AudioManager.ADJUST_LOWER);
                return new CommandResult(CommandAction.VOLUME_DOWN, "", ok,
                        ok ? "Volume kam kar diya hai." : "Volume change nahi ho saka.", false);
            } else if (lower.contains("badhao") || lower.contains("up") || lower.contains("tez") || lower.contains("बढ़ाओ")) {
                boolean ok = adjustVolume(AudioManager.ADJUST_RAISE);
                return new CommandResult(CommandAction.VOLUME_UP, "", ok,
                        ok ? "Volume badha diya hai." : "Volume change nahi ho saka.", false);
            } else if (lower.contains("mute") || lower.contains("shant") || lower.contains("म्यूट")) {
                boolean ok = adjustVolume(AudioManager.ADJUST_MUTE);
                return new CommandResult(CommandAction.VOLUME_MUTE, "", ok,
                        ok ? "Volume mute kar diya hai." : "Volume mute nahi ho saka.", false);
            }
        }

        // 11. Contact Search & Call
        if (lower.contains("contact") || lower.contains("कॉन्टैक्ट") || lower.contains("call") || lower.contains("कॉल") || lower.contains("फोन करो")) {
            String targetName = command
                    .replaceAll("(?i)(contact|search|karo|ko|call|lagao|milao|ka|number|batao|कॉन्टैक्ट|कॉल|फोन)", "")
                    .trim();

            if (lower.contains("call") || lower.contains("कॉल") || lower.contains("फोन करो")) {
                ContactHelper.ContactInfo contact = contactHelper.findContact(targetName);
                if (contact != null) {
                    return new CommandResult(CommandAction.CALL_CONTACT, contact.number, true,
                            contact.name + " (" + contact.number + ") ko call karne ke liye confirm karein.", true);
                } else if (!targetName.isEmpty() && targetName.matches("^[0-9+\\-\\s]+$")) {
                    return new CommandResult(CommandAction.CALL_CONTACT, targetName, true,
                            targetName + " par call lagane ke liye confirm karein.", true);
                } else {
                    return new CommandResult(CommandAction.FIND_CONTACT, targetName, false,
                            "Contact '" + targetName + "' nahi mila.", false);
                }
            } else {
                ContactHelper.ContactInfo contact = contactHelper.findContact(targetName);
                if (contact != null) {
                    return new CommandResult(CommandAction.FIND_CONTACT, contact.name + ": " + contact.number, true,
                            contact.name + " ka number hai: " + contact.number, false);
                } else {
                    return new CommandResult(CommandAction.FIND_CONTACT, targetName, false,
                            "Is naam ka contact nahi mila. Kripya naam dobara batayein.", false);
                }
            }
        }

        // 12. Camera
        if (lower.contains("camera") || lower.contains("कैमरा") || lower.contains("photo") || lower.contains("फोटो")) {
            boolean ok = appLauncher.openCamera();
            return new CommandResult(CommandAction.OPEN_CAMERA, "", ok,
                    ok ? "Camera khol raha hoon." : "Camera open nahi ho saka.", false);
        }

        // 13. Settings
        if (lower.contains("settings") || lower.contains("सेटिंग")) {
            boolean ok = appLauncher.openSettings();
            return new CommandResult(CommandAction.OPEN_SETTINGS, "", ok,
                    ok ? "Phone settings khol raha hoon." : "Settings open nahi ho saki.", false);
        }

        // 14. Click Screen Element (Accessibility)
        if (lower.contains("click") || lower.contains("क्लिक") || lower.contains("dabao") || lower.contains("दबाओ")) {
            String textToClick = command
                    .replaceAll("(?i)(screen|par|click|karo|dabao|दबाओ|क्लिक)", "")
                    .trim();
            MyAccessibilityService service = MyAccessibilityService.getInstance();
            if (service != null && !textToClick.isEmpty()) {
                boolean clicked = service.clickByText(textToClick);
                return new CommandResult(CommandAction.CLICK_SCREEN_ELEMENT, textToClick, clicked,
                        clicked ? "'" + textToClick + "' par click kar diya hai." : "Screen par '" + textToClick + "' nahi mila.", false);
            } else {
                return new CommandResult(CommandAction.CLICK_SCREEN_ELEMENT, textToClick, false,
                        "Screen click ke liye Accessibility Service chalu karein.", false);
            }
        }

        // 15. Generic App Launch ("Open [App]")
        if (lower.startsWith("open ") || lower.startsWith("खोलो ") || lower.endsWith(" kholo") || lower.endsWith(" खोलो")) {
            String appName = command
                    .replaceAll("(?i)^(open|खोलो)\\s*", "")
                    .replaceAll("(?i)\\s*(kholo|खोलो)$", "")
                    .trim();
            boolean ok = appLauncher.openAppByName(appName);
            return new CommandResult(CommandAction.OPEN_YOUTUBE, appName, ok,
                    ok ? appName + " khol raha hoon." : appName + " open nahi ho saka.", false);
        }

        // Fallback: explain gracefully
        return new CommandResult(CommandAction.UNKNOWN, command, false,
                "Mujhe '" + command + "' samajh nahi aaya. Aap bol sakte hain: YouTube kholo, Battery kitni hai, Flashlight on karo, ya WhatsApp kholo.", false);
    }

    private boolean setFlashlight(boolean enable) {
        try {
            CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
            if (cameraManager == null) return false;

            String[] cameraIds = cameraManager.getCameraIdList();
            for (String id : cameraIds) {
                CameraCharacteristics chars = cameraManager.getCameraCharacteristics(id);
                Boolean flashAvailable = chars.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                Integer facing = chars.get(CameraCharacteristics.LENS_FACING);

                if (Boolean.TRUE.equals(flashAvailable) && facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    cameraManager.setTorchMode(id, enable);
                    isTorchOn = enable;
                    return true;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Flashlight error", e);
        }
        return false;
    }

    private String getBatteryStatus() {
        try {
            IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent batteryStatus = context.registerReceiver(null, ifilter);

            if (batteryStatus != null) {
                int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                int status = batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, -1);

                boolean isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING
                        || status == BatteryManager.BATTERY_STATUS_FULL;

                int batteryPct = (int) ((level / (float) scale) * 100);
                return "Battery " + batteryPct + "% hai" + (isCharging ? " aur phone charging par hai." : ".");
            }
        } catch (Exception e) {
            Log.e(TAG, "Battery check error", e);
        }
        return "Battery status check nahi ho saka.";
    }

    private boolean adjustVolume(int direction) {
        try {
            AudioManager audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI);
                return true;
            }
        } catch (Exception e) {
            Log.e(TAG, "Volume adjust error", e);
        }
        return false;
    }
}
