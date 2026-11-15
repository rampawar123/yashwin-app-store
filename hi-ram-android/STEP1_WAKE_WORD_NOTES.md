# Hi Ram — Step 1: Real offline wake-word recognition

This step replaces the old RMS/energy-cadence guesser with Vosk speech recognition for the exact wake phrase.

## What changed
- Added `com.alphacephei:vosk-android:0.3.75`.
- Added Android `INTERNET` permission because the compact acoustic model is downloaded once on first activation.
- Replaced `WakeWordEngine` with a Vosk-based implementation.
- The model is stored in the app's private files directory. After the first successful download, wake-word recognition runs offline.
- Model download/extraction is cancellable when the listening service is stopped and rejects unsafe ZIP paths.

## First-run behavior
The first activation needs an internet connection and approximately 40 MB of model download space. Later wake-word detection does not need internet. This initial model is English; it is used only to recognize “Hi Ram”. After wake-up, the existing command recognizer continues to handle the selected spoken command language.

## Important testing note
This source patch has not yet been built on an Android SDK or tested on the target phone. Build it with GitHub Actions or Android Gradle, install the debug APK, allow microphone access, start background listening while the app is visible, and test “Hi Ram” several times in a quiet room and with normal background noise. Do not publish this build until device testing is successful.

## Dependency source
Vosk Android is published on Maven Central. Model information and the small English model are documented by Vosk:
- https://central.sonatype.com/artifact/com.alphacephei/vosk-android/0.3.75
- https://alphacephei.com/vosk/models
