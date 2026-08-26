import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { formatMoney, formatHoursMinutes, getProcessCode } from '../utils/formatters';
import { X, Calendar, Clock, CheckCircle2, DollarSign, Package } from 'lucide-react';

export const WorkerDetailModal: React.FC<{
  workerName: string | null;
  isOpen: boolean;
  onClose: () => void;
}> = ({ workerName, isOpen, onClose }) => {
  const { orders, crmOrders, paintRecords, orderLabor, openSearchModal } = useApp();
  const [period, setPeriod] = useState<'day' | 'week' | 'month' | 'all'>('month');

  if (!isOpen || !workerName) return null;

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

  interface DetailRecord {
    orderId: string;
    proc: string;
    qty: number;
    unit: string;
    startTime: Date | null;
    endTime: Date | null;
    duration: number; // minutes
    item: string;
    client: string;
    sum: number;
  }

  const records: DetailRecord[] = [];

  // Completed processes
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
    if (r.worker !== workerName || !isInPeriod(r.created_at)) return;
    const crmData = crmOrders.find(c => c.oid === r.order_id);
    records.push({
      orderId: r.order_id,
      proc: `Краска — ${r.item_name}`,
      qty: r.qty_done || 1,
      unit: 'шт',
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

  // Group by order
  const byOrder: Record<string, { client: string; item: string; qty: number; records: DetailRecord[] }> = {};
  records.forEach(r => {
    if (!byOrder[r.orderId]) {
      byOrder[r.orderId] = { client: r.client, item: r.item, qty: 0, records: [] };
    }
    byOrder[r.orderId].qty += r.qty;
    byOrder[r.orderId].records.push(r);
  });

  const totalProcs = records.length;
  const totalQty = records.reduce((s, r) => s + r.qty, 0);
  const totalMin = records.reduce((s, r) => s + r.duration, 0);
  const totalSum = records.reduce((s, r) => s + r.sum, 0);
  const orderCount = Object.keys(byOrder).length;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900/90 backdrop-blur-2xl rounded-3xl max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl border border-white/10 text-slate-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-950/80 to-teal-900/80 border-b border-white/10 text-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-emerald-400 font-bold">Карточка сотрудника</div>
              <div className="text-2xl font-black font-headline text-white">{workerName}</div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 mt-5">
            <div className="bg-white/5 border border-white/10 backdrop-blur-xs rounded-xl p-3 text-center">
              <div className="text-xl font-black font-mono text-white">{totalProcs}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wide">Процессов</div>
            </div>
            <div className="bg-white/5 border border-white/10 backdrop-blur-xs rounded-xl p-3 text-center">
              <div className="text-xl font-black font-mono text-white">{totalQty}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wide">Объём (ед)</div>
            </div>
            <div className="bg-white/5 border border-white/10 backdrop-blur-xs rounded-xl p-3 text-center">
              <div className="text-xl font-black font-mono text-white">{orderCount}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wide">Заказов</div>
            </div>
            <div className="bg-white/5 border border-white/10 backdrop-blur-xs rounded-xl p-3 text-center">
              <div className="text-xl font-black font-mono text-emerald-400">{formatHoursMinutes(totalMin)}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wide">Время в работе</div>
            </div>
            <div className="bg-white/5 border border-white/10 backdrop-blur-xs rounded-xl p-3 text-center col-span-2 sm:col-span-1">
              <div className="text-xl font-black font-mono text-blue-400">{formatMoney(totalSum)}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wide">Начислено</div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          <div className="flex gap-2 bg-white/5 border border-white/10 backdrop-blur-md p-1 rounded-xl">
            {(['day', 'week', 'month', 'all'] as const).map(p => {
              const labels = { day: 'Сегодня', week: 'Неделя', month: 'Месяц', all: 'Всё время' };
              const isSel = period === p;
              return (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                    isSel ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {labels[p]}
                </button>
              );
            })}
          </div>

          {Object.keys(byOrder).length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              Нет записей о выполненных работах за выбранный период
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(byOrder).map(([oid, od]) => (
                <div key={oid} className="bg-white/[0.03] border border-white/10 rounded-2xl overflow-hidden shadow-xs">
                  <div className="p-4 bg-white/5 flex items-center justify-between border-b border-white/10">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-black text-blue-400 text-base">Заказ #{oid}</span>
                        {od.client && <span className="font-bold text-white text-sm">· {od.client}</span>}
                      </div>
                      {od.item && <div className="text-xs text-slate-400 mt-0.5">{od.item}</div>}
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-bold text-white text-sm">{od.qty} ед.</div>
                        <div className="text-[10px] text-slate-400">всего объём</div>
                      </div>
                      <button
                        onClick={() => {
                          onClose();
                          openSearchModal(oid);
                        }}
                        className="px-3 py-1.5 bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/30 font-bold text-xs rounded-xl transition-colors"
                      >
                        Заказ →
                      </button>
                    </div>
                  </div>

                  <div className="divide-y divide-white/5 text-xs">
                    {od.records.map((r, ri) => (
                      <div key={ri} className="p-3 flex items-center justify-between hover:bg-white/5 transition-colors">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 bg-white/5 border border-white/10 rounded text-slate-300 font-medium">
                            {r.proc}
                          </span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="font-bold text-white">
                            {r.qty} {r.unit}
                          </span>
                          <span className="font-mono text-slate-400">
                            {r.duration > 0 ? `${r.duration} мин` : '—'}
                          </span>
                          {r.sum > 0 && (
                            <span className="font-mono font-bold text-blue-400">
                              {formatMoney(r.sum)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
