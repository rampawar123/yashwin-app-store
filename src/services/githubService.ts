import { AppDefinition, CatalogApp } from '../types';

export const OWNER = 'rampawar123';
export const REPO = 'yashwin-app-store';
export const BRANCH = 'main';
export const API_URL = `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`;
export const UPDATE_STORAGE_KEY = 'yashwinStoreApkStateV2';

export const APP_DEFINITIONS: AppDefinition[] = [
  {
    id: 'calculator',
    name: 'VANSH CALCULATOR',
    keys: ['vansh', 'calculator'],
    desc: 'Fast • Simple • Accurate calculation suite with history & saved maths',
    icon: '/yashwin-app-store/calculator-logo.png',
    fallbackIcon: '/yashwin-app-store/icon-512.png',
    openType: 'calculator',
    apkKeywords: ['vansh', 'calculator'],
    defaultApk: '/VANSH-CALCULATOR.apk'
  },
  {
    id: 'cric-yuva',
    name: 'CRIC YUVA',
    keys: ['cric-yuva', 'cric yuva', 'cric', 'cricket', 'yuva'],
    desc: 'Live Cricket Score • Teams • Match ID • Scorecard • Real-time stats',
    icon: '/yashwin-app-store/cric-yuva-2-logo.png',
    fallbackIcon: '/yashwin-app-store/icon-512.png',
    openType: 'cric-yuva',
    apkKeywords: ['cric-yuva-2', 'cric yuva', 'cric', 'yuva'],
    defaultApk: '/CRIC-YUVA.apk'
  },
  {
    id: 'store',
    name: 'YASHWIN APP STORE',
    keys: ['yashwin', 'store'],
    desc: 'Your App Hub • Direct APK Downloads • Always Updated from GitHub',
    icon: '/yashwin-app-store/icon-512.png',
    fallbackIcon: '/yashwin-app-store/icon-512.png',
    openType: 'external',
    apkKeywords: ['app-release-signed'],
    defaultApk: '/app-release-signed.apk'
  }
];

export function scoreFile(path: string, keys: string[]): number {
  const p = path.toLowerCase();
  if (!p.endsWith('.apk')) return -1;
  let score = 0;
  for (const k of keys) {
    if (p.includes(k.toLowerCase())) score += 5;
  }
  if (p.includes('debug')) score -= 3;
  if (p.includes('release')) score += 1;
  return score;
}

export function parseVersion(path: string): string {
  const m = path.match(/(?:v|version[-_ ]?)(\d+(?:\.\d+){0,2})/i);
  return m ? 'Version ' + m[1] : 'Latest';
}

export function rawGithubUrl(path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${encoded}?v=${Date.now()}`;
}

export const PENDING_UPDATES_KEY = 'yashwinStorePendingUpdatesV1';

export function readPendingUpdates(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PENDING_UPDATES_KEY) || '{}');
  } catch {
    return {};
  }
}

export function writePendingUpdates(state: Record<string, string>): void {
  try {
    localStorage.setItem(PENDING_UPDATES_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function clearPendingUpdate(appId: string): void {
  const pending = readPendingUpdates();
  delete pending[appId];
  writePendingUpdates(pending);
}

export function readStoredShaState(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(UPDATE_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function writeStoredShaState(state: Record<string, string>): void {
  try {
    localStorage.setItem(UPDATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
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
  let changedAny = false;

  try {
    const res = await fetch(`${API_URL}&t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json'
      }
    });

    if (!res.ok) {
      throw new Error(`GitHub API HTTP ${res.status}`);
    }

    const data = await res.json();
    const files: Array<{ path: string; sha: string; type: string }> = (data.tree || []).filter(
      (x: { type: string }) => x.type === 'blob'
    );

    const catalog: CatalogApp[] = APP_DEFINITIONS.map(app => {
      const candidates = files
        .filter(f => scoreFile(f.path, app.apkKeywords) >= 0)
        .sort((a, b) => {
          const scoreDiff = scoreFile(b.path, app.apkKeywords) - scoreFile(a.path, app.apkKeywords);
          if (scoreDiff !== 0) return scoreDiff;
          return a.path.length - b.path.length;
        });

      const chosen = candidates[0];
      const sha = chosen?.sha || '';
      const previousSha = previousShaMap[app.id] || previousShaMap[app.name] || '';
      if (chosen && previousSha && previousSha !== sha) pendingUpdates[app.id] = sha;
      if (chosen && pendingUpdates[app.id] && pendingUpdates[app.id] !== sha) pendingUpdates[app.id] = sha;
      const hasChanged = Boolean(chosen && pendingUpdates[app.id]);

      if (hasChanged) {
        changedAny = true;
      }
      if (chosen) {
        nextShaMap[app.id] = sha;
      }

      return {
        ...app,
        apkUrl: chosen ? rawGithubUrl(chosen.path) : (app.defaultApk || ''),
        version: chosen ? parseVersion(chosen.path) : 'Version 2.0',
        updatedLabel: chosen ? `GitHub file: ${chosen.path}` : 'Bundled release APK',
        isLatest: Boolean(chosen),
        hasUpdate: hasChanged,
        sha
      };
    });

    writeStoredShaState(nextShaMap);
    writePendingUpdates(pendingUpdates);
    changedAny = Object.keys(pendingUpdates).length > 0;

    const timeStr = new Date().toLocaleTimeString();
    return {
      catalog,
      hasAnyUpdate: changedAny,
      message: changedAny
        ? `UPDATE AVAILABLE — New APK detected from GitHub • ${timeStr}`
        : `GitHub connected • Latest app files checked automatically • ${timeStr}`,
      isOnline: true,
      lastCheckedTime: timeStr
    };
  } catch {
    // Fallback using bundled files
    const fallbackCatalog: CatalogApp[] = APP_DEFINITIONS.map(app => ({
      ...app,
      apkUrl: app.defaultApk || '',
      version: 'Version 2.0',
      updatedLabel: 'Offline / Cached Catalog',
      isLatest: true,
      hasUpdate: false
    }));

    return {
      catalog: fallbackCatalog,
      hasAnyUpdate: false,
      message: 'GitHub check unavailable. Check internet connection and try again.',
      isOnline: false,
      lastCheckedTime: new Date().toLocaleTimeString()
    };
  }
}
