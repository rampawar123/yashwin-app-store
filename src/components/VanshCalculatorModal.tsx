import React, { useState, useEffect, useCallback } from 'react';

interface CalculationRecord {
  expression: string;
  answer: string;
}

interface VanshCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowToast: (msg: string) => void;
}

export const VanshCalculatorModal: React.FC<VanshCalculatorModalProps> = ({
  isOpen,
  onClose,
  onShowToast
}) => {
  const [current, setCurrent] = useState<string>('0');
  const [previous, setPrevious] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<boolean>(false);

  const [history, setHistory] = useState<CalculationRecord[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('vanshHistory') || '[]');
    } catch {
      return [];
    }
  });

  const [saved, setSaved] = useState<CalculationRecord[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('vanshSaved') || '[]');
    } catch {
      return [];
    }
  });

  // Sync to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('vanshHistory', JSON.stringify(history));
    } catch {
      // ignore
    }
  }, [history]);

  useEffect(() => {
    try {
      localStorage.setItem('vanshSaved', JSON.stringify(saved));
    } catch {
      // ignore
    }
  }, [saved]);

  const formatNumber = useCallback((val: string | number | null | undefined): string => {
    if (val === null || val === undefined) return '';
    const text = String(val);
    if (text.length > 16) {
      const n = Number(val);
      if (Number.isFinite(n)) {
        return n.toPrecision(10).replace(/\.?0+$/, '');
      }
    }
    return text;
  }, []);

  const displayOperator = useCallback((op: string | null) => {
    if (op === '/') return '÷';
    if (op === '*') return '×';
    if (op === '-') return '−';
    return '+';
  }, []);

  const getExpressionText = useCallback(() => {
    if (previous !== null && operator && !waiting) {
      return `${formatNumber(previous)} ${displayOperator(operator)} ${formatNumber(current)}`;
    } else if (previous !== null && operator && waiting) {
      return `${formatNumber(previous)} ${displayOperator(operator)}`;
    }
    return '';
  }, [previous, operator, waiting, current, formatNumber, displayOperator]);

  const handleNumber = useCallback((num: string) => {
    if (waiting) {
      setCurrent(num);
      setWaiting(false);
    } else {
      if (current === '0') {
        setCurrent(num);
      } else {
        setCurrent(prev => prev + num);
      }
    }
  }, [waiting, current]);

  const handleDecimal = useCallback(() => {
    if (waiting) {
      setCurrent('0.');
      setWaiting(false);
      return;
    }
    if (!current.includes('.')) {
      setCurrent(prev => prev + '.');
    }
  }, [waiting, current]);

  const handlePercentage = useCallback(() => {
    const val = parseFloat(current);
    if (Number.isNaN(val)) return;
    setCurrent(String(val / 100));
  }, [current]);

  const handleBackspace = useCallback(() => {
    if (waiting) return;
    if (current.length <= 1) {
      setCurrent('0');
    } else {
      setCurrent(prev => prev.slice(0, -1));
    }
  }, [waiting, current]);

  const handleClearAll = useCallback(() => {
    setCurrent('0');
    setPrevious(null);
    setOperator(null);
    setWaiting(false);
  }, []);

  const handleCalculate = useCallback((addToHist: boolean = true) => {
    if (previous === null || operator === null) return;
    const second = parseFloat(current);
    if (Number.isNaN(second)) return;

    let ans: number;
    if (operator === '+') ans = previous + second;
    else if (operator === '-') ans = previous - second;
    else if (operator === '*') ans = previous * second;
    else if (operator === '/') {
      if (second === 0) {
        onShowToast('Cannot divide by zero');
        return;
      }
      ans = previous / second;
    } else {
      return;
    }

    if (!Number.isFinite(ans)) {
      onShowToast('Invalid calculation');
      return;
    }

    const firstVal = previous;
    const usedOp = operator;
    const expressionString = `${formatNumber(firstVal)} ${displayOperator(usedOp)} ${formatNumber(second)}`;
    const finalAnswer = String(Number.isInteger(ans) ? ans : Number(ans.toFixed(12)));

    setCurrent(finalAnswer);
    setPrevious(null);
    setOperator(null);
    setWaiting(true);

    if (addToHist) {
      setHistory(prev => [{ expression: expressionString, answer: finalAnswer }, ...prev]);
    }
  }, [previous, operator, current, onShowToast, formatNumber, displayOperator]);

  const handleChooseOperator = useCallback((op: string) => {
    const input = parseFloat(current);
    if (Number.isNaN(input)) return;

    if (previous !== null && operator && !waiting) {
      handleCalculate(false);
    }

    setPrevious(parseFloat(current));
    setOperator(op);
    setWaiting(true);
  }, [current, previous, operator, waiting, handleCalculate]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleNumber(e.key);
      } else if (e.key === '.') {
        handleDecimal();
      } else if (e.key === '+') {
        handleChooseOperator('+');
      } else if (e.key === '-') {
        handleChooseOperator('-');
      } else if (e.key === '*') {
        handleChooseOperator('*');
      } else if (e.key === '/') {
        e.preventDefault();
        handleChooseOperator('/');
      } else if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        handleCalculate();
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Escape') {
        handleClearAll();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleNumber, handleDecimal, handleChooseOperator, handleCalculate, handleBackspace, handleClearAll]);

  // Actions
  const handleDeleteHistory = (index: number) => {
    setHistory(prev => prev.filter((_, i) => i !== index));
  };

  const handleClearHistory = () => {
    if (history.length === 0) return;
    setHistory([]);
    onShowToast('Calculation history cleared');
  };

  const handleSaveHistoryItem = (index: number) => {
    const item = history[index];
    if (!item) return;
    const exists = saved.some(x => x.expression === item.expression && x.answer === item.answer);
    if (!exists) {
      setSaved(prev => [item, ...prev]);
      onShowToast('Calculation saved to Saved Maths');
    } else {
      onShowToast('Already saved in list');
    }
  };

  const handleDeleteSaved = (index: number) => {
    setSaved(prev => prev.filter((_, i) => i !== index));
  };

  const handleClearSaved = () => {
    if (saved.length === 0) return;
    setSaved([]);
    onShowToast('Saved calculations cleared');
  };

  const handleShareItem = async (item: CalculationRecord) => {
    const text = `VANSH CALCULATOR\n${item.expression} = ${item.answer}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'VANSH CALCULATOR',
          text
        });
      } catch {
        // User cancelled
      }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        onShowToast('Calculation copied to clipboard!');
      } catch {
        onShowToast(text);
      }
    }
  };

  const historyTotal = history.reduce((sum, item) => {
    const n = Number(item.answer);
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);

  const savedTotal = saved.reduce((sum, item) => {
    const n = Number(item.answer);
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 animate-fade-in">
      <div className="w-full max-w-lg bg-[#191919] border-3 border-[#ff9800] rounded-[28px] sm:rounded-[32px] p-4 sm:p-6 shadow-[0_0_35px_rgba(255,152,0,0.25)] relative max-h-[92vh] overflow-y-auto">
        {/* Header close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-[#292929] hover:bg-[#ff9800] hover:text-black text-white font-bold text-sm flex items-center justify-center transition-colors cursor-pointer z-10"
          title="Close Calculator"
        >
          ✕
        </button>

        {/* Logo & Title */}
        <div className="text-center">
          <img
            src="/yashwin-app-store/calculator-logo.png"
            alt="VANSH CALCULATOR"
            className="w-24 h-24 sm:w-28 sm:h-28 object-cover mx-auto mb-2 rounded-2xl border-2 border-[#ff9800]/40 shadow-md"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = '/icon-512.png';
            }}
          />
          <h2 className="text-[#ff9800] font-black text-2xl sm:text-3xl tracking-tight">
            VANSH CALCULATOR
          </h2>
          <div className="text-[#888] text-[11px] font-semibold mb-4">
            Version 2.0 • Offline First
          </div>
        </div>

        {/* Display Box */}
        <div className="bg-[#050505] border-3 border-[#292929] rounded-[22px] min-h-[110px] p-4 mb-4 flex flex-col justify-center">
          <div className="text-[#aaa] text-right text-base sm:text-lg min-h-[24px] overflow-x-auto whitespace-nowrap">
            {getExpressionText()}
          </div>
          <div className="text-white text-right text-4xl sm:text-5xl font-black overflow-x-auto whitespace-nowrap leading-none mt-1">
            {formatNumber(current)}
          </div>
        </div>

        {/* Keypad Buttons */}
        <div className="grid grid-cols-4 gap-2 sm:gap-2.5">
          <button
            onClick={handleClearAll}
            className="h-14 sm:h-16 rounded-[18px] bg-[#5a5a5a] hover:bg-[#6a6a6a] text-white font-extrabold text-xl active:scale-95 transition-transform"
          >
            AC
          </button>
          <button
            onClick={handleBackspace}
            className="h-14 sm:h-16 rounded-[18px] bg-[#5a5a5a] hover:bg-[#6a6a6a] text-white font-extrabold text-xl active:scale-95 transition-transform"
          >
            ⌫
          </button>
          <button
            onClick={handlePercentage}
            className="h-14 sm:h-16 rounded-[18px] bg-[#5a5a5a] hover:bg-[#6a6a6a] text-white font-extrabold text-xl active:scale-95 transition-transform"
          >
            %
          </button>
          <button
            onClick={() => handleChooseOperator('/')}
            className="h-14 sm:h-16 rounded-[18px] bg-[#ff9800] hover:bg-[#ff9800]/90 text-black font-black text-2xl active:scale-95 transition-transform"
          >
            ÷
          </button>

          <button
            onClick={() => handleNumber('7')}
            className="h-14 sm:h-16 rounded-[18px] bg-[#292929] hover:bg-[#333] text-white font-extrabold text-2xl active:scale-95 transition-transform"
          >
            7
          </button>
          <button
            onClick={() => handleNumber('8')}
            className="h-14 sm:h-16 rounded-[18px] bg-[#292929] hover:bg-[#333] text-white font-extrabold text-2xl active:scale-95 transition-transform"
          >
            8
          </button>
          <button
            onClick={() => handleNumber('9')}
            className="h-14 sm:h-16 rounded-[18px] bg-[#292929] hover:bg-[#333] text-white font-extrabold text-2xl active:scale-95 transition-transform"
          >
            9
          </button>
          <button
            onClick={() => handleChooseOperator('*')}
            className="h-14 sm:h-16 rounded-[18px] bg-[#ff9800] hover:bg-[#ff9800]/90 text-black font-black text-2xl active:scale-95 transition-transform"
          >
            ×
          </button>

          <button
            onClick={() => handleNumber('4')}
            className="h-14 sm:h-16 rounded-[18px] bg-[#292929] hover:bg-[#333] text-white font-extrabold text-2xl active:scale-95 transition-transform"
          >
            4
          </button>
          <button
            onClick={() => handleNumber('5')}
            className="h-14 sm:h-16 rounded-[18px] bg-[#292929] hover:bg-[#333] text-white font-extrabold text-2xl active:scale-95 transition-transform"
          >
            5
          </button>
          <button
            onClick={() => handleNumber('6')}
            className="h-14 sm:h-16 rounded-[18px] bg-[#292929] hover:bg-[#333] text-white font-extrabold text-2xl active:scale-95 transition-transform"
          >
            6
          </button>
          <button
            onClick={() => handleChooseOperator('-')}
            className="h-14 sm:h-16 rounded-[18px] bg-[#ff9800] hover:bg-[#ff9800]/90 text-black font-black text-2xl active:scale-95 transition-transform"
          >
            −
          </button>

          <button
            onClick={() => handleNumber('1')}
            className="h-14 sm:h-16 rounded-[18px] bg-[#292929] hover:bg-[#333] text-white font-extrabold text-2xl active:scale-95 transition-transform"
          >
            1
          </button>
          <button
            onClick={() => handleNumber('2')}
            className="h-14 sm:h-16 rounded-[18px] bg-[#292929] hover:bg-[#333] text-white font-extrabold text-2xl active:scale-95 transition-transform"
          >
            2
          </button>
          <button
            onClick={() => handleNumber('3')}
            className="h-14 sm:h-16 rounded-[18px] bg-[#292929] hover:bg-[#333] text-white font-extrabold text-2xl active:scale-95 transition-transform"
          >
            3
          </button>
          <button
            onClick={() => handleChooseOperator('+')}
            className="h-14 sm:h-16 rounded-[18px] bg-[#ff9800] hover:bg-[#ff9800]/90 text-black font-black text-2xl active:scale-95 transition-transform"
          >
            +
          </button>

          <button
            onClick={() => handleNumber('0')}
            className="col-span-2 h-14 sm:h-16 rounded-[18px] bg-[#292929] hover:bg-[#333] text-white font-extrabold text-2xl active:scale-95 transition-transform"
          >
            0
          </button>
          <button
            onClick={handleDecimal}
            className="h-14 sm:h-16 rounded-[18px] bg-[#292929] hover:bg-[#333] text-white font-extrabold text-2xl active:scale-95 transition-transform"
          >
            .
          </button>
          <button
            onClick={() => handleCalculate()}
            className="h-14 sm:h-16 rounded-[18px] bg-[#ff9800] hover:bg-[#ff9800]/90 text-black font-black text-2xl active:scale-95 transition-transform"
          >
            =
          </button>
        </div>

        {/* History Section */}
        <div className="mt-5 bg-[#0e0e0e] border-2 border-[#292929] rounded-[22px] p-3.5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[#ff9800] text-lg font-black m-0">
              Calculation History
            </h3>
            {history.length > 0 && (
              <button
                onClick={handleClearHistory}
                className="bg-[#5b5b5b] hover:bg-red-700 text-white rounded-lg px-3 py-1 text-xs font-bold transition-colors"
              >
                CLEAR
              </button>
            )}
          </div>
          <div className="text-[#999] text-xs mb-2">
            Total Maths: {history.length}
          </div>

          <div className="max-h-40 overflow-y-auto space-y-1.5">
            {history.length === 0 ? (
              <div className="text-center text-[#777] py-4 text-xs">
                No calculations yet
              </div>
            ) : (
              history.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-[#1b1b1b] rounded-xl px-3 py-2 text-xs"
                >
                  <div className="truncate mr-2">
                    <span className="text-white font-medium">{item.expression} = </span>
                    <span className="text-[#63d636] font-bold">{item.answer}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleDeleteHistory(idx)}
                      title="Delete"
                      className="w-7 h-7 rounded bg-[#151515] border border-[#444] text-red-500 hover:bg-red-950 flex items-center justify-center text-xs"
                    >
                      🗑
                    </button>
                    <button
                      onClick={() => handleSaveHistoryItem(idx)}
                      title="Save"
                      className="w-7 h-7 rounded bg-[#151515] border border-[#444] text-[#38d85b] hover:bg-green-950 flex items-center justify-center text-xs"
                    >
                      💾
                    </button>
                    <button
                      onClick={() => handleShareItem(item)}
                      title="Share"
                      className="w-7 h-7 rounded bg-[#151515] border border-[#444] text-[#168cff] hover:bg-blue-950 flex items-center justify-center text-xs"
                    >
                      🔗
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-dashed border-[#555] mt-2.5 pt-2 px-1">
            <span className="text-[#ff9800] text-xs font-bold">TOTAL (ALL MATHS)</span>
            <span className="text-[#63d636] text-base font-black">
              {formatNumber(historyTotal)}
            </span>
          </div>
        </div>

        {/* Saved Maths Section */}
        <div className="mt-4 bg-[#0e0e0e] border-2 border-[#292929] rounded-[22px] p-3.5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[#ff9800] text-lg font-black m-0">
              Saved Maths
            </h3>
            {saved.length > 0 && (
              <button
                onClick={handleClearSaved}
                className="bg-[#5b5b5b] hover:bg-red-700 text-white rounded-lg px-3 py-1 text-xs font-bold transition-colors"
              >
                CLEAR
              </button>
            )}
          </div>
          <div className="text-[#999] text-xs mb-2">
            Saved: {saved.length}
          </div>

          <div className="max-h-40 overflow-y-auto space-y-1.5">
            {saved.length === 0 ? (
              <div className="text-center text-[#777] py-4 text-xs">
                No saved maths
              </div>
            ) : (
              saved.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-[#1b1b1b] rounded-xl px-3 py-2 text-xs"
                >
                  <div className="truncate mr-2">
                    <span className="text-white font-medium">{item.expression} = </span>
                    <span className="text-[#63d636] font-bold">{item.answer}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleDeleteSaved(idx)}
                      title="Delete"
                      className="w-7 h-7 rounded bg-[#151515] border border-[#444] text-red-500 hover:bg-red-950 flex items-center justify-center text-xs"
                    >
                      🗑
                    </button>
                    <button
                      onClick={() => handleShareItem(item)}
                      title="Share"
                      className="w-7 h-7 rounded bg-[#151515] border border-[#444] text-[#168cff] hover:bg-blue-950 flex items-center justify-center text-xs"
                    >
                      🔗
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-dashed border-[#555] mt-2.5 pt-2 px-1">
            <span className="text-[#ff9800] text-xs font-bold">TOTAL SAVED</span>
            <span className="text-[#63d636] text-base font-black">
              {formatNumber(savedTotal)}
            </span>
          </div>
        </div>

        <div className="text-center text-[#777] text-xs mt-4">
          VANSH CALCULATOR • Offline First
        </div>
      </div>
    </div>
  );
};
