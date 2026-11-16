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
import android.util.Log;
import android.net.Uri;
import android.provider.Settings;
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
    private TextView txtPermissionStatus;
    private Button btnMic;

    private Button btnToggleService;
    private Button btnOpenAccessibility;
    private TextView txtAccessibilityBadge;

    private Spinner spinnerLanguage;
    private RecyclerView recyclerHistory;
    private CommandHistoryAdapter historyAdapter;
    private final List<CommandHistoryItem> historyList = new ArrayList<>();

    private SpeechRecognizer speechRecognizer;
    private TtsManager ttsManager;
    private VoiceCommandProcessor commandProcessor;
    private VoiceAuthManager authManager;
    private AppLauncher appLauncher;
    private AiClient aiClient;
    private final AiCommandEngine aiCommandEngine = new AiCommandEngine();
    private String aiSessionId = "";
    private static final String AI_BACKEND_URL = "https://hi-ram-backend.onrender.com";

    private String selectedLanguageCode = "hi-IN";
    private boolean isListening = false;
    private boolean conversationMode = false;
    private int conversationRetryCount = 0;
    private boolean pendingStartAfterOverlay = false;
    private boolean pendingStartAfterMicPermission = false;
    private boolean pendingStartAfterListen = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private final ActivityResultLauncher<String[]> multiplePermissionsLauncher =
            registerForActivityResult(
                    new ActivityResultContracts.RequestMultiplePermissions(),
                    resultMap -> {
                        updatePermissionsUI();

                        boolean micGranted = Boolean.TRUE.equals(
                                resultMap.get(Manifest.permission.RECORD_AUDIO));

                        if (pendingStartAfterListen) {
                            pendingStartAfterListen = false;

                            if (micGranted) {
                                startListening();
                            } else {
                                conversationMode = false;
                                isListening = false;
                                txtStatus.setText("Microphone permission required.");
                                Toast.makeText(this, "Microphone permission denied",
                                        Toast.LENGTH_LONG).show();
                            }
                        }

                        if (pendingStartAfterMicPermission) {
                            pendingStartAfterMicPermission = false;

                            if (micGranted) {
                                if (!hasOverlayPermission()) {
                                    pendingStartAfterOverlay = true;
                                    requestOverlayPermission();
                                } else {
                                    startVoiceService();
                                }
                            } else {
                                Toast.makeText(this, "Microphone permission denied",
                                        Toast.LENGTH_LONG).show();
                            }
                        }
                    });

    private String pendingContactCallName = "";

    private final ActivityResultLauncher<String> contactsPermissionLauncher =
            registerForActivityResult(
                    new ActivityResultContracts.RequestPermission(),
                    granted -> {
                        updatePermissionsUI();

                        String contactName = pendingContactCallName;
                        pendingContactCallName = "";

                        if (granted && !contactName.isEmpty()) {
                            showContactSelection(contactName);
                        } else if (!granted) {
                            finalizeCommandExecution("Contact " + contactName,
                                    new VoiceCommandProcessor.CommandResult(
                                            VoiceCommandProcessor.CommandAction.FIND_CONTACT,
                                            contactName, false,
                                            "Contacts permission nahi mili. Contact search nahi kar sakta.",
                                            false));
                        }
                    });

    private final BroadcastReceiver wakeWordReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (VoiceAgentService.BROADCAST_WAKE_WORD.equals(intent.getAction())) {
                conversationMode = true;
                ttsManager.speak("Haan ji, boliye!", MainActivity.this::startListening);
            }
        }
    };

    private boolean hasOverlayPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this);
    }
    private void requestOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        }
    }

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

        handleVoiceTriggerIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleVoiceTriggerIntent(intent);
    }

    private void handleVoiceTriggerIntent(Intent intent) {
        if (intent == null) return;

        if (intent.getBooleanExtra("ENABLE_ASSISTANT", false)) {
            intent.removeExtra("ENABLE_ASSISTANT");

            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED) {
                pendingStartAfterMicPermission = true;
                requestMicrophonePermission();
                return;
            }

            if (!hasOverlayPermission()) {
                pendingStartAfterOverlay = true;
                requestOverlayPermission();
                return;
            }

            startVoiceService();
        }

        if (!intent.getBooleanExtra("TRIGGER_VOICE_COMMAND", false)) {
            return;
        }

        intent.removeExtra("TRIGGER_VOICE_COMMAND");
        conversationMode = true;
        conversationRetryCount = 0;

        mainHandler.postDelayed(() -> {
            if (!isFinishing() && !isDestroyed()) {
                ttsManager.speak("Haan ji, boliye!", this::startListening);
            }
        }, 600);
    }

    private void initViews() {
        txtStatus = findViewById(R.id.txtStatus);
        txtResult = findViewById(R.id.txtResult);
        txtFeedback = findViewById(R.id.txtFeedback);
        txtPermissionStatus = findViewById(R.id.txtPermissionStatus);
        btnMic = findViewById(R.id.btnMic);

        btnToggleService = findViewById(R.id.btnToggleService);
        btnOpenAccessibility = findViewById(R.id.btnOpenAccessibility);
        txtAccessibilityBadge = findViewById(R.id.txtAccessibilityBadge);

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

        btnOpenAccessibility.setOnClickListener(v -> showAccessibilityDisclosure());
    }

    private void showAccessibilityDisclosure() {
        android.content.SharedPreferences preferences =
                getSharedPreferences("hi_ram_accessibility", MODE_PRIVATE);

        if (preferences.getBoolean("user_consented", false)) {
            appLauncher.openAccessibilitySettings();
            return;
        }

        new AlertDialog.Builder(this)
                .setTitle(R.string.accessibility_consent_title)
                .setMessage(R.string.accessibility_consent_message)
                .setCancelable(false)
                .setPositiveButton(R.string.accessibility_consent_agree,
                        (dialog, which) -> {
                            preferences.edit()
                                    .putBoolean("user_consented", true)
                                    .apply();
                            appLauncher.openAccessibilitySettings();
                        })
                .setNegativeButton(R.string.accessibility_consent_decline,
                        (dialog, which) -> Toast.makeText(
                                MainActivity.this,
                                R.string.accessibility_consent_declined,
                                Toast.LENGTH_LONG).show())
                .show();
    }

    private void initComponents() {
        commandProcessor = new VoiceCommandProcessor(this);
        appLauncher = new AppLauncher(this);
        authManager = new VoiceAuthManager(this);
        ttsManager = new TtsManager(this);

        if (AI_BACKEND_URL.startsWith("https://")) {
            aiClient = new AiClient(AI_BACKEND_URL);
        }

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
            }

            @Override
            public void onError(int error) {
                isListening = false;
                String errorMsg = getSpeechErrorMessage(error);
                txtStatus.setText(errorMsg);
                txtStatus.setTextColor(ContextCompat.getColor(MainActivity.this, R.color.hiram_red));

                if (conversationMode) {
                    if (error == SpeechRecognizer.ERROR_NO_MATCH
                            || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                        conversationRetryCount++;

                        if (conversationRetryCount <= 2) {
                            ttsManager.speak("Main sun nahi paya. Dobara boliye.",
                                    () -> mainHandler.postDelayed(
                                            MainActivity.this::startListening, 400));
                            return;
                        }
                    }

                    conversationMode = false;
                    ttsManager.speak(
                            "Theek hai, main abhi ruk raha hoon. Dobara bulane ke liye Hi Ram boliye.",
                            MainActivity.this::resumeWakeWordListening);
                }
            }

            @Override
            public void onResults(Bundle results) {
                isListening = false;
                ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (matches != null && !matches.isEmpty()) {
                    conversationRetryCount = 0;
                    String recognizedText = matches.get(0);
                    txtResult.setText(recognizedText);
                    processCommand(recognizedText);
                } else {
                    txtStatus.setText(R.string.status_ready);

                    if (conversationMode) {
                        conversationRetryCount++;

                        if (conversationRetryCount <= 2) {
                            ttsManager.speak("Main sun nahi paya. Dobara boliye.",
                                    () -> mainHandler.postDelayed(
                                            MainActivity.this::startListening, 400));
                        } else {
                            conversationMode = false;
                            ttsManager.speak(
                                    "Theek hai, main abhi ruk raha hoon. Dobara bulane ke liye Hi Ram boliye.",
                                    MainActivity.this::resumeWakeWordListening);
                        }
                    }
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
        updateBackgroundToggleUI();

        btnToggleService.setOnClickListener(v -> {
            if (VoiceAgentService.isRunning()) {
                Intent intent = new Intent(this, VoiceAgentService.class);
                intent.setAction(VoiceAgentService.ACTION_STOP);
                startService(intent);
                txtStatus.setText("Background listening OFF");
                mainHandler.postDelayed(this::updateBackgroundToggleUI, 700);
                return;
            }

            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED) {
                pendingStartAfterMicPermission = true;
                Toast.makeText(this, "Microphone permission required", Toast.LENGTH_LONG).show();
                requestMicrophonePermission();
                return;
            }

            if (!hasOverlayPermission()) {
                pendingStartAfterOverlay = true;
                requestOverlayPermission();
                return;
            }

            startVoiceService();
        });
    }

    private void startVoiceService() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            txtStatus.setText("Microphone permission required.");
            Toast.makeText(this, "Microphone permission required",
                    Toast.LENGTH_LONG).show();
            updateBackgroundToggleUI();
            return;
        }

        Intent intent = new Intent(this, VoiceAgentService.class);
        intent.setAction(VoiceAgentService.ACTION_START);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent);
            } else {
                startService(intent);
            }

            txtStatus.setText("Starting background listening...");
            mainHandler.postDelayed(this::updateBackgroundToggleUI, 1000);

        } catch (RuntimeException e) {
            Log.e("MainActivity", "Could not start voice foreground service", e);
            txtStatus.setText("Background service could not start.");
            Toast.makeText(this,
                    "Background service start nahi hui. Permissions aur battery settings check karein.",
                    Toast.LENGTH_LONG).show();
            updateBackgroundToggleUI();
        }
    }

    private void updateBackgroundToggleUI() {
        boolean running = VoiceAgentService.isRunning();
        btnToggleService.setText(running
                ? "Background ON • Tap to turn OFF"
                : "Background OFF • Tap to turn ON");
        btnToggleService.setBackgroundTintList(
                ContextCompat.getColorStateList(this,
                        running ? R.color.hiram_green : R.color.hiram_blue_accent));
    }

    private void checkPermissionsAndListen() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED) {
            startListening();
        } else {
            pendingStartAfterListen = true;
            requestMicrophonePermission();
        }
    }

    private void startListening() {
        if (isFinishing() || isDestroyed()) return;

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            isListening = false;
            txtStatus.setText("Microphone permission required.");
            conversationMode = false;
            return;
        }

        if (isListening) return;

        if (speechRecognizer == null) {
            initSpeechRecognizer();
        }

        if (speechRecognizer == null) {
            isListening = false;
            txtStatus.setText("Speech Recognition is not available.");
            conversationMode = false;
            return;
        }

        try {
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, selectedLanguageCode);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, selectedLanguageCode);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);

            speechRecognizer.startListening(intent);
        } catch (Exception e) {
            isListening = false;
            txtStatus.setText("Error starting listener: " + e.getMessage());
            Log.e("MainActivity", "Speech recognition start failed", e);
        }
    }

    private void stopListening() {
        if (speechRecognizer != null) {
            speechRecognizer.stopListening();
        }
        isListening = false;
        txtStatus.setText(R.string.status_ready);
    }

    private void processCommand(String spokenText) {
        VoiceCommandProcessor.CommandResult result =
                commandProcessor.executeCommand(spokenText);

        if (result.action == VoiceCommandProcessor.CommandAction.UNKNOWN) {
            askGeminiCommand(spokenText);
            return;
        }

        if (result.action == VoiceCommandProcessor.CommandAction.SELECT_CONTACT) {
            showContactSelection(result.argument);
            return;
        }

        if (result.requiresConfirmation) {
            confirmAndExecute(result);
        } else {
            finalizeCommandExecution(spokenText, result);
        }
    }


    private void showContactSelection(String contactName) {
        ContactHelper helper = new ContactHelper(this);

        if (!helper.hasContactsPermission()) {
            pendingContactCallName = contactName;
            contactsPermissionLauncher.launch(Manifest.permission.READ_CONTACTS);
            return;
        }

        List<ContactHelper.ContactInfo> matches = helper.findContacts(contactName);

        if (matches.isEmpty()) {
            finalizeCommandExecution("Call " + contactName,
                    new VoiceCommandProcessor.CommandResult(
                            VoiceCommandProcessor.CommandAction.FIND_CONTACT,
                            contactName, false,
                            "Contact nahi mila ya Contacts permission available nahi hai.",
                            false));
            return;
        }

        if (matches.size() == 1) {
            confirmContactCall(matches.get(0));
            return;
        }

        String[] labels = new String[matches.size()];
        for (int i = 0; i < matches.size(); i++) {
            ContactHelper.ContactInfo contact = matches.get(i);
            labels[i] = contact.name + "  •  " + contact.number;
        }

        new AlertDialog.Builder(this)
                .setTitle("Sahi contact select karein")
                .setItems(labels, (dialog, which) ->
                        confirmContactCall(matches.get(which)))
                .setNegativeButton(R.string.auth_cancel,
                        (dialog, which) -> continueConversation())
                .show();
    }

    private void confirmContactCall(ContactHelper.ContactInfo contact) {
        VoiceCommandProcessor.CommandResult result =
                new VoiceCommandProcessor.CommandResult(
                        VoiceCommandProcessor.CommandAction.CALL_CONTACT,
                        contact.number,
                        true,
                        contact.name + " (" + contact.number
                                + ") ko call karne ke liye confirmation chahiye.",
                        true);

        confirmAndExecute(result);
    }

    private void confirmAndExecute(VoiceCommandProcessor.CommandResult result) {
        new AlertDialog.Builder(this)
                .setTitle(R.string.auth_confirm_title)
                .setMessage(result.feedbackMessage)
                .setPositiveButton(R.string.auth_proceed, (dialog, which) -> {
                    authManager.authenticateForSensitiveAction(
                            "Sensitive Action",
                            result.feedbackMessage,
                            new VoiceAuthManager.AuthCallback() {
                                @Override
                                public void onAuthenticated() {
                                    executeSensitiveAction(result);
                                }

                                @Override
                                public void onAuthenticationFailed(String reason) {
                                    Toast.makeText(MainActivity.this,
                                            "Authentication failed: " + reason,
                                            Toast.LENGTH_SHORT).show();
                                    continueConversation();
                                }

                                @Override
                                public void onCancelled() {
                                    continueConversation();
                                }
                            });
                })
                .setNegativeButton(R.string.auth_cancel,
                        (dialog, which) -> continueConversation())
                .show();
    }

    private void askGeminiCommand(String spokenText) {
        if (aiClient == null) {
            askGemini(spokenText);
            return;
        }

        txtStatus.setText("Gemini command samajh raha hai...");
        txtFeedback.setText("Please wait...");

        aiClient.sendCommand(spokenText, new AiClient.CommandCallback() {
            @Override
            public void onSuccess(String actionJson) {
                AiCommandEngine.StructuredAction action =
                        aiCommandEngine.parseAndValidate(actionJson);

                mainHandler.post(() -> {
                    if (isFinishing() || isDestroyed()) return;

                    if (action == null || "UNKNOWN".equals(action.actionType)) {
                        askGemini(spokenText);
                        return;
                    }

                    if ((action.requiresConfirmation
                            || "TYPE_TEXT".equals(action.actionType)
                            || "SEARCH_APP".equals(action.actionType))
                            && !"CALL_CONTACT".equals(action.actionType)
                            && !"CLICK_ELEMENT".equals(action.actionType)) {
                        confirmStructuredAction(spokenText, action);
                    } else {
                        executeStructuredAction(spokenText, action);
                    }
                });
            }

            @Override
            public void onError(String error) {
                mainHandler.post(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    askGemini(spokenText);
                });
            }
        });
    }


    private void confirmStructuredAction(
            String spokenText,
            AiCommandEngine.StructuredAction action) {

        new AlertDialog.Builder(this)
                .setTitle(R.string.auth_confirm_title)
                .setMessage(action.explanation + "\n\nKya aap is action ko allow karte hain?")
                .setPositiveButton(R.string.auth_proceed, (dialog, which) -> {
                    authManager.authenticateForSensitiveAction(
                            "AI Command",
                            action.explanation,
                            new VoiceAuthManager.AuthCallback() {
                                @Override
                                public void onAuthenticated() {
                                    AiCommandEngine.StructuredAction approved =
                                            new AiCommandEngine.StructuredAction(
                                                    action.actionType,
                                                    action.target,
                                                    action.parameter,
                                                    false,
                                                    action.explanation);
                                    executeStructuredAction(spokenText, approved);
                                }

                                @Override
                                public void onAuthenticationFailed(String reason) {
                                    Toast.makeText(MainActivity.this,
                                            "Authentication failed: " + reason,
                                            Toast.LENGTH_SHORT).show();
                                    continueConversation();
                                }

                                @Override
                                public void onCancelled() {
                                    continueConversation();
                                }
                            });
                })
                .setNegativeButton(R.string.auth_cancel,
                        (dialog, which) -> continueConversation())
                .show();
    }

    private void executeStructuredAction(
            String spokenText,
            AiCommandEngine.StructuredAction action) {

        if (action == null || action.actionType == null) {
            askGemini(spokenText);
            return;
        }

        String type = action.actionType;
        String target = action.target == null ? "" : action.target.trim();
        String parameter = action.parameter == null ? "" : action.parameter.trim();

        MyAccessibilityService accessibility =
                MyAccessibilityService.getInstance();

        VoiceCommandProcessor.CommandResult result;

        switch (type) {
            case "OPEN_APP": {
                boolean ok = appLauncher.openAppByName(target);
                result = new VoiceCommandProcessor.CommandResult(
                        VoiceCommandProcessor.CommandAction.OPEN_APP,
                        target, ok,
                        ok ? target + " khol diya." : target + " app nahi khul paya.",
                        false);
                break;
            }

            case "SEARCH_APP": {
                boolean opened = appLauncher.openAppByName(target);
                if (!opened) {
                    result = new VoiceCommandProcessor.CommandResult(
                            VoiceCommandProcessor.CommandAction.OPEN_APP,
                            target, false, target + " app nahi khul paya.", false);
                    break;
                }

                txtStatus.setText("App search taiyar kar raha hai...");
                mainHandler.postDelayed(() -> {
                    MyAccessibilityService service =
                            MyAccessibilityService.getInstance();

                    boolean focused = service != null
                            && (service.focusEditableField("search")
                            || service.focusEditableField("खोज"));

                    boolean typed = focused && service.typeText(parameter);
                    boolean submitted = typed && service.submitSearch();

                    String feedback;
                    if (!typed) {
                        feedback = "App khul gaya, lekin search field nahi mili ya text enter nahi hua. Accessibility ON karein.";
                    } else if (submitted) {
                        feedback = target + " mein search text enter karke Search submit kar diya.";
                    } else {
                        feedback = target + " mein search text enter kar diya, lekin Search submit nahi hua. Search button manually tap karein.";
                    }

                    VoiceCommandProcessor.CommandResult searchResult =
                            new VoiceCommandProcessor.CommandResult(
                                    VoiceCommandProcessor.CommandAction.TYPE_TEXT,
                                    parameter, typed, feedback, false);

                    finalizeCommandExecution(spokenText, searchResult);
                }, 1200);
                return;
            }

            case "OPEN_YOUTUBE":
            case "SEARCH_YOUTUBE": {
                boolean ok = appLauncher.openYouTube(
                        "SEARCH_YOUTUBE".equals(type) ? parameter : "");
                result = new VoiceCommandProcessor.CommandResult(
                        "SEARCH_YOUTUBE".equals(type)
                                ? VoiceCommandProcessor.CommandAction.SEARCH_YOUTUBE
                                : VoiceCommandProcessor.CommandAction.OPEN_YOUTUBE,
                        parameter, ok,
                        ok ? ("SEARCH_YOUTUBE".equals(type)
                                ? "YouTube search khol diya: " + parameter
                                : "YouTube khol diya.")
                                : "YouTube nahi khul paya.",
                        false);
                break;
            }

            case "OPEN_WHATSAPP": {
                boolean ok = appLauncher.openWhatsApp();
                result = new VoiceCommandProcessor.CommandResult(
                        VoiceCommandProcessor.CommandAction.OPEN_WHATSAPP,
                        "", ok, ok ? "WhatsApp khol diya." : "WhatsApp nahi khul paya.",
                        false);
                break;
            }

            case "PLAY_MUSIC":
            case "OPEN_CAMERA":
            case "OPEN_SETTINGS":
            case "OPEN_WIFI_SETTINGS":
            case "OPEN_BLUETOOTH_SETTINGS": {
                boolean ok;
                String message;

                if ("PLAY_MUSIC".equals(type)) {
                    ok = appLauncher.playMusic();
                    message = "Music app khol diya.";
                } else if ("OPEN_CAMERA".equals(type)) {
                    ok = appLauncher.openCamera();
                    message = "Camera khol diya.";
                } else if ("OPEN_WIFI_SETTINGS".equals(type)) {
                    ok = appLauncher.openWifiSettings();
                    message = "Wi-Fi settings khol di.";
                } else if ("OPEN_BLUETOOTH_SETTINGS".equals(type)) {
                    ok = appLauncher.openBluetoothSettings();
                    message = "Bluetooth settings khol di.";
                } else {
                    ok = appLauncher.openSettings();
                    message = "Settings khol di.";
                }

                result = new VoiceCommandProcessor.CommandResult(
                        VoiceCommandProcessor.CommandAction.OPEN_SETTINGS,
                        "", ok, ok ? message : "Requested screen nahi khul saki.",
                        false);
                break;
            }

            case "HOME_SCREEN":
            case "BACK":
            case "RECENT_APPS":
            case "NOTIFICATIONS":
            case "SCROLL_UP":
            case "SCROLL_DOWN": {
                boolean ok = false;
                if (accessibility != null) {
                    switch (type) {
                        case "HOME_SCREEN": ok = accessibility.goHome(); break;
                        case "BACK": ok = accessibility.goBack(); break;
                        case "RECENT_APPS": ok = accessibility.showRecents(); break;
                        case "NOTIFICATIONS": ok = accessibility.openNotifications(); break;
                        case "SCROLL_UP": ok = accessibility.scrollScreen(false); break;
                        case "SCROLL_DOWN": ok = accessibility.scrollScreen(true); break;
                    }
                }

                String message = ok ? "Command execute ho gaya."
                        : "Accessibility service available nahi hai. Settings mein ise ON karein.";

                result = new VoiceCommandProcessor.CommandResult(
                        VoiceCommandProcessor.CommandAction.UNKNOWN,
                        "", ok, message, false);
                break;
            }

            case "CLICK_ELEMENT": {
                result = new VoiceCommandProcessor.CommandResult(
                        VoiceCommandProcessor.CommandAction.CLICK_SCREEN_ELEMENT,
                        target, true,
                        "Kya screen par '" + target + "' ko click karna hai?",
                        true);
                confirmAndExecute(result);
                return;
            }

            case "TYPE_TEXT": {
                result = new VoiceCommandProcessor.CommandResult(
                        VoiceCommandProcessor.CommandAction.TYPE_TEXT,
                        parameter,
                        true,
                        "Kya aap selected field mein ye text likhna chahte hain?",
                        true);
                confirmAndExecute(result);
                return;
            }

            case "CALL_CONTACT": {
                showContactSelection(target);
                return;
            }

            case "FIND_CONTACT": {
                ContactHelper helper = new ContactHelper(this);
                ContactHelper.ContactInfo contact = helper.findContact(target);
                boolean found = contact != null;

                result = new VoiceCommandProcessor.CommandResult(
                        VoiceCommandProcessor.CommandAction.FIND_CONTACT,
                        target, found,
                        found ? "Contact mil gaya: " + contact.name
                                : "Contact nahi mila: " + target,
                        false);
                break;
            }

            case "FLASHLIGHT_ON":
            case "FLASHLIGHT_OFF":
            case "BATTERY_STATUS":
            case "VOLUME_UP":
            case "VOLUME_DOWN":
            case "VOLUME_MUTE": {
                String localCommand;
                switch (type) {
                    case "FLASHLIGHT_ON": localCommand = "flashlight on"; break;
                    case "FLASHLIGHT_OFF": localCommand = "flashlight off"; break;
                    case "BATTERY_STATUS": localCommand = "battery status"; break;
                    case "VOLUME_UP": localCommand = "volume up"; break;
                    case "VOLUME_DOWN": localCommand = "volume down"; break;
                    default: localCommand = "mute volume"; break;
                }
                result = commandProcessor.executeCommand(localCommand);
                break;
            }

            default:
                askGemini(spokenText);
                return;
        }

        finalizeCommandExecution(spokenText, result);
    }

    private void askGemini(String spokenText) {
        if (aiClient == null) {
            String message = "AI backend abhi configure nahi hai.";
            finalizeCommandExecution(
                    spokenText,
                    new VoiceCommandProcessor.CommandResult(
                            VoiceCommandProcessor.CommandAction.UNKNOWN,
                            spokenText,
                            false,
                            message,
                            false
                    )
            );
            return;
        }

        txtStatus.setText("Gemini se jawab aa raha hai...");
        txtFeedback.setText("Please wait...");

        aiClient.sendMessage(
                spokenText,
                aiSessionId,
                new AiClient.AiCallback() {
                    @Override
                    public void onSuccess(String reply, String newSessionId) {
                        mainHandler.post(() -> {
                            if (isFinishing() || isDestroyed()) return;

                            if (newSessionId != null && !newSessionId.isEmpty()) {
                                aiSessionId = newSessionId;
                            }

                            finalizeCommandExecution(
                                    spokenText,
                                    new VoiceCommandProcessor.CommandResult(
                                            VoiceCommandProcessor.CommandAction.UNKNOWN,
                                            spokenText,
                                            true,
                                            reply,
                                            false
                                    )
                            );
                        });
                    }

                    @Override
                    public void onError(String error) {
                        mainHandler.post(() -> {
                            if (isFinishing() || isDestroyed()) return;

                            finalizeCommandExecution(
                                    spokenText,
                                    new VoiceCommandProcessor.CommandResult(
                                            VoiceCommandProcessor.CommandAction.UNKNOWN,
                                            spokenText,
                                            false,
                                            "AI se jawab nahi mil saka. " + error,
                                            false
                                    )
                            );
                        });
                    }
                }
        );
    }

    private void continueConversation() {
        if (conversationMode) {
            ttsManager.speak("Theek hai, aage boliye.",
                    () -> mainHandler.postDelayed(this::startListening, 400));
        }
    }

    private void executeSensitiveAction(VoiceCommandProcessor.CommandResult result) {
        if (result.action == VoiceCommandProcessor.CommandAction.TYPE_TEXT) {
            MyAccessibilityService service =
                    MyAccessibilityService.getInstance();
            boolean typed = service != null && service.typeText(result.argument);

            finalizeCommandExecution("Type text",
                    new VoiceCommandProcessor.CommandResult(
                            result.action, result.argument, typed,
                            typed ? "Text field mein likh diya."
                                    : "Text enter nahi ho saka. Input field select karein.",
                            false));
            return;
        }
        if (result.action == VoiceCommandProcessor.CommandAction.CALL_CONTACT) {
            try {
                ContactHelper helper = new ContactHelper(this);
                Intent callIntent = helper.createCallIntent(result.argument);
                if (callIntent == null) {
                    finalizeCommandExecution("Call",
                            new VoiceCommandProcessor.CommandResult(
                                    result.action, result.argument, false,
                                    "Call intent create nahi ho saka.", false));
                    return;
                }
                boolean directCall = Intent.ACTION_CALL.equals(callIntent.getAction());
                startActivity(callIntent);

                String feedback = directCall
                        ? "Call shuru ki ja rahi hai."
                        : "Dialer khul gaya hai. Call karne ke liye call button dabayein.";

                finalizeCommandExecution("Call",
                        new VoiceCommandProcessor.CommandResult(
                                result.action, result.argument, true,
                                feedback, false));
            } catch (Exception e) {
                Log.e("MainActivity", "Call action failed", e);
                finalizeCommandExecution("Call",
                        new VoiceCommandProcessor.CommandResult(
                                result.action, result.argument, false,
                                "Call nahi lag paya.", false));
            }
            return;
        }

        if (result.action == VoiceCommandProcessor.CommandAction.CLICK_SCREEN_ELEMENT) {
            MyAccessibilityService service =
                    MyAccessibilityService.getInstance();
            boolean clicked = service != null && service.clickByText(result.argument);

            finalizeCommandExecution("Click " + result.argument,
                    new VoiceCommandProcessor.CommandResult(
                            result.action, result.argument, clicked,
                            clicked ? result.argument + " click kar diya."
                                    : "Element nahi mila ya click nahi ho saka.",
                            false));
        }
    }

    private void finalizeCommandExecution(String commandText, VoiceCommandProcessor.CommandResult result) {
        txtFeedback.setText(result.feedbackMessage);
        txtStatus.setText(result.success ? "Command executed" : "Command failed");
        txtStatus.setTextColor(ContextCompat.getColor(this, result.success ? R.color.hiram_green : R.color.hiram_amber));

        String timeStr = new SimpleDateFormat("h:mm a", Locale.getDefault()).format(new Date());
        historyList.add(0, new CommandHistoryItem(commandText, result.feedbackMessage, timeStr, result.success));
        historyAdapter.notifyItemInserted(0);
        recyclerHistory.scrollToPosition(0);

        if (result.action == VoiceCommandProcessor.CommandAction.END_CONVERSATION) {
            conversationMode = false;
            ttsManager.speak(result.feedbackMessage, this::resumeWakeWordListening);
        } else if (conversationMode) {
            ttsManager.speak(result.feedbackMessage, () ->
                    mainHandler.postDelayed(this::startListening, 400));
        } else {
            ttsManager.speak(result.feedbackMessage);
        }
    }

    private void resumeWakeWordListening() {
        conversationMode = false;

        Intent intent = new Intent(this, VoiceAgentService.class);
        intent.setAction(VoiceAgentService.ACTION_RESUME_WAKE_WORD);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent);
            } else {
                startService(intent);
            }
        } catch (RuntimeException e) {
            txtStatus.setText("Wake-word service could not resume");
            Log.e("MainActivity", "Could not resume wake-word service", e);
        }
    }

    private void simulateCommand(String command) {
        txtResult.setText(command);
        processCommand(command);
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
        if (txtPermissionStatus == null) return;

        boolean mic = ContextCompat.checkSelfPermission(
                this, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;

        boolean contacts = ContextCompat.checkSelfPermission(
                this, Manifest.permission.READ_CONTACTS)
                == PackageManager.PERMISSION_GRANTED;

        boolean notifications = Build.VERSION.SDK_INT
                < Build.VERSION_CODES.TIRAMISU
                || ContextCompat.checkSelfPermission(
                        this, Manifest.permission.POST_NOTIFICATIONS)
                        == PackageManager.PERMISSION_GRANTED;

        boolean overlay = hasOverlayPermission();

        String status = "Mic: " + (mic ? "ON" : "OFF")
                + "  |  Contacts: " + (contacts ? "ON" : "OFF")
                + "\nNotifications: " + (notifications ? "ON" : "OFF")
                + "  |  Overlay: " + (overlay ? "ON" : "OFF");

        txtPermissionStatus.setText(status);
        txtPermissionStatus.setTextColor(ContextCompat.getColor(
                this, mic ? R.color.hiram_green : R.color.hiram_amber));
    }

    private void updateAccessibilityUI() {
        boolean active = MyAccessibilityService.isRunning();
        txtAccessibilityBadge.setText(active ? R.string.accessibility_status_active : R.string.accessibility_status_inactive);
        txtAccessibilityBadge.setTextColor(ContextCompat.getColor(this, active ? R.color.hiram_green : R.color.hiram_amber));
    }

    private void requestMicrophonePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            multiplePermissionsLauncher.launch(new String[]{
                    Manifest.permission.RECORD_AUDIO,
                    Manifest.permission.POST_NOTIFICATIONS
            });
        } else {
            multiplePermissionsLauncher.launch(new String[]{
                    Manifest.permission.RECORD_AUDIO
            });
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateAccessibilityUI();
        updatePermissionsUI();

        // Show Hi Ram floating bubble when overlay permission is available.
        if (hasOverlayPermission()) {
            try {
                startService(new Intent(this, FloatingBubbleService.class));
            } catch (RuntimeException e) {
                Toast.makeText(this, "Floating bubble could not start",
                        Toast.LENGTH_LONG).show();
            }
        }

        if (pendingStartAfterOverlay) {
            pendingStartAfterOverlay = false;

            if (hasOverlayPermission()
                    && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                    == PackageManager.PERMISSION_GRANTED) {
                startVoiceService();
            } else {
                Toast.makeText(this, "Required permissions not granted", Toast.LENGTH_LONG).show();
            }
        }

        try {
            IntentFilter filter = new IntentFilter(VoiceAgentService.BROADCAST_WAKE_WORD);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(wakeWordReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(wakeWordReceiver, filter);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        try {
            unregisterReceiver(wakeWordReceiver);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (speechRecognizer != null) {
            try {
                speechRecognizer.destroy();
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
        if (ttsManager != null) {
            ttsManager.shutdown();
        }
    }
    }
