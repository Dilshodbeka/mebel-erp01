import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { formatMoney, calculateOrderProgress, getProcessCode, getPathProcUnit } from '../utils/formatters';
import { printProductionSheet } from '../utils/printUtils';
import {
  X,
  Printer,
  CheckCircle2,
  Trash2,
  Clock,
  PlayCircle,
  FileText,
  DollarSign,
  Calculator,
  ChevronRight
} from 'lucide-react';

export const MonitorOrderModal: React.FC<{
  orderId: string | null;
  isOpen: boolean;
  onClose: () => void;
}> = ({ orderId, isOpen, onClose }) => {
  const {
    orders,
    crmOrders,
    orderMaterials,
    orderLabor,
    orderCalcMetas,
    loadAllData,
    showToast,
    logActivity,
    currentUser,
    setCurrentView,
    setActiveCalcOrderId
  } = useApp();

  const [activeTab, setActiveTab] = useState<'processes' | 'info' | 'calc'>('processes');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'active' | 'done'>('all');

  if (!isOpen || !orderId) return null;

  const order = orders.find(o => o.id === orderId);
  const crmData = crmOrders.find(c => c.oid === orderId);

  const materials = orderMaterials.filter(m => m.order_id === orderId);
  const labor = orderLabor.filter(l => l.order_id === orderId);
  const calcMeta = orderCalcMetas.find(m => m.order_id === orderId);

  const matTotal = materials.reduce((s, m) => s + (m.qty || 0) * (m.unit_price || 0), 0);
  const laborTotal = labor.reduce((s, l) => s + (l.qty || 1) * (l.unit_price || 0), 0);
  const delivery = calcMeta?.delivery_cost || 0;
  const cost = matTotal + laborTotal + delivery;
  const salePrice = calcMeta?.sale_price || (typeof crmData?.price === 'number' ? crmData.price : parseFloat(crmData?.price as any) || 0);
  const profit = salePrice - cost;

  const progress = order ? calculateOrderProgress(order) : 0;

  // Complete process manually by admin
  const handleAdminCompleteProcess = async (processName: string) => {
    if (!order || !currentUser) return;
    const now = new Date().toISOString();
    const updatedHistory = { ...(order.history || {}) };
    const currentHist = { ...(updatedHistory[processName] || {}) };

    if (!currentHist.start) currentHist.start = now;
    currentHist.end = now;
    currentHist.completed_by = `${currentUser.name} (админ)`;
    currentHist.worker = currentHist.worker || currentUser.name;
    updatedHistory[processName] = currentHist;

    try {
      await supabase.from('orders').upsert({ id: order.id, path: order.path || [], history: updatedHistory });
      await logActivity(
        currentUser.name,
        'Завершил процесс вручную (админ)',
        `Заказ #${order.id}, процесс: ${processName}`,
        'process'
      );
      showToast(`Процесс «${processName}» отмечен завершенным`);
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка: ' + e.message, 'error');
    }
  };

  // Complete all processes on order
  const handleAdminCompleteOrder = async () => {
    if (!order || !currentUser) return;
    if (!confirm(`Завершить ВСЕ оставшиеся процессы заказа #${order.id}?`)) return;

    const now = new Date().toISOString();
    const updatedHistory = { ...(order.history || {}) };

    (order.path || []).forEach(p => {
      if (!updatedHistory[p]?.end) {
        updatedHistory[p] = {
          start: updatedHistory[p]?.start || now,
          end: now,
          completed_by: `${currentUser.name} (админ)`,
          worker: updatedHistory[p]?.worker || currentUser.name
        };
      }
    });

    try {
      await supabase.from('orders').upsert({ id: order.id, path: order.path || [], history: updatedHistory });
      await logActivity(
        currentUser.name,
        'Завершил заказ целиком (админ)',
        `Заказ #${order.id}`,
        'order'
      );
      showToast(`Заказ #${order.id} полностью завершен`);
      await loadAllData();
      onClose();
    } catch (e: any) {
      showToast('Ошибка: ' + e.message, 'error');
    }
  };

  const handleDeleteOrder = async () => {
    if (!confirm(`Удалить заказ #${orderId} из производства?`)) return;
    try {
      await supabase.from('orders').delete().eq('id', orderId);
      await logActivity(currentUser?.name || 'Админ', 'Удалил заказ', `Заказ #${orderId}`, 'delete');
      showToast(`Заказ #${orderId} удален`);
      await loadAllData();
      onClose();
    } catch (e: any) {
      showToast('Ошибка удаления: ' + e.message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900/90 backdrop-blur-2xl rounded-3xl max-w-3xl w-full max-h-[88vh] overflow-hidden flex flex-col shadow-2xl border border-white/15 text-slate-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-800 text-white p-6 border-b border-white/10">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs uppercase font-bold tracking-wider text-blue-200">Заказ в производстве</div>
              <div className="text-3xl font-black font-headline mt-0.5 tracking-tight">№ {orderId}</div>
              <div className="text-xs text-blue-100 mt-1">
                {crmData?.client || 'Без клиента'} · {crmData?.item || 'Без описания'}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-xl transition-colors border border-white/10"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <div className="flex-1 h-2 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400 rounded-full transition-all shadow-sm shadow-emerald-400/50" style={{ width: `${progress}%` }} />
            </div>
            <span className="font-mono font-bold text-sm">{progress}%</span>
          </div>
        </div>

        {/* Action bar & Subtabs */}
        <div className="px-6 pt-4 pb-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 bg-white/[0.02]">
          <div className="flex gap-1.5 p-1 bg-white/5 rounded-xl border border-white/10">
            <button
              onClick={() => setActiveTab('processes')}
              className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'processes' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📋 Маршрут
            </button>
            <button
              onClick={() => setActiveTab('info')}
              className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'info' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ℹ️ Детали CRM
            </button>
            <button
              onClick={() => setActiveTab('calc')}
              className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'calc' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🧮 Калькуляция
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => printProductionSheet(orderId, order?.path || [], crmData, materials)}
              className="flex items-center gap-1 px-3 py-1.5 bg-white/5 border border-white/10 text-slate-200 rounded-xl text-xs font-bold hover:bg-white/10 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Лист</span>
            </button>
            {progress < 100 && (
              <button
                onClick={handleAdminCompleteOrder}
                className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-bold hover:bg-emerald-500/30 transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Завершить всё</span>
              </button>
            )}
            <button
              onClick={handleDeleteOrder}
              className="p-2 text-rose-400 hover:bg-rose-500/20 rounded-xl border border-rose-500/20 transition-colors"
              title="Удалить заказ"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Body */}
        <div className="p-6 flex-1 overflow-y-auto">
          {activeTab === 'processes' && (
            <div className="space-y-4">
              {/* Filter */}
              <div className="flex gap-2">
                {(['all', 'pending', 'active', 'done'] as const).map(st => {
                  const labels = { all: 'Все', pending: 'Ожидают', active: 'В работе', done: 'Завершены' };
                  const isSel = filterStatus === st;
                  return (
                    <button
                      key={st}
                      onClick={() => setFilterStatus(st)}
                      className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                        isSel ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30' : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/10'
                      }`}
                    >
                      {labels[st]}
                    </button>
                  );
                })}
              </div>

              {/* Steps list */}
              <div className="space-y-2">
                {(order?.path || [])
                  .filter(proc => {
                    const h = order?.history?.[proc];
                    const isDone = !!h?.end;
                    const isActive = !!h?.start && !isDone;
                    if (filterStatus === 'pending') return !h?.start;
                    if (filterStatus === 'active') return isActive;
                    if (filterStatus === 'done') return isDone;
                    return true;
                  })
                  .map((proc) => {
                    const code = getProcessCode(order, proc);
                    const h = order?.history?.[proc];
                    const isDone = !!h?.end;
                    const isActive = !!h?.start && !isDone;

                    return (
                      <div
                        key={proc}
                        className={`p-3.5 rounded-2xl border flex items-center justify-between transition-all backdrop-blur-sm ${
                          isDone
                            ? 'bg-emerald-500/10 border-emerald-500/30'
                            : isActive
                            ? 'bg-blue-500/15 border-blue-500/30'
                            : 'bg-white/5 border-white/10'
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs px-2 py-0.5 bg-white/10 text-blue-300 font-bold rounded-lg border border-white/10">
                              {code}
                            </span>
                            <span className="font-bold text-sm text-white">{proc}</span>
                          </div>
                          <div className="text-xs text-slate-400 mt-1">
                            {isDone
                              ? `Завершил: ${h?.completed_by || h?.worker || '—'} (${h?.qty_done || 1} ${h?.unit || getPathProcUnit(proc)})`
                              : isActive
                              ? `В работе: ${h?.worker || '—'}`
                              : 'Ожидает в очереди'}
                          </div>
                        </div>

                        <div>
                          {!isDone ? (
                            <button
                              onClick={() => handleAdminCompleteProcess(proc)}
                              className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 font-bold rounded-xl text-xs flex items-center gap-1 transition-all"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Завершить</span>
                            </button>
                          ) : (
                            <span className="text-emerald-400 font-bold text-xs flex items-center gap-1">
                              <CheckCircle2 className="w-4 h-4" />
                              <span>Готово</span>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {activeTab === 'info' && (
            <div className="space-y-4 text-xs">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2">
                <div className="font-bold text-slate-400 uppercase tracking-wider text-[11px]">Карточка CRM</div>
                <div className="grid grid-cols-2 gap-3 text-slate-300">
                  <div>Клиент: <b className="text-white block font-bold">{crmData?.client || '—'}</b></div>
                  <div>Телефон: <b className="text-white block font-bold">{crmData?.phone || '—'}</b></div>
                  <div>Изделие: <b className="text-white block font-bold">{crmData?.item || '—'}</b></div>
                  <div>Цена продажи: <b className="text-blue-400 block font-bold font-mono">{formatMoney(crmData?.price)}</b></div>
                  <div>Адрес: <b className="text-white block font-bold">{crmData?.loc || '—'}</b></div>
                  <div>Срок сдачи: <b className="text-white block font-bold">{crmData?.due_date || '—'}</b></div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'calc' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-white text-sm font-headline">Сводка себестоимости и прибыли</h4>
                <button
                  onClick={() => {
                    onClose();
                    setActiveCalcOrderId(orderId);
                    setCurrentView('order-calc');
                  }}
                  className="text-xs font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                >
                  <span>Полная калькуляция</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-white/5 rounded-2xl border border-white/10 text-center">
                  <div className="text-base font-black font-mono text-white">{formatMoney(matTotal)}</div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 mt-0.5">Материалы</div>
                </div>
                <div className="p-3 bg-white/5 rounded-2xl border border-white/10 text-center">
                  <div className="text-base font-black font-mono text-white">{formatMoney(laborTotal)}</div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 mt-0.5">Работа/сборка</div>
                </div>
                <div className="p-3 bg-white/5 rounded-2xl border border-white/10 text-center">
                  <div className="text-base font-black font-mono text-white">{formatMoney(cost)}</div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 mt-0.5">Себестоимость</div>
                </div>
                <div className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 text-center">
                  <div className="text-base font-black font-mono text-emerald-400">{formatMoney(profit)}</div>
                  <div className="text-[10px] uppercase font-bold text-emerald-300 mt-0.5">Прибыль</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
