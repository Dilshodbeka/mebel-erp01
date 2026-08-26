import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { ALL_WORKER_PROCS, PAINT_PROCS } from '../constants';
import { formatMoney, formatHoursMinutes } from '../utils/formatters';
import { WorkerDetailModal } from './WorkerDetailModal';
import {
  UserCheck,
  UserPlus,
  Edit2,
  Trash2,
  BarChart3,
  Calendar,
  Clock,
  Sparkles,
  ChevronRight,
  TrendingUp,
  X
} from 'lucide-react';

export const WorkersView: React.FC = () => {
  const {
    workers,
    orders,
    paintRecords,
    orderLabor,
    activityLogs,
    loadAllData,
    showToast,
    logActivity,
    currentUser
  } = useApp();

  const [activeTab, setActiveTab] = useState<'list' | 'analytics'>('list');
  const [workerNameInput, setWorkerNameInput] = useState('');
  const [selectedProcs, setSelectedProcs] = useState<string[]>([]);
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);
  const [selectedWorkerDetail, setSelectedWorkerDetail] = useState<string | null>(null);

  // Analytics period
  const [analyticsPeriod, setAnalyticsPeriod] = useState<'day' | 'week' | 'month' | 'all'>('month');

  const handleToggleProc = (proc: string) => {
    setSelectedProcs(prev =>
      prev.includes(proc) ? prev.filter(p => p !== proc) : [...prev, proc]
    );
  };

  const handleEdit = (worker: (typeof workers)[0]) => {
    setEditingWorkerId(worker.name);
    setWorkerNameInput(worker.name);
    setSelectedProcs(worker.procs || []);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleResetForm = () => {
    setEditingWorkerId(null);
    setWorkerNameInput('');
    setSelectedProcs([]);
  };

  const handleSaveWorker = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const name = workerNameInput.trim();
    if (!name) {
      showToast('Введите ФИО сотрудника', 'error');
      return;
    }
    if (selectedProcs.length === 0) {
      showToast('Выберите хотя бы один доступный процесс', 'error');
      return;
    }

    try {
      if (editingWorkerId && editingWorkerId !== name) {
        await supabase.from('workers').delete().eq('name', editingWorkerId);
        await supabase.from('workers').insert({ name, procs: selectedProcs });
        showToast(`Сотрудник переименован в «${name}»`);
      } else {
        await supabase.from('workers').upsert({ name, procs: JSON.stringify(selectedProcs) });
        showToast(editingWorkerId ? 'Доступы обновлены' : 'Сотрудник успешно добавлен');
      }

      await logActivity(
        currentUser?.name || 'Админ',
        editingWorkerId ? 'Обновил сотрудника' : 'Добавил сотрудника',
        `Сотрудник: ${name}, процессов: ${selectedProcs.length}`,
        'worker'
      );

      handleResetForm();
      await loadAllData();
    } catch (err: any) {
      showToast('Ошибка: ' + err.message, 'error');
    }
  };

  const handleDeleteWorker = async (name: string) => {
    if (!confirm(`Удалить сотрудника «${name}»?`)) return;
    try {
      await supabase.from('workers').delete().eq('name', name);
      await logActivity(currentUser?.name || 'Админ', 'Удалил сотрудника', `Сотрудник: ${name}`, 'delete');
      showToast(`Сотрудник «${name}» удален`);
      await loadAllData();
    } catch (err: any) {
      showToast('Ошибка удаления: ' + err.message, 'error');
    }
  };

  // Analytics helper
  const isInPeriod = (dateStr?: string) => {
    if (!dateStr || analyticsPeriod === 'all') return true;
    const d = new Date(dateStr);
    const now = new Date();
    if (analyticsPeriod === 'day') return d.toDateString() === now.toDateString();
    if (analyticsPeriod === 'week') {
      const ago = new Date(now);
      ago.setDate(now.getDate() - 7);
      return d >= ago && d <= now;
    }
    if (analyticsPeriod === 'month') {
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }
    return true;
  };

  interface WorkerSummary {
    name: string;
    procCount: number;
    qtyTotal: number;
    minutesTotal: number;
    sumTotal: number;
    orderCount: number;
  }

  const workerSummaryMap: Record<string, WorkerSummary> = {};

  workers.forEach(w => {
    workerSummaryMap[w.name] = {
      name: w.name,
      procCount: 0,
      qtyTotal: 0,
      minutesTotal: 0,
      sumTotal: 0,
      orderCount: 0
    };
  });

  const workerOrderSets: Record<string, Set<string>> = {};

  orders.forEach(o => {
    if (!o.history) return;
    Object.keys(o.history).forEach(pName => {
      const h = o.history?.[pName];
      if (!h || !h.end || !isInPeriod(h.end)) return;
      const workerName = h.completed_by || h.worker;
      if (!workerName) return;

      if (!workerSummaryMap[workerName]) {
        workerSummaryMap[workerName] = {
          name: workerName,
          procCount: 0,
          qtyTotal: 0,
          minutesTotal: 0,
          sumTotal: 0,
          orderCount: 0
        };
      }

      if (!workerOrderSets[workerName]) workerOrderSets[workerName] = new Set();
      workerOrderSets[workerName].add(o.id);

      const startT = h.start ? new Date(h.start) : null;
      const endT = h.end ? new Date(h.end) : null;
      const dur = startT && endT ? Math.round((endT.getTime() - startT.getTime()) / 60000) : 0;

      workerSummaryMap[workerName].procCount += 1;
      workerSummaryMap[workerName].qtyTotal += (h.qty_done || 1);
      workerSummaryMap[workerName].minutesTotal += dur;
    });
  });

  paintRecords.forEach(r => {
    if (!isInPeriod(r.created_at) || !r.worker) return;
    if (!workerSummaryMap[r.worker]) {
      workerSummaryMap[r.worker] = {
        name: r.worker,
        procCount: 0,
        qtyTotal: 0,
        minutesTotal: 0,
        sumTotal: 0,
        orderCount: 0
      };
    }
    if (!workerOrderSets[r.worker]) workerOrderSets[r.worker] = new Set();
    workerOrderSets[r.worker].add(r.order_id);

    workerSummaryMap[r.worker].procCount += 1;
    workerSummaryMap[r.worker].qtyTotal += (r.qty_done || 1);
  });

  orderLabor.forEach(l => {
    if (!isInPeriod(l.created_at) || !l.worker) return;
    if (!workerSummaryMap[l.worker]) {
      workerSummaryMap[l.worker] = {
        name: l.worker,
        procCount: 0,
        qtyTotal: 0,
        minutesTotal: 0,
        sumTotal: 0,
        orderCount: 0
      };
    }
    if (!workerOrderSets[l.worker]) workerOrderSets[l.worker] = new Set();
    workerOrderSets[l.worker].add(l.order_id);

    workerSummaryMap[l.worker].sumTotal += (l.qty || 1) * (l.unit_price || 0);
  });

  Object.keys(workerSummaryMap).forEach(wName => {
    workerSummaryMap[wName].orderCount = workerOrderSets[wName]?.size || 0;
  });

  const workerSummaryList = Object.values(workerSummaryMap).sort((a, b) => b.qtyTotal - a.qtyTotal);

  return (
    <div className="space-y-6">
      {/* Subnav */}
      <div className="flex gap-2 p-1.5 bg-white/5 border border-white/10 backdrop-blur-md rounded-2xl max-w-sm">
        <button
          onClick={() => setActiveTab('list')}
          className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'list' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          👤 Сотрудники
        </button>
        <button
          onClick={() => setActiveTab('analytics')}
          className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'analytics' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          📊 Аналитика
        </button>
      </div>

      {activeTab === 'list' ? (
        /* Worker CRUD */
        <div className="space-y-6">
          {/* Add / Edit Form */}
          <div className={`bg-white/[0.04] backdrop-blur-xl rounded-3xl p-6 border shadow-xl shadow-black/20 transition-all text-slate-200 ${editingWorkerId ? 'border-amber-400/40 bg-amber-500/10' : 'border-white/10'}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white text-lg font-headline flex items-center gap-2">
                {editingWorkerId ? <Edit2 className="w-5 h-5 text-amber-400" /> : <UserPlus className="w-5 h-5 text-blue-400" />}
                <span>{editingWorkerId ? `Редактирование: ${editingWorkerId}` : 'Добавить нового сотрудника'}</span>
              </h3>
              {editingWorkerId && (
                <button
                  onClick={handleResetForm}
                  className="p-1.5 text-slate-400 hover:text-white bg-white/10 rounded-lg text-xs font-bold flex items-center gap-1"
                >
                  <X className="w-4 h-4" />
                  <span>Отмена</span>
                </button>
              )}
            </div>

            <form onSubmit={handleSaveWorker} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  ФИО сотрудника
                </label>
                <input
                  type="text"
                  value={workerNameInput}
                  onChange={(e) => setWorkerNameInput(e.target.value)}
                  placeholder="Например: Алишер Умаров"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-blue-400"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Доступы к процессам в цехе
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {ALL_WORKER_PROCS.map((proc) => {
                    const isSelected = selectedProcs.includes(proc);
                    const isPaint = PAINT_PROCS.includes(proc);
                    return (
                      <label
                        key={proc}
                        className={`flex items-center gap-2.5 p-3 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-blue-600/30 border-blue-500 text-white shadow-lg shadow-blue-900/30'
                            : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleProc(proc)}
                          className="w-4 h-4 rounded-md text-blue-600 focus:ring-blue-500 border-white/20 bg-white/5"
                        />
                        <span>{isPaint ? `🎨 ${proc}` : proc}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-sm shadow-lg shadow-blue-900/30 cursor-pointer transition-colors"
                >
                  {editingWorkerId ? 'Сохранить изменения' : 'Добавить сотрудника'}
                </button>
              </div>
            </form>
          </div>

          {/* Workers Table */}
          <div className="bg-white/[0.04] backdrop-blur-xl rounded-3xl p-6 border border-white/10 shadow-xl shadow-black/20 text-slate-200">
            <h3 className="font-bold text-white text-lg font-headline mb-4">
              Список сотрудников ({workers.length})
            </h3>

            {workers.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-sm">
                Нет добавленных сотрудников
              </div>
            ) : (
              <div className="border border-white/10 rounded-2xl overflow-x-auto bg-white/[0.02]">
                <table className="w-full text-xs text-left">
                  <thead className="bg-white/5 text-slate-400 uppercase tracking-wider text-[11px] border-b border-white/10">
                    <tr>
                      <th className="p-3.5">Сотрудник</th>
                      <th className="p-3.5">Доступные процессы</th>
                      <th className="p-3.5 text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {workers.map((worker) => (
                      <tr key={worker.name} className="hover:bg-white/5 transition-colors">
                        <td className="p-3.5 font-bold text-white text-sm">{worker.name}</td>
                        <td className="p-3.5">
                          <div className="flex flex-wrap gap-1">
                            {(worker.procs || []).map((p) => (
                              <span
                                key={p}
                                className="px-2 py-0.5 bg-white/5 text-slate-300 border border-white/10 rounded-md font-medium text-[11px]"
                              >
                                {p}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-3.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleEdit(worker)}
                              className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors"
                              title="Редактировать"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteWorker(worker.name)}
                              className="p-2 text-rose-400 hover:bg-rose-500/20 rounded-lg transition-colors"
                              title="Удалить"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Personnel Analytics */
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <h3 className="font-bold text-white text-lg font-headline">Контроль и выработка персонала</h3>
            <div className="flex gap-1.5 bg-white/5 border border-white/10 backdrop-blur-md p-1 rounded-xl">
              {(['day', 'week', 'month', 'all'] as const).map(p => {
                const labels = { day: 'Сегодня', week: 'Неделя', month: 'Месяц', all: 'Всё время' };
                const isSel = analyticsPeriod === p;
                return (
                  <button
                    key={p}
                    onClick={() => setAnalyticsPeriod(p)}
                    className={`py-1 px-3 rounded-lg text-xs font-bold transition-all ${
                      isSel ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {labels[p]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {workerSummaryList.map((ws) => (
              <div
                key={ws.name}
                onClick={() => setSelectedWorkerDetail(ws.name)}
                className="bg-white/[0.04] backdrop-blur-xl rounded-2xl p-5 border border-white/10 shadow-xl shadow-black/20 hover:border-blue-500/50 hover:bg-white/[0.07] cursor-pointer transition-all flex flex-col justify-between text-slate-200"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-base text-white font-headline">{ws.name}</span>
                    <span className="px-2.5 py-1 bg-blue-500/20 text-blue-300 border border-blue-500/30 font-mono font-bold text-xs rounded-lg">
                      {ws.qtyTotal} ед.
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 mb-4">
                    <div>Процессов: <b className="text-slate-200 font-mono">{ws.procCount}</b></div>
                    <div>Заказов: <b className="text-slate-200 font-mono">{ws.orderCount}</b></div>
                    <div>Время: <b className="text-emerald-400 font-mono">{formatHoursMinutes(ws.minutesTotal)}</b></div>
                    <div>Начислено: <b className="text-blue-400 font-mono">{formatMoney(ws.sumTotal)}</b></div>
                  </div>
                </div>

                <div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs font-bold text-blue-400">
                  <span>Подробный журнал</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail Modal */}
      <WorkerDetailModal
        workerName={selectedWorkerDetail}
        isOpen={!!selectedWorkerDetail}
        onClose={() => setSelectedWorkerDetail(null)}
      />
    </div>
  );
};
