import React from 'react';
import { useApp } from '../context/AppContext';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-center justify-between p-3.5 rounded-2xl shadow-2xl backdrop-blur-xl border text-sm font-medium transition-all transform translate-y-0 ${
            toast.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-500/30 text-emerald-200'
              : toast.type === 'error'
              ? 'bg-rose-950/80 border-rose-500/30 text-rose-200'
              : 'bg-slate-900/80 border-blue-500/30 text-blue-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
            {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />}
            {toast.type === 'info' && <Info className="w-5 h-5 text-blue-400 shrink-0" />}
            <span className="leading-snug">{toast.message}</span>
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            className="text-slate-400 hover:text-white p-1 rounded-lg shrink-0 ml-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
