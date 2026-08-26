import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { formatMoney, getProcessCode, calculateOrderProgress } from '../utils/formatters';
import { MonitorOrderModal } from './MonitorOrderModal';
import {
  Kanban,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Search,
  Eye
} from 'lucide-react';

export const KanbanView: React.FC = () => {
  const { orders, crmOrders, loadAllData, showToast, logActivity, currentUser } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Kanban stage categorization
  // Column 1: Новые / В очереди (no steps started)
  // Column 2: Раскрой & Кромка & ЧПУ
  // Column 3: Малярный цех (любые малярные процессы)
  // Column 4: Сборка & Подготовка
  // Column 5: Готовы к отгрузке / Завершены (100%)

  const categorizeOrder = (order: (typeof orders)[0]): string => {
    const prog = calculateOrderProgress(order);
    if (prog === 100) return 'done';

    const path = Array.isArray(order?.path) ? order.path : [];
    const activeProcs = path.filter(p => {
      const h = order?.history?.[p];
      return h?.start && !h?.end;
    });

    if (activeProcs.length === 0) {
      const finishedAny = path.some(p => order?.history?.[p]?.end);
      if (!finishedAny) return 'queue';
    }

    const currentProc = activeProcs[0] || path.find(p => !order?.history?.[p]?.end) || '';

    if (
      currentProc.includes('Раскрой') ||
      currentProc.includes('Кромка') ||
      currentProc.includes('ЧПУ') ||
      currentProc.includes('Присадка')
    ) {
      return 'cutting';
    }

    if (
      currentProc.includes('Краска') ||
      currentProc.includes('Шлифовка') ||
      currentProc.includes('Грунтовка') ||
      currentProc.includes('Полировка') ||
      currentProc.includes('Патина')
    ) {
      return 'paint';
    }

    if (
      currentProc.includes('Сборка') ||
      currentProc.includes('Упаковка') ||
      currentProc.includes('Монтаж')
    ) {
      return 'assembly';
    }

    return 'cutting';
  };

  const columns = [
    { id: 'queue', title: '📥 В очереди', color: 'border-white/10 bg-white/[0.02]', badge: 'bg-white/10 text-slate-300' },
    { id: 'cutting', title: '🪚 Раскрой / ЧПУ / Кромка', color: 'border-blue-500/20 bg-blue-500/[0.03]', badge: 'bg-blue-500/20 text-blue-300 border border-blue-500/30' },
    { id: 'paint', title: '🎨 Малярный цех', color: 'border-amber-500/20 bg-amber-500/[0.03]', badge: 'bg-amber-500/20 text-amber-300 border border-amber-500/30' },
    { id: 'assembly', title: '🔩 Сборка & Упаковка', color: 'border-purple-500/20 bg-purple-500/[0.03]', badge: 'bg-purple-500/20 text-purple-300 border border-purple-500/30' },
    { id: 'done', title: '✅ Готовы к отгрузке', color: 'border-emerald-500/20 bg-emerald-500/[0.03]', badge: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' }
  ];

  const filteredOrders = orders.filter(o => {
    const crm = crmOrders.find(c => c.oid === o.id);
    const q = searchQuery.toLowerCase();
    return (
      (o.id || '').toLowerCase().includes(q) ||
      (crm?.client || '').toLowerCase().includes(q) ||
      (crm?.item || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-bold text-white text-lg font-headline flex items-center gap-2">
            <Kanban className="w-5 h-5 text-blue-400" />
            <span>Канбан-доска производства</span>
          </h3>
          <p className="text-xs text-slate-400 mt-1 font-medium">
            Визуальное отслеживание всех заказов по стадиям производственной цепочки
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по заказу или клиенту..."
            className="w-full pl-9 pr-3 py-2 bg-white/5 hover:bg-white/[0.08] focus:bg-white/10 border border-white/10 focus:border-blue-500/60 rounded-xl text-xs font-medium text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
        </div>
      </div>

      {/* Columns grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4 items-start">
        {columns.map(col => {
          const colOrders = filteredOrders.filter(o => categorizeOrder(o) === col.id);

          return (
            <div
              key={col.id}
              className={`rounded-3xl border ${col.color} p-4 flex flex-col min-h-[480px] max-h-[80vh] backdrop-blur-xl shadow-lg shadow-black/20`}
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
                <span className="font-bold text-xs font-headline text-slate-200">{col.title}</span>
                <span className={`font-mono font-bold text-xs px-2 py-0.5 rounded-full ${col.badge}`}>
                  {colOrders.length}
                </span>
              </div>

              <div className="space-y-3 overflow-y-auto flex-1 pr-1">
                {colOrders.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic">
                    Заказов нет
                  </div>
                ) : (
                  colOrders.map(o => {
                    const crm = crmOrders.find(c => c.oid === o.id);
                    const progress = calculateOrderProgress(o);
                    const isDone = progress === 100;
                    const path = Array.isArray(o?.path) ? o.path : [];
                    const activeProc = path.find(p => o?.history?.[p]?.start && !o?.history?.[p]?.end);

                    return (
                      <div
                        key={o.id}
                        onClick={() => setSelectedOrderId(o.id)}
                        className="bg-slate-900/60 backdrop-blur-md rounded-2xl p-4 border border-white/10 shadow-md hover:shadow-xl hover:border-blue-500/40 hover:bg-slate-900/80 cursor-pointer transition-all space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-black text-blue-400 text-sm">
                            #{o.id}
                          </span>
                          <span className="text-[11px] font-mono font-bold text-slate-400">
                            {progress}%
                          </span>
                        </div>

                        <div>
                          <div className="font-bold text-white text-xs line-clamp-1">
                            {crm?.client || 'Без клиента'}
                          </div>
                          {crm?.item && (
                            <div className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                              {crm.item}
                            </div>
                          )}
                        </div>

                        {activeProc && (
                          <div className="p-2 bg-blue-500/20 border border-blue-500/30 rounded-xl text-[11px] font-semibold text-blue-300 flex items-center gap-1.5 backdrop-blur-sm">
                            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                            <span className="truncate">{activeProc}</span>
                          </div>
                        )}

                        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              isDone ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50' : 'bg-gradient-to-r from-blue-500 to-indigo-500'
                            }`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>

                        <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400 font-medium">
                          <span>{path.length} процессов</span>
                          <span className="text-blue-400 font-bold hover:text-blue-300 flex items-center gap-0.5">
                            <Eye className="w-3 h-3" />
                            <span>Детали</span>
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal */}
      <MonitorOrderModal
        orderId={selectedOrderId}
        isOpen={!!selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
      />
    </div>
  );
};
