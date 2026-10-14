import React from 'react';

const FEATURES = [
  {
    icon: '🛡️',
    title: 'Safe & Secure',
    subtitle: 'Trusted Apps'
  },
  {
    icon: '⚡',
    title: 'Fast Downloads',
    subtitle: 'Direct & Latest'
  },
  {
    icon: '🔄',
    title: 'Auto Updates',
    subtitle: 'From GitHub'
  },
  {
    icon: '❤️',
    title: 'Made For You',
    subtitle: 'With Love'
  }
];

export const Features: React.FC = () => {
  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-3 my-3.5 mb-8.5">
      {FEATURES.map((item, index) => (
        <div
          key={index}
          className="bg-gradient-to-br from-[#0e2439]/90 to-[#06121e]/90 border border-[#3f7197]/35 rounded-[17px] p-4 transition-transform hover:-translate-y-0.5"
        >
          <div className="text-2xl">{item.icon}</div>
          <b className="block mt-2 text-white font-bold text-sm sm:text-base">
            {item.title}
          </b>
          <span className="block text-[#9db0c6] text-xs mt-1">
            {item.subtitle}
          </span>
        </div>
      ))}
    </section>
  );
};
