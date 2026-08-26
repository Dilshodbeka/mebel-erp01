import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import {
  getProcessCode,
  isPaintProc,
  isAssemblyProc,
  getPathProcUnit
} from '../utils/formatters';
import { PAINT_WORKER_TYPES } from '../constants';
import { WorkerInlinePaint } from './WorkerInlinePaint';
import { WorkerInlineAssembly } from './WorkerInlineAssembly';
import { WorkerSandingTerminal } from './WorkerSandingTerminal';
import { MyWorkerStatsModal } from './MyWorkerStatsModal';
import {
  HardHat,
  BarChart3,
  LogOut,
  Palette,
  Play,
  Check,
  Search,
  CheckCircle2,
  Clock,
  RotateCcw,
  Sparkles
} from 'lucide-react';

export const WorkerTerminalView: React.FC = () => {
  const {
    currentUser,
    orders,
    crmOrders,
    paintOrderItems,
    paintRecords,
    paintOrderLayers,
    loadAllData,
    showToast,
    logActivity,
    sendTelegramNotification,
    logout
  } = useApp();

  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [activeProcessName, setActiveProcessName] = useState<string | null>(null);
  const [finishQty, setFinishQty] = useState<number>(1);
  const [isStatsOpen, setIsStatsOpen] = useState<boolean>(false);
  const [manualSearchQuery, setManualSearchQuery] = useState<string>('');
  const [showManualBox, setShowManualBox] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [sandingMode, setSandingMode] = useState<boolean>(false);

  if (!currentUser) return null;

  const myProcs = currentUser.procs || [];

  // Check if worker has painting permissions
  const hasPaintAccess = myProcs.some(p => !!PAINT_WORKER_TYPES[p]);

  // Доступ к терминалу шлиповки — если работнику назначен процесс «Шлиповка».
  // В отличие от остальных процессов он не привязан к конкретному заказу:
  // работник всегда видит каталог деталей и отмечает, что именно отшлифовал.
  const hasSandingAccess = myProcs.some(p => p.trim().toLowerCase() === 'шлиповка');

  interface TaskItem {
    order: (typeof orders)[0];
    proc: string;
    status: 'pending' | 'active';
    isPaint: boolean;
    isAssembly: boolean;
    pct?: number;
  }

  const myTasks: TaskItem[] = [];

  myProcs.forEach(proc => {
    if (isPaintProc(proc)) {
      const stageKeys = PAINT_WORKER_TYPES[proc] || [];
      if (!stageKeys.length) return;

      orders.forEach(o => {
        const path = Array.isArray(o?.path) ? o.path : [];
        if (!path.length) return;
        const procInPath = path.some(p => p.toLowerCase() === proc.toLowerCase());
        if (!procInPath) return;

        const items = (paintOrderItems || []).filter(i => i.order_id === o.id);
        if (!items.length) return;

        const totalPerStage = items.reduce((s, i) => s + (i.qty || 0), 0);
        const cfg = paintOrderLayers[o.id] || { layers: 2, coats: 2 };

        const isStageActive = (k: string) => {
          if (k === 'шлиф_2' || k === 'грунт_2') return cfg.layers >= 2;
          if (k === 'краска_2') return cfg.coats >= 2;
          return true;
        };

        const hasWork = stageKeys.some(k => {
          if (!isStageActive(k)) return false;
          const done = (paintRecords || [])
            .filter(r => r.order_id === o.id && r.stage_key === k)
            .reduce((s, r) => s + (r.qty_done || 0), 0);
          return done < totalPerStage;
        });

        if (!hasWork) return;

        const anyActive = stageKeys.some(k => {
          if (!isStageActive(k)) return false;
          const done = (paintRecords || [])
            .filter(r => r.order_id === o.id && r.stage_key === k)
            .reduce((s, r) => s + (r.qty_done || 0), 0);
          return done > 0 && done < totalPerStage;
        });

        const activeStagesCount = stageKeys.filter(k => isStageActive(k)).length;
        const totalExpected = totalPerStage * activeStagesCount;
        const totalDone = stageKeys
          .filter(k => isStageActive(k))
          .reduce(
            (s, k) =>
              s +
              (paintRecords || [])
                .filter(r => r.order_id === o.id && r.stage_key === k)
                .reduce((ss, r) => ss + (r.qty_done || 0), 0),
            0
          );
        const pct = totalExpected > 0 ? Math.round((totalDone / totalExpected) * 100) : 0;

        if (!myTasks.some(t => t.order.id === o.id && t.proc === proc)) {
          myTasks.push({
            order: o,
            proc,
            status: anyActive ? 'active' : 'pending',
            isPaint: true,
            isAssembly: false,
            pct
          });
        }
      });
    } else {
      orders.forEach(o => {
        const path = Array.isArray(o?.path) ? o.path : [];
        if (path.includes(proc)) {
          const h = o.history?.[proc];
          const isDone = !!h?.end;
          const isStarted = !!h?.start && !isDone;
          if (!isDone) {
            myTasks.push({
              order: o,
              proc,
              status: isStarted ? 'active' : 'pending',
              isPaint: false,
              isAssembly: isAssemblyProc(proc)
            });
          }
        }
      });
    }
  });

  // Sort active tasks first
  myTasks.sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1));

  const activeOrder = orders.find(o => o.id === activeOrderId);
  const activeHistory = activeProcessName ? activeOrder?.history?.[activeProcessName] : undefined;
  const activeCrmData = activeOrder ? crmOrders.find(c => c.oid === activeOrder.id) : undefined;
  const isStarted = !!activeHistory?.start;
  const isFinished = !!activeHistory?.end;

  const handleSelectTask = (orderId: string, procName: string) => {
    setActiveOrderId(orderId);
    setActiveProcessName(procName);
    const ord = orders.find(o => o.id === orderId);
    const h = ord?.history?.[procName];
    setFinishQty(h?.planned_qty || 1);
  };

  const handleManualSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = manualSearchQuery.trim();
    if (!query) return;

    const ord = orders.find(o => o.id === query);
    const ordPath = Array.isArray(ord?.path) ? ord.path : [];
    if (!ord || !ordPath.length) {
      showToast(`Заказ «${query}» не найден или не имеет маршрута`, 'error');
      return;
    }

    const availableProc = ordPath.find(p => myProcs.includes(p));
    if (!availableProc) {
      showToast(`В заказе #${query} нет процессов, доступных вам`, 'error');
      return;
    }

    handleSelectTask(ord.id, availableProc);
    setManualSearchQuery('');
    setShowManualBox(false);
  };

  const handleProcessAction = async (type: 'start' | 'finish') => {
    if (!activeOrder || !activeProcessName || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      const updatedHistory = { ...(activeOrder.history || {}) };
      const currentProcHist = { ...(updatedHistory[activeProcessName] || {}) };

      if (type === 'start') {
        currentProcHist.start = now;
        currentProcHist.worker = currentUser.name;
        updatedHistory[activeProcessName] = currentProcHist;

        await logActivity(
          currentUser.name,
          'Начал процесс',
          `Заказ #${activeOrder.id}, процесс: ${activeProcessName}`,
          'process'
        );
      } else {
        currentProcHist.end = now;
        currentProcHist.completed_by = currentUser.name;
        currentProcHist.qty_done = finishQty;
        currentProcHist.unit = getPathProcUnit(activeProcessName);
        updatedHistory[activeProcessName] = currentProcHist;

        await logActivity(
          currentUser.name,
          'Завершил процесс',
          `Заказ #${activeOrder.id}, процесс: ${activeProcessName}, объём: ${finishQty} ${getPathProcUnit(activeProcessName)}`,
          'process'
        );

        // Telegram Notification
        if (activeCrmData?.client) {
          sendTelegramNotification(
            activeCrmData.client,
            activeOrder.id,
            activeProcessName,
            activeCrmData.item || 'Не указано'
          );
        }
      }

      await supabase.from('orders').upsert({
        id: activeOrder.id,
        path: activeOrder.path,
        history: updatedHistory
      });

      showToast(type === 'start' ? 'Работа начата' : 'Работа успешно завершена!');
      await loadAllData();

      if (type === 'finish') {
        setTimeout(() => {
          setActiveOrderId(null);
          setActiveProcessName(null);
        }, 1200);
      }
    } catch (e: any) {
      showToast('Ошибка: ' + e.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-blue-900/50 via-slate-900/60 to-purple-900/50 text-white rounded-3xl p-6 shadow-2xl border border-white/10 backdrop-blur-xl relative overflow-hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="text-xs uppercase tracking-wider font-bold text-blue-400">Рабочий терминал</div>
            <div className="text-2xl sm:text-3xl font-black font-headline mt-0.5 flex items-center gap-2">
              <span>{currentUser.name}</span>
            </div>
            <div className="text-xs text-slate-300 mt-1 font-medium">
              Доступы к процессам: {myProcs.join(', ')}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="bg-white/5 border border-white/10 backdrop-blur-xs px-4 py-2 rounded-2xl text-center">
              <span className="text-2xl font-black font-mono block leading-none text-white">{myTasks.length}</span>
              <span className="text-[10px] uppercase font-bold text-slate-400">задач в очереди</span>
            </div>

            <button
              onClick={() => setIsStatsOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/10 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              <BarChart3 className="w-4 h-4" />
              <span>Моя статистика</span>
            </button>

            <button
              onClick={logout}
              className="flex items-center gap-1.5 px-3.5 py-2.5 bg-rose-500/80 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Выйти</span>
            </button>
          </div>
        </div>
      </div>

      {/* Переключатель: задачи по заказам / терминал шлиповки */}
      {hasSandingAccess && (
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setSandingMode(false)}
            className={`flex-1 py-3 rounded-2xl text-sm font-bold transition-all ${
              !sandingMode
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
                : 'bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10'
            }`}
          >
            📋 Задачи по заказам
          </button>
          <button
            onClick={() => {
              setSandingMode(true);
              setActiveOrderId(null);
              setActiveProcessName(null);
            }}
            className={`flex-1 py-3 rounded-2xl text-sm font-bold transition-all ${
              sandingMode
                ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/40'
                : 'bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10'
            }`}
          >
            🪵 Шлиповка
          </button>
        </div>
      )}

      {/* Main Container */}
      {sandingMode ? (
        <div className="bg-white/[0.04] backdrop-blur-xl rounded-3xl p-6 border border-white/10 shadow-xl shadow-black/20 text-slate-200">
          <WorkerSandingTerminal />
        </div>
      ) : !activeOrderId ? (
        /* Task List View */
        <div className="bg-white/[0.04] backdrop-blur-xl rounded-3xl p-6 border border-white/10 shadow-xl shadow-black/20 space-y-4 text-slate-200">
          <div className="flex items-center justify-between">
            <h3 className="font-headline font-bold text-white text-lg">Ваши текущие задачи</h3>
            <button
              onClick={() => setShowManualBox(!showManualBox)}
              className="text-xs font-bold text-blue-400 hover:text-blue-300"
            >
              {showManualBox ? 'Скрыть поиск' : 'Найти по номеру'}
            </button>
          </div>

          {showManualBox && (
            <form onSubmit={handleManualSearch} className="flex gap-2 p-3 bg-white/5 rounded-2xl border border-white/10">
              <input
                type="text"
                value={manualSearchQuery}
                onChange={(e) => setManualSearchQuery(e.target.value)}
                placeholder="Введите номер заказа (например: 0001)"
                className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm font-medium text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-900/40"
              >
                Открыть заказ
              </button>
            </form>
          )}

          {myTasks.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <div className="text-4xl mb-2">🎉</div>
              <div className="font-bold text-slate-200 text-base">Нет активных задач в цехе</div>
              <div className="text-xs mt-1 text-slate-500">Все процессы завершены либо ещё не запущены</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {myTasks.map((task) => {
                const crmInfo = crmOrders.find(c => c.oid === task.order.id);
                const code = getProcessCode(task.order, task.proc);
                const isActive = task.status === 'active';

                return (
                  <div
                    key={`${task.order.id}-${task.proc}`}
                    onClick={() => handleSelectTask(task.order.id, task.proc)}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all hover:scale-[1.01] ${
                      isActive
                        ? 'bg-blue-600/15 border-blue-500/40 ring-1 ring-blue-500/30'
                        : 'bg-white/5 border-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-black font-headline text-white">№ {task.order.id}</span>
                        {code && (
                          <span className="font-mono text-xs px-2 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-500/30 font-bold rounded-md">
                            {code}
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                          isActive ? 'bg-blue-600 text-white shadow-xs' : 'bg-white/5 text-slate-400 border border-white/10'
                        }`}
                      >
                        {isActive ? '● В работе' : 'Ожидает'}
                      </span>
                    </div>

                    <div className="font-bold text-white text-sm flex items-center gap-1.5">
                      {task.isPaint && <Palette className="w-4 h-4 text-amber-400" />}
                      <span>{task.proc}</span>
                    </div>

                    <div className="text-xs text-slate-400 mt-1">
                      {crmInfo?.client ? `Клиент: ${crmInfo.client}` : 'Без клиента'} · {crmInfo?.item || 'Изделие'}
                    </div>

                    {task.isPaint && task.pct !== undefined && (
                      <div className="mt-3">
                        <div className="w-full h-1.5 bg-white/5 border border-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-500 rounded-full" style={{ width: `${task.pct}%` }} />
                        </div>
                        <div className="text-[10px] text-right font-mono text-slate-500 mt-0.5">{task.pct}% этапов</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Active Task Execution View */
        <div className="bg-white/[0.04] backdrop-blur-xl rounded-3xl p-6 sm:p-8 border border-white/10 shadow-xl shadow-black/20 space-y-6 text-slate-200">
          {/* Active Info Header */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 text-center relative">
            <button
              onClick={() => {
                setActiveOrderId(null);
                setActiveProcessName(null);
              }}
              className="absolute top-4 left-4 text-xs font-bold text-slate-400 hover:text-white bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Список</span>
            </button>

            <div className="text-3xl font-black font-headline text-white">Заказ № {activeOrderId}</div>
            <div className="font-mono text-xs font-bold text-blue-300 mt-1 bg-blue-500/20 border border-blue-500/30 inline-block px-2.5 py-0.5 rounded-md">
              {getProcessCode(activeOrder, activeProcessName || '')}
            </div>

            <div className="text-xl font-bold text-white mt-2 font-headline">{activeProcessName}</div>
            {activeCrmData && (
              <div className="text-xs text-slate-400 mt-1">
                {activeCrmData.client} · {activeCrmData.item || 'Без описания'}
              </div>
            )}
          </div>

          {/* Special mode: Paint */}
          {activeProcessName && isPaintProc(activeProcessName) ? (
            <WorkerInlinePaint
              orderId={activeOrderId}
              onBack={() => {
                setActiveOrderId(null);
                setActiveProcessName(null);
              }}
              onFinishOrder={() => {
                setActiveOrderId(null);
                setActiveProcessName(null);
              }}
            />
          ) : activeProcessName && isAssemblyProc(activeProcessName) ? (
            <WorkerInlineAssembly
              orderId={activeOrderId}
              processName={activeProcessName}
              onBack={() => {
                setActiveOrderId(null);
                setActiveProcessName(null);
              }}
              onFinishOrder={() => {
                setActiveOrderId(null);
                setActiveProcessName(null);
              }}
            />
          ) : (
            /* Regular Process Start / Finish controls */
            <div className="space-y-6 pt-2">
              {!isStarted && !isFinished && (
                <button
                  onClick={() => handleProcessAction('start')}
                  disabled={isSubmitting}
                  className="w-full py-5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-2xl text-lg shadow-xl shadow-blue-900/40 flex items-center justify-center gap-3 transition-transform active:scale-[0.99] cursor-pointer"
                >
                  <Play className="w-6 h-6 fill-current" />
                  <span>НАЧАТЬ РАБОТУ</span>
                </button>
              )}

              {isStarted && !isFinished && (
                <div className="space-y-4 animate-in fade-in">
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 text-center">
                    <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2">
                      Укажите количество выполненных единиц:
                    </div>
                    <div className="flex items-center justify-center gap-3">
                      <input
                        type="number"
                        min="1"
                        value={finishQty}
                        onChange={(e) => setFinishQty(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-28 text-center text-3xl font-black font-mono p-3 bg-white/5 border border-white/20 rounded-xl text-white focus:outline-none focus:border-blue-400"
                      />
                      <span className="font-bold text-slate-300 text-sm">{getPathProcUnit(activeProcessName || '')}</span>
                    </div>
                    {activeHistory?.planned_qty && (
                      <div className="text-xs text-slate-400 mt-2 font-medium">
                        План по заказу: {activeHistory.planned_qty} {getPathProcUnit(activeProcessName || '')}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => handleProcessAction('finish')}
                    disabled={isSubmitting}
                    className="w-full py-5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-2xl text-lg shadow-xl shadow-emerald-950/40 flex items-center justify-center gap-3 transition-transform active:scale-[0.99] cursor-pointer"
                  >
                    <Check className="w-6 h-6" />
                    <span>ЗАВЕРШИТЬ ПРОЦЕСС</span>
                  </button>
                </div>
              )}

              {isFinished && (
                <div className="p-6 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-center space-y-2">
                  <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
                  <div className="text-lg font-bold text-emerald-300 font-headline">Процесс успешно выполнен!</div>
                  <div className="text-xs text-emerald-400/80">
                    Исполнитель: {activeHistory?.completed_by} · Объём: {activeHistory?.qty_done}{' '}
                    {activeHistory?.unit || getPathProcUnit(activeProcessName || '')}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Worker Personal Stats Modal */}
      <MyWorkerStatsModal isOpen={isStatsOpen} onClose={() => setIsStatsOpen(false)} />
    </div>
  );
};
