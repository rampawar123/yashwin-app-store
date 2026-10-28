# Hi Ram – Voice Controlled Android Mobile Operator

**Package**: `com.example.hiram`  
**Target SDK**: 35 (Android 15) • **Min SDK**: 23 (Android 6.0+) • **Build System**: Gradle 8.7+ (AGP 8.6.1)

Hi Ram is a complete, modern native Android mobile operator that allows hands-free voice control of permitted device functions using the wake phrase **"Hi Ram"**.

Unlike chatbot-only assistants, Hi Ram operates phone hardware, system settings, media, applications, and on-screen controls via Android Accessibility and official platform APIs.

---

## 1. System Architecture

```
                                  [ User Voice ]
                                         │
                    ┌────────────────────┴────────────────────┐
                    ▼                                         ▼
         [ WakeWordEngine (Offline) ]            [ SpeechRecognizer (Android) ]
         • Low-power acoustic spotting           • Multilingual (Hindi, English, etc.)
         • "Hi Ram" / "हाय राम"                  • Real-time speech-to-text
         • Continuous offline buffer             • On-screen live transcription
                    │                                         │
                    ▼                                         ▼
         [ VoiceAgentService ]                   [ VoiceCommandProcessor ]
         • Foreground Service (microphone)       • Multilingual NLP Parser
         • Persistent ongoing notification       • Intent & System API Dispatch
         • Start, Pause & Stop controls                       │
                    │                                         │
                    └────────────────────┬────────────────────┘
                                         ▼
                    ┌────────────────────┴────────────────────┐
                    ▼                                         ▼
         [ Device Operations ]                   [ Security & Authorization ]
         • Camera Flashlight (Torch)             • VoiceAuthManager (BiometricPrompt/PIN)
         • BatteryManager Status                 • Explicit user confirmation for calls
         • AudioManager (Volume Up/Down)         • Zero raw audio storage policy
         • AppLauncher (YouTube, WhatsApp, etc)  • Whitelist & Shell execution sandbox
         • ContactHelper (Query & Dial)
         • MyAccessibilityService (Home, Back, Recents, Notifications, Click by text)
```

---

## 2. Wake Word Detection Architecture

- **Wake Phrase**: "Hi Ram" ("हाय राम", "hey ram").
- **Offline Guarantee**: Wake word detection runs strictly on-device without continuous cloud streaming to ensure privacy and low battery consumption.
- **Engine Evaluation**:
  - **Picovoice Porcupine**: Highly optimized, micro-footprint (~1MB) keyword spotter with high accuracy. Recommended for commercial deployments with access keys.
  - **Vosk**: Open-source Kaldi-based offline speech recognizer (~50MB offline acoustic model). Supported via `WakeWordEngine` interface.
  - **Integrated Acoustic Spotter**: Built-in 16kHz PCM rolling buffer acoustic pattern matcher detecting the two-syllable "Hi Ram" cadence without external binary blobs.
- **Foreground Service**: Controlled by `VoiceAgentService` with `foregroundServiceType="microphone"` and an ongoing notification providing **Start**, **Pause**, and **Stop** controls.

---

## 3. Voice Recognition & Multilingual Support

- Implements Android `SpeechRecognizer` for continuous command dictation.
- Supported languages:
  - Hindi (`hi-IN`)
  - English (India) (`en-IN`)
  - English (US) (`en-US`)
  - Marathi (`mr-IN`)
  - Gujarati (`gu-IN`)
  - Tamil (`ta-IN`)
  - Telugu (`te-IN`)
- Features live transcription on screen and voice feedback via `TtsManager` in both Hindi and English.

---

## 4. Voice Commands Reference

| Command (Hindi / Hinglish / English) | Action Executed | Underlying Android API |
|---|---|---|
| *"Hi Ram, YouTube kholo."* | Opens YouTube app or browser fallback | `AppLauncher` + `com.google.android.youtube` |
| *"Hi Ram, YouTube par cricket search karo."* | Searches YouTube for query | `Intent.ACTION_VIEW` (`youtube.com/results?search_query=`) |
| *"Hi Ram, WhatsApp kholo."* | Launches WhatsApp | `AppLauncher` + `com.whatsapp` |
| *"Hi Ram, music chalao."* / *"Gana bajao."* | Plays music | `MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH` |
| *"Hi Ram, home screen par jao."* | Returns to Home Screen | `MyAccessibilityService.performGlobalAction(GLOBAL_ACTION_HOME)` |
| *"Hi Ram, peeche jao."* / *"Back jao."* | Navigates back | `MyAccessibilityService.performGlobalAction(GLOBAL_ACTION_BACK)` |
| *"Hi Ram, recent apps dikhao."* | Shows active app switcher | `MyAccessibilityService.performGlobalAction(GLOBAL_ACTION_RECENTS)` |
| *"Hi Ram, notification dikhao."* | Pulls down notification shade | `MyAccessibilityService.performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)` |
| *"Hi Ram, flashlight on karo."* | Turns camera torch ON | `CameraManager.setTorchMode(cameraId, true)` |
| *"Hi Ram, flashlight off karo."* | Turns camera torch OFF | `CameraManager.setTorchMode(cameraId, false)` |
| *"Hi Ram, battery kitni hai?"* | Queries battery percentage and charging state | `BatteryManager.EXTRA_LEVEL` / `EXTRA_SCALE` |
| *"Hi Ram, volume badhao."* | Increases media volume | `AudioManager.adjustStreamVolume(STREAM_MUSIC, ADJUST_RAISE)` |
| *"Hi Ram, volume kam karo."* | Decreases media volume | `AudioManager.adjustStreamVolume(STREAM_MUSIC, ADJUST_LOWER)` |
| *"Hi Ram, contact search karo [naam]."* | Looks up contact in address book | `ContactsContract.CommonDataKinds.Phone` query |
| *"Hi Ram, call karo [naam]."* | Prepares phone call with confirmation | `VoiceAuthManager` + `Intent.ACTION_CALL` / `DIAL` |
| *"Hi Ram, camera kholo."* | Opens device camera | `MediaStore.ACTION_IMAGE_CAPTURE` |
| *"Hi Ram, settings kholo."* | Opens Android Settings | `Settings.ACTION_SETTINGS` |
| *"Hi Ram, screen par [button] click karo."* | Clicks matching UI element | `MyAccessibilityService.clickByText(text)` |

---

## 5. Security & Device Authentication

- **Voice Security Posture**: Voice matching alone is **not** a secure biometric authentication mechanism due to replay and synthesis vulnerabilities.
- **Biometric Device Authentication**: Sensitive operations (e.g., placing phone calls or modifying system configurations) require Android device authentication (`BiometricPrompt` with device PIN, pattern, or fingerprint) via `VoiceAuthManager`.
- **Zero Raw Audio Storage**: Raw microphone recordings are processed in memory and **never** stored on disk or transmitted without explicit consent.

---

## 6. Android Accessibility Service

- **Why Accessibility is Required**: Android limits background apps from navigating the Home screen, switching apps, opening notifications, or clicking buttons. Accessibility permission provides these capabilities safely upon explicit user command.
- **Enabling the Service**:
  1. Open Hi Ram app.
  2. Tap **"Open Accessibility Settings"**.
  3. Locate **Hi Ram** in the Installed Services list.
  4. Toggle the switch to **On** and accept the system prompt.
- **Disabling the Service**: The user can toggle off Hi Ram anytime in `Settings > Accessibility > Installed Services > Hi Ram`.
- **Privacy Enforcement**: Hi Ram does not record screen contents, monitor background typing, or capture passwords.

---

## 7. AI Command Interpretation Layer (Optional)

`AiCommandEngine.java` provides an optional structured AI layer (e.g. for Gemini backend integration):
- API keys reside on a secure backend proxy (`/api/command`); they are never bundled into the APK.
- AI returns structured JSON actions:
  ```json
  {
    "action": "OPEN_YOUTUBE",
    "target": "cricket highlights",
    "parameter": "",
    "requiresConfirmation": false,
    "explanation": "Searching YouTube for cricket highlights"
  }
  ```
- **Local Validation**: Every action is validated against `ALLOWED_ACTIONS` whitelist before execution. Shell characters (`;`, `&&`, `|`, `` ` ``, `$`) are strictly rejected.

---

## 8. Building the Android Application

### Prerequisites
- JDK 17 or higher
- Android SDK 35 (Build tools 35.0.0+)
- Gradle 8.7+

### Build Debug APK
```bash
cd hi-ram-android
chmod +x gradlew
./gradlew clean assembleDebug
# Output APK: app/build/outputs/apk/debug/app-debug.apk
```

### Build Signed Release APK
To build a release APK without committing private signing keys:
1. Provide the signing configuration via environment variables:
   ```bash
   export KEYSTORE_FILE="/path/to/my-release-key.jks"
   export KEYSTORE_PASSWORD="your-keystore-password"
   export KEY_ALIAS="your-key-alias"
   export KEY_PASSWORD="your-key-password"
   ./gradlew assembleRelease
   # Output APK: app/build/outputs/apk/release/app-release.apk
   ```

### GitHub Actions CI
The repository includes automated GitHub Actions workflows in `.github/workflows/android.yml`:
- Triggers on push to `hi-ram-android/**` or manual `workflow_dispatch`.
- Automatically builds the Debug APK and uploads it as an artifact.
- Signs the Release APK when repository secret `KEYSTORE_BASE64` is configured.

---

## 9. Testing & Feature Limitations

| Feature | Real Device Testing | Emulator Limitations |
|---|---|---|
| Voice Recognition (`SpeechRecognizer`) | Fully functional | Requires Google Play Services / speech engine installed in AVD |
| Flashlight (`CameraManager`) | Fully functional on hardware flash | Emulator virtual cameras do not have hardware torch LEDs |
| Phone Calls & SMS (`Intent.ACTION_CALL`) | Fully functional with active SIM | Emulator will open dialer without placing cellular calls |
| Accessibility Service | Fully functional | Requires manual enablement in Emulator Accessibility settings |
| Offline Wake Word (`AudioRecord`) | Fully functional with hardware mic | Requires audio input pass-through enabled in emulator |
| Volume Control (`AudioManager`) | Fully functional | Controls emulator host sound |
