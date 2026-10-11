# YASHWIN AI Trading Assistant

Production-hardened, AI-powered Indian & Global market analysis, strategy evaluation, backtesting, and **Paper Trading** platform with Web App, Progressive Web App (PWA), and Android WebView shell.

## Core Safety & Trading Mode Guarantees

- **Strict Paper Mode Only:** `TRADING_MODE=paper` and `LIVE_TRADING_ENABLED=false` are enforced at the server configuration and API boundary.
- **Zero Live Broker Order Execution:** No live broker order placement endpoints exist (`/api/order/*` returns `404`). All trades are virtual paper fills validated by `RiskEngine`, `StrategyEngine`, `AISafetyGate`, and `Emergency Stop`.
- **Single Authoritative SQLite Database:** All 26 tables reside in `server/data/yashwin-trading.sqlite` (Schema Version 9, WAL mode, Foreign Keys enabled, secret redaction enforced).
- **Zero Client-Side Secret Exposure:** Broker (`ANGEL_*`), AI (`GEMINI_API_KEY`), intelligence (`FINNHUB_*`, `ALPHA_VANTAGE_*`), and notification (`TELEGRAM_*`) credentials are read exclusively on the server from environment variables.

---

## Quick Start & Production Scripts

```bash
# 1. Install dependencies
npm ci

# 2. Configure environment variables (never commit .env)
cp .env.example .env

# 3. Start production server (binds to API_HOST=0.0.0.0, PORT=3000)
npm run start:prod

# 4. Run non-destructive production readiness & health verification
npm run verify:prod

# 5. Run non-destructive SQLite schema & integrity audit
npm run db:audit

# 6. Create an atomic SQLite backup (VACUUM INTO server/data/backups/)
npm run db:backup

# 7. Run automated test suite (uses isolated :memory: / temp DBs; never touches production DB)
npm test
```

---

## Canonical SQLite Database & Persistent Storage

- **Default Path:** `server/data/yashwin-trading.sqlite` (override via `YASHWIN_DB_PATH`).
- **Migrations:** Idempotent startup migrations (`v1` through `v9`) automatically initialize or upgrade all 26 tables without deleting or overwriting existing user records.
- **Atomic Backups:** Because SQLite runs with `PRAGMA journal_mode = WAL`, never copy raw `.sqlite` files while transactions are active without including `.sqlite-wal`. Always run `npm run db:backup` (`node server/db-backup.js [destination.sqlite]`), which checkpoints WAL frames and executes an atomic `VACUUM INTO` snapshot followed by a read-only `PRAGMA quick_check` verification.
- **Graceful Shutdown:** On `SIGTERM` / `SIGINT`, `server/api-server.js` stops accepting new connections, checkpoints the WAL (`TRUNCATE`), and cleanly closes the SQLite connection.

---

## Container & Cloud Deployment

### Option A: Docker / Docker Compose (VPS, Cloud Run, Railway, Fly.io)
The repository includes a production `Dockerfile` (Node 22 slim, non-root `node` user, built-in `HEALTHCHECK` on `/api/health`) and `docker-compose.yml` mounting a persistent named volume (`yashwin_sqlite_data`) at `/app/server/data`:

```bash
docker compose up -d --build
docker compose ps
```

### Option B: Render Blueprint (`render.yaml`)
The included `render.yaml` provisions a Node web service with:
- Health check path `/api/health`
- Persistent 1 GB disk mounted at `/opt/render/project/src/server/data`
- Locked `TRADING_MODE=paper` and `LIVE_TRADING_ENABLED=false`

---

## Health, Readiness & Audit Endpoints

| Endpoint | Purpose |
| :--- | :--- |
| `GET /api/health` | Liveness, trading mode (`paper`), `liveTradingEnabled: false`, `orderEndpoints: "NONE"`, provider readiness, and SQLite status |
| `GET /api/readiness` / `GET /api/readiness/audit` | Complete live-readiness gate audit, production environment validation, and database integrity report |
| `GET /api/database/audit` | Non-destructive SQLite `PRAGMA quick_check`, foreign key check, schema version (`9`), and secret-redaction invariant verification |

---

## Android Client & Production Backend URL

The Android project (`android/`) uses `YASHWIN_PROD_BASE_URL` in `android/gradle.properties` (or `-PYASHWIN_PROD_BASE_URL=https://your-production-domain.com`) to connect to the deployed HTTPS backend:

```bash
cd android
./gradlew assembleDebug -PYASHWIN_PROD_BASE_URL=https://your-production-domain.com
```
- **Why `localhost` does not work on a physical phone:** On a physical Android phone, `localhost` (`127.0.0.1`) refers to the phone's own loopback interface, not your computer or cloud server. Use an HTTPS production domain for physical devices, or `http://10.0.2.2:3000` inside the Android Emulator.

### Mobile-Only Android Debug APK Build via GitHub Actions (`.github/workflows/android-debug-apk.yml`)

When developing solely from an Android phone without Android Studio or a local Android SDK:

1. **Workflow File:** `.github/workflows/android-debug-apk.yml` (`Build Android Debug APK (Paper Mode Only)`).
2. **Backend URL Configuration (Zero Secrets):**
   - Optional GitHub Repository Variable: `YASHWIN_BACKEND_URL` (or `YASHWIN_PROD_BASE_URL`) under **Settings → Secrets and variables → Actions → Variables**.
   - Optional Manual Run Input: `backend_url` when triggering `workflow_dispatch`.
   - Default Fallback: `YASHWIN_PROD_BASE_URL` in `android/gradle.properties` (`https://ais-pre-tuksbxdpaeqeyjl35z77of-346280624125.asia-southeast1.run.app`).
   - Validation: Rejects empty URLs, non-HTTPS schemes (except `http://10.0.2.2` for emulator), and `localhost` / `127.0.0.1`.
3. **Triggering & Downloading from a Mobile Browser / GitHub App:**
   - Open your GitHub repository → **Actions** tab → select **Build Android Debug APK (Paper Mode Only)**.
   - Tap **Run workflow** (optionally enter an HTTPS `backend_url`) and wait for the job to complete.
   - Scroll to **Artifacts** on the completed workflow run summary page and download **`yashwin-ai-trading-debug-apk`** (`app-debug.apk`).

---

## Mobile-Friendly GitHub Synchronization (`rampawar123/yashwin-ai-trading`)

When pushing changes from Google AI Studio or a mobile browser to the private GitHub repository `rampawar123/yashwin-ai-trading`:

1. **Option 1: Google AI Studio Built-in GitHub Sync (Recommended on Mobile)**
   - In the Google AI Studio top toolbar, tap the **GitHub / Export to GitHub** icon.
   - Authenticate your GitHub account (`rampawar123`) and select the existing repository **`rampawar123/yashwin-ai-trading`** (branch: `main`).
   - Confirm the commit and push. Because `.gitignore` excludes `node_modules/`, `.env*` (except `.env.example`), `server/data/*.sqlite*`, `server/data/backups/`, `*.jks`, `*.keystore`, `*.apk`, and `*.aab`, only the 102 verified source, test, Android, and workflow files are synchronized.

2. **Option 2: Git CLI / Termux / Cloud Shell (Non-Destructive Fast-Forward Sync)**
   ```bash
   git remote -v
   # origin  https://github.com/rampawar123/yashwin-ai-trading.git (fetch/push)

   # Fetch existing remote history first (never force-push)
   git fetch origin main
   git pull --rebase origin main
   git push -u origin main
   ```
