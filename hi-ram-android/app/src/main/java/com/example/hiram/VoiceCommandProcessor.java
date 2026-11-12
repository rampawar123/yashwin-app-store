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

public class VoiceCommandProcessor {

    private static final String TAG = "VoiceCommandProcessor";

    public enum CommandAction {
        OPEN_YOUTUBE, SEARCH_YOUTUBE, OPEN_WHATSAPP, PLAY_MUSIC,
        HOME_SCREEN, BACK, RECENT_APPS, NOTIFICATIONS,
        FLASHLIGHT_ON, FLASHLIGHT_OFF, BATTERY_STATUS,
        VOLUME_UP, VOLUME_DOWN, VOLUME_MUTE,
        FIND_CONTACT, CALL_CONTACT, OPEN_CAMERA, OPEN_SETTINGS,
        CLICK_SCREEN_ELEMENT, UNKNOWN
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

    public String cleanCommandText(String spokenText) {
        if (spokenText == null) return "";
        return spokenText
                .replaceAll("(?i)^(hi ram|hey ram|hai ram|हाय राम|हे राम)[,\\s]*", "")
                .trim();
    }

    public CommandResult executeCommand(String spokenText) {
        String command = cleanCommandText(spokenText);
        if (command.isEmpty()) {
            return new CommandResult(CommandAction.UNKNOWN, "", false, "Kripya command boliye.", false);
        }

        String lower = command.toLowerCase(Locale.ROOT);

        // 1. YouTube
        if (lower.contains("youtube") || lower.contains("यूट्यूब")) {
            String query = command.replaceAll("(?i)(youtube|यूट्यूब|open|kholo|chalao|search|khojo)", "").trim();
            if (!query.isEmpty()) {
                boolean ok = appLauncher.openYouTube(query);
                return new CommandResult(CommandAction.SEARCH_YOUTUBE, query, ok, "YouTube par " + query + " search kar raha hoon.", false);
            } else {
                boolean ok = appLauncher.openYouTube("");
                return new CommandResult(CommandAction.OPEN_YOUTUBE, "", ok, "YouTube khol raha hoon.", false);
            }
        }

        // 2. WhatsApp
        if (lower.contains("whatsapp") || lower.contains("व्हाट्सएप")) {
            boolean ok = appLauncher.openWhatsApp();
            return new CommandResult(CommandAction.OPEN_WHATSAPP, "", ok, "WhatsApp khol raha hoon.", false);
        }

        // 3. Music
        if (lower.contains("music") || lower.contains("gana") || lower.contains("गाना") || lower.contains("song")) {
            boolean ok = appLauncher.playMusic();
            return new CommandResult(CommandAction.PLAY_MUSIC, "", ok, "Music chala raha hoon.", false);
        }

        // 4. Home Screen
        if (lower.contains("home screen") || lower.contains("होम स्क्रीन") || lower.contains("go home")) {
            MyAccessibilityService service = MyAccessibilityService.getInstance();
            if (service != null) {
                boolean ok = service.goHome();
                return new CommandResult(CommandAction.HOME_SCREEN, "", ok, "Home screen par ja rahe hain.", false);
            } else {
                Intent startMain = new Intent(Intent.ACTION_MAIN);
                startMain.addCategory(Intent.CATEGORY_HOME);
                startMain.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(startMain);
                return new CommandResult(CommandAction.HOME_SCREEN, "", true, "Home screen khol di hai.", false);
            }
        }

        // 5. Flashlight
        if (lower.contains("flashlight") || lower.contains("torch") || lower.contains("टॉर्च")) {
            boolean turnOff = lower.contains("off") || lower.contains("band") || lower.contains("बंद");
            boolean ok = setFlashlight(!turnOff);
            return new CommandResult(turnOff ? CommandAction.FLASHLIGHT_OFF : CommandAction.FLASHLIGHT_ON, "", ok,
                    ok ? (turnOff ? "Flashlight band kar di hai." : "Flashlight on kar di hai.") : "Flashlight control nahi ho saki.", false);
        }

        // 6. Battery Status
        if (lower.contains("battery") || lower.contains("बैटरी")) {
            return new CommandResult(CommandAction.BATTERY_STATUS, "", true, getBatteryStatus(), false);
        }

        // 7. Volume Controls
        if (lower.contains("volume") || lower.contains("awaaz") || lower.contains("आवाज")) {
            int dir = lower.contains("kam") || lower.contains("down") ? AudioManager.ADJUST_LOWER : AudioManager.ADJUST_RAISE;
            boolean ok = adjustVolume(dir);
            return new CommandResult(dir == AudioManager.ADJUST_LOWER ? CommandAction.VOLUME_DOWN : CommandAction.VOLUME_UP, "", ok, "Volume adjust kar diya hai.", false);
        }

        // 8. Call / Contacts
        if (lower.contains("call") || lower.contains("कॉल") || lower.contains("फोन करो")) {
            String targetName = command.replaceAll("(?i)(contact|search|call|lagao|milao|कॉल|फोन)", "").trim();
            ContactHelper.ContactInfo contact = contactHelper.findContact(targetName);
            if (contact != null) {
                return new CommandResult(CommandAction.CALL_CONTACT, contact.number, true, contact.name + " ko call kar rahe hain.", true);
            }
            return new CommandResult(CommandAction.FIND_CONTACT, targetName, false, "Contact nahi mila.", false);
        }

        // Fallback
        return new CommandResult(CommandAction.UNKNOWN, command, false, "Mujhe '" + command + "' samajh nahi aaya.", false);
    }

    private boolean setFlashlight(boolean enable) {
        try {
            CameraManager cm = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
            if (cm != null) {
                for (String id : cm.getCameraIdList()) {
                    CameraCharacteristics chars = cm.getCameraCharacteristics(id);
                    Boolean flash = chars.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                    if (Boolean.TRUE.equals(flash)) {
                        cm.setTorchMode(id, enable);
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
            IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent status = context.registerReceiver(null, ifilter);
            if (status != null) {
                int level = status.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = status.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                int pct = (int) ((level / (float) scale) * 100);
                return "Battery " + pct + "% hai.";
            }
        } catch (Exception e) {
            Log.e(TAG, "Battery error", e);
        }
        return "Battery status nahi mil saka.";
    }

    private boolean adjustVolume(int direction) {
        try {
            AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                am.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI);
                return true;
            }
        } catch (Exception e) {
            Log.e(TAG, "Volume error", e);
        }
        return false;
    }
}
