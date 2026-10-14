import React from 'react';

export const Hero: React.FC = () => {
  return (
    <section className="pt-12 pb-6 relative">
      <div className="text-[#8db8df] tracking-[4px] text-xs font-bold uppercase mb-2">
        SIMPLE APPS FOR A BETTER LIFE
      </div>
      <h1 className="text-4xl sm:text-6xl lg:text-[76px] font-extrabold tracking-tight leading-[0.98] my-3 text-white max-w-[720px]">
        Useful Apps<br />
        For <span className="text-[#ffb21a]">Everyone</span>
      </h1>
      <p className="text-[#9db0c6] text-base sm:text-lg max-w-[620px] leading-relaxed mt-3">
        Discover, download and enjoy useful apps made with passion. The store reads the latest app files directly from GitHub.
      </p>

      {/* Decorative cursive script badge */}
      <div className="hidden md:block absolute right-[3%] top-[55px] text-[#a9d5ff] text-2xl lg:text-3xl font-cursive -rotate-6 text-center opacity-90 select-none">
        Small Apps<br />Big Possibilities
      </div>
    </section>
  );
};
