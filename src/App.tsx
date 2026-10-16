import React, { useState, useEffect, useCallback } from 'react';
import { CatalogApp } from './types';
import {
  fetchLatestGithubCatalog,
  APP_DEFINITIONS,
  clearPendingUpdate
} from './services/githubService';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { Features } from './components/Features';
import { SearchBox } from './components/SearchBox';
import { AboutSection } from './components/AboutModal';
import { AppCard } from './components/AppCard';
import { AutoUpdateSection } from './components/AutoUpdateSection';
import { Footer } from './components/Footer';
import { VanshCalculatorModal } from './components/VanshCalculatorModal';
import { CricYuvaModal } from './components/CricYuvaModal';
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
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [statusText, setStatusText] = useState('GitHub status: checking latest APK files…');
  const [activeModal, setActiveModal] = useState<'calculator' | 'cric-yuva' | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  const checkingRef = React.useRef(false);

  const refreshCatalog = useCallback(async (manual: boolean = false) => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setIsChecking(true);
    setStatusText('GitHub status: checking latest APK files…');

    try {
      const result = await fetchLatestGithubCatalog();
      setCatalog(result.catalog);
      setStatusText(result.message);

      if (manual) {
        showToast(
          result.hasAnyUpdate
            ? 'New app update detected! Check UPDATE APK button to download.'
            : result.isOnline
              ? 'Store is up to date with the latest GitHub files.'
              : 'GitHub check failed. Please try again later.'
        );
      }
    } catch {
      setStatusText('GitHub check failed. Please try again later.');
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

    const handleVisibility = () => {
      // Refresh only when returning after the page was hidden.
      if (!document.hidden) void refreshCatalog(false);
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshCatalog]);

  const handleOpenApp = (app: CatalogApp) => {
    if (app.openType === 'calculator') {
      setActiveModal('calculator');
    } else if (app.openType === 'cric-yuva') {
      window.location.href = '/yashwin-app-store/cric-yuva-2/index.html'; return;
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast('You are already browsing YASHWIN APP STORE.');
    }
  };

  const handleUpdateAll = () => {
    const pendingApps = catalog.filter(app => app.hasUpdate && app.apkUrl);

    if (pendingApps.length === 0) {
      showToast('No app updates are currently available.');
      return;
    }

    pendingApps.forEach((app, index) => {
      const link = document.createElement('a');
      link.href = app.apkUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.download = app.apkUrl.split('/').pop()?.split('?')[0] || app.id + '.apk';
      document.body.appendChild(link);
      link.click();
      link.remove();

      clearPendingUpdate(app.id);
    });

    setCatalog(current =>
      current.map(app =>
        pendingApps.some(pending => pending.id === app.id)
          ? { ...app, hasUpdate: false }
          : app
      )
    );

    showToast(
      'Started download requests for ' + pendingApps.length +
      ' app update(s). Complete installation from Android when prompted.'
    );
  };

  const handleShare = async (app: CatalogApp) => {
    const url = app.apkUrl ? `${window.location.origin}${app.apkUrl}` : window.location.href;
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
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const combined = `${app.name} ${app.desc} ${app.keys.join(' ')}`.toLowerCase();
    return combined.includes(q);
  });

  return (
    <div className="min-h-screen flex flex-col selection:bg-[#ffb21a] selection:text-black">
      {/* Header */}
      <Header
        onShowApps={handleShowApps}
        onToggleAbout={() => setIsAboutOpen(prev => !prev)}
        onRefresh={() => refreshCatalog(true)}
        isChecking={isChecking}
      />

      {/* Main Container */}
      <main className="max-w-[1120px] w-[calc(100%-20px)] sm:w-[calc(100%-28px)] mx-auto flex-1 pb-8">
        <Hero />

        {/* Search */}
        <SearchBox
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onClear={() => setSearchQuery('')}
        />

        {/* Features Showcase Strip */}
        <Features />

        {/* About Expandable Card */}
        <AboutSection
          isOpen={isAboutOpen}
          onClose={() => setIsAboutOpen(false)}
        />

        {/* Section Header */}
        <div id="available-apps-section" className="flex items-end justify-between gap-2.5 my-5 mb-3.5">
          <div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white m-0">
              Available Apps
            </h2>
            <div className="w-[72px] h-1 bg-[#ffb21a] rounded-full mt-2" />
          </div>
          <div className="border border-[#376483] py-2 px-3.5 rounded-full text-[#d7e8f7] text-xs sm:text-sm font-semibold">
            {filteredApps.length} Apps
          </div>
        </div>

        {/* Apps Grid/List */}
        <section className="grid gap-3.5">
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
      <div className="max-w-[1120px] w-[calc(100%-28px)] mx-auto">
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

      {/* Global Toast */}
      <Toast
        message={toastMessage}
        onClose={() => setToastMessage(null)}
      />
    </div>
  );
};

export default App;
