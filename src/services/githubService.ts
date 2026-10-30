
import { AppDefinition, CatalogApp } from '../types';

export const OWNER = 'rampawar123';
export const REPO = 'yashwin-app-store';
export const BRANCH = 'main';

export const API_URL =
  `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`;

export const UPDATE_STORAGE_KEY = 'yashwinStoreApkStateV2';

export const APP_DEFINITIONS: AppDefinition[] = [
  {
    id: 'calculator',
    name: 'VANSH CALCULATOR',
    keys: ['vansh', 'calculator'],
    desc: 'Fast • Simple • Accurate calculation suite with history & saved maths',
    icon: `${import.meta.env.BASE_URL}calculator-logo.png`,
    fallbackIcon: `${import.meta.env.BASE_URL}icon-512.png`,
    openType: 'calculator',
    apkKeywords: ['vansh', 'calculator'],
    defaultApk: `${import.meta.env.BASE_URL}VANSH-CALCULATOR.apk`
  },
  {
    id: 'cric-yuva',
    name: 'CRIC YUVA',
    keys: ['cric-yuva', 'cric yuva', 'cric', 'cricket', 'yuva'],
    desc: 'Live Cricket Score • Teams • Match ID • Scorecard • Real-time stats',
    icon: `${import.meta.env.BASE_URL}cric-yuva-2-logo.png`,
    fallbackIcon: `${import.meta.env.BASE_URL}icon-512.png`,
    openType: 'cric-yuva',
    apkKeywords: ['cric-yuva-2', 'cric yuva', 'cric', 'yuva'],
    defaultApk: `${import.meta.env.BASE_URL}CRIC-YUVA.apk`
  },
  {
    id: 'hi-ram',
    name: 'HI RAM',
    keys: ['hi-ram', 'hi ram', 'hiram'],
    desc: 'Voice Controlled Android Assistant • Hindi Voice Commands • User-controlled Accessibility',
    icon: `${import.meta.env.BASE_URL}hi-ram-android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png`,
    fallbackIcon: `${import.meta.env.BASE_URL}hi-ram-android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png`,
    openType: 'hi-ram',
    apkKeywords: ['hi-ram', 'hiram'],
    defaultApk: `${import.meta.env.BASE_URL}HI-RAM.apk`
  },
  {
    id: 'store',
    name: 'YASHWIN APP STORE',
    keys: ['yashwin', 'store'],
    desc: 'Your App Hub • Direct APK Downloads • Always Updated from GitHub',
    icon: `${import.meta.env.BASE_URL}icon-512.png`,
    fallbackIcon: `${import.meta.env.BASE_URL}icon-512.png`,
    openType: 'external',
    apkKeywords: ['app-release-signed'],
    defaultApk: '/app-release-signed.apk'
  }
];

export function scoreFile(path: string, keys: string[]): number {
  const p = path.toLowerCase();

  if (!p.endsWith('.apk')) return -1;

  let score = 0;

  for (const key of keys) {
    if (p.includes(key.toLowerCase())) {
      score += 5;
    }
  }

  if (p.includes('debug')) score -= 3;
  if (p.includes('release')) score += 1;

  return score;
}

export function parseVersion(path: string): string {
  const match = path.match(
    /(?:v|version[-_ ]?)(\d+(?:\.\d+){0,2})/i
  );

  return match ? `Version ${match[1]}` : 'Latest';
}

export function rawGithubUrl(path: string): string {
  const encoded = path
    .split('/')
    .map(encodeURIComponent)
    .join('/');

  return `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${encoded}?v=${Date.now()}`;
}

export const PENDING_UPDATES_KEY = 'yashwinStorePendingUpdatesV1';

export function readPendingUpdates(): Record<string, string> {
  try {
    return JSON.parse(
      localStorage.getItem(PENDING_UPDATES_KEY) || '{}'
    );
  } catch {
    return {};
  }
}

export function writePendingUpdates(
  state: Record<string, string>
): void {
  try {
    localStorage.setItem(
      PENDING_UPDATES_KEY,
      JSON.stringify(state)
    );
  } catch {
    // Ignore storage errors
  }
}

export function clearPendingUpdate(appId: string): void {
  const pending = readPendingUpdates();

  delete pending[appId];

  writePendingUpdates(pending);
}

export function readStoredShaState(): Record<string, string> {
  try {
    return JSON.parse(
      localStorage.getItem(UPDATE_STORAGE_KEY) || '{}'
    );
  } catch {
    return {};
  }
}

export function writeStoredShaState(
  state: Record<string, string>
): void {
  try {
    localStorage.setItem(
      UPDATE_STORAGE_KEY,
      JSON.stringify(state)
    );
  } catch {
    // Ignore storage errors
  }
}

export interface FetchResult {
  catalog: CatalogApp[];
  hasAnyUpdate: boolean;
  message: string;
  isOnline: boolean;
  lastCheckedTime: string;
}

export async function fetchLatestGithubCatalog(): Promise<FetchResult> {
  const previousShaMap = readStoredShaState();
  const nextShaMap: Record<string, string> = {};
  const pendingUpdates = readPendingUpdates();

  try {
    const response = await fetch(
      `${API_URL}&t=${Date.now()}`,
      {
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `GitHub API HTTP ${response.status}`
      );
    }

    const data = await response.json();

    const files: Array<{
      path: string;
      sha: string;
      type: string;
    }> = (data.tree || []).filter(
      (item: { type: string }) => item.type === 'blob'
    );

    const catalog: CatalogApp[] = APP_DEFINITIONS.map(app => {
      const candidates = files
        .filter(file => scoreFile(file.path, app.apkKeywords) >= 0)
        .sort((a, b) => {
          const scoreDifference =
            scoreFile(b.path, app.apkKeywords) -
            scoreFile(a.path, app.apkKeywords);

          if (scoreDifference !== 0) {
            return scoreDifference;
          }

          return a.path.length - b.path.length;
        });

      const chosen = candidates[0];
      const sha = chosen?.sha || '';

      const previousSha =
        previousShaMap[app.id] ||
        previousShaMap[app.name] ||
        '';

      if (chosen && previousSha && previousSha !== sha) {
        pendingUpdates[app.id] = sha;
      }

      if (
        chosen &&
        pendingUpdates[app.id] &&
        pendingUpdates[app.id] !== sha
      ) {
        pendingUpdates[app.id] = sha;
      }

      const hasChanged = Boolean(
        chosen && pendingUpdates[app.id]
      );

      if (chosen) {
        nextShaMap[app.id] = sha;
      }

      return {
        ...app,
        apkUrl: chosen
          ? rawGithubUrl(chosen.path)
          : (app.defaultApk || ''),
        version: chosen
          ? parseVersion(chosen.path)
          : 'APK not uploaded',
        updatedLabel: chosen
          ? `GitHub file: ${chosen.path}`
          : 'APK not uploaded yet',
        isLatest: Boolean(chosen),
        hasUpdate: hasChanged,
        sha
      };
    });

    writeStoredShaState(nextShaMap);
    writePendingUpdates(pendingUpdates);

    const changedAny =
      Object.keys(pendingUpdates).length > 0;

    const timeString = new Date().toLocaleTimeString();

    return {
      catalog,
      hasAnyUpdate: changedAny,
      message: changedAny
        ? `UPDATE AVAILABLE — New APK detected from GitHub • ${timeString}`
        : `GitHub connected • App files checked • ${timeString}`,
      isOnline: true,
      lastCheckedTime: timeString
    };
  } catch {
    const fallbackCatalog: CatalogApp[] =
      APP_DEFINITIONS.map(app => ({
        ...app,
        apkUrl: app.defaultApk || '',
        version: 'APK not uploaded yet',
        updatedLabel: 'Offline / Cached Catalog',
        isLatest: false,
        hasUpdate: false
      }));

    return {
      catalog: fallbackCatalog,
      hasAnyUpdate: false,
      message:
        'GitHub check unavailable. Check internet connection and try again.',
      isOnline: false,
      lastCheckedTime: new Date().toLocaleTimeString()
    };
  }
}
