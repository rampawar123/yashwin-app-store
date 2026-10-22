
package com.example.hiram;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.widget.ImageButton;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.Locale;

public class MainActivity extends AppCompatActivity {

    private TextView txtStatus;
    private TextView txtResult;
    private ImageButton btnMic;
    private SpeechRecognizer speechRecognizer;

    private final ActivityResultLauncher<String> micPermission =
            registerForActivityResult(
                    new ActivityResultContracts.RequestPermission(),
                    granted -> {
                        if (granted) startListening();
                        else txtStatus.setText("Microphone permission zaroori hai.");
                    });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        txtStatus = findViewById(R.id.txtStatus);
        txtResult = findViewById(R.id.txtResult);
        btnMic = findViewById(R.id.btnMic);

        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            txtStatus.setText("Is phone par speech recognition available nahi hai.");
            btnMic.setEnabled(false);
            return;
        }

        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);

        speechRecognizer.setRecognitionListener(
                new android.speech.RecognitionListener() {
                    @Override
                    public void onReadyForSpeech(Bundle params) {
                        txtStatus.setText("Sun raha hoon... Boliye!");
                    }

                    @Override public void onBeginningOfSpeech() {}
                    @Override public void onRmsChanged(float rmsdB) {}
                    @Override public void onBufferReceived(byte[] buffer) {}

                    @Override
                    public void onEndOfSpeech() {
                        txtStatus.setText("Command samajh raha hoon...");
                    }

                    @Override
                    public void onError(int error) {
                        txtStatus.setText("Dobara mic dabakar koshish karein.");
                    }

                    @Override
                    public void onResults(Bundle results) {
                        ArrayList<String> matches =
                                results.getStringArrayList(
                                        SpeechRecognizer.RESULTS_RECOGNITION);

                        if (matches != null && !matches.isEmpty()) {
                            String command = matches.get(0);
                            txtResult.setText(command);
                            processVoiceCommand(command);
                        }

                        txtStatus.setText("Taiyar hoon. Mic dabakar boliye.");
                    }

                    @Override public void onPartialResults(Bundle partialResults) {}
                    @Override public void onEvent(int eventType, Bundle params) {}
                });

        btnMic.setOnClickListener(v -> {
            if (ContextCompat.checkSelfPermission(
                    this, Manifest.permission.RECORD_AUDIO)
                    == PackageManager.PERMISSION_GRANTED) {
                startListening();
            } else {
                micPermission.launch(Manifest.permission.RECORD_AUDIO);
            }
        });
    }

    private void startListening() {
        if (speechRecognizer == null) return;

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "hi-IN");
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "hi-IN");
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);

        speechRecognizer.startListening(intent);
    }

    private void processVoiceCommand(String command) {
        String lower = command.toLowerCase(Locale.ROOT);

        if (lower.contains("youtube") || lower.contains("यूट्यूब")) {
            Intent launchIntent =
                    getPackageManager().getLaunchIntentForPackage(
                            "com.google.android.youtube");

            if (launchIntent != null) {
                startActivity(launchIntent);
            } else {
                startActivity(new Intent(
                        Intent.ACTION_VIEW,
                        android.net.Uri.parse("https://www.youtube.com/")));
            }
        } else {
            Toast.makeText(
                    this,
                    "Command mili: " + command,
                    Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onDestroy() {
        if (speechRecognizer != null) {
            speechRecognizer.destroy();
            speechRecognizer = null;
        }
        super.onDestroy();
    }
}
