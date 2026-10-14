import React from 'react';

interface AboutProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutSection: React.FC<AboutProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="p-5 border border-[#21425f] bg-[#0a1928]/85 rounded-[18px] mb-5 text-[#c4d4e3] leading-relaxed shadow-xl animate-fade-in">
      <div className="flex items-center justify-between mb-3 border-b border-[#21425f]/50 pb-2">
        <h2 className="text-xl sm:text-2xl font-bold text-white">
          About YASHWIN APP STORE
        </h2>
        <button
          onClick={onClose}
          className="text-[#9db0c6] hover:text-white font-bold p-1"
        >
          ✕
        </button>
      </div>
      <p className="mb-2.5 text-sm sm:text-base">
        <strong>YASHWIN APP STORE</strong> is the official home for our suite of Android applications.
        App cards, direct APK download links, and release update information are refreshed automatically from the GitHub repository tree.
      </p>
      <p className="text-sm sm:text-base text-[#9db0c6]">
        <strong className="text-amber-400">Important:</strong> Uploading or committing a new APK build to GitHub automatically changes what this store displays. The app store does not require manual file edits to reflect new releases.
      </p>
    </div>
  );
};
