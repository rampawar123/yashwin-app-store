import React from 'react';

interface AutoUpdateSectionProps {
  statusText: string;
  isChecking: boolean;
  onRefresh: () => void;
  onUpdateAll: () => void;
  pendingCount: number;
}

export const AutoUpdateSection: React.FC<AutoUpdateSectionProps> = ({
  statusText,
  isChecking,
  onRefresh,
  onUpdateAll,
  pendingCount,
}) => {
  return (
    <section className="my-5 rounded-2xl border border-[#563b91] bg-gradient-to-br from-[#17112d] via-[#0d1c34] to-[#071421] p-4 sm:p-5 shadow-[0_12px_35px_rgba(0,0,0,0.3)]">
      <div className="flex items-center gap-3">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#7652c7] bg-[#27174a] text-2xl text-[#d9c6ff] ${isChecking ? 'animate-spin' : ''}`}>
          ↻
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-lg font-extrabold text-white sm:text-xl">
            Automatic Updates
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-[#aebbd2] sm:text-sm">
            Automatically detect new APK versions from GitHub.
          </p>
        </div>
      </div>

      <button
        onClick={onRefresh}
        disabled={isChecking}
        className="mt-4 w-full rounded-xl border border-[#57417e] bg-[#17132b] px-4 py-2.5 text-sm font-bold text-[#ded0ff] transition hover:bg-[#251a42] disabled:opacity-60"
      >
        {isChecking ? '⏳ Checking…' : '↻ Check Updates'}
      </button>

      <button
        onClick={onUpdateAll}
        disabled={pendingCount === 0}
        className="mt-3 w-full rounded-xl border border-[#bba0ff] bg-gradient-to-r from-[#8250df] to-[#a855f7] px-4 py-3.5 text-sm font-black tracking-wide text-white shadow-[0_0_20px_rgba(139,92,246,0.25)] transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
      >
        ⬇ UPDATE ALL APPS {pendingCount > 0 ? '(' + pendingCount + ')' : ''}
      </button>

      <p className="mb-0 mt-3 text-center text-xs text-[#9caac3]">
        {statusText}
      </p>
    </section>
  );
};
