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
}) => (
  <section className="fixed inset-x-0 bottom-0 z-40 border-t border-[#7652c7]/60 bg-[#071421]/95 px-3 py-2 shadow-[0_-8px_25px_rgba(0,0,0,0.35)] backdrop-blur-xl">
    <div className="mx-auto flex w-full max-w-[1120px] items-center gap-2">
      <button
        type="button"
        onClick={onRefresh}
        disabled={isChecking}
        className="min-w-0 flex-1 rounded-xl border border-[#7652c7] bg-[#17132b] px-2 py-3 text-xs font-bold text-[#ded0ff] disabled:opacity-60 sm:text-sm"
      >
        {isChecking ? '⏳ Checking…' : '↻ Check Updates'}
      </button>
      <button
        type="button"
        onClick={onUpdateAll}
        disabled={pendingCount === 0}
        className="min-w-0 flex-1 rounded-xl border border-[#bba0ff] bg-gradient-to-r from-[#8250df] to-[#a855f7] px-2 py-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
      >
        ⬇ Update All{pendingCount > 0 ? ` (${pendingCount})` : ''}
      </button>
    </div>
    <p className="mx-auto mb-0 mt-1 max-w-[1120px] truncate text-center text-[10px] text-[#9caac3]">
      {statusText}
    </p>
  </section>
);
