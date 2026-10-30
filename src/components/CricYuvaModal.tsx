import React from 'react';

interface CricYuvaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowToast?: (msg: string) => void;
}

export const CricYuvaModal: React.FC<CricYuvaModalProps> = ({
  isOpen,
  onClose
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col animate-fade-in">
      {/* Top Header Controls */}
      <div className="bg-[#121620] border-b border-[#ff5a00]/40 px-4 py-2.5 flex items-center justify-between text-white shrink-0">
        <div className="flex items-center gap-3">
          <img
            src={`${import.meta.env.BASE_URL}cric-yuva-2/cric-yuva-logo.png`}
            alt="CRIC YUVA"
            className="w-7 h-7 rounded-full border border-[#ff5a00] object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = `${import.meta.env.BASE_URL}icon-512.png`;
            }}
          />
          <div>
            <div className="text-sm font-extrabold tracking-wide flex items-center gap-2">
              <span>CRIC <span className="text-[#ff5a00]">YUVA</span></span>
              <span className="text-[10px] font-semibold bg-[#ff5a00]/20 text-[#ff5a00] px-2 py-0.5 rounded-full">
                Version 19.0.0
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <a
            href={`${import.meta.env.BASE_URL}cric-yuva-2/index.html`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1 rounded-lg bg-[#1f293d] hover:bg-[#ff5a00] hover:text-black text-xs font-bold text-gray-200 border border-[#3b4c6e] transition-colors"
          >
            ↗ Open in New Window
          </a>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-[#1f293d] hover:bg-red-700 text-white font-black text-sm flex items-center justify-center cursor-pointer transition-colors"
            title="Close Cric Yuva"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Original Cric Yuva App Loaded Directly */}
      <iframe
        src={`${import.meta.env.BASE_URL}cric-yuva-2/index.html`}
        className="w-full flex-1 border-0 bg-[#0b0f19]"
        title="CRIC YUVA - Original Application"
      />
    </div>
  );
};
