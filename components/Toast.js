'use client';

import { useState, useRef, useCallback, createContext, useContext } from 'react';

const ToastContext = createContext(null);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }) {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);

  const showToast = useCallback((msg, duration = 2800) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setMessage(msg);
    setVisible(true);
    timerRef.current = setTimeout(() => setVisible(false), duration);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div 
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-xl bg-zinc-900/95 border border-zinc-800 text-xs font-semibold text-zinc-100 shadow-2xl backdrop-blur-md transition-all duration-300 ${
          visible 
            ? 'opacity-100 translate-y-0 scale-100' 
            : 'opacity-0 translate-y-3 scale-95 pointer-events-none'
        }`}
      >
        {message}
      </div>
    </ToastContext.Provider>
  );
}
