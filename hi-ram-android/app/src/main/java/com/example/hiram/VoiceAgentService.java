
package com.example.hiram;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

public class VoiceAgentService extends Service {

    private static final String TAG = "VoiceAgentService";

    public static final String CHANNEL_ID = "VoiceAgentServiceChannel";
    public static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_START =
            "com.example.hiram.ACTION_START";

    public static final String ACTION_STOP =
            "com.example.hiram.ACTION_STOP";

    public static final String BROADCAST_WAKE_WORD =
            "com.example.hiram.WAKE_WORD_DETECTED";

    private static volatile boolean running = false;

    private WakeWordEngine wakeWordEngine;

    public static boolean isRunning() {
        return running;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {

        String action = intent != null ? intent.getAction() : ACTION_START;

        if (ACTION_STOP.equals(action)) {
            stopAssistant();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (running) {
            return START_STICKY;
        }

        try {
            Notification notification =
                    new NotificationCompat.Builder(this, CHANNEL_ID)
                            .setContentTitle("Hi Ram Assistant Active")
                            .setContentText("Hi Ram wake word sun raha hai")
                            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                            .setOngoing(true)
                            .setPriority(NotificationCompat.PRIORITY_LOW)
                            .build();

            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                );
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }

            running = true;

            wakeWordEngine = new WakeWordEngine(
                    this,
                    new WakeWordEngine.WakeWordListener() {

                        @Override
                        public void onWakeWordDetected() {
                            Log.i(TAG, "Hi Ram wake word detected");

                            Intent broadcast =
                                    new Intent(BROADCAST_WAKE_WORD);

                            broadcast.setPackage(getPackageName());

                            sendBroadcast(broadcast);
                        }

                        @Override
                        public void onStateChanged(
                                WakeWordEngine.State state) {

                            Log.d(TAG, "Wake state: " + state);
                        }

                        @Override
                        public void onError(String errorMessage) {
                            Log.e(TAG, errorMessage);
                        }
                    }
            );

            wakeWordEngine.start();

            Log.i(TAG, "Hi Ram service started");

            return START_STICKY;

        } catch (Exception e) {
            Log.e(TAG, "Service start failed", e);
            stopAssistant();
            stopSelf();
            return START_NOT_STICKY;
        }
    }

    private void stopAssistant() {

        running = false;

        if (wakeWordEngine != null) {
            wakeWordEngine.stop();
            wakeWordEngine = null;
        }

        stopForeground(true);

        Log.i(TAG, "Hi Ram service stopped");
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

            NotificationChannel channel =
                    new NotificationChannel(
                            CHANNEL_ID,
                            "Hi Ram Voice Assistant",
                            NotificationManager.IMPORTANCE_LOW
                    );

            NotificationManager manager =
                    getSystemService(NotificationManager.class);

            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }
}
