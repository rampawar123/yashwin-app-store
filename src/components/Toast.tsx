import React, { useEffect } from 'react';

interface ToastProps {
  message: string | null;
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, onClose }) => {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => {
      onClose();
    }, 3000);
    return () => clearTimeout(timer);
  }, [message, onClose]);

  if (!message) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-[#0c243d] border border-[#ffb21a] text-white px-5 py-3 rounded-xl shadow-2xl animate-fade-in text-sm font-semibold max-w-sm">
      <span className="text-amber-400 text-lg">ℹ️</span>
      <span className="flex-1">{message}</span>
      <button
        onClick={onClose}
        className="text-gray-400 hover:text-white ml-2 text-xs font-bold"
      >
        ✕
      </button>
    </div>
  );
};
