import React from 'react';
import { CatalogApp } from '../types';

interface AppCardProps {
  app: CatalogApp;
  onOpenApp: (app: CatalogApp) => void;
  onShare: (app: CatalogApp) => void;
}

export const AppCard: React.FC<AppCardProps> = ({
  app,
  onOpenApp,
  onShare,
}) => {
  return (
    <article className="grid grid-cols-[76px_minmax(0,1fr)] gap-3 rounded-[22px] border border-[#245678] bg-gradient-to-br from-[#071c2d] via-[#092137] to-[#061321] p-3 shadow-[0_12px_30px_rgba(0,0,0,0.24)] transition duration-200 hover:border-[#3688b7] sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-5 sm:rounded-[27px] sm:p-5">
      <img
        className="h-[76px] w-[76px] rounded-[19px] border border-[#ffb21a]/80 bg-[#02070e] object-cover shadow-[0_0_16px_rgba(255,178,26,0.08)] sm:h-[120px] sm:w-[120px] sm:rounded-[24px]"
        src={app.icon}
        alt={app.name}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).src = app.fallbackIcon;
        }}
      />

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 break-words text-base font-extrabold leading-tight text-white sm:text-2xl">
            {app.name}
          </h3>

          {app.hasUpdate ? (
            <span className="rounded-full bg-gradient-to-r from-[#ffbd24] to-[#ff9f0a] px-2.5 py-1 text-[10px] font-black tracking-wide text-[#17100a] sm:text-xs">
              UPDATE AVAILABLE
            </span>
          ) : (
            <span className="rounded-full bg-[#087650] px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-[#c5ffe5] sm:text-xs">
              {app.isLatest ? 'LATEST' : 'READY'}
            </span>
          )}
        </div>

        <p className="mb-2 mt-2 text-xs leading-relaxed text-[#a6bad1] sm:text-base">
          {app.desc}
        </p>

        <div className="mb-3 flex flex-wrap gap-1.5 text-[10px] text-[#b4c9df] sm:gap-2 sm:text-sm">
          <span className="rounded-lg border border-[#203c57] bg-[#071727] px-2 py-1">
            🏷️ {app.version}
          </span>
          <span className="rounded-lg border border-[#203c57] bg-[#071727] px-2 py-1">
            🤖 Android
          </span>
          <span className="rounded-lg border border-[#203c57] bg-[#071727] px-2 py-1">
            ☁️ GitHub
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <a
            href={app.apkUrl || '#'}
            download={Boolean(app.apkUrl)}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!app.apkUrl}
            className={`flex min-h-[43px] items-center justify-center gap-1 rounded-xl bg-gradient-to-r from-[#1688ff] to-[#0873e8] px-2 py-2 text-center text-xs font-extrabold text-white transition hover:brightness-110 active:scale-[0.98] sm:min-h-[50px] sm:px-4 sm:text-sm ${
              !app.apkUrl ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            ⬇ Download APK
          </a>

          <button
            type="button"
            onClick={() => onOpenApp(app)}
            className="flex min-h-[43px] items-center justify-center gap-1 rounded-xl bg-gradient-to-r from-[#12d59a] to-[#08b980] px-2 py-2 text-xs font-extrabold text-[#031b13] transition hover:brightness-110 active:scale-[0.98] sm:min-h-[50px] sm:px-4 sm:text-sm"
          >
            ▶ Open App
          </button>

          <button
            type="button"
            onClick={() => onShare(app)}
            className="col-span-2 flex min-h-[43px] items-center justify-center gap-2 rounded-xl border border-[#3b5877] bg-[#10243a] px-3 py-2 text-xs font-extrabold text-white transition hover:border-[#6b8eaf] hover:bg-[#17314b] active:scale-[0.98] sm:col-span-1 sm:min-h-[50px] sm:px-4 sm:text-sm"
          >
            ↗ Share
          </button>
        </div>

        <p className="mb-0 mt-2 truncate text-[10px] text-[#88a4bf] sm:text-xs">
          GitHub file: {app.apkUrl ? app.apkUrl.split('/').pop()?.split('?')[0] : 'APK unavailable'}
        </p>
      </div>
    </article>
  );
};
