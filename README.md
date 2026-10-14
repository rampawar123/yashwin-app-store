# YASHWIN APP STORE (React + Vite + TypeScript)

Discover, download, and enjoy useful Android apps directly synced from GitHub, including **VANSH CALCULATOR** and **CRIC YUVA 2**.

## Features

- **Dynamic GitHub APK Detection**: Reads the latest APK releases directly from GitHub repository trees (`rampawar123/yashwin-app-store`), parses version numbers, computes release scores, and flags available updates.
- **In-App Launchers**:
  - **Vansh Calculator**: Full offline-first interactive calculator with calculation history, saved maths, totals, percentage, backspace, and keyboard shortcuts.
  - **Cric Yuva 2**: Live cricket scorekeeper featuring limited-overs match configuration, toss and openers selection, ball-by-ball scorepad, batsman/bowler statistics, over rotation, and match results.
- **Fast Search & Filter**: Real-time filtering by app name, description, and keywords.
- **Sharing**: Integrated Web Share API with clipboard copy fallbacks.
- **Dark Neon Theme**: True-to-brand navy & gold styling.

## Tech Stack

- React 19
- Vite 6
- TypeScript
- Tailwind CSS v4

## Running Locally

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```
