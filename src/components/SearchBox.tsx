import React from 'react';

interface SearchBoxProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onClear: () => void;
}

const CATEGORIES = [
  { label: 'All Apps', icon: '', value: 'all' },
  { label: 'Android', icon: '🤖', value: 'android' },
  { label: 'Tools', icon: '🔧', value: 'tools' },
  { label: 'Games', icon: '🎮', value: 'games' },
  { label: 'Others', icon: '▦', value: 'others' },
];

export const SearchBox: React.FC<SearchBoxProps> = ({
  searchQuery,
  onSearchChange,
  onClear,
}) => {
  const [activeCategory, setActiveCategory] = React.useState('all');

  const chooseCategory = (category: string) => {
    setActiveCategory(category);
    if (category === 'all') onSearchChange('');
    else if (category === 'android') onSearchChange('android');
    else if (category === 'tools') onSearchChange('calculator');
    else if (category === 'games') onSearchChange('cric');
    else onSearchChange('yashwin');
  };

  return (
    <section className="my-5 space-y-4 sm:my-6">
      <div className="flex min-h-[60px] items-center gap-3 rounded-[19px] border border-[#456789] bg-gradient-to-r from-[#0b1c30] to-[#071321] px-4 shadow-[0_10px_30px_rgba(0,0,0,0.22)] transition focus-within:border-[#ffb21a] sm:min-h-[72px] sm:px-6">
        <span className="text-3xl text-[#9db8d5]" aria-hidden="true">⌕</span>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => {
            onSearchChange(e.target.value);
            setActiveCategory('all');
          }}
          placeholder="Search apps..."
          aria-label="Search apps"
          className="min-w-0 flex-1 border-0 bg-transparent py-3 text-base text-white outline-none placeholder:text-[#91a9c4] sm:text-xl"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => {
              onClear();
              setActiveCategory('all');
            }}
            aria-label="Clear search"
            className="rounded-full px-2 py-1 text-xl text-[#a9bed8] hover:text-white"
          >
            ×
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3">
        {CATEGORIES.map((category) => (
          <button
            key={category.value}
            type="button"
            onClick={() => chooseCategory(category.value)}
            aria-pressed={activeCategory === category.value}
            className={`flex min-h-[48px] items-center justify-center gap-1.5 rounded-2xl border px-2 py-3 text-xs font-bold transition active:scale-[0.98] sm:min-h-[60px] sm:gap-2 sm:px-3 sm:text-base ${
              activeCategory === category.value
                ? 'border-[#2388ff] bg-gradient-to-r from-[#1685ff] to-[#0872e8] text-white shadow-[0_5px_18px_rgba(35,136,255,0.2)]'
                : 'border-[#354f6d] bg-gradient-to-br from-[#0c1b2c] to-[#071321] text-[#b4c8e0] hover:border-[#6486ab]'
            }`}
          >
            {category.icon && <span className="text-base sm:text-xl">{category.icon}</span>}
            <span>{category.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
};
