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

    private VoiceCommandProcessor commandProcessor;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        commandProcessor = new VoiceCommandProcessor(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Hi Ram Assistant Active")
                .setContentText("Aapki voice commands sun raha hoon...")
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .build();

        startForeground(NOTIFICATION_ID, notification);
        startListeningService();

        return START_STICKY;
    }

    private void startListeningService() {
        Log.d(TAG, "Voice Agent Service successfully started.");
    }

    public void processIncomingVoiceCommand(String spokenText) {
        if (commandProcessor != null && spokenText != null && !spokenText.trim().isEmpty()) {
            VoiceCommandProcessor.CommandResult result = commandProcessor.executeCommand(spokenText);
            Log.d(TAG, "Action: " + result.action + " | Success: " + result.success);
            Log.d(TAG, "Feedback: " + result.feedbackMessage);
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel serviceChannel = new NotificationChannel(
                    CHANNEL_ID,
                    "Voice Agent Background Service",
                    NotificationManager.IMPORTANCE_LOW
            );
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(serviceChannel);
            }
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.d(TAG, "Voice Agent Service destroyed.");
    }
}
