import json
import base64
import os
import ipaddress
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, auth

load_dotenv()

FIREBASE_AUTH_READY = False
FIREBASE_AUTH_ERROR = ""

try:
    encoded_service_account = os.getenv(
        "FIREBASE_SERVICE_ACCOUNT_JSON_BASE64", ""
    ).strip()
    if not encoded_service_account:
        raise RuntimeError("Firebase service account is not configured")

    service_account_info = json.loads(
        base64.b64decode(encoded_service_account, validate=True)
    )
    if service_account_info.get("project_id") != "hi-ram":
        raise RuntimeError("Firebase project ID mismatch")

    try:
        firebase_admin.get_app()
    except ValueError:
        firebase_admin.initialize_app(
            credentials.Certificate(service_account_info)
        )
    FIREBASE_AUTH_READY = True
except Exception as error:
    FIREBASE_AUTH_ERROR = str(error)
    print("Firebase authentication is not ready:", FIREBASE_AUTH_ERROR)

API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    + MODEL + ":generateContent"
)

sessions = {}
sessions_lock = threading.Lock()
sessions_last_seen = {}
MAX_SESSIONS = 100
MAX_HISTORY = 10
SESSION_IDLE_SECONDS = 30 * 60

rate_limits = {}
rate_limits_lock = threading.Lock()
RATE_LIMIT_WINDOW = 60
RATE_LIMITS = {"chat": 10, "command": 20}
MAX_RATE_LIMIT_KEYS = 5000


class HiRamHandler(BaseHTTPRequestHandler):

    def send_json(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def check_rate_limit(self, route):
        # Firebase UID is assigned only after successful token verification.
        user_id = getattr(self, "firebase_uid", "")
        if not user_id:
            self.send_json(401, {"error": "Authentication required"})
            return False

        now = time.monotonic()
        key = (user_id, route)

        with rate_limits_lock:
            expired = [
                item for item, value in rate_limits.items()
                if now - value[0] > RATE_LIMIT_WINDOW
            ]
            for item in expired:
                rate_limits.pop(item, None)

            entry = rate_limits.get(key)

            if entry is None or now - entry[0] >= RATE_LIMIT_WINDOW:
                if len(rate_limits) >= MAX_RATE_LIMIT_KEYS:
                    self.send_json(429, {"error": "Rate limit capacity reached"})
                    return False

                rate_limits[key] = [now, 1]
                return True

            if entry[1] >= RATE_LIMITS[route]:
                self.send_json(429, {"error": "Too many requests"})
                return False

            entry[1] += 1
            return True

    def do_GET(self):
        if self.path != "/health":
            self.send_json(404, {"error": "Not found"})
            return

        self.send_json(200, {
            "status": "ok",
            "service": "Hi Ram Backend"
        })

    def require_firebase_user(self):
        if not FIREBASE_AUTH_READY:
            self.send_json(503, {
                "error": "Authentication service is not configured"
            })
            return False

        authorization = self.headers.get("Authorization", "")
        parts = authorization.split(None, 1)
        if (
            len(parts) != 2
            or parts[0].lower() != "bearer"
            or not parts[1].strip()
            or len(parts[1]) > 8192
        ):
            self.send_json(401, {"error": "Authentication required"})
            return False

        try:
            decoded_token = auth.verify_id_token(
                parts[1].strip(), check_revoked=True
            )
            self.firebase_uid = decoded_token.get("uid")
            if not self.firebase_uid:
                raise ValueError("Token has no user ID")
            return True
        except Exception:
            self.send_json(401, {"error": "Invalid or expired token"})
            return False

    def do_POST(self):
        if self.path == "/command":
            if not self.require_firebase_user():
                return
            if not self.check_rate_limit("command"):
                return
            self.handle_command()
            return
        if self.path != "/chat":
            self.send_json(404, {"error": "Not found"})
            return
        if not self.require_firebase_user():
            return
        if not self.check_rate_limit("chat"):
            return

        if not API_KEY:
            self.send_json(503, {"error": "AI key not configured"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))

            if length <= 0 or length > 10000:
                self.send_json(400, {"error": "Invalid request size"})
                return

            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                self.send_json(400, {"error": "JSON object required"})
                return

            message_value = data.get("message", "")
            if not isinstance(message_value, str):
                self.send_json(400, {"error": "Message must be text"})
                return
            message = message_value.strip()
            session_id = str(data.get("session_id", "")).strip()

            if not message:
                self.send_json(400, {"error": "Message is empty"})
                return

            if len(message) > 2000:
                self.send_json(400, {"error": "Message too long"})
                return

            if not session_id:
                session_id = str(uuid4())

            if len(session_id) > 100:
                self.send_json(400, {"error": "Invalid session ID"})
                return

            session_key = self.firebase_uid + ":" + session_id

            with sessions_lock:
                now = time.monotonic()
                expired = [
                    sid for sid, last_seen in sessions_last_seen.items()
                    if now - last_seen > SESSION_IDLE_SECONDS
                ]
                for sid in expired:
                    sessions.pop(sid, None)
                    sessions_last_seen.pop(sid, None)

                if session_key not in sessions:
                    if len(sessions) >= MAX_SESSIONS:
                        oldest = min(
                            sessions,
                            key=lambda sid: sessions_last_seen.get(sid, 0)
                        )
                        sessions.pop(oldest, None)
                        sessions_last_seen.pop(oldest, None)

                    sessions[session_key] = deque(maxlen=MAX_HISTORY)

                sessions_last_seen[session_key] = now
                history = list(sessions[session_key])
                history.append({
                    "role": "user",
                    "parts": [{"text": message}]
                })

            payload = {
                "system_instruction": {
                    "parts": [{
                        "text": (
                            "You are Hi Ram, a helpful voice assistant. "
                            "Reply naturally and concisely. "
                            "Use Hindi or Hinglish when the user does. "
                            "Never claim a phone action was completed "
                            "unless the Android app confirms it."
                        )
                    }]
                },
                "contents": history,
                "generationConfig": {
                    "temperature": 0.7,
                    "maxOutputTokens": 512
                }
            }

            request = Request(
                API_URL,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": API_KEY
                },
                method="POST"
            )

            with urlopen(request, timeout=45) as response:
                result = json.loads(response.read().decode("utf-8"))

            reply = (
                result["candidates"][0]["content"]["parts"][0]["text"]
                .strip()
            )

            if not reply:
                raise ValueError("Empty AI response")

            with sessions_lock:
                if session_key not in sessions:
                    sessions[session_key] = deque(maxlen=MAX_HISTORY)
                sessions_last_seen[session_key] = time.monotonic()
                sessions[session_key].append({
                    "role": "user",
                    "parts": [{"text": message}]
                })
                sessions[session_key].append({
                    "role": "model",
                    "parts": [{"text": reply}]
                })

            self.send_json(200, {
                "reply": reply,
                "session_id": session_id
            })

        except HTTPError as e:
            self.send_json(502, {"error": "Gemini API error", "code": e.code})
        except URLError:
            self.send_json(502, {"error": "Could not reach Gemini API"})
        except (ValueError, KeyError, IndexError, TypeError):
            self.send_json(502, {"error": "Invalid AI response"})
        except Exception:
            self.send_json(500, {"error": "Internal server error"})


    def handle_command(self):
        if not API_KEY:
            self.send_json(503, {"error": "AI key not configured"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 10000:
                self.send_json(400, {"error": "Invalid request size"})
                return

            data = json.loads(self.rfile.read(length))

            if not isinstance(data, dict):
                self.send_json(400, {"error": "JSON object required"})
                return

            message_value = data.get("message", "")

            if not isinstance(message_value, str):
                self.send_json(400, {"error": "Message must be text"})
                return

            message = message_value.strip()

            if not message or len(message) > 2000:
                self.send_json(400, {"error": "Invalid message"})
                return

            allowed_actions = [
                "OPEN_APP", "SEARCH_APP", "OPEN_YOUTUBE",
                "SEARCH_YOUTUBE", "OPEN_WHATSAPP", "PLAY_MUSIC",
                "OPEN_CAMERA", "OPEN_SETTINGS", "OPEN_WIFI_SETTINGS",
                "OPEN_BLUETOOTH_SETTINGS", "HOME_SCREEN", "BACK",
                "RECENT_APPS", "NOTIFICATIONS", "CLICK_ELEMENT",
                "TYPE_TEXT", "SCROLL_UP", "SCROLL_DOWN",
                "FLASHLIGHT_ON", "FLASHLIGHT_OFF", "BATTERY_STATUS",
                "VOLUME_UP", "VOLUME_DOWN", "VOLUME_MUTE",
                "FIND_CONTACT", "CALL_CONTACT", "UNKNOWN"
            ]

            instruction = (
                "You are the command planner for Hi Ram, an Android voice assistant. "
                "Convert the user's request into exactly one JSON object with these keys: "
                "action, target, parameter, requiresConfirmation, explanation. "
                "Allowed action values: " + ", ".join(allowed_actions) + ". "
                "Use UNKNOWN if the request is unclear, unsupported, or needs multiple "
                "steps that cannot safely be represented by one action. "
                "Never invent that an action has already happened. "
                "Never return shell commands, code, URLs, or extra text. "
                "For CALL_CONTACT and CLICK_ELEMENT set requiresConfirmation to true. "
                "Use concise Hindi/Hinglish explanation when appropriate. "
                "The target is the app, contact, or UI element. "
                "The parameter is the search query or text to enter. "
                "Return JSON only."
            )

            payload = {
                "system_instruction": {"parts": [{"text": instruction}]},
                "contents": [{
                    "role": "user",
                    "parts": [{"text": message}]
                }],
                "generationConfig": {
                    "temperature": 0.1,
                    "maxOutputTokens": 300,
                    "responseMimeType": "application/json"
                }
            }

            request = Request(
                API_URL,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": API_KEY
                },
                method="POST"
            )

            with urlopen(request, timeout=45) as response:
                result = json.loads(response.read().decode("utf-8"))

            raw = result["candidates"][0]["content"]["parts"][0]["text"]
            action_data = json.loads(raw)

            if not isinstance(action_data, dict):
                raise ValueError("Action response is not an object")

            action_value = action_data.get("action", "UNKNOWN")
            target_value = action_data.get("target", "")
            parameter_value = action_data.get("parameter", "")
            explanation_value = action_data.get("explanation", "Command ready")
            confirmation_value = action_data.get("requiresConfirmation", False)

            if not isinstance(action_value, str):
                raise ValueError("Action must be text")
            if not isinstance(target_value, str):
                raise ValueError("Target must be text")
            if not isinstance(parameter_value, str):
                raise ValueError("Parameter must be text")
            if not isinstance(explanation_value, str):
                raise ValueError("Explanation must be text")
            if not isinstance(confirmation_value, bool):
                raise ValueError("Confirmation must be Boolean")

            action = action_value.strip().upper()
            target = target_value.strip()
            parameter = parameter_value.strip()
            explanation = explanation_value.strip()

            if len(action) > 40:
                raise ValueError("Action field too long")

            for field_name, field_value in (
                ("action", action),
                ("target", target),
                ("parameter", parameter),
                ("explanation", explanation)
            ):
                if any(ord(char) < 32 or ord(char) == 127
                       for char in field_value):
                    raise ValueError(
                        "Invalid control character in " + field_name
                    )

            if action not in allowed_actions:
                action = "UNKNOWN"
                target = ""
                parameter = ""
                explanation = "Unsupported AI action"
                confirmation_value = False

            if (len(target) > 120 or len(parameter) > 300
                    or len(explanation) > 500):
                raise ValueError("Action field too long")

            required_fields = {
                "OPEN_APP": target,
                "SEARCH_APP": target,
                "CLICK_ELEMENT": target,
                "FIND_CONTACT": target,
                "CALL_CONTACT": target,
                "SEARCH_YOUTUBE": parameter,
                "TYPE_TEXT": parameter
            }

            if action in required_fields and not required_fields[action]:
                raise ValueError("Required action field is missing")

            confirmation = confirmation_value
            if action in ("CALL_CONTACT", "CLICK_ELEMENT"):
                confirmation = True

            self.send_json(200, {
                "action": action,
                "target": target,
                "parameter": parameter,
                "requiresConfirmation": confirmation,
                "explanation": explanation
            })

        except HTTPError as e:
            self.send_json(502, {"error": "Gemini API error", "code": e.code})
        except URLError:
            self.send_json(502, {"error": "Could not reach Gemini API"})
        except (ValueError, KeyError, IndexError, TypeError):
            self.send_json(502, {"error": "Invalid AI command response"})
        except Exception:
            self.send_json(500, {"error": "Internal server error"})

    def log_message(self, format, *args):
        print("Hi Ram:", args[0])


if __name__ == "__main__":
    HOST = "0.0.0.0"
    PORT = int(os.environ.get("PORT", "8000"))

    server = ThreadingHTTPServer((HOST, PORT), HiRamHandler)
    print(f"Hi Ram backend running on {HOST}:{PORT}")
    print("Model:", MODEL)
    server.serve_forever()
