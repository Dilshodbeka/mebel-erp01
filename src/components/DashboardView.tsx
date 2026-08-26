import React from 'react';
import { useApp } from '../context/AppContext';
import { formatMoney, isOrderFinished, calculateOrderProgress } from '../utils/formatters';
import {
  Boxes,
  Clock,
  CheckCircle2,
  Send,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  CreditCard,
  UserCheck,
  Package,
  ChevronRight,
  Sparkles,
  Scissors,
  Wrench,
  Users,
  Activity
} from 'lucide-react';

export const DashboardView: React.FC = () => {
  const {
    orders = [],
    crmOrders = [],
    notificationHistory = [],
    svcClients = [],
    svcTransactions = [],
    warehouseItems = [],
    activityLogs = [],
    setCurrentView,
    setActiveCalcOrderId,
    openSearchModal
  } = useApp();

  const safeOrders = Array.isArray(orders) ? orders : [];
  const safeCrmOrders = Array.isArray(crmOrders) ? crmOrders : [];
  const safeNotificationHistory = Array.isArray(notificationHistory) ? notificationHistory : [];
  const safeSvcClients = Array.isArray(svcClients) ? svcClients : [];
  const safeSvcTransactions = Array.isArray(svcTransactions) ? svcTransactions : [];
  const safeWarehouseItems = Array.isArray(warehouseItems) ? warehouseItems : [];
  const safeActivityLogs = Array.isArray(activityLogs) ? activityLogs : [];

  const totalOrders = safeOrders.length;
  const activeOrders = safeOrders.filter(o => !isOrderFinished(o)).length;

  const todayStr = new Date().toDateString();
  const finishedToday = safeOrders.filter(o => {
    if (!isOrderFinished(o)) return false;
    const path = Array.isArray(o.path) ? o.path : [];
    if (path.length === 0) return false;
    const lastStep = path[path.length - 1];
    const h = o.history?.[lastStep];
    return h?.end && new Date(h.end).toDateString() === todayStr;
  }).length;

  const notificationCount = safeNotificationHistory.filter(n =>
    n.status === 'sent' && new Date(n.created_at).toDateString() === todayStr
  ).length;

  // Alerts logic
  const now = new Date();
  const alerts: { id: string; type: 'stale' | 'debt' | 'stock'; text: string; action: () => void }[] = [];

  safeCrmOrders.forEach(c => {
    const order = safeOrders.find(o => o.id === c.oid);
    if (order && isOrderFinished(order)) return;

    if (c.due_date) {
      const due = new Date(c.due_date);
      due.setHours(0, 0, 0, 0);
      const daysOverdue = Math.floor((now.getTime() - due.getTime()) / 86400000);
      if (daysOverdue >= 0) {
        alerts.push({
          id: `stale-${c.oid}`,
          type: 'stale',
          text: `Заказ #${c.oid} (${c.client || ''}) просрочен на ${daysOverdue} дн. (срок: ${new Date(c.due_date).toLocaleDateString('ru-RU')})`,
          action: () => openSearchModal(c.oid)
        });
      }
    } else if (order && c.date) {
      const orderDate = new Date(c.date);
      const daysAgo = Math.floor((now.getTime() - orderDate.getTime()) / 86400000);
      if (daysAgo >= 7) {
        alerts.push({
          id: `stale-old-${c.oid}`,
          type: 'stale',
          text: `Заказ #${c.oid} (${c.client || ''}) в производстве уже ${daysAgo} дн.`,
          action: () => openSearchModal(c.oid)
        });
      }
    }
  });

  // Debtors
  const debtorClients = safeSvcClients
    .map(c => {
      const txs = safeSvcTransactions.filter(t => t.client_id === c.id);
      const balance = txs.reduce((s, t) => s + (t.paid_amount || 0) - (t.total_amount || 0), 0);
      return { client: c, debt: -balance };
    })
    .filter(x => x.debt > 0)
    .sort((a, b) => b.debt - a.debt);

  debtorClients.slice(0, 3).forEach(({ client, debt }) => {
    alerts.push({
      id: `debt-${client.id}`,
      type: 'debt',
      text: `Долг за услуги: ${formatMoney(debt)} сум — ${client.name}`,
      action: () => setCurrentView('services')
    });
  });

  // Low stock
  const lowStockItems = safeWarehouseItems.filter(i => (i.min_qty || 0) > 0 && (i.qty_in_stock || 0) <= (i.min_qty || 0));
  lowStockItems.slice(0, 3).forEach(item => {
    alerts.push({
      id: `stock-${item.id}`,
      type: 'stock',
      text: `Мало на складе: ${item.name} (${item.qty_in_stock || 0} ${item.unit || 'шт'}, мин: ${item.min_qty || 0})`,
      action: () => setCurrentView('warehouse')
    });
  });

  // Recent CRM orders
  const recentOrders = [...safeCrmOrders]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 6);

  return (
    <div className="space-y-6">
      {/* KPI Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Всего заказов</span>
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
              <Boxes className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-black font-mono text-slate-900 mt-3">{totalOrders}</div>
          <div className="text-xs text-slate-500 font-medium mt-1">Всех заказов в базе</div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">В работе в цехе</span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-black font-mono text-amber-600 mt-3">{activeOrders}</div>
          <div className="text-xs text-slate-500 font-medium mt-1">Активные на станках</div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Сдано сегодня</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-black font-mono text-emerald-600 mt-3">{finishedToday}</div>
          <div className="text-xs text-slate-500 font-medium mt-1">Завершено за смену</div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Уведомлений</span>
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
              <Send className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-black font-mono text-indigo-600 mt-3">{notificationCount}</div>
          <div className="text-xs text-slate-500 font-medium mt-1">Отправлено клиентам</div>
        </div>
      </div>

      {/* Action Alerts */}
      {alerts.length > 0 && (
        <div className="bg-amber-50/80 border border-amber-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
              Внимание: важные сигналы ({alerts.length})
            </h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {alerts.slice(0, 4).map(alert => (
              <div
                key={alert.id}
                onClick={alert.action}
                className="flex items-center justify-between p-3 bg-white border border-amber-200/80 rounded-xl cursor-pointer hover:border-amber-300 transition-all text-xs"
              >
                <span className="font-medium text-slate-800 line-clamp-1">{alert.text}</span>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 ml-2" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Grid: Recent Orders & Quick Navigation */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Recent Orders */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Boxes className="w-4 h-4 text-blue-600" />
              <span>Последние заказы в производстве</span>
            </h3>
            <button
              onClick={() => setCurrentView('crm')}
              className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              <span>Все заказы</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {recentOrders.map(c => {
              const order = orders.find(o => o.id === c.oid);
              const progress = calculateOrderProgress(order);
              const finished = isOrderFinished(order);

              return (
                <div
                  key={c.oid}
                  onClick={() => openSearchModal(c.oid)}
                  className="py-3.5 hover:bg-slate-50/80 px-2 rounded-xl transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center font-mono font-black text-blue-600 text-xs shrink-0">
                      {c.oid}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">{c.client}</span>
                        {finished ? (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded-md">
                            Завершён
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-800 font-bold text-[10px] rounded-md">
                            {progress}%
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {c.item || 'Мебельное изделие'} · {c.phone || 'Без телефона'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 text-right">
                    <div>
                      <div className="font-mono font-black text-slate-900 text-sm">
                        {formatMoney(c.price)} сум
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {c.due_date ? `Сдача: ${new Date(c.due_date).toLocaleDateString('ru-RU')}` : 'Без дедлайна'}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Col: Quick Access & Activity */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
            <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              <span>Быстрый переход к разделам</span>
            </h4>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                onClick={() => setCurrentView('crm')}
                className="p-3 bg-slate-50 hover:bg-blue-50 hover:text-blue-700 rounded-xl border border-slate-200 text-left font-bold text-slate-800 transition-colors"
              >
                ➕ Новый заказ CRM
              </button>
              <button
                onClick={() => setCurrentView('orders')}
                className="p-3 bg-slate-50 hover:bg-blue-50 hover:text-blue-700 rounded-xl border border-slate-200 text-left font-bold text-slate-800 transition-colors"
              >
                ⚙️ Запуск в Цех
              </button>
              <button
                onClick={() => setCurrentView('monitor')}
                className="p-3 bg-slate-50 hover:bg-blue-50 hover:text-blue-700 rounded-xl border border-slate-200 text-left font-bold text-slate-800 transition-colors"
              >
                📊 Мониторинг цеха
              </button>
              <button
                onClick={() => setCurrentView('finance')}
                className="p-3 bg-slate-50 hover:bg-blue-50 hover:text-blue-700 rounded-xl border border-slate-200 text-left font-bold text-slate-800 transition-colors"
              >
                📈 Аналитика объёмов
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
            <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-600" />
              <span>Недавние действия в системе</span>
            </h4>

            <div className="space-y-2 text-xs max-h-48 overflow-y-auto pr-1">
              {activityLogs.slice(0, 5).map(log => (
                <div key={log.id} className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl">
                  <div className="flex items-center justify-between font-semibold text-slate-800">
                    <span>{log.user_name}</span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(log.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="text-slate-600 mt-0.5">{log.action}: {log.details}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
