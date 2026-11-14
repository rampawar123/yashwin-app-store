package com.example.hiram;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Offline wake-word recognizer powered by Vosk.
 * The compact English model is downloaded once, stored privately, and then
 * used completely offline for the "Hi Ram" wake phrase.
 */
public class WakeWordEngine {

    private static final String TAG = "WakeWordEngine";
    public static final String WAKE_PHRASE = "Hi Ram";
    private static final String MODEL_URL =
            "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip";
    private static final String MODEL_DIR_NAME = "vosk-model-small-en-us-0.15";
    private static final int SAMPLE_RATE = 16000;
    private static final int CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO;
    private static final int AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT;
    private static final long WAKE_COOLDOWN_MS = 1800L;

    public enum State {
        STOPPED,
        DOWNLOADING_MODEL,
        LISTENING_FOR_WAKE_WORD,
        PAUSED,
        DETECTED
    }

    public interface WakeWordListener {
        void onWakeWordDetected();
        void onStateChanged(State state);
        void onError(String errorMessage);
    }

    private final Context context;
    private final WakeWordListener listener;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicBoolean isRunning = new AtomicBoolean(false);
    private final AtomicBoolean isPaused = new AtomicBoolean(false);

    private volatile AudioRecord audioRecord;
    private volatile Thread recordingThread;
    private volatile State currentState = State.STOPPED;

    public WakeWordEngine(Context context, WakeWordListener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
    }

    public synchronized void start() {
        if (isRunning.get()) {
            if (isPaused.get()) resume();
            return;
        }
        isRunning.set(true);
        isPaused.set(false);
        recordingThread = new Thread(this::loadModelAndListen, "HiRam-Vosk-WakeWord");
        recordingThread.start();
    }

    public synchronized void pause() {
        if (!isRunning.get() || isPaused.get()) return;
        isPaused.set(true);
        updateState(State.PAUSED);
    }

    public synchronized void resume() {
        if (!isRunning.get() || !isPaused.get()) return;
        isPaused.set(false);
        updateState(State.LISTENING_FOR_WAKE_WORD);
    }

    public synchronized void stop() {
        isRunning.set(false);
        isPaused.set(false);
        AudioRecord recorder = audioRecord;
        if (recorder != null) {
            try {
                if (recorder.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                    recorder.stop();
                }
            } catch (Exception e) {
                Log.w(TAG, "AudioRecord stop warning", e);
            }
        }
        Thread thread = recordingThread;
        if (thread != null) thread.interrupt();
        recordingThread = null;
        updateState(State.STOPPED);
    }

    public State getCurrentState() { return currentState; }
    public boolean isListening() { return isRunning.get() && !isPaused.get(); }

    private void loadModelAndListen() {
        Model model = null;
        Recognizer recognizer = null;
        AudioRecord recorder = null;
        try {
            File modelDir = new File(context.getFilesDir(), MODEL_DIR_NAME);
            if (!isModelReady(modelDir)) {
                updateState(State.DOWNLOADING_MODEL);
                downloadAndExtractModel(modelDir);
            }
            if (!isRunning.get()) return;

            model = new Model(modelDir.getAbsolutePath());
            // Grammar narrows recognition to the wake phrase and common acoustic variants.
            String grammar = "[\"hi ram\", \"hey ram\", \"high ram\"]";
            recognizer = new Recognizer(model, SAMPLE_RATE, grammar);

            int minBufferSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT);
            if (minBufferSize <= 0) throw new IllegalStateException("Microphone audio format is not supported");
            int bufferSize = Math.max(minBufferSize, 8192);
            recorder = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT, bufferSize);
            audioRecord = recorder;
            if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
                throw new IllegalStateException("Microphone recorder could not initialize");
            }

            recorder.startRecording();
            updateState(State.LISTENING_FOR_WAKE_WORD);
            byte[] audioBuffer = new byte[4096];
            long lastWakeAt = 0L;

            while (isRunning.get() && !Thread.currentThread().isInterrupted()) {
                int count = recorder.read(audioBuffer, 0, audioBuffer.length);
                if (count <= 0) continue;
                if (isPaused.get()) continue;

                boolean finalResult = recognizer.acceptWaveForm(audioBuffer, count);
                String resultJson = finalResult ? recognizer.getResult() : recognizer.getPartialResult();
                String recognized = extractText(resultJson);
                if (isWakePhrase(recognized)) {
                    long now = System.currentTimeMillis();
                    if (now - lastWakeAt >= WAKE_COOLDOWN_MS) {
                        lastWakeAt = now;
                        Log.i(TAG, "Vosk recognized wake phrase: " + recognized);
                        notifyWakeWordDetected();
                        recognizer.reset();
                    }
                }
            }
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        } catch (SecurityException e) {
            notifyError("Microphone permission is missing. Please allow microphone access.");
        } catch (Exception e) {
            Log.e(TAG, "Vosk wake-word engine failed", e);
            notifyError("Wake-word setup failed: " + safeMessage(e));
        } finally {
            audioRecord = null;
            if (recorder != null) {
                try {
                    if (recorder.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) recorder.stop();
                } catch (Exception ignored) {}
                try { recorder.release(); } catch (Exception ignored) {}
            }
            if (recognizer != null) try { recognizer.close(); } catch (Exception ignored) {}
            if (model != null) try { model.close(); } catch (Exception ignored) {}
            if (!isRunning.get()) updateState(State.STOPPED);
        }
    }

    private boolean isModelReady(File modelDir) {
        return new File(modelDir, "am/final.mdl").isFile()
                && new File(modelDir, "conf/model.conf").isFile();
    }

    private void downloadAndExtractModel(File modelDir) throws Exception {
        File zipFile = new File(context.getFilesDir(), MODEL_DIR_NAME + ".zip.part");
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(MODEL_URL).openConnection();
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("User-Agent", "HiRam-Android/1.1");
            connection.connect();
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("Model download server returned HTTP " + status);
            try (InputStream in = new BufferedInputStream(connection.getInputStream());
                 BufferedOutputStream out = new BufferedOutputStream(new FileOutputStream(zipFile))) {
                byte[] buffer = new byte[16384];
                int read;
                while (isRunning.get() && (read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                if (!isRunning.get()) throw new InterruptedException("Download cancelled");
            }
            extractModelZip(zipFile, modelDir);
            if (!isModelReady(modelDir)) throw new IllegalStateException("Downloaded model is incomplete");
        } finally {
            if (connection != null) connection.disconnect();
            // Keep no partial archive after success or failure; retry can download again.
            if (zipFile.exists()) //noinspection ResultOfMethodCallIgnored
                zipFile.delete();
        }
    }

    private void extractModelZip(File zipFile, File destination) throws Exception {
        File staging = new File(context.getFilesDir(), MODEL_DIR_NAME + ".extracting");
        deleteRecursively(staging);
        if (!staging.mkdirs() && !staging.isDirectory()) throw new IllegalStateException("Cannot create model folder");
        try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(new java.io.FileInputStream(zipFile)))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (!isRunning.get()) throw new InterruptedException("Extraction cancelled");
                String name = entry.getName().replace('\\', '/');
                String[] parts = name.split("/", 2);
                if (parts.length < 2) continue; // Skip the archive's top-level folder.
                String relative = parts[1];
                if (relative.isEmpty()) continue;
                File output = new File(staging, relative);
                String root = staging.getCanonicalPath() + File.separator;
                if (!output.getCanonicalPath().startsWith(root)) throw new SecurityException("Unsafe model archive path");
                if (entry.isDirectory()) {
                    if (!output.mkdirs() && !output.isDirectory()) throw new IllegalStateException("Cannot create model directory");
                } else {
                    File parent = output.getParentFile();
                    if (parent != null && !parent.mkdirs() && !parent.isDirectory()) throw new IllegalStateException("Cannot create model folder");
                    try (FileOutputStream out = new FileOutputStream(output)) {
                        byte[] buffer = new byte[16384];
                        int count;
                        while ((count = zis.read(buffer)) != -1) out.write(buffer, 0, count);
                    }
                }
                zis.closeEntry();
            }
        } catch (Exception e) {
            deleteRecursively(staging);
            throw e;
        }
        deleteRecursively(destination);
        if (!staging.renameTo(destination)) {
            deleteRecursively(staging);
            throw new IllegalStateException("Cannot install offline voice model");
        }
    }

    private void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    private String extractText(String json) {
        try {
            JSONObject object = new JSONObject(json);
            String text = object.optString("partial", "");
            if (text.isEmpty()) text = object.optString("text", "");
            return text;
        } catch (Exception ignored) {
            return "";
        }
    }

    private boolean isWakePhrase(String text) {
        if (text == null || text.trim().isEmpty()) return false;
        String normalized = text.toLowerCase(Locale.US).replaceAll("[^a-z ]", " ").trim().replaceAll("\\s+", " ");
        return normalized.equals("hi ram") || normalized.endsWith(" hi ram")
                || normalized.equals("hey ram") || normalized.endsWith(" hey ram")
                || normalized.equals("high ram") || normalized.endsWith(" high ram");
    }

    private String safeMessage(Exception e) {
        String message = e.getMessage();
        return message == null || message.trim().isEmpty() ? e.getClass().getSimpleName() : message;
    }

    private void updateState(State state) {
        currentState = state;
        mainHandler.post(() -> { if (listener != null) listener.onStateChanged(state); });
    }

    private void notifyWakeWordDetected() {
        mainHandler.post(() -> {
            updateState(State.DETECTED);
            if (listener != null) listener.onWakeWordDetected();
        });
    }

    private void notifyError(String error) {
        mainHandler.post(() -> { if (listener != null) listener.onError(error); });
    }
}
