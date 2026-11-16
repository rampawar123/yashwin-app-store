package com.example.hiram;

import org.json.JSONObject;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.auth.AuthResult;
import com.google.android.gms.tasks.Task;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class AiClient {

    private static final MediaType JSON =
            MediaType.parse("application/json; charset=utf-8");

    private final OkHttpClient client;
    private final String backendUrl;
    private final FirebaseAuth firebaseAuth;
    private final Object authLock = new Object();
    private Task<AuthResult> anonymousSignInTask;

    public interface AiCallback {
        void onSuccess(String reply, String sessionId);
        void onError(String error);
    }

    public interface CommandCallback {
        void onSuccess(String actionJson);
        void onError(String error);
    }

    public AiClient(String backendUrl) {
        if (backendUrl == null || !backendUrl.startsWith("https://")) {
            throw new IllegalArgumentException(
                    "Secure HTTPS backend URL required"
            );
        }

        this.backendUrl = backendUrl.replaceAll("/+$", "");
        this.firebaseAuth = FirebaseAuth.getInstance();

        this.client = new OkHttpClient.Builder()
                .connectTimeout(20, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .writeTimeout(20, TimeUnit.SECONDS)
                .build();
    }

    // Normal Gemini conversation
    public void sendMessage(
            String message,
            String sessionId,
            AiCallback callback
    ) {
        if (callback == null) return;

        if (message == null || message.trim().isEmpty()) {
            callback.onError("Message is empty");
            return;
        }

        try {
            JSONObject json = new JSONObject();
            json.put("message", message.trim());
            json.put("session_id",
                    sessionId == null ? "" : sessionId);

            Request request = new Request.Builder()
                    .url(backendUrl + "/chat")
                    .post(createBody(json))
                    .header("Accept", "application/json")
                    .build();

            enqueueAuthenticated(request, new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    callback.onError("Network error: " + e.getMessage());
                }

                @Override
                public void onResponse(Call call, Response response)
                        throws IOException {
                    try (Response res = response) {
                        if (!res.isSuccessful() || res.body() == null) {
                            callback.onError("Server error: " + res.code());
                            return;
                        }

                        try {
                            JSONObject result =
                                    new JSONObject(res.body().string());

                            String reply = result.optString("reply", "").trim();
                            String newSessionId =
                                    result.optString("session_id", "").trim();

                            if (reply.isEmpty()) {
                                callback.onError("AI response is empty");
                            } else {
                                callback.onSuccess(reply, newSessionId);
                            }
                        } catch (Exception e) {
                            callback.onError("Invalid server response");
                        }
                    }
                }
            });
        } catch (Exception e) {
            callback.onError("Request error: " + e.getMessage());
        }
    }

    // Structured Android command request
    public void sendCommand(
            String message,
            CommandCallback callback
    ) {
        if (callback == null) return;

        if (message == null || message.trim().isEmpty()) {
            callback.onError("Command is empty");
            return;
        }

        try {
            JSONObject json = new JSONObject();
            json.put("message", message.trim());

            Request request = new Request.Builder()
                    .url(backendUrl + "/command")
                    .post(createBody(json))
                    .header("Accept", "application/json")
                    .build();

            enqueueAuthenticated(request, new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    callback.onError("Command network error: "
                            + e.getMessage());
                }

                @Override
                public void onResponse(Call call, Response response)
                        throws IOException {
                    try (Response res = response) {
                        if (!res.isSuccessful() || res.body() == null) {
                            callback.onError(
                                    "Command server error: " + res.code()
                            );
                            return;
                        }

                        try {
                            JSONObject result =
                                    new JSONObject(res.body().string());

                            String action = result.optString("action", "")
                                    .trim();

                            if (action.isEmpty()) {
                                callback.onError(
                                        "Structured action is missing"
                                );
                                return;
                            }

                            callback.onSuccess(result.toString());

                        } catch (Exception e) {
                            callback.onError(
                                    "Invalid structured command response"
                            );
                        }
                    }
                }
            });
        } catch (Exception e) {
            callback.onError("Command request error: " + e.getMessage());
        }
    }

    private void enqueueAuthenticated(Request request, Callback callback) {
        FirebaseUser user;
        Task<AuthResult> signInTask = null;

        synchronized (authLock) {
            user = firebaseAuth.getCurrentUser();

            if (user == null) {
                if (anonymousSignInTask == null) {
                    anonymousSignInTask = firebaseAuth.signInAnonymously();
                }
                signInTask = anonymousSignInTask;
            }
        }

        if (user != null) {
            fetchFirebaseToken(user, request, callback);
            return;
        }

        final Task<AuthResult> pendingTask = signInTask;

        pendingTask.addOnCompleteListener(task -> {
            synchronized (authLock) {
                if (anonymousSignInTask == pendingTask) {
                    anonymousSignInTask = null;
                }
            }

            if (task.isSuccessful() && task.getResult() != null) {
                fetchFirebaseToken(
                        task.getResult().getUser(), request, callback);
            } else {
                callback.onFailure(
                        null,
                        new IOException("Firebase sign-in failed",
                                task.getException()));
            }
        });
    }

    private void fetchFirebaseToken(
            FirebaseUser user, Request request, Callback callback) {
        if (user == null) {
            callback.onFailure(null, new IOException("Firebase user unavailable"));
            return;
        }

        user.getIdToken(false)
                .addOnSuccessListener(result -> {
                    String token = result.getToken();
                    if (token == null || token.isEmpty()) {
                        callback.onFailure(null,
                                new IOException("Firebase ID token is empty"));
                        return;
                    }

                    Request authenticatedRequest = request.newBuilder()
                            .header("Authorization", "Bearer " + token)
                            .build();

                    client.newCall(authenticatedRequest).enqueue(callback);
                })
                .addOnFailureListener(error ->
                        callback.onFailure(null,
                                new IOException("Firebase token failed", error)));
    }

    private RequestBody createBody(JSONObject json) {
        return RequestBody.create(JSON, json.toString());
    }
}
