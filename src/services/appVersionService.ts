import { OWNER, REPO, BRANCH } from './githubService';
import { InstalledApp, getInstalledApps } from './nativeBridge';

export interface RemoteAppVersion {
  packageName: string;
  versionCode: number;
  versionName: string;
  apkFile: string;
}

interface VersionManifest {
  schemaVersion: number;
  generatedAt: string;
  apps: Record<string, RemoteAppVersion>;
}

export async function fetchAppVersionManifest(): Promise<VersionManifest> {
  const url =
    `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/app-versions.json?t=${Date.now()}`;

  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Version manifest unavailable: HTTP ${response.status}`);
  }

  const manifest = await response.json() as VersionManifest;

  if (
    manifest.schemaVersion !== 1 ||
    !manifest.apps ||
    typeof manifest.apps !== 'object'
  ) {
    throw new Error('Invalid app version manifest.');
  }

  for (const id of ['calculator', 'cric-yuva', 'hi-ram']) {
    const app = manifest.apps[id];

    if (
      !app ||
      !Number.isSafeInteger(app.versionCode) ||
      app.versionCode < 1 ||
      typeof app.packageName !== 'string' ||
      typeof app.apkFile !== 'string'
    ) {
      throw new Error(`Invalid version information for ${id}.`);
    }
  }

  return manifest;
}

export async function fetchInstalledApps(): Promise<InstalledApp[]> {
  return getInstalledApps();
}

export function isAppUpdateAvailable(
  remote: RemoteAppVersion,
  installed: InstalledApp | undefined
): boolean {
  if (!installed || !installed.installed) return false;

  return remote.versionCode > installed.versionCode;
}
