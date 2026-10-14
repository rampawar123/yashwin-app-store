import React from 'react';

interface FooterProps {
  onShowAbout: () => void;
}

export const Footer: React.FC<FooterProps> = ({ onShowAbout }) => {
  return (
    <footer className="pt-10 pb-14 text-[#8fa5ba] text-xs sm:text-sm border-t border-[#21425f]/40 flex flex-col sm:flex-row justify-between items-center gap-4">
      <div className="text-center sm:text-left">
        <div className="font-semibold text-white">© 2026 YASHWIN APP STORE</div>
        <span className="text-xs text-[#9db0c6]">Discover • Download • Enjoy</span>
      </div>

      <div className="flex gap-4">
        <button
          onClick={onShowAbout}
          className="text-[#9db0c6] hover:text-[#ffb21a] transition-colors cursor-pointer"
        >
          About
        </button>
        <a
          href="https://github.com/rampawar123/yashwin-app-store"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#9db0c6] hover:text-[#ffb21a] transition-colors"
        >
          GitHub Repository
        </a>
      </div>
    </footer>
  );
};
