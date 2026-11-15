package com.example.hiram;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;

import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Queue;

public class TtsManager {

    private static final String TAG = "TtsManager";

    public interface TtsListener {
        void onSpeechStarted();
        void onSpeechCompleted();
        void onError(String error);
    }

    private static class SpeechItem {
        final String text;
        final Runnable onComplete;

        SpeechItem(String text, Runnable onComplete) {
            this.text = text;
            this.onComplete = onComplete;
        }
    }

    private final Context context;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Queue<SpeechItem> pendingSpeech = new ArrayDeque<>();
    private final Map<String, Runnable> callbacks = new HashMap<>();

    private TextToSpeech tts;
    private volatile boolean isInitialized = false;
    private Locale currentLocale = new Locale("hi", "IN");
    private TtsListener listener;
    private long utteranceCounter = 0;

    public TtsManager(Context context) {
        this.context = context.getApplicationContext();
        initialize();
    }

    public void setListener(TtsListener listener) {
        this.listener = listener;
    }

    private void initialize() {
        tts = new TextToSpeech(context, status -> {
            if (status == TextToSpeech.SUCCESS) {
                isInitialized = true;
                setLanguage(currentLocale);

                tts.setOnUtteranceProgressListener(
                        new UtteranceProgressListener() {
                    @Override
                    public void onStart(String utteranceId) {
                        mainHandler.post(() -> {
                            if (listener != null) {
                                listener.onSpeechStarted();
                            }
                        });
                    }

                    @Override
                    public void onDone(String utteranceId) {
                        mainHandler.post(() -> {
                            Runnable callback;
                            synchronized (callbacks) {
                                callback = callbacks.remove(utteranceId);
                            }

                            if (listener != null) {
                                listener.onSpeechCompleted();
                            }

                            if (callback != null) {
                                callback.run();
                            }
                        });
                    }

                    @Override
                    public void onError(String utteranceId) {
                        mainHandler.post(() -> {
                            Runnable callback;
                            synchronized (callbacks) {
                                callback = callbacks.remove(utteranceId);
                            }

                            if (listener != null) {
                                listener.onError("TTS playback failed");
                            }

                            if (callback != null) {
                                callback.run();
                            }
                        });
                    }
                });

                Log.i(TAG, "TextToSpeech initialized.");
                flushPendingSpeech();

            } else {
                Log.e(TAG, "TTS initialization failed: " + status);
                isInitialized = false;
                mainHandler.post(() -> {
                    if (listener != null) {
                        listener.onError("TTS initialization failed");
                    }
                });
            }
        });
    }

    public void setLanguage(Locale locale) {
        if (locale == null) return;

        currentLocale = locale;

        if (!isInitialized || tts == null) return;

        int result = tts.setLanguage(locale);

        if (result == TextToSpeech.LANG_MISSING_DATA
                || result == TextToSpeech.LANG_NOT_SUPPORTED) {
            Log.w(TAG, "Language unavailable: " + locale);
            tts.setLanguage(Locale.ENGLISH);
        }
    }

    public void speak(String text) {
        speak(text, null);
    }

    public void speak(String text, Runnable onComplete) {
        if (text == null || text.trim().isEmpty()) {
            if (onComplete != null) {
                mainHandler.post(onComplete);
            }
            return;
        }

        synchronized (pendingSpeech) {
            pendingSpeech.offer(new SpeechItem(text, onComplete));
        }

        flushPendingSpeech();
    }

    private void flushPendingSpeech() {
        if (!isInitialized || tts == null) return;

        synchronized (pendingSpeech) {
            while (!pendingSpeech.isEmpty()) {
                SpeechItem item = pendingSpeech.poll();
                speakNow(item);
            }
        }
    }

    private void speakNow(SpeechItem item) {
        if (containsHindiCharacters(item.text)) {
            tts.setLanguage(new Locale("hi", "IN"));
        } else {
            tts.setLanguage(currentLocale);
        }

        // Deeper, masculine-style speech profile.
        // Actual voice gender depends on the installed TTS engine voice.
        tts.setPitch(0.82f);
        tts.setSpeechRate(0.96f);

        String utteranceId = "Hiram_UTTERANCE_" + (++utteranceCounter);

        if (item.onComplete != null) {
            synchronized (callbacks) {
                callbacks.put(utteranceId, item.onComplete);
            }
        }

        int result = tts.speak(
                item.text,
                TextToSpeech.QUEUE_ADD,
                null,
                utteranceId
        );

        if (result == TextToSpeech.ERROR) {
            Runnable callback;
            synchronized (callbacks) {
                callback = callbacks.remove(utteranceId);
            }

            if (listener != null) {
                mainHandler.post(() ->
                        listener.onError("TTS could not start"));
            }

            if (callback != null) {
                mainHandler.post(callback);
            }
        }
    }

    public void stop() {
        if (tts != null) {
            tts.stop();
        }

        synchronized (pendingSpeech) {
            pendingSpeech.clear();
        }

        synchronized (callbacks) {
            callbacks.clear();
        }
    }

    public void shutdown() {
        stop();

        if (tts != null) {
            tts.shutdown();
            tts = null;
        }

        isInitialized = false;
    }

    private boolean containsHindiCharacters(String text) {
        for (int i = 0; i < text.length(); i++) {
            Character.UnicodeBlock block =
                    Character.UnicodeBlock.of(text.charAt(i));

            if (Character.UnicodeBlock.DEVANAGARI.equals(block)) {
                return true;
            }
        }

        return false;
    }
}
