package com.example.hiram;

import android.app.Service;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.IBinder;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

public class FloatingBubbleService extends Service {

    private WindowManager windowManager;
    private FrameLayout bubbleView;
    private TextView bubbleLabel;
    private WindowManager.LayoutParams params;

    private int bubbleSize;
    private float touchX;
    private float touchY;
    private int startX;
    private int startY;
    private boolean moved;

    @Override
    public void onCreate() {
        super.onCreate();

        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        bubbleSize = (int) (48 * getResources().getDisplayMetrics().density);

        createBubble();
    }

    private void createBubble() {
        if (bubbleView != null) return;

        float density = getResources().getDisplayMetrics().density;

        bubbleView = new FrameLayout(this);

        bubbleLabel = new TextView(this);
        bubbleLabel.setText("Hi");
        bubbleLabel.setTextColor(Color.WHITE);
        bubbleLabel.setTextSize(15);
        bubbleLabel.setTypeface(null, Typeface.BOLD);
        bubbleLabel.setGravity(Gravity.CENTER);
        updateBubbleAppearance();

        FrameLayout.LayoutParams labelParams = new FrameLayout.LayoutParams(
                bubbleSize,
                bubbleSize,
                Gravity.CENTER
        );
        bubbleView.addView(bubbleLabel, labelParams);

        TextView closeButton = new TextView(this);
        closeButton.setText("×");
        closeButton.setTextColor(Color.WHITE);
        closeButton.setTextSize(17);
        closeButton.setTypeface(null, Typeface.BOLD);
        closeButton.setGravity(Gravity.CENTER);

        GradientDrawable closeBackground = new GradientDrawable();
        closeBackground.setShape(GradientDrawable.OVAL);
        closeBackground.setColor(Color.parseColor("#EF4444"));
        closeButton.setBackground(closeBackground);

        int closeSize = (int) (20 * density);
        FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(
                closeSize,
                closeSize,
                Gravity.TOP | Gravity.END
        );
        bubbleView.addView(closeButton, closeParams);

        closeButton.setOnClickListener(v -> stopSelf());
        bubbleLabel.setOnTouchListener(this::handleTouch);

        params = new WindowManager.LayoutParams(
                bubbleSize,
                bubbleSize,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
        );

        params.gravity = Gravity.TOP | Gravity.START;
        params.x = 20;
        params.y = 250;

        try {
            windowManager.addView(bubbleView, params);
        } catch (Exception e) {
            Toast.makeText(this, "Hi Ram Bubble could not open", Toast.LENGTH_LONG).show();
            stopSelf();
        }
    }

    private void updateBubbleAppearance() {
        if (bubbleLabel == null) return;

        boolean running = VoiceAgentService.isRunning();

        GradientDrawable background = new GradientDrawable();
        background.setShape(GradientDrawable.OVAL);
        background.setColor(Color.parseColor("#070E1E"));
        background.setStroke(
                (int) (3 * getResources().getDisplayMetrics().density),
                Color.parseColor(running ? "#10B981" : "#EF4444")
        );

        bubbleLabel.setBackground(background);
    }

    private boolean handleTouch(View view, MotionEvent event) {
        switch (event.getAction()) {
            case MotionEvent.ACTION_DOWN:
                touchX = event.getRawX();
                touchY = event.getRawY();
                startX = params.x;
                startY = params.y;
                moved = false;
                return true;

            case MotionEvent.ACTION_MOVE:
                float dx = event.getRawX() - touchX;
                float dy = event.getRawY() - touchY;

                if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
                    moved = true;
                }

                if (moved) {
                    params.x = startX + (int) dx;
                    params.y = startY + (int) dy;

                    try {
                        windowManager.updateViewLayout(bubbleView, params);
                    } catch (Exception ignored) {}
                }
                return true;

            case MotionEvent.ACTION_UP:
                if (!moved) {
                    toggleAssistant();
                } else {
                    dockToEdge();
                }
                return true;
        }

        return false;
    }

    private void dockToEdge() {
        int screenWidth = getResources().getDisplayMetrics().widthPixels;

        params.x = params.x + bubbleSize / 2 < screenWidth / 2
                ? 0
                : Math.max(0, screenWidth - bubbleSize);

        try {
            windowManager.updateViewLayout(bubbleView, params);
        } catch (Exception ignored) {}
    }

    private void toggleAssistant() {
        if (VoiceAgentService.isRunning()) {
            Intent stopIntent = new Intent(this, VoiceAgentService.class);
            stopIntent.setAction(VoiceAgentService.ACTION_STOP);
            startService(stopIntent);

            Toast.makeText(this, "Hi Ram OFF", Toast.LENGTH_SHORT).show();
        } else {
            try {
                Intent openIntent = new Intent(this, MainActivity.class);
                openIntent.putExtra("ENABLE_ASSISTANT", true);
                openIntent.addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK
                                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                );
                startActivity(openIntent);
            } catch (Exception e) {
                Toast.makeText(
                        this,
                        "Hi Ram app could not open",
                        Toast.LENGTH_LONG
                ).show();
            }
        }

        bubbleView.postDelayed(this::updateBubbleAppearance, 1000);
    }

    @Override
    public void onDestroy() {
        if (bubbleView != null && windowManager != null) {
            try {
                windowManager.removeView(bubbleView);
            } catch (Exception ignored) {}

            bubbleView = null;
        }

        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
