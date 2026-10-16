import React from 'react';

interface SearchBoxProps {
  searchQuery: string;
  isSearchOpen: boolean;
  onSearchChange: (query: string) => void;
  onClear: () => void;
  activeCategory: string;
  onCategoryChange: (category: string) => void;
}

const CATEGORIES = [
  { label: 'All Apps', value: 'all' },
  { label: 'Android', value: 'android' },
  { label: 'Tools', value: 'tools' },
  { label: 'Games', value: 'games' },
  { label: 'Others', value: 'others' },
];

export const SearchBox: React.FC<SearchBoxProps> = ({
  searchQuery,
  isSearchOpen,
  onSearchChange,
  onClear,
  activeCategory,
  onCategoryChange,
}) => (
  <section className="w-full space-y-2">
    {isSearchOpen && <div className="flex items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-[#456789] bg-[#0b1c30] px-3">
        <span className="text-lg text-[#ffb21a]" aria-hidden="true">🔎</span>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search apps..."
          aria-label="Search apps"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-white outline-none placeholder:text-[#91a9c4]"
        />
        {searchQuery && (
          <button type="button" onClick={onClear} aria-label="Clear search" className="px-1 text-lg text-white">×</button>
        )}
      </div>
    </div>}

    <div className="grid grid-cols-5 gap-1">
      {CATEGORIES.map((category) => (
        <button
          key={category.value}
          type="button"
          onClick={() => onCategoryChange(category.value)}
          aria-pressed={activeCategory === category.value}
          className={`min-w-0 rounded-lg border px-0.5 py-2 text-[10px] font-bold leading-tight transition sm:text-sm ${
            activeCategory === category.value
              ? 'border-[#2388ff] bg-[#0872e8] text-white'
              : 'border-[#354f6d] bg-[#0c1b2c] text-[#b4c8e0]'
          }`}
        >
          {category.label}
        </button>
      ))}
    </div>
  </section>
);
