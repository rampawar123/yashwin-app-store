package com.example.hiram;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import androidx.core.app.NotificationCompat;

/**
 * VoiceAgentService - Persistent Foreground Service with Microphone Access
 *
 * Adheres strictly to Android 14+ background execution requirements:
 * 1. Declared foregroundServiceType="microphone"
 * 2. Persistent notification informs user whenever microphone listening is active
 * 3. Dedicated Start, Pause, and Stop action controls
 */
public class VoiceAgentService extends Service implements WakeWordEngine.WakeWordListener {

    private static final String TAG = "VoiceAgentService";
    public static final String CHANNEL_ID = "hiram_voice_channel";
    public static final int NOTIFICATION_ID = 2001;

    public static final String ACTION_START = "com.example.hiram.ACTION_START";
    public static final String ACTION_PAUSE = "com.example.hiram.ACTION_PAUSE";
    public static final String ACTION_RESUME = "com.example.hiram.ACTION_RESUME";
    public static final String ACTION_STOP = "com.example.hiram.ACTION_STOP";
    public static final String BROADCAST_WAKE_WORD = "com.example.hiram.WAKE_WORD_DETECTED";

    private static boolean isServiceRunning = false;
    private WakeWordEngine wakeWordEngine;
    private boolean isPaused = false;

    public static boolean isRunning() {
        return isServiceRunning;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        wakeWordEngine = new WakeWordEngine(this, this);
        isServiceRunning = true;
        Log.i(TAG, "VoiceAgentService initialized.");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_STOP.equals(action)) {
            stopListeningService();
            return START_NOT_STICKY;
        } else if (ACTION_PAUSE.equals(action)) {
            pauseListening();
        } else if (ACTION_RESUME.equals(action)) {
            resumeListening();
        } else {
            startListening();
        }

        return START_STICKY;
    }

    private void startListening() {
        isPaused = false;
        Notification notification = buildNotification(getString(R.string.notif_listening_active), false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        if (wakeWordEngine != null) {
            wakeWordEngine.start();
        }
    }

    private void pauseListening() {
        isPaused = true;
        if (wakeWordEngine != null) {
            wakeWordEngine.pause();
        }
        updateNotification("Listening paused • Tap to resume", true);
    }

    private void resumeListening() {
        isPaused = false;
        if (wakeWordEngine != null) {
            wakeWordEngine.resume();
        }
        updateNotification(getString(R.string.notif_listening_active), false);
    }

    private void stopListeningService() {
        isServiceRunning = false;
        if (wakeWordEngine != null) {
            wakeWordEngine.stop();
        }
        stopForeground(true);
        stopSelf();
    }

    private void updateNotification(String statusText, boolean isPausedState) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification(statusText, isPausedState));
        }
    }

    private Notification buildNotification(String statusText, boolean isPausedState) {
        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentPendingIntent = PendingIntent.getActivity(
                this, 0, openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0));

        Intent pauseResumeIntent = new Intent(this, VoiceAgentService.class);
        pauseResumeIntent.setAction(isPausedState ? ACTION_RESUME : ACTION_PAUSE);
        PendingIntent pauseResumePendingIntent = PendingIntent.getService(
                this, 1, pauseResumeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0));

        Intent stopIntent = new Intent(this, VoiceAgentService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPendingIntent = PendingIntent.getService(
                this, 2, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0));

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(statusText)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentIntent(contentPendingIntent)
                .setOngoing(true)
                .setColor(0xFF4CC9F0)
                .addAction(
                        isPausedState ? android.R.drawable.ic_media_play : android.R.drawable.ic_media_pause,
                        isPausedState ? getString(R.string.notif_action_resume) : getString(R.string.notif_action_pause),
                        pauseResumePendingIntent)
                .addAction(
                        android.R.drawable.ic_menu_close_clear_cancel,
                        getString(R.string.notif_action_stop),
                        stopPendingIntent)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    getString(R.string.channel_voice_name),
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription(getString(R.string.channel_voice_desc));

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public void onWakeWordDetected() {
        Log.i(TAG, "Wake word 'Hi Ram' spotted in background!");

        // Vibrate to give tactile feedback
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createOneShot(120, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(120);
                }
            }
        } catch (Exception ignored) {}

        // Broadcast to MainActivity to bring up voice recognition
        Intent broadcast = new Intent(BROADCAST_WAKE_WORD);
        broadcast.setPackage(getPackageName());
        sendBroadcast(broadcast);

        // Also launch MainActivity if screen is active
        Intent activityIntent = new Intent(this, MainActivity.class);
        activityIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        activityIntent.putExtra("TRIGGER_VOICE_COMMAND", true);
        startActivity(activityIntent);
    }

    @Override
    public void onStateChanged(WakeWordEngine.State state) {
        Log.d(TAG, "WakeWord state changed: " + state);
    }

    @Override
    public void onError(String errorMessage) {
        Log.w(TAG, "WakeWord error: " + errorMessage);
    }

    @Override
    public void onDestroy() {
        isServiceRunning = false;
        if (wakeWordEngine != null) {
            wakeWordEngine.stop();
            wakeWordEngine = null;
        }
        super.onDestroy();
        Log.i(TAG, "VoiceAgentService destroyed.");
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
