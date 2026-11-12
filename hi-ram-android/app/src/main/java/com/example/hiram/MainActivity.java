
package com.example.hiram;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class MainActivity extends AppCompatActivity {

    private TextView txtStatus;
    private TextView txtResult;
    private TextView txtFeedback;
    private TextView txtAccessibilityBadge;

    private Button btnMic;
    private Button btnToggleService;
    private Button btnOpenAccessibility;

    private Spinner spinnerLanguage;
    private RecyclerView recyclerHistory;

    private CommandHistoryAdapter historyAdapter;

    private final List<CommandHistoryItem> historyList =
            new ArrayList<>();

    private SpeechRecognizer speechRecognizer;
    private TtsManager ttsManager;
    private VoiceCommandProcessor commandProcessor;
    private VoiceAuthManager authManager;
    private AppLauncher appLauncher;

    private String selectedLanguageCode = "hi-IN";

    private boolean isListening = false;
    private boolean receiverRegistered = false;

    private final Handler mainHandler =
            new Handler(Looper.getMainLooper());

    private final ActivityResultLauncher<String[]> permissionLauncher =
            registerForActivityResult(
                    new ActivityResultContracts.RequestMultiplePermissions(),
                    result -> {

                        if (hasMicrophonePermission()) {
                            Toast.makeText(
                                    this,
                                    "Microphone permission granted",
                                    Toast.LENGTH_SHORT
                            ).show();
                        } else {
                            Toast.makeText(
                                    this,
                                    "Microphone permission required",
                                    Toast.LENGTH_LONG
                            ).show();
                        }

                        updatePermissionsUI();
                    }
            );

    private final BroadcastReceiver wakeWordReceiver =
            new BroadcastReceiver() {

                @Override
                public void onReceive(
                        Context context,
                        Intent intent) {

                    if (intent == null ||
                            !VoiceAgentService.BROADCAST_WAKE_WORD
                                    .equals(intent.getAction())) {
                        return;
                    }

                    if (!hasMicrophonePermission()) {
                        requestPermissionsForAssistant();
                        return;
                    }

                    if (ttsManager != null) {
                        ttsManager.speak("Haan ji, boliye!");
                    }

                    mainHandler.postDelayed(
                            () -> {
                                if (!isFinishing()
                                        && !isDestroyed()) {
                                    startListening();
                                }
                            },
                            1000
                    );
                }
            };

    @Override
    protected void onCreate(Bundle savedInstanceState) {

        super.onCreate(savedInstanceState);

        setContentView(R.layout.activity_main);

        initViews();
        initComponents();
        setupLanguageSpinner();
        setupSuggestionChips();
        setupServiceButtons();

        updatePermissionsUI();
        updateAccessibilityUI();

        if (getIntent() != null &&
                getIntent().getBooleanExtra(
                        "TRIGGER_VOICE_COMMAND",
                        false)) {

            mainHandler.postDelayed(
                    this::checkPermissionsAndListen,
                    600
            );
        }
    }

    private void initViews() {

        txtStatus = findViewById(R.id.txtStatus);
        txtResult = findViewById(R.id.txtResult);
        txtFeedback = findViewById(R.id.txtFeedback);

        txtAccessibilityBadge =
                findViewById(R.id.txtAccessibilityBadge);

        btnMic = findViewById(R.id.btnMic);

        btnToggleService =
                findViewById(R.id.btnToggleService);

        btnOpenAccessibility =
                findViewById(R.id.btnOpenAccessibility);

        spinnerLanguage =
                findViewById(R.id.spinnerLanguage);

        recyclerHistory =
                findViewById(R.id.recyclerHistory);

        recyclerHistory.setLayoutManager(
                new LinearLayoutManager(this)
        );

        historyAdapter =
                new CommandHistoryAdapter(historyList);

        recyclerHistory.setAdapter(historyAdapter);

        btnMic.setOnClickListener(v -> {

            if (isListening) {
                stopListening();
            } else {
                checkPermissionsAndListen();
            }
        });

        btnOpenAccessibility.setOnClickListener(v -> {

            if (appLauncher != null) {
                appLauncher.openAccessibilitySettings();
            }
        });
    }

    private void initComponents() {

        commandProcessor =
                new VoiceCommandProcessor(this);

        appLauncher =
                new AppLauncher(this);

        authManager =
                new VoiceAuthManager(this);

        ttsManager =
                new TtsManager(this);

        initSpeechRecognizer();
    }

    private void initSpeechRecognizer() {

        if (!SpeechRecognizer.isRecognitionAvailable(this)) {

            txtStatus.setText(
                    "Speech Recognition is not available."
            );

            btnMic.setEnabled(false);
            return;
        }

        if (speechRecognizer != null) {
            speechRecognizer.destroy();
        }

        speechRecognizer =
                SpeechRecognizer.createSpeechRecognizer(this);

        speechRecognizer.setRecognitionListener(
                new RecognitionListener() {

                    @Override
                    public void onReadyForSpeech(Bundle params) {

                        isListening = true;

                        txtStatus.setText(
                                R.string.status_listening
                        );

                        txtStatus.setTextColor(
                                ContextCompat.getColor(
                                        MainActivity.this,
                                        R.color.hiram_cyan
                                )
                        );
                    }

                    @Override
                    public void onBeginningOfSpeech() {
                        txtStatus.setText("Voice detected...");
                    }

                    @Override
                    public void onRmsChanged(float rmsdB) {}

                    @Override
                    public void onBufferReceived(byte[] buffer) {}

                    @Override
                    public void onEndOfSpeech() {
                        txtStatus.setText(
                                R.string.status_processing
                        );
                    }

                    @Override
                    public void onError(int error) {

                        isListening = false;
                        btnMic.setText("Tap to Speak");

                        txtStatus.setText(
                                getSpeechErrorMessage(error)
                        );
                    }

                    @Override
                    public void onResults(Bundle results) {

                        isListening = false;
                        btnMic.setText("Tap to Speak");

                        ArrayList<String> matches =
                                results.getStringArrayList(
                                        SpeechRecognizer.RESULTS_RECOGNITION
                                );

                        if (matches != null &&
                                !matches.isEmpty()) {

                            String recognizedText = matches.get(0);

                            txtResult.setText(recognizedText);

                            processCommand(recognizedText);

                        } else {
                            txtStatus.setText(
                                    R.string.status_ready
                            );
                        }
                    }

                    @Override
                    public void onPartialResults(Bundle partialResults) {

                        ArrayList<String> partials =
                                partialResults.getStringArrayList(
                                        SpeechRecognizer.RESULTS_RECOGNITION
                                );

                        if (partials != null &&
                                !partials.isEmpty()) {
                            txtResult.setText(partials.get(0));
                        }
                    }

                    @Override
                    public void onEvent(int eventType, Bundle params) {}
                }
        );
    }

    private void setupLanguageSpinner() {

        String[] languages = {
                "Hindi (हिन्दी)",
                "English (India)",
                "English (US)",
                "Marathi (मराठी)",
                "Gujarati (ગુજરાતી)",
                "Tamil (தமிழ்)",
                "Telugu (తెలుగు)"
        };

        String[] langCodes = {
                "hi-IN",
                "en-IN",
                "en-US",
                "mr-IN",
                "gu-IN",
                "ta-IN",
                "te-IN"
        };

        ArrayAdapter<String> adapter =
                new ArrayAdapter<>(
                        this,
                        android.R.layout.simple_spinner_dropdown_item,
                        languages
                );

        spinnerLanguage.setAdapter(adapter);

        spinnerLanguage.setOnItemSelectedListener(
                new AdapterView.OnItemSelectedListener() {

                    @Override
                    public void onItemSelected(
                            AdapterView<?> parent,
                            View view,
                            int position,
                            long id) {

                        selectedLanguageCode = langCodes[position];

                        Locale locale =
                                Locale.forLanguageTag(
                                        selectedLanguageCode
                                );

                        if (ttsManager != null) {
                            ttsManager.setLanguage(locale);
                        }
                    }

                    @Override
                    public void onNothingSelected(
                            AdapterView<?> parent) {}
                }
        );
    }

    private void setupSuggestionChips() {

        findViewById(R.id.chipYoutube).setOnClickListener(
                v -> simulateCommand("YouTube kholo")
        );

        findViewById(R.id.chipWhatsapp).setOnClickListener(
                v -> simulateCommand("WhatsApp kholo")
        );

        findViewById(R.id.chipMusic).setOnClickListener(
                v -> simulateCommand("Music chalao")
        );

        findViewById(R.id.chipBattery).setOnClickListener(
                v -> simulateCommand("Battery kitni hai?")
        );

        findViewById(R.id.chipTorch).setOnClickListener(
                v -> simulateCommand("Flashlight on karo")
        );

        findViewById(R.id.chipHome).setOnClickListener(
                v -> simulateCommand("Home screen par jao")
        );

        findViewById(R.id.chipVolume).setOnClickListener(
                v -> simulateCommand("Volume badhao")
        );
    }

    
    private void setupServiceButtons() {

        updateBackgroundToggleUI();

        btnToggleService.setOnClickListener(v -> {

            if (VoiceAgentService.isRunning()) {

                Intent stopIntent =
                        new Intent(this, VoiceAgentService.class);

                stopIntent.setAction(
                        VoiceAgentService.ACTION_STOP
                );

                startService(stopIntent);

                txtStatus.setText("Background listening OFF");

            } else {

                if (!hasMicrophonePermission()) {
                    requestPermissionsForAssistant();
                    return;
                }

                Intent startIntent =
                        new Intent(this, VoiceAgentService.class);

                startIntent.setAction(
                        VoiceAgentService.ACTION_START
                );

                try {

                    if (Build.VERSION.SDK_INT >=
                            Build.VERSION_CODES.O) {

                        ContextCompat.startForegroundService(
                                this,
                                startIntent
                        );

                    } else {
                        startService(startIntent);
                    }

                    txtStatus.setText(
                            "Starting background assistant..."
                    );

                } catch (Exception e) {
                    txtStatus.setText(
                            "Service error: " + e.getMessage()
                    );
                }
            }

            mainHandler.postDelayed(
                    this::updateBackgroundToggleUI,
                    1000
            );
        });
    }

    private void updateBackgroundToggleUI() {

        if (btnToggleService == null) return;

        boolean running = VoiceAgentService.isRunning();

        btnToggleService.setText(
                running
                        ? "Background ON • Tap to turn OFF"
                        : "Background OFF • Tap to turn ON"
        );

        btnToggleService.setBackgroundTintList(
                ContextCompat.getColorStateList(
                        this,
                        running
                                ? R.color.hiram_green
                                : R.color.hiram_blue_accent
                )
        );
    }

    private boolean hasMicrophonePermission() {

        return ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED;
    }

    private void checkPermissionsAndListen() {

        if (hasMicrophonePermission()) {
            startListening();
        } else {
            requestPermissionsForAssistant();
        }
    }

    private void requestPermissionsForAssistant() {

        List<String> permissions = new ArrayList<>();

        permissions.add(Manifest.permission.RECORD_AUDIO);

        if (Build.VERSION.SDK_INT >= 33) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS);
        }

        permissionLauncher.launch(
                permissions.toArray(new String[0])
        );
    }

    private void startListening() {

        if (!hasMicrophonePermission()) {
            requestPermissionsForAssistant();
            return;
        }

        if (speechRecognizer == null) {
            initSpeechRecognizer();
        }

        if (speechRecognizer == null) return;

        try {

            Intent intent =
                    new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);

            intent.putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
            );

            intent.putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE,
                    selectedLanguageCode
            );

            intent.putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE,
                    selectedLanguageCode
            );

            intent.putExtra(
                    RecognizerIntent.EXTRA_PARTIAL_RESULTS,
                    true
            );

            intent.putExtra(
                    RecognizerIntent.EXTRA_MAX_RESULTS,
                    3
            );

            speechRecognizer.startListening(intent);

        } catch (Exception e) {

            isListening = false;
            btnMic.setText("Tap to Speak");

            txtStatus.setText(
                    "Listening error: " + e.getMessage()
            );
        }
    }

    private void stopListening() {

        if (speechRecognizer != null) {
            try {
                speechRecognizer.cancel();
            } catch (Exception ignored) {}
        }

        isListening = false;

        btnMic.setText("Tap to Speak");

        txtStatus.setText(R.string.status_ready);
    }

    private void processCommand(String spokenText) {

        if (spokenText == null || spokenText.trim().isEmpty()) {
            return;
        }

        VoiceCommandProcessor.CommandResult result =
                commandProcessor.executeCommand(spokenText);

        if (result.requiresConfirmation) {

            new AlertDialog.Builder(this)

                    .setTitle(R.string.auth_confirm_title)

                    .setMessage(result.feedbackMessage)

                    .setPositiveButton(
                            R.string.auth_proceed,
                            (dialog, which) -> {

                                authManager.authenticateForSensitiveAction(
                                        "Sensitive Action",
                                        result.feedbackMessage,

                                        new VoiceAuthManager.AuthCallback() {

                                            @Override
                                            public void onAuthenticated() {
                                                executeSensitiveAction(result);
                                            }

                                            @Override
                                            public void onAuthenticationFailed(
                                                    String reason) {

                                                Toast.makeText(
                                                        MainActivity.this,
                                                        "Authentication failed: " + reason,
                                                        Toast.LENGTH_SHORT
                                                ).show();
                                            }

                                            @Override
                                            public void onCancelled() {}
                                        }
                                );
                            }
                    )

                    .setNegativeButton(
                            R.string.auth_cancel,
                            null
                    )

                    .show();

        } else {

            finalizeCommandExecution(spokenText, result);
        }
    }

    private void executeSensitiveAction(
            VoiceCommandProcessor.CommandResult result) {

        if (result.action ==
                VoiceCommandProcessor.CommandAction.CALL_CONTACT) {

            try {

                ContactHelper helper =
                        new ContactHelper(this);

                Intent callIntent =
                        helper.createCallIntent(result.argument);

                if (callIntent != null) {

                    startActivity(callIntent);

                    VoiceCommandProcessor.CommandResult completed =
                            new VoiceCommandProcessor.CommandResult(
                                    result.action,
                                    result.argument,
                                    true,
                                    "Call screen opened.",
                                    false
                            );

                    finalizeCommandExecution(
                            "Call " + result.argument,
                            completed
                    );

                } else {

                    Toast.makeText(
                            this,
                            "Unable to open call screen",
                            Toast.LENGTH_SHORT
                    ).show();
                }

            } catch (Exception e) {

                Toast.makeText(
                        this,
                        "Call error: " + e.getMessage(),
                        Toast.LENGTH_LONG
                ).show();
            }
        }
    }

    private void finalizeCommandExecution(
            String commandText,
            VoiceCommandProcessor.CommandResult result) {

        txtFeedback.setText(result.feedbackMessage);

        txtStatus.setText(
                result.success
                        ? "Command executed"
                        : "Command failed"
        );

        txtStatus.setTextColor(
                ContextCompat.getColor(
                        this,
                        result.success
                                ? R.color.hiram_green
                                : R.color.hiram_amber
                )
        );

        if (ttsManager != null) {
            ttsManager.speak(result.feedbackMessage);
        }

        String timeStr =
                new SimpleDateFormat(
                        "h:mm a",
                        Locale.getDefault()
                ).format(new Date());

        historyList.add(
                0,
                new CommandHistoryItem(
                        commandText,
                        result.feedbackMessage,
                        timeStr,
                        result.success
                )
        );

        historyAdapter.notifyItemInserted(0);

        recyclerHistory.scrollToPosition(0);
    }

    private void simulateCommand(String command) {

        txtResult.setText(command);

        processCommand(command);
    }

    private String getSpeechErrorMessage(int error) {

        switch (error) {

            case SpeechRecognizer.ERROR_AUDIO:
                return "Audio recording error.";

            case SpeechRecognizer.ERROR_CLIENT:
                return "Speech client error.";

            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "Microphone permission required.";

            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "Network error. Check connection.";

            case SpeechRecognizer.ERROR_NO_MATCH:
                return "No command matched. Speak again.";

            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "Recognizer is busy. Wait.";

            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "No speech heard. Try again.";

            default:
                return "Error processing voice command.";
        }
    }

    private void updatePermissionsUI() {

        if (txtStatus == null) return;

        if (!hasMicrophonePermission() && !isListening) {
            txtStatus.setText(
                    "Microphone permission required"
            );
        }
    }

    private void updateAccessibilityUI() {

        if (txtAccessibilityBadge == null) return;

        boolean active =
                MyAccessibilityService.isRunning();

        txtAccessibilityBadge.setText(
                active
                        ? R.string.accessibility_status_active
                        : R.string.accessibility_status_inactive
        );

        txtAccessibilityBadge.setTextColor(
                ContextCompat.getColor(
                        this,
                        active
                                ? R.color.hiram_green
                                : R.color.hiram_amber
                )
        );
    }

    private void registerWakeWordReceiver() {

        if (receiverRegistered) return;

        IntentFilter filter =
                new IntentFilter(
                        VoiceAgentService.BROADCAST_WAKE_WORD
                );

        try {

            if (Build.VERSION.SDK_INT >=
                    Build.VERSION_CODES.TIRAMISU) {

                registerReceiver(
                        wakeWordReceiver,
                        filter,
                        Context.RECEIVER_NOT_EXPORTED
                );

            } else {

                registerReceiver(
                        wakeWordReceiver,
                        filter
                );
            }

            receiverRegistered = true;

        } catch (Exception e) {

            android.util.Log.e(
                    "MainActivity",
                    "Receiver registration failed",
                    e
            );
        }
    }

    private void unregisterWakeWordReceiver() {

        if (!receiverRegistered) return;

        try {

            unregisterReceiver(wakeWordReceiver);

            receiverRegistered = false;

        } catch (Exception e) {

            android.util.Log.e(
                    "MainActivity",
                    "Receiver unregister failed",
                    e
            );
        }
    }

    @Override
    protected void onResume() {

        super.onResume();

        registerWakeWordReceiver();

        updateAccessibilityUI();

        updatePermissionsUI();

        updateBackgroundToggleUI();
    }

    @Override
    protected void onPause() {

        unregisterWakeWordReceiver();

        super.onPause();
    }

    @Override
    protected void onDestroy() {

        mainHandler.removeCallbacksAndMessages(null);

        unregisterWakeWordReceiver();

        if (speechRecognizer != null) {

            try {
                speechRecognizer.cancel();
                speechRecognizer.destroy();
            } catch (Exception e) {
                android.util.Log.e(
                        "MainActivity",
                        "Speech cleanup error",
                        e
                );
            }

            speechRecognizer = null;
        }

        if (ttsManager != null) {
            ttsManager.shutdown();
            ttsManager = null;
        }

        super.onDestroy();
    }
}

   
