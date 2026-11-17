package com.example.hiram;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.PendingIntent;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

public class VoiceAgentService extends Service {

    private static final String TAG = "VoiceAgentService";

    public static final String CHANNEL_ID = "VoiceAgentServiceChannel";
    public static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_START = "com.example.hiram.action.START";
    public static final String ACTION_STOP = "com.example.hiram.action.STOP";
    public static final String ACTION_RESUME_WAKE_WORD =
            "com.example.hiram.action.RESUME_WAKE_WORD";

    public static final String BROADCAST_WAKE_WORD =
            "com.example.hiram.action.WAKE_WORD";

    private static volatile boolean running = false;

    private static final String PREFS_NAME = "hi_ram_voice_settings";
    private static final String KEY_WAKE_WORD_ENABLED = "wake_word_enabled";

    public static boolean isWakeWordEnabled(android.content.Context context) {
        return context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .getBoolean(KEY_WAKE_WORD_ENABLED, false);
    }

    private void setWakeWordEnabled(boolean enabled) {
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_WAKE_WORD_ENABLED, enabled)
                .apply();
    }

    private volatile WakeWordEngine wakeWordEngine;
    private VoiceCommandProcessor commandProcessor;

    private boolean stopPending = false;
    private boolean restartRequested = false;
    private boolean destroyed = false;

    public static boolean isRunning() {
        return running;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        commandProcessor = new VoiceCommandProcessor(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();

        if (ACTION_START.equals(action)) {
            setWakeWordEnabled(true);
        } else if (ACTION_RESUME_WAKE_WORD.equals(action) || intent == null) {
            if (!isWakeWordEnabled(this)) {
                Log.i(TAG, "Wake word is OFF; ignoring automatic restart.");
                return START_NOT_STICKY;
            }
        }

        if (ACTION_STOP.equals(action)) {
            setWakeWordEnabled(false);
            synchronized (this) {
                restartRequested = false;
                if (stopPending) {
                    return START_NOT_STICKY;
                }
                stopPending = true;
            }

            stopAssistantAndExit(startId);
            return START_NOT_STICKY;
        }

        synchronized (this) {
            if (stopPending) {
                restartRequested = true;
                return START_STICKY;
            }
            running = true;
        }

        startForeground(NOTIFICATION_ID, buildNotification("Listening for Hi Ram"));

        if (ACTION_START.equals(action)
                || ACTION_RESUME_WAKE_WORD.equals(action)
                || intent == null) {
            startWakeWordEngine();
        }

        return START_STICKY;
    }

    private synchronized void startWakeWordEngine() {
        if (!running || wakeWordEngine != null) return;

        wakeWordEngine = new WakeWordEngine(
                getApplicationContext(),
                new WakeWordEngine.WakeWordListener() {

            @Override
            public void onWakeWordDetected() {
                Log.i(TAG, "Wake word detected. Releasing microphone.");

                WakeWordEngine engine = wakeWordEngine;
                if (engine != null) {
                    releaseWakeWordEngine(engine);
                }
            }

            @Override
            public void onStateChanged(WakeWordEngine.State state) {
                Log.d(TAG, "Wake-word engine state: " + state);
            }

            @Override
            public void onError(String errorMessage) {
                Log.e(TAG, errorMessage);

                WakeWordEngine engine = wakeWordEngine;
                if (engine != null) {
                    handleWakeWordError(engine, errorMessage);
                }
            }
        });

        wakeWordEngine.start();
    }

    private void handleWakeWordError(
            WakeWordEngine engine, String errorMessage) {

        if (!engine.stop()) {
            new Handler(Looper.getMainLooper()).postDelayed(
                    () -> handleWakeWordError(engine, errorMessage), 1000);
            return;
        }

        synchronized (this) {
            if (wakeWordEngine != engine) return;

            wakeWordEngine = null;
            running = false;
        }

        NotificationManager manager =
                (NotificationManager) getSystemService(NOTIFICATION_SERVICE);

        if (manager != null) {
            manager.notify(
                    NOTIFICATION_ID,
                    buildNotification("Wake word stopped — tap to retry")
            );
        }
    }

    private void releaseWakeWordEngine(WakeWordEngine engine) {
        if (!running || wakeWordEngine != engine) return;

        if (!engine.stop()) {
            Log.w(TAG, "Microphone is still releasing; retrying shortly.");
            new Handler(Looper.getMainLooper()).postDelayed(
                    () -> releaseWakeWordEngine(engine), 500);
            return;
        }

        if (wakeWordEngine == engine) {
            wakeWordEngine = null;
        }

        if (!running) return;

        // Keep the foreground Activity flow and also notify when the app is backgrounded.
        Intent wakeIntent = new Intent(BROADCAST_WAKE_WORD);
        wakeIntent.setPackage(getPackageName());
        sendBroadcast(wakeIntent);

        NotificationManager manager =
                (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(
                    NOTIFICATION_ID,
                    buildNotification("Hi Ram detected — Tap to talk")
            );
        }
    }

    private Notification buildNotification(String statusText) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.putExtra("TRIGGER_VOICE_COMMAND", true);
        openIntent.setFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP
        );

        PendingIntent contentIntent = PendingIntent.getActivity(
                this,
                1002,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Hi Ram Assistant")
                .setContentText(statusText)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .build();
    }

    public void processIncomingVoiceCommand(String spokenText) {
        if (commandProcessor != null
                && spokenText != null
                && !spokenText.trim().isEmpty()) {

            VoiceCommandProcessor.CommandResult result =
                    commandProcessor.executeCommand(spokenText);

            Log.d(TAG, "Action: " + result.action
                    + " | Feedback: " + result.feedbackMessage);
        }
    }

    private void stopAssistantAndExit(int startId) {
        WakeWordEngine engine;

        synchronized (this) {
            running = false;
            engine = wakeWordEngine;
        }

        if (engine == null) {
            completeStopRequest(startId);
            return;
        }

        finishStoppingEngine(engine, startId);
    }

    private void finishStoppingEngine(WakeWordEngine engine, int startId) {
        synchronized (this) {
            if (wakeWordEngine != engine) {
                completeStopRequest(startId);
                return;
            }
        }

        if (!engine.stop()) {
            Log.w(TAG, "Microphone is still releasing; retrying stop.");
            new Handler(Looper.getMainLooper()).postDelayed(
                    () -> finishStoppingEngine(engine, startId), 1000);
            return;
        }

        synchronized (this) {
            if (wakeWordEngine == engine) {
                wakeWordEngine = null;
            }
            completeStopRequest(startId);
        }
    }

    private void completeStopRequest(int startId) {
        synchronized (this) {
            if (destroyed) {
                restartRequested = false;
                stopPending = false;
                running = false;
                stopForeground(true);
                return;
            }

            if (restartRequested && isWakeWordEnabled(this)) {
                restartRequested = false;
                stopPending = false;
                running = true;

                startForeground(
                        NOTIFICATION_ID,
                        buildNotification("Listening for Hi Ram")
                );
                startWakeWordEngine();
                Log.i(TAG, "Assistant restarted after microphone release.");
                return;
            }

            restartRequested = false;
            stopPending = false;
            running = false;
            stopForeground(true);
            stopSelf(startId);
            Log.i(TAG, "Assistant stopped.");
        }
    }

    private synchronized void stopAssistant() {
        running = false;

        WakeWordEngine engine = wakeWordEngine;
        if (engine == null) {
            stopForeground(true);
            return;
        }

        if (engine.stop()) {
            if (wakeWordEngine == engine) {
                wakeWordEngine = null;
            }
            stopForeground(true);
        } else {
            Log.w(TAG,
                    "Wake-word engine is still releasing microphone; "
                            + "its cleanup thread will finish resource release.");
        }
    }

    @Override
    public void onDestroy() {
        synchronized (this) {
            destroyed = true;
            restartRequested = false;
            running = false;
        }

        stopAssistant();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel serviceChannel = new NotificationChannel(
                    CHANNEL_ID,
                    "Hi Ram Background Voice",
                    NotificationManager.IMPORTANCE_LOW
            );

            NotificationManager manager =
                    getSystemService(NotificationManager.class);

            if (manager != null) {
                manager.createNotificationChannel(serviceChannel);
            }
        }
    }
}
