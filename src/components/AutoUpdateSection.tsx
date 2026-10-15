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
  pendingCount
}) => {
  return (
    <div className="my-6">
      <div className="p-5 rounded-[22px] border border-[#285f89] bg-gradient-to-r from-[#0a2743]/90 to-[#071522]/95 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div
          className={`w-14 h-14 rounded-full flex items-center justify-center bg-[#0c2c4a] border border-[#397eaf] text-2xl text-white select-none transition-transform duration-700 shrink-0 ${
            isChecking ? 'animate-spin' : ''
          }`}
        >
          ↻
        </div>

        <div className="flex-1">
          <b className="text-lg text-white font-bold block">
            Automatic Updates
          </b>
          <p className="m-0 mt-1 text-[#9db0c6] text-xs sm:text-sm leading-relaxed">
            GitHub par APK badalte hi store latest file ko automatically detect karega. Neeche se kabhi bhi manually update check kar sakte hain.
          </p>
        </div>

        <button
          onClick={onRefresh}
          disabled={isChecking}
          className="w-full sm:w-auto border border-[#ffb21a] bg-[#ffb21a]/15 text-white px-4 py-2.5 rounded-xl font-bold text-sm cursor-pointer hover:bg-[#ffb21a]/25 transition-all disabled:opacity-55 active:scale-95"
        >
          {isChecking ? '⏳ Checking…' : '↻ Check Updates'}
        </button>
      </div>

      <button
        onClick={onUpdateAll}
        disabled={pendingCount === 0}
        className="w-full mt-3 px-5 py-3 rounded-xl bg-[#ffb21a] text-black font-extrabold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        ⬇ UPDATE ALL APPS {pendingCount > 0 ? '(' + pendingCount + ')' : ''}
      </button>

      <div className="text-xs text-[#7fa0b9] my-2 mb-6">
        {statusText}
      </div>
    </div>
  );
};
