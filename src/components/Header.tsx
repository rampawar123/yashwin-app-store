import React, { useState } from 'react';

interface HeaderProps {
  onShowApps: () => void;
  onToggleAbout: () => void;
  onRefresh: () => void;
  isChecking: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onShowApps,
  onToggleAbout,
  onRefresh,
  isChecking,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);

  const runAction = (action: () => void) => {
    action();
    setMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-[#d9a52e]/25 bg-[#020a13]/95 backdrop-blur-xl">
      <div className="mx-auto w-[calc(100%-28px)] max-w-[1120px]">
        <div className="flex min-h-[88px] items-center gap-3 py-3 sm:min-h-[112px] sm:gap-5">
          <img
            className="h-[58px] w-[58px] shrink-0 rounded-2xl border border-[#ffb21a] object-cover shadow-[0_0_22px_rgba(255,178,26,0.16)] sm:h-[76px] sm:w-[76px]"
            src="/yashwin-app-store/icon-512.png"
            alt="YASHWIN APP STORE"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = '/yashwin-app-store/icon-512.png';
            }}
          />

          <div className="min-w-0 flex-1">
            <div className="text-[clamp(17px,4.5vw,34px)] font-black leading-tight tracking-wide text-white">
              YASHWIN <span className="text-[#ffb21a]">APP STORE</span>
            </div>
            <p className="m-0 mt-1 text-[8px] font-bold tracking-[2px] text-[#a9bed8] sm:text-xs sm:tracking-[4px]">
              DISCOVER • DOWNLOAD • ENJOY
            </p>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-[18px] border border-[#ffb21a] bg-[#ffb21a]/5 text-3xl text-white transition hover:bg-[#ffb21a]/15 active:scale-95 sm:h-[72px] sm:w-[72px] sm:text-4xl"
          >
            {menuOpen ? '×' : '☰'}
          </button>
        </div>

        {menuOpen && (
          <nav className="grid grid-cols-3 gap-2 border-t border-[#24415b] py-3">
            <button
              type="button"
              onClick={() => runAction(onShowApps)}
              className="rounded-xl border border-[#24415b] bg-[#0b1b2d] px-2 py-3 text-sm font-bold text-white hover:border-[#ffb21a]"
            >
              📱 Apps
            </button>
            <button
              type="button"
              onClick={() => runAction(onToggleAbout)}
              className="rounded-xl border border-[#24415b] bg-[#0b1b2d] px-2 py-3 text-sm font-bold text-white hover:border-[#ffb21a]"
            >
              ℹ️ About
            </button>
            <button
              type="button"
              onClick={() => runAction(onRefresh)}
              disabled={isChecking}
              className="rounded-xl border border-[#ffb21a]/60 bg-[#ffb21a]/10 px-2 py-3 text-sm font-bold text-[#ffcf68] hover:bg-[#ffb21a]/20 disabled:opacity-50"
            >
              {isChecking ? '⏳ Checking' : '↻ Refresh'}
            </button>
          </nav>
        )}
      </div>
    </header>
  );
};
