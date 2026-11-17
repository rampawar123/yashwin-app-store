
export interface InstalledApp {
  id: string;
  installed: boolean;
  packageName: string;
  versionCode: number;
  versionName: string;
}

interface NativeResponse {
  requestId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

interface PendingRequest {
  resolve: (value: NativeResponse) => void;
  reject: (reason: Error) => void;
}

interface NativeBridgeObject {
  postMessage: (message: string) => void;
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent) => void
  ) => void;
}

declare global {
  interface Window {
    YashwinNative?: NativeBridgeObject;
  }
}

const pending = new Map<string, PendingRequest>();
let requestCounter = 0;
let listenerReady = false;

function setupListener(): void {
  const bridge = window.YashwinNative;
  if (!bridge || listenerReady) return;

  bridge.addEventListener('message', (event: MessageEvent) => {
    try {
      const response = JSON.parse(
        String(event.data)
      ) as NativeResponse;

      const request = pending.get(response.requestId);
      if (!request) return;

      pending.delete(response.requestId);

      if (response.ok) {
        request.resolve(response);
      } else {
        request.reject(
          new Error(response.error || 'Native request failed.')
        );
      }
    } catch {
      // Ignore malformed native responses.
    }
  });

  listenerReady = true;
}

function sendRequest(
  action: string,
  extra: Record<string, string> = {}
): Promise<NativeResponse> {
  const bridge = window.YashwinNative;

  if (!bridge) {
    return Promise.reject(
      new Error('Native updater is available only in the Android Store app.')
    );
  }

  setupListener();

  const requestId = `store-${Date.now()}-${++requestCounter}`;

  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });

    try {
      bridge.postMessage(JSON.stringify({
        requestId,
        action,
        ...extra
      }));
    } catch (error) {
      pending.delete(requestId);
      reject(
        error instanceof Error ? error : new Error('Native bridge failed.')
      );
    }
  });
}

export async function getInstalledApps(): Promise<InstalledApp[]> {
  const response = await sendRequest('getInstalledApps');
  return Array.isArray(response.data)
    ? response.data as InstalledApp[]
    : [];
}

export async function installNativeApp(appId: string): Promise<void> {
  await sendRequest('installApp', { appId });
}

export function isNativeStore(): boolean {
  return typeof window !== 'undefined'
    && Boolean(window.YashwinNative);
}
