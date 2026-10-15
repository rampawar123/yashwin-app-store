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


## Deploy to GitHub Pages (fix for blank white page)

This repository is a Vite + React + TypeScript app. **Do not publish the source `index.html`/`src` files directly as a static site**; GitHub Actions must build them into `dist/` first.

1. Upload/commit the complete repository contents to the `main` branch of `rampawar123/yashwin-app-store`.
2. In GitHub, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.
3. Open **Actions → Deploy YASHWIN APP STORE to GitHub Pages** and wait for the workflow to finish successfully.
4. Open `https://rampawar123.github.io/` and refresh. The workflow deploys the generated `dist/` folder.
5. If an older service worker keeps showing a cached page, clear the site data for `rampawar123.github.io` in the browser and reopen the site.

The workflow above builds with `npm ci` and `npm run build`, verifies `dist/index.html`, and deploys the build artifact. The separate APK build workflow remains in place.
