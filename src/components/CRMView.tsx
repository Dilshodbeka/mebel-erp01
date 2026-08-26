import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { formatMoney, calculateOrderProgress, isOrderFinished, getPathProcUnit } from '../utils/formatters';
import { PROCS } from '../constants';
import {
  UserPlus,
  Search,
  Calendar,
  DollarSign,
  Phone,
  MapPin,
  Package,
  ArrowRight,
  Send,
  Trash2,
  CheckCircle2,
  Clock,
  Wrench,
  Sparkles,
  FileText,
  Boxes,
  Layers,
  ChevronDown,
  ChevronUp,
  Plus
} from 'lucide-react';

export const CRMView: React.FC = () => {
  const {
    crmOrders,
    orders,
    telegramClients,
    svcClients,
    warehouseItems,
    workers,
    loadAllData,
    showToast,
    logActivity,
    currentUser,
    setCurrentView,
    setActiveCalcOrderId,
    openSearchModal
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'finished'>('all');
  const [showAdvancedRoute, setShowAdvancedRoute] = useState(true);

  // Auto increment order ID helper
  const getNextOrderId = () => {
    let maxNum = 0;
    (crmOrders || []).forEach(c => {
      const num = parseInt(c.oid, 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    });
    return String(maxNum + 1).padStart(4, '0');
  };

  const defaultProcs = ["Раскрой NESTING", "кромка", "Присадка", "Сборка", "Упаковка"];

  const [formData, setFormData] = useState({
    oid: getNextOrderId(),
    client: '',
    phone: '',
    item: '',
    price: '',
    prepayment: '',
    loc: '',
    date: new Date().toISOString().slice(0, 10),
    due_date: '',
    svc_client_id: '',
    svc_material: 'client' as 'ours' | 'client',
    svc_qty: '1'
  });

  const [selectedProcs, setSelectedProcs] = useState<string[]>(defaultProcs);
  const [procConfigs, setProcConfigs] = useState<Record<string, { qty: number; worker: string }>>({
    "Раскрой NESTING": { qty: 25, worker: '' },
    "кромка": { qty: 120, worker: '' },
    "Присадка": { qty: 40, worker: '' },
    "Сборка": { qty: 1, worker: '' },
    "Упаковка": { qty: 1, worker: '' }
  });

  // Attached initial materials
  const [initialMaterials, setInitialMaterials] = useState<{ item_id: number; name: string; qty: number; unit: string; price: number }[]>([]);
  const [selectedWarehouseItem, setSelectedWarehouseItem] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleToggleProc = (proc: string) => {
    if (selectedProcs.includes(proc)) {
      setSelectedProcs(prev => prev.filter(p => p !== proc));
    } else {
      setSelectedProcs(prev => [...prev, proc]);
      if (!procConfigs[proc]) {
        setProcConfigs(prev => ({
          ...prev,
          [proc]: {
            qty: proc.includes('кромк') ? 100 : proc.includes('раскрой') ? 20 : 1,
            worker: ''
          }
        }));
      }
    }
  };

  const handleProcConfigChange = (proc: string, field: 'qty' | 'worker', val: any) => {
    setProcConfigs(prev => ({
      ...prev,
      [proc]: {
        qty: field === 'qty' ? parseFloat(val) || 1 : prev[proc]?.qty || 1,
        worker: field === 'worker' ? val : prev[proc]?.worker || ''
      }
    }));
  };

  const handleAddWarehouseMaterial = () => {
    if (!selectedWarehouseItem) return;
    const item = warehouseItems.find(i => i.id === parseInt(selectedWarehouseItem, 10));
    if (!item) return;

    setInitialMaterials(prev => [
      ...prev,
      {
        item_id: item.id,
        name: item.name,
        qty: 1,
        unit: item.unit || 'шт',
        price: item.unit_cost || 0
      }
    ]);
    setSelectedWarehouseItem('');
  };

  const handleRemoveInitialMaterial = (index: number) => {
    setInitialMaterials(prev => prev.filter((_, i) => i !== index));
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const oid = formData.oid.trim();
    const client = formData.client.trim();
    if (!oid || !client) {
      showToast('Укажите номер заказа и клиента', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Insert into crm_orders
      const crmPayload: any = {
        oid,
        client,
        phone: formData.phone.trim(),
        item: formData.item.trim(),
        price: parseFloat(formData.price) || 0,
        loc: formData.loc.trim(),
        date: formData.date || null,
        due_date: formData.due_date || null,
        svc_client_id: formData.svc_client_id ? parseInt(formData.svc_client_id) : null,
        svc_material: formData.svc_material,
        svc_qty: parseFloat(formData.svc_qty) || 1
      };

      const { error: crmError } = await supabase.from('crm_orders').upsert(crmPayload);
      if (crmError) throw crmError;

      // 2. Insert into orders with tech route & assigned masters & volumes
      if (selectedProcs.length > 0) {
        const history: Record<string, any> = {};
        selectedProcs.forEach(p => {
          history[p] = {
            planned_qty: procConfigs[p]?.qty || 1,
            unit: getPathProcUnit(p),
            assigned_worker: procConfigs[p]?.worker || null
          };
        });

        const { error: orderError } = await supabase.from('orders').upsert({
          id: oid,
          path: selectedProcs,
          history
        });
        if (orderError) console.warn('Order upsert warning:', orderError);
      }

      // 3. Insert initial materials if chosen
      if (initialMaterials.length > 0) {
        const matPayload = initialMaterials.map(m => ({
          order_id: oid,
          name: m.name,
          color: '',
          package: '',
          qty: m.qty,
          unit: m.unit,
          unit_price: m.price
        }));
        await supabase.from('order_materials').insert(matPayload);
      }

      // 4. Record order calc meta
      await supabase.from('order_calc_meta').upsert({
        order_id: oid,
        sale_price: parseFloat(formData.price) || 0,
        delivery_cost: 0,
        notes: `Клиент: ${client}, Тел: ${formData.phone}`
      });

      await logActivity(
        currentUser?.name || 'Админ',
        'Создал заказ CRM и запустил маршрут',
        `Заказ #${oid}, клиент: ${client}, процессов: ${selectedProcs.length}`,
        'crm'
      );

      showToast(`Заказ #${oid} успешно создан и связан с производством!`);
      
      // Reset form
      setFormData({
        oid: getNextOrderId(),
        client: '',
        phone: '',
        item: '',
        price: '',
        prepayment: '',
        loc: '',
        date: new Date().toISOString().slice(0, 10),
        due_date: '',
        svc_client_id: '',
        svc_material: 'client',
        svc_qty: '1'
      });
      setInitialMaterials([]);

      await loadAllData();
    } catch (err: any) {
      showToast('Ошибка сохранения: ' + err.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (oid: string) => {
    if (!confirm(`Удалить заказ CRM #${oid}?`)) return;
    try {
      await supabase.from('crm_orders').delete().eq('oid', oid);
      await logActivity(currentUser?.name || 'Админ', 'Удалил заказ CRM', `Заказ #${oid}`, 'delete');
      showToast(`Заказ #${oid} удален`);
      await loadAllData();
    } catch (err: any) {
      showToast('Ошибка удаления: ' + err.message, 'error');
    }
  };

  const filteredOrders = crmOrders.filter(c => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      (c.oid || '').toLowerCase().includes(q) ||
      (c.client || '').toLowerCase().includes(q) ||
      (c.item || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q);

    if (!matchesSearch) return false;

    if (statusFilter === 'all') return true;
    const order = orders.find(o => o.id === c.oid);
    const finished = isOrderFinished(order);
    if (statusFilter === 'active') return !finished;
    if (statusFilter === 'finished') return finished;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold font-headline text-slate-900 flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-blue-600" />
            <span>CRM & Управление заказами</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            Сквозное создание заказов: клиент, технологический маршрут, назначение мастеров, материалы и расчёты
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <span className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl shadow-xs">
            Всего в базе: <b className="text-slate-900">{crmOrders.length}</b>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Form to Create Comprehensive Order */}
        <div className="lg:col-span-1">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-600" />
                <span>Новый заказ с маршрутом</span>
              </h3>
              <span className="text-[11px] font-mono text-blue-600 font-bold">№ {formData.oid}</span>
            </div>

            <form onSubmit={handleCreateOrder} className="space-y-3.5">
              {/* Core Order Info */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    № Заказа *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.oid}
                    onChange={e => setFormData({ ...formData, oid: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Сумма счёта (сум)
                  </label>
                  <input
                    type="number"
                    value={formData.price}
                    onChange={e => setFormData({ ...formData, price: e.target.value })}
                    placeholder="0"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Клиент / Заказчик *
                </label>
                <input
                  type="text"
                  required
                  value={formData.client}
                  onChange={e => setFormData({ ...formData, client: e.target.value })}
                  placeholder="ФИО или название компании"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Телефон
                  </label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+7 7..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Срок сдачи
                  </label>
                  <input
                    type="date"
                    value={formData.due_date}
                    onChange={e => setFormData({ ...formData, due_date: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Изделие / Наименование мебели
                </label>
                <input
                  type="text"
                  value={formData.item}
                  onChange={e => setFormData({ ...formData, item: e.target.value })}
                  placeholder="напр. Кухонный гарнитур, Шкаф-купе"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Адрес доставки / Объект
                </label>
                <input
                  type="text"
                  value={formData.loc}
                  onChange={e => setFormData({ ...formData, loc: e.target.value })}
                  placeholder="Адрес или примечание"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {/* Tech Route & Masters Selection */}
              <div className="pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAdvancedRoute(!showAdvancedRoute)}
                  className="w-full flex items-center justify-between text-xs font-bold text-slate-700 py-1 hover:text-blue-600"
                >
                  <span className="flex items-center gap-1.5">
                    <Wrench className="w-3.5 h-3.5 text-blue-600" />
                    <span>Маршрут в цех и Мастера ({selectedProcs.length})</span>
                  </span>
                  {showAdvancedRoute ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {showAdvancedRoute && (
                  <div className="mt-2 space-y-2 max-h-56 overflow-y-auto pr-1">
                    {PROCS.map(proc => {
                      const isSel = selectedProcs.includes(proc);
                      const unit = getPathProcUnit(proc);
                      const config = procConfigs[proc] || { qty: 1, worker: '' };

                      return (
                        <div
                          key={proc}
                          className={`p-2 rounded-xl border text-xs transition-all ${
                            isSel ? 'bg-blue-50/60 border-blue-200' : 'bg-slate-50/50 border-slate-200 opacity-60'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={isSel}
                                onChange={() => handleToggleProc(proc)}
                                className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500"
                              />
                              <span className="font-semibold text-slate-800">{proc}</span>
                            </label>
                            <span className="text-[10px] text-slate-400 font-mono">({unit})</span>
                          </div>

                          {isSel && (
                            <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-blue-100">
                              <div>
                                <span className="text-[10px] text-slate-500 font-bold block mb-0.5">План объем:</span>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min="0.1"
                                    step="any"
                                    value={config.qty}
                                    onChange={e => handleProcConfigChange(proc, 'qty', e.target.value)}
                                    className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-800"
                                  />
                                  <span className="text-[10px] text-slate-500">{unit}</span>
                                </div>
                              </div>

                              <div>
                                <span className="text-[10px] text-slate-500 font-bold block mb-0.5">Мастер:</span>
                                <select
                                  value={config.worker}
                                  onChange={e => handleProcConfigChange(proc, 'worker', e.target.value)}
                                  className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs text-slate-800"
                                >
                                  <option value="">(Любой)</option>
                                  {workers.map(w => (
                                    <option key={w.id} value={w.name}>{w.name}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Warehouse Materials Section */}
              <div className="pt-2 border-t border-slate-100">
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Материалы со склада (по желанию)
                </label>
                <div className="flex gap-1.5">
                  <select
                    value={selectedWarehouseItem}
                    onChange={e => setSelectedWarehouseItem(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800"
                  >
                    <option value="">-- Выберите товар со склада --</option>
                    {warehouseItems.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.qty_in_stock} {item.unit}) - {formatMoney(item.unit_cost)} сум
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddWarehouseMaterial}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl border border-slate-200 transition-colors"
                  >
                    + Добавить
                  </button>
                </div>

                {initialMaterials.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {initialMaterials.map((m, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs bg-slate-50 p-2 rounded-lg border border-slate-200">
                        <span className="font-semibold text-slate-800">{m.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-600">{m.qty} {m.unit}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveInitialMaterial(idx)}
                            className="text-rose-500 hover:text-rose-700"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-600/20 transition-all flex items-center justify-center gap-2 mt-4"
              >
                <Plus className="w-4 h-4" />
                <span>{isSubmitting ? 'Сохранение...' : 'Создать и связать с цехом'}</span>
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: Orders List & Search */}
        <div className="lg:col-span-2 space-y-4">
          {/* Filter Bar */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Поиск по № заказа, клиенту, телефону..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-medium"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>

            <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200 w-full sm:w-auto justify-center">
              {(['all', 'active', 'finished'] as const).map(s => {
                const labels = { all: 'Все заказы', active: 'В работе', finished: 'Завершенные' };
                const isSel = statusFilter === s;
                return (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      isSel
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {labels[s]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Orders Table */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm">
                Список заказов ({filteredOrders.length})
              </h3>
              <span className="text-xs text-slate-500">Нажмите на заказ для полного паспорта</span>
            </div>

            {filteredOrders.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-xs">
                Заказы не найдены. Создайте новый заказ слева.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredOrders.map(c => {
                  const order = orders.find(o => o.id === c.oid);
                  const progress = calculateOrderProgress(order);
                  const finished = isOrderFinished(order);
                  const price = typeof c.price === 'number' ? c.price : parseFloat(c.price as any) || 0;

                  return (
                    <div
                      key={c.oid}
                      onClick={() => openSearchModal(c.oid)}
                      className="p-4 hover:bg-slate-50/80 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center font-mono font-black text-blue-600 text-xs shrink-0">
                          {c.oid}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-sm">{c.client}</span>
                            {finished ? (
                              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded-md">
                                Завершен
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-blue-100 text-blue-800 font-bold text-[10px] rounded-md">
                                В цехе ({progress}%)
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-2">
                            {c.item && <span>Изделие: <b className="text-slate-700">{c.item}</b></span>}
                            {c.phone && <span>Тел: <b className="text-slate-700">{c.phone}</b></span>}
                            {c.due_date && <span>Срок: <b className="text-blue-600">{new Date(c.due_date).toLocaleDateString('ru-RU')}</b></span>}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                        <div className="text-right">
                          <div className="font-mono font-black text-slate-900 text-sm">
                            {formatMoney(price)} сум
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Процессов: {order?.path?.length || 0}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => {
                              setActiveCalcOrderId(c.oid);
                              setCurrentView('order-calc');
                            }}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg transition-colors"
                            title="Открыть калькулятор заказа"
                          >
                            Расчет
                          </button>
                          <button
                            onClick={() => handleDelete(c.oid)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Удалить заказ"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
