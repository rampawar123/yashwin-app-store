package com.example.hiram;

import android.content.Context;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;

import java.util.Locale;

/**
 * TtsManager - Speaks feedback to the user in Hindi or English
 */
public class TtsManager {

    private static final String TAG = "TtsManager";

    public interface TtsListener {
        void onSpeechStarted();
        void onSpeechCompleted();
        void onError(String error);
    }

    private final Context context;
    private TextToSpeech tts;
    private boolean isInitialized = false;
    private Locale currentLocale = new Locale("hi", "IN");
    private TtsListener listener;

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
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String utteranceId) {
                        if (listener != null) listener.onSpeechStarted();
                    }

                    @Override
                    public void onDone(String utteranceId) {
                        if (listener != null) listener.onSpeechCompleted();
                    }

                    @Override
                    public void onError(String utteranceId) {
                        if (listener != null) listener.onError("TTS playback failed");
                    }
                });
                Log.i(TAG, "TextToSpeech successfully initialized.");
            } else {
                Log.w(TAG, "TextToSpeech initialization returned error status: " + status);
            }
        });
    }

    public void setLanguage(Locale locale) {
        this.currentLocale = locale;
        if (!isInitialized || tts == null) return;

        int result = tts.setLanguage(locale);
        if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
            Log.w(TAG, "Locale " + locale + " not fully supported, falling back to default/English.");
            tts.setLanguage(Locale.ENGLISH);
        }
    }

    public void speak(String text) {
        if (text == null || text.trim().isEmpty()) return;

        if (!isInitialized || tts == null) {
            Log.w(TAG, "TTS not ready yet to speak: " + text);
            return;
        }

        // Auto-detect Hindi vs English text for natural accent
        if (containsHindiCharacters(text)) {
            tts.setLanguage(new Locale("hi", "IN"));
        } else {
            tts.setLanguage(currentLocale);
        }

        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "Hiram_UTTERANCE_" + System.currentTimeMillis());
    }

    public void stop() {
        if (tts != null) {
            tts.stop();
        }
    }

    public void shutdown() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        isInitialized = false;
    }

    private boolean containsHindiCharacters(String text) {
        for (int i = 0; i < text.length(); i++) {
            Character.UnicodeBlock block = Character.UnicodeBlock.of(text.charAt(i));
            if (Character.UnicodeBlock.DEVANAGARI.equals(block)) {
                return true;
            }
        }
        return false;
    }
}
