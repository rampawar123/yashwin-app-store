import React from 'react';

interface SearchBoxProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onClear: () => void;
}

export const SearchBox: React.FC<SearchBoxProps> = ({
  searchQuery,
  onSearchChange,
  onClear
}) => {
  return (
    <div className="flex bg-[#081726]/85 border border-[#416887] rounded-[18px] overflow-hidden shadow-[0_18px_50px_rgba(0,0,0,0.35)] my-3 mb-6.5 transition-all focus-within:border-[#ffb21a]">
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search apps (calculator, cric, yashwin...)"
        className="flex-1 min-w-0 bg-transparent border-0 outline-none text-white px-4.5 py-4 text-base placeholder:text-[#9db0c6]/60"
      />
      {searchQuery && (
        <button
          onClick={onClear}
          className="px-3 text-[#9db0c6] hover:text-white transition-colors"
          title="Clear search"
        >
          ✕
        </button>
      )}
      <button
        onClick={() => {}}
        className="border-0 bg-[#ffb21a] hover:bg-[#ffb21a]/90 text-[#111] px-5 sm:px-6 font-extrabold cursor-pointer transition-colors flex items-center gap-1.5 text-base"
      >
        <span>⌕</span> Search
      </button>
    </div>
  );
};
