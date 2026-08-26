import React, { useState } from 'react';
import { useApp, AppView } from '../context/AppContext';
import {
  Factory,
  Search,
  LayoutDashboard,
  Users,
  Send,
  UserPlus,
  Wrench,
  Cog,
  Activity,
  Boxes,
  Palette,
  DollarSign,
  Kanban,
  LogOut,
  Menu,
  X,
  Tv,
  Layers,
  FileSpreadsheet
} from 'lucide-react';

export const Header: React.FC = () => {
  const {
    currentUser,
    currentView,
    setCurrentView,
    logout,
    openSearchModal,
    isTVMode,
    toggleTVMode
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;
    openSearchModal(searchQuery);
    setSearchQuery('');
  };

  const navItems: { id: AppView; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Обзор', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'crm', label: 'CRM / Заказы', icon: <UserPlus className="w-4 h-4" /> },
    { id: 'orders', label: 'Цех', icon: <Cog className="w-4 h-4" /> },
    { id: 'monitor', label: 'Мониторинг', icon: <Activity className="w-4 h-4" /> },
    { id: 'finance', label: 'Аналитика и Объёмы', icon: <DollarSign className="w-4 h-4" /> },
    { id: 'warehouse', label: 'Склад сырья', icon: <Boxes className="w-4 h-4" /> },
    { id: 'blanks', label: 'Заготовки', icon: <Factory className="w-4 h-4" /> },
    { id: 'finished', label: 'Готовые изделия', icon: <Boxes className="w-4 h-4" /> },
    { id: 'services', label: 'Услуги', icon: <Wrench className="w-4 h-4" /> },
    { id: 'paint', label: 'Краска', icon: <Palette className="w-4 h-4" /> },
    { id: 'sanding', label: 'Шлиповка', icon: <Layers className="w-4 h-4" /> },
    { id: 'kanban', label: 'Kanban', icon: <Kanban className="w-4 h-4" /> },
    { id: 'workers', label: 'Персонал', icon: <Users className="w-4 h-4" /> },
    { id: 'telegram', label: 'Telegram', icon: <Send className="w-4 h-4" /> },
  ];

  if (!currentUser || currentView === 'login') return null;

  return (
    <>
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
        <div className="max-w-[1560px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3 shrink-0">
            {currentUser.role === 'admin' && (
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="xl:hidden p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors"
                aria-label="Меню"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            )}

            <div
              onClick={() => {
                if (currentUser.role === 'admin') setCurrentView('dashboard');
                else if (currentUser.role === 'worker') setCurrentView('worker-terminal');
                else if (currentUser.role === 'kanban') setCurrentView('kanban');
              }}
              className="flex items-center gap-2.5 cursor-pointer select-none group"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
                <Factory className="w-5 h-5" />
              </div>
              <div className="hidden sm:block">
                <span className="font-headline font-extrabold text-base text-slate-900 tracking-tight block leading-none">
                  Mebel Aliya
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider text-blue-600 block mt-0.5">
                  ERP & ПРОИЗВОДСТВО
                </span>
              </div>
            </div>
          </div>

          {/* Universal Order Search */}
          <form onSubmit={handleSearch} className="flex-1 max-w-xs sm:max-w-md mx-2">
            <div className="relative flex items-center">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск заказа № (напр. 0001) или клиент..."
                className="w-full pl-9 pr-8 py-2 bg-slate-100/90 hover:bg-slate-100 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-xl text-xs sm:text-sm text-slate-800 placeholder-slate-400 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-medium"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
              {searchQuery && (
                <button
                  type="submit"
                  className="absolute right-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 px-2 py-0.5 rounded-md shadow-xs transition-colors"
                >
                  Найти
                </button>
              )}
            </div>
          </form>

          {/* Desktop Navigation Tabs (Admin) */}
          {currentUser.role === 'admin' && (
            <nav className="hidden xl:flex items-center gap-1 overflow-x-auto max-w-2xl py-1 no-scrollbar">
              {navItems.map((item) => {
                const isActive = currentView === item.id || 
                  (item.id === 'orders' && (currentView as string) === 'production') ||
                  (item.id === 'monitor' && (currentView as string) === 'monitoring') ||
                  (item.id === 'finance' && (currentView as string) === 'analytics');
                return (
                  <button
                    key={item.id}
                    onClick={() => setCurrentView(item.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          )}

          {/* Right Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {currentUser.role === 'admin' && currentView === 'kanban' && (
              <button
                onClick={toggleTVMode}
                className={`hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                  isTVMode
                    ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/25'
                    : 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200'
                }`}
                title="TV Режим 4K для цеха"
              >
                <Tv className="w-4 h-4 text-amber-500" />
                <span>TV 4K</span>
              </button>
            )}

            <div className="hidden md:flex items-center gap-2 px-2.5 py-1.5 bg-slate-100 rounded-xl border border-slate-200 text-xs font-medium text-slate-700">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{currentUser.name}</span>
            </div>

            <button
              onClick={logout}
              className="flex items-center gap-1.5 px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs rounded-xl transition-all shadow-xs"
              title="Выйти"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Выход</span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && currentUser.role === 'admin' && (
        <div className="xl:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative ml-auto w-full max-w-xs bg-white h-full shadow-2xl p-6 flex flex-col justify-between overflow-y-auto">
            <div>
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center font-bold">
                    MA
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 text-sm block">Mebel Aliya ERP</span>
                    <span className="text-[10px] text-slate-500 block font-mono">Администратор</span>
                  </div>
                </div>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-1">
                {navItems.map((item) => {
                  const isActive = currentView === item.id ||
                    (item.id === 'orders' && (currentView as string) === 'production') ||
                    (item.id === 'monitor' && (currentView as string) === 'monitoring') ||
                    (item.id === 'finance' && (currentView as string) === 'analytics');
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setCurrentView(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-semibold transition-all ${
                        isActive
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                      }`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-6 border-t border-slate-200">
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  logout();
                }}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold rounded-xl text-sm transition-all"
              >
                <LogOut className="w-4 h-4" />
                <span>Выйти из аккаунта</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
