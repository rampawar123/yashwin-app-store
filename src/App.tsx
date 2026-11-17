import React, { useState, useEffect, useCallback } from 'react';
import { CatalogApp } from './types';
import { fetchLatestGithubCatalog, APP_DEFINITIONS, clearPendingUpdate, rawGithubUrl } from './services/githubService';
import { fetchAppVersionManifest, fetchInstalledApps, isAppUpdateAvailable, RemoteAppVersion } from './services/appVersionService';
import { InstalledApp, isNativeStore, installNativeApp } from './services/nativeBridge';
import { Header } from './components/Header';
import { SearchBox } from './components/SearchBox';
import { AboutSection } from './components/AboutModal';
import { AppCard } from './components/AppCard';
import { AutoUpdateSection } from './components/AutoUpdateSection';
import { Footer } from './components/Footer';
import { VanshCalculatorModal } from './components/VanshCalculatorModal';
import { CricYuvaModal } from './components/CricYuvaModal';
import { HiRamModal } from './components/HiRamModal';
import { Toast } from './components/Toast';
export const App: React.FC = () => {
  const [catalog, setCatalog] = useState<CatalogApp[]>(() =>
    APP_DEFINITIONS.map(app => ({
      ...app,
      apkUrl: app.defaultApk || '',
      version: 'Version 2.0',
      updatedLabel: 'Bundled APK release',
      isLatest: true,
      hasUpdate: false
    }))
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState('all');
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [statusText, setStatusText] = useState('GitHub status: checking latest APK files…');
  const [activeModal, setActiveModal] = useState<'calculator' | 'cric-yuva' | 'hi-ram' | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  const checkingRef = React.useRef(false);
  const [installedVersions, setInstalledVersions] = useState<Record<string, InstalledApp>>({});
const [remoteVersions, setRemoteVersions] = useState<Record<string, RemoteAppVersion>>({});
const [updateQueue, setUpdateQueue] = useState<string[]>([]);
const [isInstalling, setIsInstalling] = useState(false);
  const refreshCatalog = useCallback(async (manual: boolean = false) => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setIsChecking(true);
    setStatusText('GitHub status: checking latest APK files…');

    try {
      const result = await fetchLatestGithubCatalog();
      let nextCatalog = result.catalog;

      if (isNativeStore()) {
        try {
          const [manifest, installed] = await Promise.all([
            fetchAppVersionManifest(),
            fetchInstalledApps()
          ]);

          const installedMap: Record<string, InstalledApp> = {};
          const remoteMap: Record<string, RemoteAppVersion> = {};

          for (const app of installed) installedMap[app.id] = app;

          for (const id of ['calculator', 'cric-yuva', 'hi-ram']) {
            const remote = manifest.apps[id];
            if (remote) remoteMap[id] = remote;
          }

          setInstalledVersions(installedMap);
          setRemoteVersions(remoteMap);

          nextCatalog = nextCatalog.map(app => {
            const remote = remoteMap[app.id];
            if (!remote || app.id === 'store') return app;

            const local = installedMap[app.id];
            const hasUpdate = isAppUpdateAvailable(remote, local);

            return {
              ...app,
              apkUrl: rawGithubUrl(remote.apkFile),
              version: remote.versionName || `Version ${remote.versionCode}`,
              updatedLabel: `GitHub version ${remote.versionCode}`,
              hasUpdate,
              isLatest: Boolean(local?.installed) && !hasUpdate
            };
          });
        } catch (error) {
          console.warn('Native version check unavailable:', error);
        }
      }

      setCatalog(nextCatalog);
      setStatusText(result.message);

      if (manual) {
        showToast(
          nextCatalog.some(app => app.hasUpdate)
            ? 'New app update detected!'
            : result.isOnline
              ? 'Store is up to date with the latest GitHub files.'
              : 'GitHub check failed. Please try again later.'
        );
      }
    } catch {
      setStatusText('GitHub check failed. Please try again later.');
      if (manual) showToast('GitHub check failed. Please try again later.');
    } finally {
      checkingRef.current = false;
      setIsChecking(false);
    }
  }, [showToast]);
  useEffect(() => {
    void refreshCatalog(false);

    const interval = setInterval(() => {
      if (!document.hidden) void refreshCatalog(false);
    }, 5 * 60 * 1000);

    let verifyingQueue = false;

    const handleVisibility = async () => {
      if (document.hidden) return;
      void refreshCatalog(false);

      if (!isNativeStore() || !isInstalling || updateQueue.length === 0 || verifyingQueue) return;
      verifyingQueue = true;

      try {
        await new Promise(resolve => setTimeout(resolve, 1500));
        if (document.hidden) return;

        const currentId = updateQueue[0];
        const [manifest, installed] = await Promise.all([
          fetchAppVersionManifest(),
          fetchInstalledApps()
        ]);
        const remote = manifest.apps[currentId];
        const local = installed.find(app => app.id === currentId);

        if (remote && local?.installed && local.versionCode >= remote.versionCode) {
          const remaining = updateQueue.slice(1);
          setUpdateQueue(remaining);

          if (remaining.length > 0) {
            await installNativeApp(remaining[0]);
            showToast('Update verified. Installing next app: ' + remaining[0]);
          } else {
            setIsInstalling(false);
            showToast('All queued app updates were installed and verified.');
          }
        } else {
          setUpdateQueue([]);
          setIsInstalling(false);
          showToast('Installation was cancelled or not verified. Remaining updates stopped.');
        }
      } catch (error) {
        setUpdateQueue([]);
        setIsInstalling(false);
        showToast(error instanceof Error ? error.message : 'Could not verify installation. Queue stopped.');
      } finally {
        verifyingQueue = false;
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshCatalog, isInstalling, updateQueue, showToast]);

  const handleOpenApp = (app: CatalogApp) => {
    if (app.openType === 'calculator') {
      setActiveModal('calculator');
    } else if (app.openType === 'cric-yuva') {
      setActiveModal('cric-yuva');
    } else if (app.openType === 'hi-ram') {
      setActiveModal('hi-ram');
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast('You are already browsing YASHWIN APP STORE.');
    }
  };

  const handleUpdateAll = async () => {
    const pendingApps = catalog.filter(app => app.hasUpdate && app.apkUrl && app.id !== 'store');

    if (pendingApps.length === 0) {
      showToast('No app updates are currently available.');
      return;
    }

    if (isNativeStore()) {
      const ids = pendingApps
        .filter(app => remoteVersions[app.id])
        .map(app => app.id);

      if (ids.length === 0) {
        showToast('Native version information is unavailable. Refresh and try again.');
        return;
      }

      setUpdateQueue(ids);
      setIsInstalling(true);

      try {
        await installNativeApp(ids[0]);
        showToast('Installing ' + pendingApps.find(app => app.id === ids[0])?.name + '. Return to Store after installation.');
      } catch (error) {
        setUpdateQueue([]);
        setIsInstalling(false);
        showToast(error instanceof Error ? error.message : 'Could not start installation.');
      }
      return;
    }

    pendingApps.forEach(app => {
      const link = document.createElement('a');
      link.href = app.apkUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.download = app.apkUrl.split('/').pop()?.split('?')[0] || app.id + '.apk';
      document.body.appendChild(link);
      link.click();
      link.remove();
    });

    showToast('Started download requests for ' + pendingApps.length + ' app update(s).');
  };

  const handleShare = async (app: CatalogApp) => {
    const url = 'https://rampawar123.github.io/yashwin-app-store/';
    const title = `${app.name} - YASHWIN APP STORE`;
    const text = `Check out ${app.name} on YASHWIN APP STORE: ${app.desc}`;

    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
      } catch {
        // User cancelled share
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        showToast(`Link for ${app.name} copied to clipboard!`);
      } catch {
        showToast(url);
      }
    }
  };

  const handleShowApps = () => {
    setIsAboutOpen(false);
    const elem = document.getElementById('available-apps-section');
    if (elem) {
      elem.scrollIntoView({ behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const filteredApps = catalog.filter(app => {
    const categoryMatches =
      activeCategory === 'all' ||
      (activeCategory === 'android' && ['calculator', 'cric-yuva'].includes(app.id)) ||
      (activeCategory === 'tools' && app.id === 'calculator') ||
      (activeCategory === 'games' && app.id === 'cric-yuva') ||
      (activeCategory === 'others' && app.id === 'store');

    const q = searchQuery.toLowerCase().trim();
    const combined = `${app.name} ${app.desc} ${app.keys.join(' ')}`.toLowerCase();
    return categoryMatches && (!q || combined.includes(q));
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden selection:bg-[#ffb21a] selection:text-black" style={{ height: "100dvh" }}>
      {/* Header */}
      <Header
        onShowApps={handleShowApps}
        onToggleAbout={() => setIsAboutOpen(prev => !prev)}
        onRefresh={() => refreshCatalog(true)}
        isChecking={isChecking}
        onToggleSearch={() => setIsSearchOpen(prev => !prev)}
        isSearchOpen={isSearchOpen}
      />

      {/* Main Container */}
      <main className="mx-auto flex min-h-0 w-[calc(100%-20px)] max-w-[1120px] flex-1 flex-col overflow-hidden sm:w-[calc(100%-28px)]">

        {/* Search */}
        <SearchBox
          searchQuery={searchQuery}
          isSearchOpen={isSearchOpen}
          onSearchChange={setSearchQuery}
          onClear={() => setSearchQuery('')}
          activeCategory={activeCategory}
          onCategoryChange={(category) => {
            setActiveCategory(category);
            if (category === 'all') setSearchQuery('');
          }}
        />


        {/* About Expandable Card */}
        <AboutSection
          isOpen={isAboutOpen}
          onClose={() => setIsAboutOpen(false)}
        />

        <div id="available-apps-section" className="mb-4" />

        {/* Apps Grid/List */}
        <section className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain touch-pan-y grid content-start gap-3.5 pb-4" style={{ WebkitOverflowScrolling: "touch" }}>
          {filteredApps.length === 0 ? (
            <div className="p-12 text-center bg-[#0b1a2b]/80 border border-[#21425f] rounded-2xl text-[#9db0c6]">
              <div className="text-3xl mb-2">🔍</div>
              <p className="text-base text-white font-bold">No apps found matching &quot;{searchQuery}&quot;</p>
              <button
                onClick={() => setSearchQuery('')}
                className="mt-3 text-xs text-[#ffb21a] font-semibold underline cursor-pointer"
              >
                Clear Search
              </button>
            </div>
          ) : (
            filteredApps.map(app => (
              <AppCard
                key={app.id}
                app={app}
                onOpenApp={handleOpenApp}
                onShare={handleShare}
                onUpdate={async (selectedApp) => {
                  if (!selectedApp.apkUrl) {
                    showToast('APK is not available.');
                    return;
                  }
                  if (isNativeStore() && selectedApp.id !== 'store') {
                    try {
                      await installNativeApp(selectedApp.id);
                      showToast('Installing ' + selectedApp.name + '. Return to Store after installation.');
                    } catch (error) {
                      showToast(error instanceof Error ? error.message : 'Could not start installation.');
                    }
                    return;
                  }
                  const link = document.createElement('a');
                  link.href = selectedApp.apkUrl;
                  link.download = selectedApp.apkUrl.split('/').pop()?.split('?')[0] || selectedApp.id + '.apk';
                  link.target = '_blank';
                  link.rel = 'noopener noreferrer';
                  document.body.appendChild(link);
                  link.click();
                  link.remove();
                  showToast('Downloading ' + selectedApp.name + ' update.');
                }}
              />
            ))
          )}
        </section>

        {/* Automatic Updates Section */}
        <AutoUpdateSection
          statusText={statusText}
          isChecking={isChecking}
          onRefresh={() => refreshCatalog(true)}
          onUpdateAll={handleUpdateAll}
          pendingCount={catalog.filter(app => app.hasUpdate).length}
        />
      </main>

      {/* Footer */}
      <div className="hidden">
        <Footer onShowAbout={() => setIsAboutOpen(true)} />
      </div>

      {/* In-Store Interactive Applications */}
      <VanshCalculatorModal
        isOpen={activeModal === 'calculator'}
        onClose={() => setActiveModal(null)}
        onShowToast={showToast}
      />

      <CricYuvaModal
        isOpen={activeModal === 'cric-yuva'}
        onClose={() => setActiveModal(null)}
        onShowToast={showToast}
      />

      <HiRamModal
        isOpen={activeModal === 'hi-ram'}
        onClose={() => setActiveModal(null)}
        apkUrl={catalog.find(app => app.id === 'hi-ram')?.apkUrl}
        onShowToast={showToast}
      />

      {/* Global Toast */}
      <Toast
        message={toastMessage}
        onClose={() => setToastMessage(null)}
      />
    </div>
  );
};

export default App;
