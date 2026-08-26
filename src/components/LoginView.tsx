import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Factory, ArrowRight, ShieldCheck, Tv, UserCheck, HardHat } from 'lucide-react';

export const LoginView: React.FC = () => {
  const { login, workers } = useApp();
  const [loginInput, setLoginInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!loginInput.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await login(loginInput.trim());
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickLogin = async (name: string) => {
    setLoginInput(name);
    setIsSubmitting(true);
    try {
      await login(name);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-slate-900/60 backdrop-blur-2xl rounded-3xl p-8 shadow-2xl border border-white/10 text-slate-200">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-2xl mx-auto flex items-center justify-center text-white shadow-xl shadow-blue-600/30 mb-4 border border-blue-400/30">
          <Factory className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-black font-headline text-white tracking-tight">
          Mebel Aliya ERP
        </h1>
        <p className="text-slate-400 text-xs mt-1.5 font-medium">
          Система управления производством мебели
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
            Логин или ФИО сотрудника
          </label>
          <input
            type="text"
            value={loginInput}
            onChange={(e) => setLoginInput(e.target.value)}
            placeholder="Введите логин (например, admin939291)"
            className="w-full px-4 py-3.5 bg-white/5 border border-white/10 focus:border-blue-500 focus:bg-white/10 rounded-xl text-sm font-medium text-white placeholder-slate-500 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            autoFocus
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !loginInput.trim()}
          className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-all shadow-lg shadow-blue-900/40 border border-blue-400/20 flex items-center justify-center gap-2 cursor-pointer"
        >
          <span>{isSubmitting ? 'Вход...' : 'Войти в систему'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>

      <div className="mt-8 pt-6 border-t border-white/10">
        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider text-center mb-3">
          Быстрый вход
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <button
            onClick={() => handleQuickLogin('admin939291')}
            className="flex items-center justify-center gap-2 p-2.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border border-blue-500/20 font-bold rounded-xl text-xs transition-all"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Администратор</span>
          </button>
          <button
            onClick={() => handleQuickLogin('kanban')}
            className="flex items-center justify-center gap-2 p-2.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 font-bold rounded-xl text-xs transition-all"
          >
            <Tv className="w-4 h-4" />
            <span>Kanban TV</span>
          </button>
        </div>

        {workers.length > 0 && (
          <div>
            <div className="text-[11px] text-slate-400 mb-2 font-medium">Сотрудники в цехе:</div>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
              {workers.map((w) => (
                <button
                  key={w.name}
                  onClick={() => handleQuickLogin(w.name)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-lg text-xs font-medium transition-all"
                >
                  <HardHat className="w-3 h-3 text-slate-400" />
                  <span>{w.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
