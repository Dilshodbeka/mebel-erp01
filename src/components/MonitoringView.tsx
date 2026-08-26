import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import {
  formatMoney,
  calculateOrderProgress,
  formatDuration,
  formatHoursMinutes,
  getProcessCode,
  pad2,
  getPathProcUnit,
  isOrderFinished
} from '../utils/formatters';
import { MonitorOrderModal } from './MonitorOrderModal';
import {
  Activity,
  UserCheck,
  ListOrdered,
  Search,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  CheckCircle2,
  Clock,
  PlayCircle,
  Eye,
  FileText
} from 'lucide-react';

export const MonitoringView: React.FC = () => {
  const {
    orders,
    crmOrders,
    activityLogs,
    loadAllData,
    showToast,
    logActivity,
    currentUser,
    openSearchModal
  } = useApp();

  const [activeTab, setActiveTab] = useState<'orders' | 'attendance' | 'processes'>('orders');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Orders tab filter
  const [orderSearch, setOrderSearch] = useState('');
  const [orderDateFilter, setOrderDateFilter] = useState('');

  // Attendance tab date
  const [attendanceDate, setAttendanceDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );

  // Processes tab filters
  const [processSearch, setProcessSearch] = useState('');
  const [processStatusFilter, setProcessStatusFilter] = useState<'all' | 'pending' | 'active' | 'completed'>('all');

  // --- Orders tab logic ---
  const filteredOrders = orders.filter(o => {
    const crm = crmOrders.find(c => c.oid === o.id);
    const q = orderSearch.toLowerCase();
    const matchesQuery =
      (o.id || '').toLowerCase().includes(q) ||
      (crm?.client || '').toLowerCase().includes(q) ||
      (o.path || []).some(p => p.toLowerCase().includes(q));

    const matchesDate = !orderDateFilter || (o.created_at || '').slice(0, 10) === orderDateFilter;
    return matchesQuery && matchesDate;
  });

  // --- Attendance tab logic ---
  const shiftAttendanceDate = (days: number) => {
    const d = new Date(attendanceDate + 'T00:00:00');
    d.setDate(d.getDate() + days);
    setAttendanceDate(d.toISOString().slice(0, 10));
  };

  const dayEvents = activityLogs.filter(a => {
    const isTargetDate = (a.created_at || '').slice(0, 10) === attendanceDate;
    const isAuth = ['login', 'logout'].includes(a.type);
    const notAdmin = a.user_name !== 'admin939291' && a.user_name !== 'Администратор';
    return isTargetDate && isAuth && notAdmin;
  });

  // Reconstruct shift sessions
  const sessionsByWorker: Record<string, { login: Date; logout: Date | null }[]> = {};
  [...dayEvents]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .forEach(e => {
      if (!sessionsByWorker[e.user_name]) sessionsByWorker[e.user_name] = [];
      const list = sessionsByWorker[e.user_name];
      if (e.type === 'login') {
        list.push({ login: new Date(e.created_at), logout: null });
      } else {
        const open = [...list].reverse().find(s => s.logout === null);
        if (open) open.logout = new Date(e.created_at);
      }
    });

  const isToday = attendanceDate === new Date().toISOString().slice(0, 10);
  let workingCount = 0;
  let leftCount = 0;
  let totalShiftMinutesAll = 0;

  const attendanceRows = Object.keys(sessionsByWorker).map(name => {
    const list = sessionsByWorker[name] || [];
    const firstLogin = list[0]?.login;
    const lastSession = list.length > 0 ? list[list.length - 1] : null;
    const isWorking = isToday && !!lastSession && lastSession.logout === null;

    let totalMinutes = 0;
    list.forEach(s => {
      if (!s) return;
      const end = s.logout || (isWorking && s === lastSession ? new Date() : s.login);
      if (s.logout || (isWorking && s === lastSession)) {
        totalMinutes += Math.max(0, (end.getTime() - s.login.getTime()) / 60000);
      }
    });
    totalShiftMinutesAll += totalMinutes;

    if (isWorking) workingCount++;
    else leftCount++;

    const lastLogout = [...list].reverse().find(s => s?.logout)?.logout;

    return {
      name,
      firstLogin,
      lastLogout,
      isWorking,
      totalMinutes,
      sessionsCount: list.length
    };
  });

  // --- Processes granular tab logic ---
  interface ProcessRow {
    orderId: string;
    procNumber: number;
    procTotal: number;
    procCode: string;
    procName: string;
    client: string;
    item: string;
    status: 'pending' | 'active' | 'completed';
    startedBy?: string;
    completedBy?: string;
    startTime?: Date | null;
    endTime?: Date | null;
    durationMs?: number;
    orderProgress: number;
  }

  const allProcessRows: ProcessRow[] = [];

  orders.forEach(o => {
    const crm = crmOrders.find(c => c.oid === o.id);
    const prog = calculateOrderProgress(o);

    (o.path || []).forEach((p, idx) => {
      const h = o.history?.[p];
      const code = getProcessCode(o, p);
      const isDone = !!h?.end;
      const isActive = !!h?.start && !isDone;

      const status: 'pending' | 'active' | 'completed' = isDone
        ? 'completed'
        : isActive
        ? 'active'
        : 'pending';

      const sTime = h?.start ? new Date(h.start) : null;
      const eTime = h?.end ? new Date(h.end) : null;
      let dur = 0;
      if (sTime && eTime) dur = eTime.getTime() - sTime.getTime();
      else if (sTime && isActive) dur = Date.now() - sTime.getTime();

      allProcessRows.push({
        orderId: o.id,
        procNumber: idx + 1,
        procTotal: (o.path || []).length,
        procCode: code,
        procName: p,
        client: crm?.client || '—',
        item: crm?.item || '—',
        status,
        startedBy: h?.worker,
        completedBy: h?.completed_by,
        startTime: sTime,
        endTime: eTime,
        durationMs: dur,
        orderProgress: prog
      });
    });
  });

  const filteredProcessRows = allProcessRows.filter(r => {
    const q = processSearch.toLowerCase();
    const matchesQuery =
      r.orderId.toLowerCase().includes(q) ||
      r.procCode.toLowerCase().includes(q) ||
      r.procName.toLowerCase().includes(q) ||
      r.client.toLowerCase().includes(q);

    const matchesStatus = processStatusFilter === 'all' || r.status === processStatusFilter;
    return matchesQuery && matchesStatus;
  });

  // Export CSV
  const handleExportCSV = () => {
    const headers = [
      '№ Заказа',
      'Код процесса',
      'Клиент',
      'Изделие',
      'Процесс',
      'Статус',
      'Кто начал',
      'Кто завершил',
      'Время начала',
      'Время завершения',
      'Длительность',
      'Прогресс заказа'
    ];

    const rows = filteredProcessRows.map(r => [
      r.orderId,
      r.procCode,
      r.client,
      r.item,
      r.procName,
      r.status === 'completed' ? 'Завершен' : r.status === 'active' ? 'В работе' : 'Ожидает',
      r.startedBy || '',
      r.completedBy || '',
      r.startTime ? r.startTime.toLocaleString('ru-RU') : '',
      r.endTime ? r.endTime.toLocaleString('ru-RU') : '',
      formatDuration(r.durationMs),
      `${r.orderProgress}%`
    ]);

    const csvContent = [headers.join(';'), ...rows.map(row => row.map(cell => `"${cell}"`).join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `процессы_заказов_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Данные успешно экспортированы в CSV');
  };

  return (
    <div className="space-y-6">
      {/* Subtabs */}
      <div className="flex gap-2 p-1 bg-white border border-slate-200 rounded-2xl max-w-md shadow-xs">
        <button
          onClick={() => setActiveTab('orders')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'orders' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Заказы в цехе</span>
        </button>
        <button
          onClick={() => setActiveTab('attendance')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'attendance' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <UserCheck className="w-3.5 h-3.5" />
          <span>Смены & Посещаемость</span>
        </button>
        <button
          onClick={() => setActiveTab('processes')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'processes' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ListOrdered className="w-3.5 h-3.5" />
          <span>Детализация процессов</span>
        </button>
      </div>

      {/* 1. ORDERS TAB */}
      {activeTab === 'orders' && (
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex-1 flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder="Поиск по номеру, клиенту или процессу..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20"
                />
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              </div>
              <input
                type="date"
                value={orderDateFilter}
                onChange={(e) => setOrderDateFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900"
              />
            </div>
            <div className="text-xs font-bold text-slate-500">
              Заказов: <b className="text-slate-900">{filteredOrders.length}</b>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {filteredOrders.map((order) => {
              const crm = crmOrders.find(c => c.oid === order.id);
              const progress = calculateOrderProgress(order);
              const isFinished = isOrderFinished(order);

              return (
                <div
                  key={order.id}
                  onClick={() => openSearchModal(order.id)}
                  className="py-4 px-2 hover:bg-slate-50/80 rounded-xl transition-colors cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center font-mono font-black text-blue-600 text-sm shrink-0">
                      {order.id}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">
                          {crm?.client || 'Заказ #' + order.id}
                        </span>
                        {isFinished ? (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded-md">
                            Завершён
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-800 font-bold text-[10px] rounded-md">
                            В цехе ({progress}%)
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {crm?.item || 'Изделие'} · {crm?.phone || '—'}
                      </div>
                    </div>
                  </div>

                  {/* Processes Chips */}
                  <div className="flex-1 flex flex-wrap gap-1.5 max-w-xl">
                    {(order.path || []).map((proc, idx) => {
                      const h = order.history?.[proc];
                      const isDone = !!h?.end;
                      const isActive = !!h?.start && !isDone;

                      return (
                        <span
                          key={idx}
                          className={`px-2 py-1 rounded-lg text-[11px] font-semibold border ${
                            isDone
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : isActive
                              ? 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse'
                              : 'bg-slate-50 text-slate-500 border-slate-200'
                          }`}
                        >
                          {proc}
                        </span>
                      );
                    })}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedOrderId(order.id);
                      }}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg transition-colors"
                    >
                      История
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openSearchModal(order.id);
                      }}
                      className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-lg transition-colors"
                    >
                      Паспорт
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. ATTENDANCE TAB */}
      {activeTab === 'attendance' && (
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <button
                onClick={() => shiftAttendanceDate(-1)}
                className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 border border-slate-200"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <input
                type="date"
                value={attendanceDate}
                onChange={e => setAttendanceDate(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900"
              />
              <button
                onClick={() => shiftAttendanceDate(1)}
                className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 border border-slate-200"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-3 text-xs font-bold">
              <span className="text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                На смене: {workingCount}
              </span>
              <span className="text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg">
                Завершили: {leftCount}
              </span>
              <span className="text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200">
                Всего часов: {formatHoursMinutes(totalShiftMinutesAll)}
              </span>
            </div>
          </div>

          {attendanceRows.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs">
              За выбранную дату записей посещаемости не обнаружено.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3">Сотрудник</th>
                    <th className="p-3">Статус</th>
                    <th className="p-3">Первый вход</th>
                    <th className="p-3">Последний выход</th>
                    <th className="p-3 text-right">Отработано</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attendanceRows.map(row => (
                    <tr key={row.name} className="hover:bg-slate-50">
                      <td className="p-3 font-bold text-slate-900">{row.name}</td>
                      <td className="p-3">
                        {row.isWorking ? (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md font-bold text-[10px]">
                            🟢 На смене
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md font-bold text-[10px]">
                            ⚪ Ушёл
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-slate-600">
                        {row.firstLogin ? row.firstLogin.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="p-3 text-slate-600">
                        {row.lastLogout ? row.lastLogout.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : (row.isWorking ? 'Работает...' : '—')}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-slate-900">
                        {formatHoursMinutes(row.totalMinutes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 3. PROCESSES TAB */}
      {activeTab === 'processes' && (
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                value={processSearch}
                onChange={e => setProcessSearch(e.target.value)}
                placeholder="Поиск по коду, процессу или клиенту..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={processStatusFilter}
                onChange={e => setProcessStatusFilter(e.target.value as any)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
              >
                <option value="all">Все статусы</option>
                <option value="pending">Ожидающие</option>
                <option value="active">В работе</option>
                <option value="completed">Завершённые</option>
              </select>

              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl border border-slate-200 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">Код</th>
                  <th className="p-3">№ Заказа & Клиент</th>
                  <th className="p-3">Процесс</th>
                  <th className="p-3">Статус</th>
                  <th className="p-3">Исполнитель</th>
                  <th className="p-3 text-right">Длительность</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProcessRows.slice(0, 100).map(r => (
                  <tr
                    key={r.procCode}
                    onClick={() => openSearchModal(r.orderId)}
                    className="hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="p-3 font-mono font-bold text-blue-600">{r.procCode}</td>
                    <td className="p-3">
                      <div className="font-bold text-slate-900">№ {r.orderId}</div>
                      <div className="text-[11px] text-slate-500">{r.client}</div>
                    </td>
                    <td className="p-3 font-semibold text-slate-800">{r.procName}</td>
                    <td className="p-3">
                      {r.status === 'completed' ? (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md font-bold text-[10px]">
                          Завершен
                        </span>
                      ) : r.status === 'active' ? (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-md font-bold text-[10px] animate-pulse">
                          В работе
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md font-bold text-[10px]">
                          Ожидает
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-slate-700 font-medium">
                      {r.completedBy || r.startedBy || '—'}
                    </td>
                    <td className="p-3 text-right font-mono text-slate-600">
                      {formatDuration(r.durationMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedOrderId && (
        <MonitorOrderModal
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
        />
      )}
    </div>
  );
};
