import React, { useState } from 'react';

interface HeaderProps {
  onShowApps: () => void;
  onToggleAbout: () => void;
  onRefresh: () => void;
  isChecking: boolean;
  onToggleSearch?: () => void;
  isSearchOpen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onShowApps,
  onToggleAbout,
  onRefresh,
  isChecking,
  onToggleSearch,
  isSearchOpen = false,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);

  const runAction = (action: () => void) => {
    action();
    setMenuOpen(false);
  };

  return (
    <header className="relative z-30 shrink-0 border-b border-[#d9a52e]/30 bg-[#020817]/95 shadow-[0_4px_24px_rgba(20,30,100,0.2)] backdrop-blur-xl">
      <div className="mx-auto w-[calc(100%-20px)] max-w-[1120px] sm:w-[calc(100%-28px)]">
        <div className="flex min-h-[96px] items-center gap-2 py-3 sm:min-h-[112px] sm:gap-5">
          <img
            className="h-[62px] w-[62px] shrink-0 rounded-2xl border border-[#ffb21a] object-cover shadow-[0_0_20px_rgba(255,178,26,0.22)] sm:h-[78px] sm:w-[78px]"
            src="/icon-512.png"
            alt="YASHWIN APP STORE"
          />

          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-[clamp(15px,4.3vw,34px)] font-black leading-tight tracking-wide text-white">
              YASHWIN <span className="text-[#ffb21a]">APP STORE</span>
            </h1>
            <p className="m-0 mt-1 whitespace-nowrap text-[7px] font-bold tracking-[1.3px] text-[#b6c9e5] sm:text-xs sm:tracking-[3px]">
              DISCOVER • DOWNLOAD • ENJOY
            </p>
            <p className="m-0 mt-1.5 whitespace-nowrap text-[8px] font-extrabold tracking-[1.1px] text-[#ffb21a] sm:text-[11px] sm:tracking-[2px]">
              ━━ BUILD BY SITARAM PAWAR ━━
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <button
              type="button"
              onClick={() => onToggleSearch?.()}
              aria-label={isSearchOpen ? 'Close search' : 'Open search'}
              aria-expanded={isSearchOpen}
              className="flex h-[43px] w-[43px] items-center justify-center rounded-2xl border border-[#ffb21a] bg-[#ffb21a]/5 text-[28px] leading-none text-white transition active:scale-95 sm:h-[68px] sm:w-[68px] sm:text-4xl"
            >
              {isSearchOpen ? '×' : '⌕'}
            </button>

            <button
              type="button"
              onClick={() => setMenuOpen(open => !open)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              className="flex h-[43px] w-[43px] items-center justify-center rounded-2xl border border-[#ffb21a] bg-[#ffb21a]/5 text-[26px] leading-none text-white transition active:scale-95 sm:h-[68px] sm:w-[68px] sm:text-4xl"
            >
              {menuOpen ? '×' : '☰'}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="grid grid-cols-3 gap-2 border-t border-[#24415b] py-3">
            <button
              type="button"
              onClick={() => runAction(onShowApps)}
              className="rounded-xl border border-[#24415b] bg-[#0b1b2d] px-2 py-3 text-sm font-bold text-white"
            >
              📱 Apps
            </button>
            <button
              type="button"
              onClick={() => runAction(onToggleAbout)}
              className="rounded-xl border border-[#24415b] bg-[#0b1b2d] px-2 py-3 text-sm font-bold text-white"
            >
              ℹ️ About
            </button>
            <button
              type="button"
              onClick={() => runAction(onRefresh)}
              disabled={isChecking}
              className="rounded-xl border border-[#ffb21a]/60 bg-[#ffb21a]/10 px-2 py-3 text-sm font-bold text-[#ffcf68] disabled:opacity-50"
            >
              {isChecking ? '⏳ Checking' : '↻ Refresh'}
            </button>
          </nav>
        )}
      </div>
    </header>
  );
};
