package com.example.hiram;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

public class VoiceAgentService extends Service {

    private static final String TAG = "VoiceAgentService";

    public static final String CHANNEL_ID = "VoiceAgentServiceChannel";
    public static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_START = "com.example.hiram.action.START";
    public static final String ACTION_STOP = "com.example.hiram.action.STOP";
    public static final String BROADCAST_WAKE_WORD = "com.example.hiram.action.WAKE_WORD";

    private static volatile boolean running = false;

    private WakeWordEngine wakeWordEngine;
    private VoiceCommandProcessor commandProcessor;

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
        String action = intent == null ? ACTION_START : intent.getAction();

        if (ACTION_STOP.equals(action)) {
            stopAssistant();
            stopSelf(startId);
            return START_NOT_STICKY;
        }

        // Android requires a foreground notification immediately for microphone services.
        startForeground(NOTIFICATION_ID, buildNotification());
        running = true;

        if (wakeWordEngine == null) {
            wakeWordEngine = new WakeWordEngine(getApplicationContext(),
                    new WakeWordEngine.WakeWordListener() {
                        @Override
                        public void onWakeWordDetected() {
                            Intent wakeIntent = new Intent(BROADCAST_WAKE_WORD);
                            wakeIntent.setPackage(getPackageName());
                            sendBroadcast(wakeIntent);
                        }

                        @Override
                        public void onStateChanged(WakeWordEngine.State state) {
                            Log.d(TAG, "Wake-word engine state: " + state);
                        }

                        @Override
                        public void onError(String errorMessage) {
                            Log.e(TAG, errorMessage);
                        }
                    });
            wakeWordEngine.start();
        }

        return START_STICKY;
    }

    private Notification buildNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Hi Ram Assistant Active")
                .setContentText("Background voice service is running")
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .build();
    }

    public void processIncomingVoiceCommand(String spokenText) {
        if (commandProcessor != null && spokenText != null && !spokenText.trim().isEmpty()) {
            VoiceCommandProcessor.CommandResult result = commandProcessor.executeCommand(spokenText);
            Log.d(TAG, "Action: " + result.action + " | Feedback: " + result.feedbackMessage);
        }
    }

    private void stopAssistant() {
        if (wakeWordEngine != null) {
            wakeWordEngine.stop();
            wakeWordEngine = null;
        }
        running = false;
        stopForeground(true);
    }

    @Override
    public void onDestroy() {
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
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(serviceChannel);
            }
        }
    }
}
