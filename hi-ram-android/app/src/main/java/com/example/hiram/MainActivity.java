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
import android.view.animation.AlphaAnimation;
import android.view.animation.Animation;
import android.view.animation.ScaleAnimation;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.ImageButton;
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
    private ImageButton btnMic;
    private View viewMicRing;

    private Button btnStartService;
    private Button btnPauseService;
    private Button btnStopService;
    private Button btnOpenAccessibility;
    private TextView txtAccessibilityBadge;

    private TextView iconPermAudio;
    private TextView iconPermContacts;
    private TextView iconPermCamera;
    private Button btnGrantAudio;
    private Button btnGrantContacts;
    private Button btnGrantCamera;

    private Spinner spinnerLanguage;
    private RecyclerView recyclerHistory;
    private CommandHistoryAdapter historyAdapter;
    private final List<CommandHistoryItem> historyList = new ArrayList<>();

    private SpeechRecognizer speechRecognizer;
    private TtsManager ttsManager;
    private VoiceCommandProcessor commandProcessor;
    private VoiceAuthManager authManager;
    private AppLauncher appLauncher;

    private String selectedLanguageCode = "hi-IN";
    private boolean isListening = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private final ActivityResultLauncher<String[]> multiplePermissionsLauncher =
            registerForActivityResult(
                    new ActivityResultContracts.RequestMultiplePermissions(),
                    resultMap -> updatePermissionsUI());

    private final BroadcastReceiver wakeWordReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (VoiceAgentService.BROADCAST_WAKE_WORD.equals(intent.getAction())) {
                ttsManager.speak("Haan ji, boliye!");
                mainHandler.postDelayed(() -> startListening(), 800);
            }
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

        if (getIntent() != null && getIntent().getBooleanExtra("TRIGGER_VOICE_COMMAND", false)) {
            mainHandler.postDelayed(this::startListening, 600);
        }
    }

    private void initViews() {
        txtStatus = findViewById(R.id.txtStatus);
        txtResult = findViewById(R.id.txtResult);
        txtFeedback = findViewById(R.id.txtFeedback);
        btnMic = findViewById(R.id.btnMic);
        viewMicRing = findViewById(R.id.viewMicRing);

        btnStartService = findViewById(R.id.btnStartService);
        btnPauseService = findViewById(R.id.btnPauseService);
        btnStopService = findViewById(R.id.btnStopService);
        btnOpenAccessibility = findViewById(R.id.btnOpenAccessibility);
        txtAccessibilityBadge = findViewById(R.id.txtAccessibilityBadge);

        iconPermAudio = findViewById(R.id.iconPermAudio);
        iconPermContacts = findViewById(R.id.iconPermContacts);
        iconPermCamera = findViewById(R.id.iconPermCamera);
        btnGrantAudio = findViewById(R.id.btnGrantAudio);
        btnGrantContacts = findViewById(R.id.btnGrantContacts);
        btnGrantCamera = findViewById(R.id.btnGrantCamera);

        spinnerLanguage = findViewById(R.id.spinnerLanguage);
        recyclerHistory = findViewById(R.id.recyclerHistory);

        recyclerHistory.setLayoutManager(new LinearLayoutManager(this));
        historyAdapter = new CommandHistoryAdapter(historyList);
        recyclerHistory.setAdapter(historyAdapter);

        btnMic.setOnClickListener(v -> {
            if (isListening) {
                stopListening();
            } else {
                checkPermissionsAndListen();
            }
        });

        btnOpenAccessibility.setOnClickListener(v -> appLauncher.openAccessibilitySettings());

        btnGrantAudio.setOnClickListener(v -> requestMicrophonePermission());
        btnGrantContacts.setOnClickListener(v -> requestContactsPermission());
        btnGrantCamera.setOnClickListener(v -> requestCameraPermission());
    }

    private void initComponents() {
        commandProcessor = new VoiceCommandProcessor(this);
        appLauncher = new AppLauncher(this);
        authManager = new VoiceAuthManager(this);
        ttsManager = new TtsManager(this);

        initSpeechRecognizer();
    }

    private void initSpeechRecognizer() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            txtStatus.setText("Speech Recognition is not available on this device.");
            btnMic.setEnabled(false);
            return;
        }

        if (speechRecognizer != null) {
            speechRecognizer.destroy();
        }

        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
        speechRecognizer.setRecognitionListener(new RecognitionListener() {
            @Override
            public void onReadyForSpeech(Bundle params) {
                isListening = true;
                txtStatus.setText(R.string.status_listening);
                txtStatus.setTextColor(ContextCompat.getColor(MainActivity.this, R.color.hiram_cyan));
                startMicAnimation();
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
                txtStatus.setText(R.string.status_processing);
                txtStatus.setTextColor(ContextCompat.getColor(MainActivity.this, R.color.hiram_amber));
                stopMicAnimation();
            }

            @Override
            public void onError(int error) {
                isListening = false;
                stopMicAnimation();
                String errorMsg = getSpeechErrorMessage(error);
                txtStatus.setText(errorMsg);
                txtStatus.setTextColor(ContextCompat.getColor(MainActivity.this, R.color.hiram_red));
            }

            @Override
            public void onResults(Bundle results) {
                isListening = false;
                stopMicAnimation();

                ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (matches != null && !matches.isEmpty()) {
                    String recognizedText = matches.get(0);
                    txtResult.setText(recognizedText);
                    processCommand(recognizedText);
                } else {
                    txtStatus.setText(R.string.status_ready);
                }
            }

            @Override
            public void onPartialResults(Bundle partialResults) {
                ArrayList<String> partials = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (partials != null && !partials.isEmpty()) {
                    txtResult.setText(partials.get(0));
                }
            }

            @Override
            public void onEvent(int eventType, Bundle params) {}
        });
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

        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, languages);
        spinnerLanguage.setAdapter(adapter);

        spinnerLanguage.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                selectedLanguageCode = langCodes[position];
                Locale locale = new Locale(selectedLanguageCode.split("-")[0]);
                ttsManager.setLanguage(locale);
                Toast.makeText(MainActivity.this, "Language: " + languages[position], Toast.LENGTH_SHORT).show();
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {}
        });
    }

    private void setupSuggestionChips() {
        findViewById(R.id.chipYoutube).setOnClickListener(v -> simulateCommand("YouTube kholo"));
        findViewById(R.id.chipWhatsapp).setOnClickListener(v -> simulateCommand("WhatsApp kholo"));
        findViewById(R.id.chipMusic).setOnClickListener(v -> simulateCommand("Music chalao"));
        findViewById(R.id.chipBattery).setOnClickListener(v -> simulateCommand("Battery kitni hai?"));
        findViewById(R.id.chipTorch).setOnClickListener(v -> simulateCommand("Flashlight on karo"));
        findViewById(R.id.chipHome).setOnClickListener(v -> simulateCommand("Home screen par jao"));
        findViewById(R.id.chipVolume).setOnClickListener(v -> simulateCommand("Volume badhao"));
    }

    private void setupServiceButtons() {
        btnStartService.setOnClickListener(v -> {
            Intent intent = new Intent(this, VoiceAgentService.class);
            intent.setAction(VoiceAgentService.ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent);
            } else {
                startService(intent);
            }
            Toast.makeText(this, "Hi Ram Background Service started", Toast.LENGTH_SHORT).show();
        });

        btnPauseService.setOnClickListener(v -> {
            Intent intent = new Intent(this, VoiceAgentService.class);
            intent.setAction(VoiceAgentService.ACTION_PAUSE);
            startService(intent);
            txtStatus.setText(R.string.status_paused);
        });

        btnStopService.setOnClickListener(v -> {
            Intent intent = new Intent(this, VoiceAgentService.class);
            intent.setAction(VoiceAgentService.ACTION_STOP);
            startService(intent);
            txtStatus.setText("Service stopped");
            Toast.makeText(this, "Hi Ram Service stopped", Toast.LENGTH_SHORT).show();
        });
    }

    private void checkPermissionsAndListen() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED) {
            startListening();
        } else {
            requestMicrophonePermission();
        }
    }

    private void startListening() {
        if (speechRecognizer == null) {
            initSpeechRecognizer();
        }

        try {
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, selectedLanguageCode);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, selectedLanguageCode);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);

            speechRecognizer.startListening(intent);
        } catch (Exception e) {
            txtStatus.setText("Error starting listener: " + e.getMessage());
            isListening = false;
            stopMicAnimation();
        }
    }

    private void stopListening() {
        if (speechRecognizer != null) {
            speechRecognizer.stopListening();
        }
        isListening = false;
        stopMicAnimation();
        txtStatus.setText(R.string.status_ready);
    }

    private void processCommand(String spokenText) {
        VoiceCommandProcessor.CommandResult result = commandProcessor.executeCommand(spokenText);

        if (result.requiresConfirmation) {
            // Confirm sensitive action via dialog or device auth
            new AlertDialog.Builder(this)
                    .setTitle(R.string.auth_confirm_title)
                    .setMessage(result.feedbackMessage)
                    .setPositiveButton(R.string.auth_proceed, (dialog, which) -> {
                        authManager.authenticateForSensitiveAction("Sensitive Action", result.feedbackMessage,
                                new VoiceAuthManager.AuthCallback() {
                                    @Override
                                    public void onAuthenticated() {
                                        executeSensitiveAction(result);
                                    }

                                    @Override
                                    public void onAuthenticationFailed(String reason) {
                                        Toast.makeText(MainActivity.this, "Authentication failed: " + reason, Toast.LENGTH_SHORT).show();
                                    }

                                    @Override
                                    public void onCancelled() {}
                                });
                    })
                    .setNegativeButton(R.string.auth_cancel, null)
                    .show();
        } else {
            finalizeCommandExecution(spokenText, result);
        }
    }

    private void executeSensitiveAction(VoiceCommandProcessor.CommandResult result) {
        if (result.action == VoiceCommandProcessor.CommandAction.CALL_CONTACT) {
            ContactHelper helper = new ContactHelper(this);
            Intent callIntent = helper.createCallIntent(result.argument);
            startActivity(callIntent);
            finalizeCommandExecution("Call " + result.argument,
                    new VoiceCommandProcessor.CommandResult(result.action, result.argument, true,
                            result.argument + " ko call lagaya ja raha hai.", false));
        }
    }

    private void finalizeCommandExecution(String commandText, VoiceCommandProcessor.CommandResult result) {
        txtFeedback.setText(result.feedbackMessage);
        txtStatus.setText(result.success ? "Command executed" : "Command failed");
        txtStatus.setTextColor(ContextCompat.getColor(this, result.success ? R.color.hiram_green : R.color.hiram_amber));

        ttsManager.speak(result.feedbackMessage);

        String timeStr = new SimpleDateFormat("h:mm a", Locale.getDefault()).format(new Date());
        historyList.add(0, new CommandHistoryItem(commandText, result.feedbackMessage, timeStr, result.success));
        historyAdapter.notifyItemInserted(0);
        recyclerHistory.scrollToPosition(0);
    }

    private void simulateCommand(String command) {
        txtResult.setText(command);
        processCommand(command);
    }

    private void startMicAnimation() {
        ScaleAnimation scale = new ScaleAnimation(1.0f, 1.25f, 1.0f, 1.25f,
                Animation.RELATIVE_TO_SELF, 0.5f, Animation.RELATIVE_TO_SELF, 0.5f);
        scale.setDuration(700);
        scale.setRepeatCount(Animation.INFINITE);
        scale.setRepeatMode(Animation.REVERSE);

        AlphaAnimation alpha = new AlphaAnimation(0.3f, 0.9f);
        alpha.setDuration(700);
        alpha.setRepeatCount(Animation.INFINITE);
        alpha.setRepeatMode(Animation.REVERSE);

        viewMicRing.startAnimation(scale);
    }

    private void stopMicAnimation() {
        viewMicRing.clearAnimation();
    }

    private String getSpeechErrorMessage(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO: return "Audio recording error.";
            case SpeechRecognizer.ERROR_CLIENT: return "Client side error.";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "Microphone permission required.";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "Network error. Check connection.";
            case SpeechRecognizer.ERROR_NO_MATCH: return "No command matched. Please speak again.";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "Recognizer is busy. Wait a moment.";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "No speech heard. Tap mic to retry.";
            default: return "Error processing voice command.";
        }
    }

    private void updatePermissionsUI() {
        boolean hasAudio = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        boolean hasContacts = ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED;
        boolean hasCamera = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;

        iconPermAudio.setText(hasAudio ? "✓" : "✕");
        iconPermAudio.setTextColor(ContextCompat.getColor(this, hasAudio ? R.color.hiram_green : R.color.hiram_red));
        btnGrantAudio.setVisibility(hasAudio ? View.GONE : View.VISIBLE);

        iconPermContacts.setText(hasContacts ? "✓" : "✕");
        iconPermContacts.setTextColor(ContextCompat.getColor(this, hasContacts ? R.color.hiram_green : R.color.hiram_red));
        btnGrantContacts.setVisibility(hasContacts ? View.GONE : View.VISIBLE);

        iconPermCamera.setText(hasCamera ? "✓" : "✕");
        iconPermCamera.setTextColor(ContextCompat.getColor(this, hasCamera ? R.color.hiram_green : R.color.hiram_red));
        btnGrantCamera.setVisibility(hasCamera ? View.GONE : View.VISIBLE);
    }

    private void updateAccessibilityUI() {
        boolean active = MyAccessibilityService.isRunning();
        txtAccessibilityBadge.setText(active ? R.string.accessibility_status_active : R.string.accessibility_status_inactive);
        txtAccessibilityBadge.setTextColor(ContextCompat.getColor(this, active ? R.color.hiram_green : R.color.hiram_amber));
    }

    private void requestMicrophonePermission() {
        multiplePermissionsLauncher.launch(new String[]{
                Manifest.permission.RECORD_AUDIO,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? Manifest.permission.POST_NOTIFICATIONS : Manifest.permission.RECORD_AUDIO
        });
    }

    private void requestContactsPermission() {
        multiplePermissionsLauncher.launch(new String[]{ Manifest.permission.READ_CONTACTS, Manifest.permission.CALL_PHONE });
    }

    private void requestCameraPermission() {
        multiplePermissionsLauncher.launch(new String[]{ Manifest.permission.CAMERA });
    }

    @Override
    protected void onResume() {
        super.onResume();
        updatePermissionsUI();
        updateAccessibilityUI();

        IntentFilter filter = new IntentFilter(VoiceAgentService.BROADCAST_WAKE_WORD);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(wakeWordReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(wakeWordReceiver, filter);
        }
    }

    @Override
    protected void onPause() {
        try {
            unregisterReceiver(wakeWordReceiver);
        } catch (Exception ignored) {}
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (speechRecognizer != null) {
            speechRecognizer.destroy();
            speechRecognizer = null;
        }
        if (ttsManager != null) {
            ttsManager.shutdown();
        }
        super.onDestroy();
    }
}
