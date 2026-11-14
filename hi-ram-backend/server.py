import json
import os
import threading
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    + MODEL + ":generateContent"
)

sessions = {}
sessions_lock = threading.Lock()
MAX_SESSIONS = 100
MAX_HISTORY = 10


class HiRamHandler(BaseHTTPRequestHandler):

    def send_json(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/health":
            self.send_json(404, {"error": "Not found"})
            return

        self.send_json(200, {
            "status": "ok",
            "service": "Hi Ram Backend"
        })

    def do_POST(self):
        if self.path != "/chat":
            self.send_json(404, {"error": "Not found"})
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
            message = str(data.get("message", "")).strip()
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

            with sessions_lock:
                if session_id not in sessions:
                    if len(sessions) >= MAX_SESSIONS:
                        oldest = next(iter(sessions))
                        del sessions[oldest]

                    sessions[session_id] = deque(maxlen=MAX_HISTORY)

                history = list(sessions[session_id])
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
                sessions[session_id].append({
                    "role": "user",
                    "parts": [{"text": message}]
                })
                sessions[session_id].append({
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

    def log_message(self, format, *args):
        print("Hi Ram:", args[0])


if __name__ == "__main__":
    HOST = "0.0.0.0"
    PORT = int(os.environ.get("PORT", "8000"))

    server = ThreadingHTTPServer((HOST, PORT), HiRamHandler)
    print(f"Hi Ram backend running on {HOST}:{PORT}")
    print("Model:", MODEL)
    server.serve_forever()
