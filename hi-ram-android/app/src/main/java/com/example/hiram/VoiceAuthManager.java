package com.example.hiram;

import android.app.KeyguardManager;
import android.content.Context;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;

public class VoiceAuthManager {

    private static final String TAG = "VoiceAuthManager";

    public interface AuthCallback {
        void onAuthenticated();
        void onAuthenticationFailed(String reason);
        void onCancelled();
    }

    private final FragmentActivity activity;

    public VoiceAuthManager(FragmentActivity activity) {
        this.activity = activity;
    }

    public boolean isDeviceSecurityAvailable() {
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            return false;
        }

        BiometricManager manager = BiometricManager.from(activity);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            int authenticators =
                    BiometricManager.Authenticators.BIOMETRIC_STRONG
                    | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

            return manager.canAuthenticate(authenticators)
                    == BiometricManager.BIOMETRIC_SUCCESS;
        }

        KeyguardManager keyguard =
                (KeyguardManager) activity.getSystemService(Context.KEYGUARD_SERVICE);

        boolean secureDevice = keyguard != null && keyguard.isDeviceSecure();
        boolean biometricAvailable =
                manager.canAuthenticate(
                        BiometricManager.Authenticators.BIOMETRIC_STRONG)
                        == BiometricManager.BIOMETRIC_SUCCESS;

        return secureDevice || biometricAvailable;
    }

    public void authenticateForSensitiveAction(
            String actionTitle,
            String actionDetail,
            @NonNull AuthCallback callback) {

        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            callback.onAuthenticationFailed("Activity available nahi hai.");
            return;
        }

        if (!isDeviceSecurityAvailable()) {
            callback.onAuthenticationFailed(
                    "Phone mein PIN, Pattern, Password ya supported biometric security set karein.");
            return;
        }

        Executor executor = ContextCompat.getMainExecutor(activity);
        AtomicBoolean completed = new AtomicBoolean(false);

        BiometricPrompt.PromptInfo.Builder builder =
                new BiometricPrompt.PromptInfo.Builder()
                        .setTitle("Hi Ram: " + actionTitle)
                        .setSubtitle("Phone PIN, Pattern ya biometric se confirm karein")
                        .setDescription(actionDetail);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setAllowedAuthenticators(
                    BiometricManager.Authenticators.BIOMETRIC_STRONG
                    | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
        } else {
            builder.setDeviceCredentialAllowed(true);
        }

        BiometricPrompt prompt = new BiometricPrompt(
                activity,
                executor,
                new BiometricPrompt.AuthenticationCallback() {

                    @Override
                    public void onAuthenticationSucceeded(
                            @NonNull BiometricPrompt.AuthenticationResult result) {
                        super.onAuthenticationSucceeded(result);

                        if (completed.compareAndSet(false, true)) {
                            callback.onAuthenticated();
                        }
                    }

                    @Override
                    public void onAuthenticationFailed() {
                        super.onAuthenticationFailed();
                        Log.w(TAG, "Biometric attempt not recognized; waiting for retry.");
                    }

                    @Override
                    public void onAuthenticationError(
                            int errorCode,
                            @NonNull CharSequence errString) {
                        super.onAuthenticationError(errorCode, errString);

                        if (!completed.compareAndSet(false, true)) {
                            return;
                        }

                        if (errorCode == BiometricPrompt.ERROR_USER_CANCELED
                                || errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                                || errorCode == BiometricPrompt.ERROR_CANCELED) {
                            callback.onCancelled();
                        } else {
                            callback.onAuthenticationFailed(errString.toString());
                        }
                    }
                });

        try {
            prompt.authenticate(builder.build());
        } catch (Exception e) {
            Log.e(TAG, "Authentication prompt could not start", e);

            if (completed.compareAndSet(false, true)) {
                callback.onAuthenticationFailed(
                        "Phone authentication start nahi ho saka. Sensitive action block kar diya gaya.");
            }
        }
    }
}
