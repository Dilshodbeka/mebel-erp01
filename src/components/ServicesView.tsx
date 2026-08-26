import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { formatMoney } from '../utils/formatters';
import {
  Wrench,
  UserPlus,
  Plus,
  Trash2,
  Edit2,
  DollarSign,
  Phone,
  CheckCircle2,
  FileSpreadsheet,
  Clock,
  Printer
} from 'lucide-react';

export const ServicesView: React.FC = () => {
  const {
    svcClients,
    svcTransactions,
    crmOrders,
    loadAllData,
    showToast,
    logActivity,
    currentUser
  } = useApp();

  const [activeTab, setActiveTab] = useState<'clients' | 'orders'>('clients');

  // Client form
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');

  // Order form
  const [orderClientId, setOrderClientId] = useState('');
  const [orderDesc, setOrderDesc] = useState('');
  const [orderQty, setOrderQty] = useState('1');
  const [orderPrice, setOrderPrice] = useState('0');
  const [orderMaterial, setOrderMaterial] = useState<'client' | 'ours'>('client');
  const [orderLinkedId, setOrderLinkedId] = useState('');

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = clientName.trim();
    if (!name) {
      showToast('Введите имя субподрядчика / услугчика', 'error');
      return;
    }

    try {
      const { error } = await supabase.from('svc_clients').insert({
        name,
        phone: clientPhone.trim()
      });
      if (error) throw error;

      await logActivity(
        currentUser?.name || 'Админ',
        'Добавил субподрядчика',
        `Услугчик: ${name}`,
        'crm'
      );

      showToast(`Услугчик «${name}» добавлен`);
      setClientName('');
      setClientPhone('');
      await loadAllData();
    } catch (err: any) {
      showToast('Ошибка: ' + err.message, 'error');
    }
  };

  const handleDeleteClient = async (id: number, name: string) => {
    if (!confirm(`Удалить услугчика «${name}»?`)) return;
    try {
      await supabase.from('svc_clients').delete().eq('id', id);
      showToast(`Услугчик «${name}» удален`);
      await loadAllData();
    } catch (err: any) {
      showToast('Ошибка: ' + err.message, 'error');
    }
  };

  const handleAddServiceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderClientId) {
      showToast('Выберите субподрядчика', 'error');
      return;
    }

    try {
      const { error } = await supabase.from('svc_orders').insert({
        client_id: parseInt(orderClientId, 10),
        description: orderDesc.trim(),
        qty: parseFloat(orderQty) || 1,
        unit_price: parseFloat(orderPrice) || 0,
        material: orderMaterial,
        linked_order_id: orderLinkedId.trim() || null,
        paid: false
      });
      if (error) throw error;

      showToast('Заказ на услуги сохранен');
      setOrderDesc('');
      setOrderQty('1');
      setOrderPrice('0');
      setOrderLinkedId('');
      await loadAllData();
    } catch (err: any) {
      showToast('Ошибка: ' + err.message, 'error');
    }
  };

  const handleTogglePaid = async (id: number, current: boolean) => {
    try {
      await supabase.from('svc_orders').update({ paid: !current }).eq('id', id);
      showToast(!current ? 'Отмечено как оплачено' : 'Статус оплаты снят');
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка: ' + e.message, 'error');
    }
  };

  const handleDeleteOrder = async (id: number) => {
    if (!confirm('Удалить услугу?')) return;
    try {
      await supabase.from('svc_orders').delete().eq('id', id);
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка: ' + e.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Subtabs */}
      <div className="flex gap-2 p-1.5 bg-white border border-slate-200 backdrop-blur-md rounded-2xl max-w-sm">
        <button
          onClick={() => setActiveTab('clients')}
          className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'clients' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          👥 Услугчики ({svcClients.length})
        </button>
        <button
          onClick={() => setActiveTab('orders')}
          className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'orders' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          📋 Заказы услуг ({(svcTransactions || []).length})
        </button>
      </div>

      {/* 1. CLIENTS TAB */}
      {activeTab === 'clients' && (
        <div className="space-y-6">
          {/* Add form */}
          <div className="bg-white backdrop-blur-xl rounded-3xl p-6 border border-slate-200 shadow-xl shadow-black/20 text-slate-700">
            <h4 className="font-bold text-slate-900 text-sm font-headline mb-4 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-blue-400" />
              <span>Добавить субподрядчика / услугчика</span>
            </h4>

            <form onSubmit={handleAddClient} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">ФИО / Компания</label>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="ИП МебельМастер"
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-400"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Телефон</label>
                <input
                  type="text"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="+998 90 000 00 00"
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-400"
                />
              </div>

              <div>
                <button
                  type="submit"
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-slate-900 font-bold text-xs rounded-xl shadow-lg shadow-blue-900/30 transition-colors"
                >
                  + Добавить субподрядчика
                </button>
              </div>
            </form>
          </div>

          {/* List */}
          <div className="bg-white backdrop-blur-xl rounded-3xl border border-slate-200 shadow-xl shadow-black/20 overflow-hidden text-slate-700">
            {svcClients.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">Услугчики ещё не добавлены</div>
            ) : (
              <table className="w-full text-xs text-left">
                <thead className="bg-white text-slate-500 uppercase tracking-wider text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="p-3.5">Субподрядчик</th>
                    <th className="p-3.5">Телефон</th>
                    <th className="p-3.5 text-center">Заказов</th>
                    <th className="p-3.5 text-right">Сумма всех услуг</th>
                    <th className="p-3.5 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {svcClients.map((client) => {
                    const clientOrders = (svcTransactions || []).filter(o => o.client_id === client.id);
                    const totalSum = clientOrders.reduce((s, o) => s + (o.qty || 1) * (o.unit_price || 0), 0);

                    return (
                      <tr key={client.id} className="hover:bg-white transition-colors">
                        <td className="p-3.5 font-bold text-slate-900 text-sm">{client.name}</td>
                        <td className="p-3.5 text-slate-500">{client.phone || '—'}</td>
                        <td className="p-3.5 text-center font-mono font-bold text-slate-700">{clientOrders.length}</td>
                        <td className="p-3.5 text-right font-mono font-black text-blue-400 text-sm">
                          {formatMoney(totalSum)}
                        </td>
                        <td className="p-3.5 text-right">
                          <button
                            onClick={() => handleDeleteClient(client.id, client.name)}
                            className="p-1.5 text-rose-400 hover:bg-rose-500/20 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* 2. ORDERS TAB */}
      {activeTab === 'orders' && (
        <div className="space-y-6">
          {/* Add form */}
          <div className="bg-white backdrop-blur-xl rounded-3xl p-6 border border-slate-200 shadow-xl shadow-black/20 space-y-4 text-slate-700">
            <h4 className="font-bold text-slate-900 text-sm font-headline">Добавить услугу / работу подрядчика</h4>

            <form onSubmit={handleAddServiceOrder} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Услугчик</label>
                <select
                  value={orderClientId}
                  onChange={(e) => setOrderClientId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-400"
                >
                  <option value="">Выберите услугчика...</option>
                  {svcClients.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Описание работы</label>
                <input
                  type="text"
                  value={orderDesc}
                  onChange={(e) => setOrderDesc(e.target.value)}
                  placeholder="Распил ЛДСП 10 листов"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-400"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Кол-во</label>
                <input
                  type="number"
                  step="0.01"
                  value={orderQty}
                  onChange={(e) => setOrderQty(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-center font-bold font-mono text-slate-900 focus:outline-none focus:border-blue-400"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Цена за ед.</label>
                <input
                  type="number"
                  step="0.01"
                  value={orderPrice}
                  onChange={(e) => setOrderPrice(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-right font-bold font-mono text-slate-900 focus:outline-none focus:border-blue-400"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Материал</label>
                <select
                  value={orderMaterial}
                  onChange={(e: any) => setOrderMaterial(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-400"
                >
                  <option value="client">Клиента</option>
                  <option value="ours">Наш со склада</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Привязка к заказу (№)</label>
                <input
                  type="text"
                  value={orderLinkedId}
                  onChange={(e) => setOrderLinkedId(e.target.value)}
                  placeholder="0001"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-blue-400"
                />
              </div>

              <div className="sm:col-span-4 flex justify-end">
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-slate-900 font-bold text-xs rounded-xl shadow-lg shadow-blue-900/30 transition-colors"
                >
                  + Сохранить услугу
                </button>
              </div>
            </form>
          </div>

          {/* List */}
          <div className="bg-white backdrop-blur-xl rounded-3xl border border-slate-200 shadow-xl shadow-black/20 overflow-hidden text-slate-700">
            {!(svcTransactions || []).length ? (
              <div className="text-center py-12 text-slate-500 text-xs">Заказов на услуги нет</div>
            ) : (
              <table className="w-full text-xs text-left">
                <thead className="bg-white text-slate-500 uppercase tracking-wider text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="p-3.5">Услугчик</th>
                    <th className="p-3.5">Описание</th>
                    <th className="p-3.5 text-center">Кол-во</th>
                    <th className="p-3.5 text-right">Цена/ед</th>
                    <th className="p-3.5 text-right">Сумма</th>
                    <th className="p-3.5">Материал</th>
                    <th className="p-3.5">Заказ №</th>
                    <th className="p-3.5">Оплата</th>
                    <th className="p-3.5 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {(svcTransactions || []).map((so) => {
                    const client = svcClients.find(c => c.id === so.client_id);

                    return (
                      <tr key={so.id} className="hover:bg-white transition-colors">
                        <td className="p-3.5 font-bold text-slate-900">{client?.name || `Подрядчик #${so.client_id}`}</td>
                        <td className="p-3.5 text-slate-600">{so.description}</td>
                        <td className="p-3.5 text-center font-mono font-bold text-slate-700">{so.qty}</td>
                        <td className="p-3.5 text-right font-mono text-slate-600">{formatMoney(so.unit_price)}</td>
                        <td className="p-3.5 text-right font-mono font-black text-blue-400 text-sm">
                          {formatMoney((so.qty || 1) * (so.unit_price || 0))}
                        </td>
                        <td className="p-3.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                            so.material === 'ours' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : 'bg-white text-slate-600 border-slate-200'
                          }`}>
                            {so.material === 'ours' ? 'Наш склад' : 'Клиента'}
                          </span>
                        </td>
                        <td className="p-3.5 font-mono font-bold text-blue-400">
                          {so.linked_order_id ? `#${so.linked_order_id}` : '—'}
                        </td>
                        <td className="p-3.5">
                          <button
                            onClick={() => handleTogglePaid(so.id, !!so.paid)}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all border ${
                              so.paid
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/30'
                                : 'bg-rose-500/20 text-rose-300 border-rose-500/30 hover:bg-rose-500/30'
                            }`}
                          >
                            {so.paid ? '✔ Оплачено' : '⏳ Не оплачено'}
                          </button>
                        </td>
                        <td className="p-3.5 text-right">
                          <button
                            onClick={() => handleDeleteOrder(so.id)}
                            className="p-1.5 text-rose-400 hover:bg-rose-500/20 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
