import React from 'react';
import { CatalogApp } from '../types';

interface AppCardProps {
  app: CatalogApp;
  onOpenApp: (app: CatalogApp) => void;
  onShare: (app: CatalogApp) => void;
}

export const AppCard: React.FC<AppCardProps> = ({ app, onOpenApp, onShare }) => {
  return (
    <article className="grid grid-cols-[82px_1fr] sm:grid-cols-[120px_1fr] gap-3.5 sm:gap-4.5 p-3.5 sm:p-4.5 rounded-[19px] sm:rounded-[24px] bg-gradient-to-br from-[#10273d]/95 to-[#071421]/95 border border-[#285274] shadow-[0_18px_50px_rgba(0,0,0,0.35)] hover:-translate-y-0.5 hover:border-[#4d85ad] transition-all">
      {/* App Icon */}
      <img
        className="w-[82px] h-[82px] sm:w-[120px] sm:h-[120px] rounded-[18px] sm:rounded-[24px] object-cover border border-[#ffb21a]/55 bg-[#02070e]"
        src={app.icon}
        alt={app.name}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).src = app.fallbackIcon;
        }}
      />

      {/* Main Details */}
      <div className="min-w-0 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg sm:text-2xl font-bold text-white m-0">
              {app.name}
            </h3>
            <span className="text-[11px] py-1 px-2.5 rounded-full bg-[#0b6b47] text-[#baffdf] font-extrabold tracking-wide">
              {app.isLatest ? 'LATEST' : 'READY'}
            </span>
            {app.hasUpdate && (
              <span className="text-[11px] py-1 px-2.5 rounded-full bg-[#ffb21a] text-[#111] font-black tracking-wide animate-pulse">
                UPDATE AVAILABLE
              </span>
            )}
          </div>

          <div className="text-[#9db0c6] text-xs sm:text-sm my-1.5 sm:my-2.5">
            {app.desc}
          </div>

          <div className="flex gap-2.5 sm:gap-3.5 flex-wrap text-[#a9c0d5] text-xs mb-2.5 sm:mb-3.5">
            <span className="bg-[#0b1b2d] px-2 py-0.5 rounded-md border border-[#21425f]/50">
              🏷️ {app.version}
            </span>
            <span className="bg-[#0b1b2d] px-2 py-0.5 rounded-md border border-[#21425f]/50">
              🤖 Android
            </span>
            <span className="bg-[#0b1b2d] px-2 py-0.5 rounded-md border border-[#21425f]/50">
              ☁️ GitHub
            </span>
          </div>
        </div>

        {/* Actions */}
        <div>
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">

            <a
              href={app.apkUrl || "#"}
              download={Boolean(app.apkUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center justify-center gap-1.5 py-2.5 px-3 sm:px-4 rounded-xl font-extrabold text-xs sm:text-sm text-white cursor-pointer transition-all bg-[#2388ff] hover:bg-[#2388ff]/90 ${!app.apkUrl ? "opacity-50 pointer-events-none" : ""}`}
            >
              ⬇ Download APK
            </a>

            <button
              onClick={() => onOpenApp(app)}
              className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 sm:px-4 rounded-xl font-extrabold text-xs sm:text-sm bg-[#16c784] text-[#06150f] hover:bg-[#16c784]/90 cursor-pointer transition-all"
            >
              ▶ Open App
            </button>

            <button
              onClick={() => onShare(app)}
              className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 sm:px-4 rounded-xl font-extrabold text-xs sm:text-sm bg-[#40566e] text-white hover:bg-[#40566e]/90 cursor-pointer transition-all"
            >
              ↗ Share
            </button>
          </div>

          <div className="text-[11px] text-[#7fa0b9] mt-2 truncate">
            {app.updatedLabel}
          </div>
        </div>
      </div>
    </article>
  );
};
