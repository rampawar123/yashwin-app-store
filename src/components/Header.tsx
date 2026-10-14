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
  isChecking
}) => {
  const [menuOpen, setMenuOpen] = useState(false);

  const handleShowApps = () => {
    onShowApps();
    setMenuOpen(false);
  };

  const handleToggleAbout = () => {
    onToggleAbout();
    setMenuOpen(false);
  };

  const handleRefresh = () => {
    onRefresh();
    setMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-30 bg-[#030a12]/90 backdrop-blur-md border-b border-[#5b91be]/20">
      <div className="max-w-[1120px] w-[calc(100%-28px)] mx-auto">
        <div className="min-h-[76px] flex items-center gap-3.5 py-2">
          <img
            className="w-[52px] h-[52px] rounded-2xl object-cover border border-[#ffb21a] shadow-[0_0_24px_rgba(255,178,26,0.18)]"
            src="/icon-512.png"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = '/icon-512.png';
            }}
            alt="YASHWIN"
          />

          <div className="flex-1">
            <b className="text-[22px] tracking-[0.3px] text-white">
              YASHWIN <span className="text-[#ffb21a]">APP STORE</span>
            </b>
            <small className="block text-[#9db0c6] tracking-[3px] mt-0.5 text-[9px] uppercase font-semibold">
              DISCOVER • DOWNLOAD • ENJOY
            </small>
          </div>

          <button
            className="w-12 h-12 rounded-[15px] border border-[#ffb21a] bg-[#ffb21a]/10 text-white text-2xl flex items-center justify-center cursor-pointer hover:bg-[#ffb21a]/20 transition-all active:scale-95"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>

        {/* Drawer Menu */}
        {menuOpen && (
          <div className="flex gap-2.5 pb-4 pt-1 border-t border-[#21425f]/40">
            <button
              onClick={handleShowApps}
              className="flex-1 py-3 px-2 border border-[#21425f] rounded-xl bg-[#0b1828] text-white font-medium text-sm hover:border-[#ffb21a] transition-colors"
            >
              📱 Apps
            </button>
            <button
              onClick={handleToggleAbout}
              className="flex-1 py-3 px-2 border border-[#21425f] rounded-xl bg-[#0b1828] text-white font-medium text-sm hover:border-[#ffb21a] transition-colors"
            >
              ℹ️ About
            </button>
            <button
              onClick={handleRefresh}
              disabled={isChecking}
              className="flex-1 py-3 px-2 border border-[#ffb21a]/60 rounded-xl bg-[#ffb21a]/15 text-[#ffb21a] font-semibold text-sm hover:bg-[#ffb21a]/25 transition-colors disabled:opacity-50"
            >
              {isChecking ? '⏳ Checking…' : '↻ Refresh'}
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
