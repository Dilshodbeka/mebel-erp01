import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { formatMoney } from '../utils/formatters';
import { X, Calendar, Clock, CheckCircle2, TrendingUp, DollarSign } from 'lucide-react';

export const MyWorkerStatsModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { currentUser, orders, crmOrders, paintRecords, paintCatalog, orderLabor } = useApp();
  const [period, setPeriod] = useState<'day' | 'week' | 'month' | 'all'>('month');

  if (!isOpen || !currentUser) return null;

  const workerName = currentUser.name;

  const isInPeriod = (dateStr?: string) => {
    if (!dateStr || period === 'all') return true;
    const d = new Date(dateStr);
    const now = new Date();
    if (period === 'day') return d.toDateString() === now.toDateString();
    if (period === 'week') {
      const ago = new Date(now);
      ago.setDate(now.getDate() - 7);
      return d >= ago && d <= now;
    }
    if (period === 'month') {
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }
    return true;
  };

  interface RecordRow {
    orderId: string;
    proc: string;
    qty: number;
    unit: string;
    startTime: Date | null;
    endTime: Date | null;
    duration: number; // in minutes
    item: string;
    client: string;
    sum: number;
  }

  const records: RecordRow[] = [];

  // Regular process records from order histories
  orders.forEach(o => {
    if (!o.history) return;
    Object.keys(o.history).forEach(procName => {
      const h = o.history?.[procName];
      if (!h || !h.end) return;
      if (h.completed_by !== workerName && h.worker !== workerName) return;
      if (!isInPeriod(h.end)) return;

      const startT = h.start ? new Date(h.start) : null;
      const endT = h.end ? new Date(h.end) : null;
      const dur = startT && endT ? Math.round((endT.getTime() - startT.getTime()) / 60000) : 0;
      const crmData = crmOrders.find(c => c.oid === o.id);

      records.push({
        orderId: o.id,
        proc: procName,
        qty: h.qty_done || 1,
        unit: h.unit || 'шт',
        startTime: startT,
        endTime: endT,
        duration: dur,
        item: crmData?.item || '',
        client: crmData?.client || '',
        sum: 0
      });
    });
  });

  // Paint records
  paintRecords.forEach(r => {
    if (r.worker !== workerName) return;
    if (!isInPeriod(r.created_at)) return;
    const cat = paintCatalog.find(c => c.name === r.item_name);
    const crmData = crmOrders.find(c => c.oid === r.order_id);

    records.push({
      orderId: r.order_id,
      proc: `Краска — ${r.item_name}`,
      qty: r.qty_done || 0,
      unit: cat ? 'м²' : 'шт',
      startTime: r.created_at ? new Date(r.created_at) : null,
      endTime: r.created_at ? new Date(r.created_at) : null,
      duration: 0,
      item: r.item_name || '',
      client: crmData?.client || '',
      sum: 0
    });
  });

  // Labor from order calculation assigned to this worker
  orderLabor.forEach(lab => {
    if (lab.worker !== workerName || !isInPeriod(lab.created_at)) return;
    const crmData = crmOrders.find(c => c.oid === lab.order_id);

    records.push({
      orderId: lab.order_id,
      proc: lab.description || 'Работа/монтаж',
      qty: lab.qty || 1,
      unit: 'шт',
      startTime: lab.created_at ? new Date(lab.created_at) : null,
      endTime: lab.created_at ? new Date(lab.created_at) : null,
      duration: 0,
      item: crmData?.item || '',
      client: crmData?.client || '',
      sum: (lab.qty || 1) * (lab.unit_price || 0)
    });
  });

  // Sort descending
  records.sort((a, b) => {
    const tA = a.endTime?.getTime() || a.startTime?.getTime() || 0;
    const tB = b.endTime?.getTime() || b.startTime?.getTime() || 0;
    return tB - tA;
  });

  // Summaries
  const totalProcs = records.length;
  const totalQty = records.reduce((s, r) => s + r.qty, 0);
  const totalMinutes = records.reduce((s, r) => s + r.duration, 0);
  const totalSum = records.reduce((s, r) => s + r.sum, 0);
  const uniqueOrders = new Set(records.map(r => r.orderId)).size;

  const totalH = Math.floor(totalMinutes / 60);
  const totalM = totalMinutes % 60;
  const totalHoursStr = totalH > 0 ? `${totalH}ч ${totalM}м` : `${totalM}м`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#0b1329] rounded-3xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl border border-white/10 text-slate-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-900/60 to-teal-900/60 border-b border-white/10 text-white p-6 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-emerald-400 font-bold">Личная статистика</div>
              <div className="text-2xl font-black font-headline text-white">{workerName}</div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 mt-5">
            <div className="bg-white/5 border border-white/10 backdrop-blur-xs rounded-xl p-3 text-center">
              <div className="text-xl font-black font-mono text-white">{totalProcs}</div>
              <div className="text-[10px] text-emerald-300 uppercase tracking-wide">Процессов</div>
            </div>
            <div className="bg-white/5 border border-white/10 backdrop-blur-xs rounded-xl p-3 text-center">
              <div className="text-xl font-black font-mono text-white">{totalQty}</div>
              <div className="text-[10px] text-emerald-300 uppercase tracking-wide">Объём</div>
            </div>
            <div className="bg-white/5 border border-white/10 backdrop-blur-xs rounded-xl p-3 text-center">
              <div className="text-xl font-black font-mono text-white">{uniqueOrders}</div>
              <div className="text-[10px] text-emerald-300 uppercase tracking-wide">Заказов</div>
            </div>
            <div className="bg-white/5 border border-white/10 backdrop-blur-xs rounded-xl p-3 text-center">
              <div className="text-xl font-black font-mono text-white">{totalHoursStr}</div>
              <div className="text-[10px] text-emerald-300 uppercase tracking-wide">Время</div>
            </div>
            <div className="bg-white/5 border border-white/10 backdrop-blur-xs rounded-xl p-3 text-center col-span-2 sm:col-span-1">
              <div className="text-xl font-black font-mono text-emerald-400">{formatMoney(totalSum)}</div>
              <div className="text-[10px] text-emerald-300 uppercase tracking-wide">Заработано</div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          {/* Period selector */}
          <div className="flex gap-2 bg-white/5 border border-white/10 p-1 rounded-2xl">
            {(['day', 'week', 'month', 'all'] as const).map((p) => {
              const labels = { day: 'Сегодня', week: 'Неделя', month: 'Месяц', all: 'Всё время' };
              const isSel = period === p;
              return (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold transition-all ${
                    isSel ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/40' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {labels[p]}
                </button>
              );
            })}
          </div>

          {/* Table */}
          {records.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              Нет записей о выполненных работах за выбранный период
            </div>
          ) : (
            <div className="border border-white/10 rounded-2xl overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-white/5 text-slate-400 uppercase tracking-wider text-[11px] border-b border-white/10">
                  <tr>
                    <th className="p-3">Дата / Время</th>
                    <th className="p-3">Заказ</th>
                    <th className="p-3">Процесс</th>
                    <th className="p-3 text-center">Объём</th>
                    <th className="p-3 text-center">Длительность</th>
                    <th className="p-3 text-right">Начислено</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {records.map((r, idx) => (
                    <tr key={idx} className="hover:bg-white/5 transition-colors">
                      <td className="p-3 text-slate-400 whitespace-nowrap">
                        {r.endTime ? r.endTime.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="p-3">
                        <span className="font-mono font-bold text-blue-300 bg-blue-500/20 border border-blue-500/30 px-2 py-0.5 rounded-md">
                          #{r.orderId}
                        </span>
                        {r.client && <div className="text-[11px] text-slate-500 mt-0.5">{r.client}</div>}
                      </td>
                      <td className="p-3 font-semibold text-white">{r.proc}</td>
                      <td className="p-3 text-center font-bold text-slate-200">
                        {r.qty} {r.unit}
                      </td>
                      <td className="p-3 text-center font-mono text-emerald-400 font-semibold">
                        {r.duration > 0 ? `${r.duration} мин` : '—'}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-emerald-400">
                        {r.sum > 0 ? formatMoney(r.sum) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
