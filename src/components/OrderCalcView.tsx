import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { formatMoney, getProcessCode, isOrderFinished } from '../utils/formatters';
import { printMaterialsWorkshop, printClientInvoice, printProductionSheet } from '../utils/printUtils';
import { OrderCalcMeta } from '../types';
import { PROCS } from '../constants';
import {
  ArrowLeft,
  Printer,
  FileText,
  Boxes,
  Wrench,
  DollarSign,
  Plus,
  Trash2,
  Rocket,
  CheckCircle2,
  Clock,
  Sparkles,
  Info
} from 'lucide-react';

export const OrderCalcView: React.FC = () => {
  const {
    activeCalcOrderId,
    setActiveCalcOrderId,
    setCurrentView,
    orders,
    crmOrders,
    orderMaterials,
    orderLabor,
    orderCalcMetas,
    laborCatalog,
    warehouseItems,
    loadAllData,
    showToast,
    logActivity,
    currentUser
  } = useApp();

  const [activeTab, setActiveTab] = useState<'progress' | 'materials' | 'labor' | 'summary'>('progress');
  const [warehousePickId, setWarehousePickId] = useState('');
  const [launchPanelOpen, setLaunchPanelOpen] = useState(false);
  const [selectedLaunchProcs, setSelectedLaunchProcs] = useState<string[]>([]);

  if (!activeCalcOrderId) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 shadow-sm max-w-lg mx-auto">
        <h3 className="text-lg font-bold text-slate-900 font-headline mb-2">Заказ не выбран</h3>
        <p className="text-xs text-slate-500 mb-6 font-medium">Выберите заказ в CRM или Мониторинге</p>
        <button
          onClick={() => setCurrentView('crm')}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors"
        >
          Перейти в CRM
        </button>
      </div>
    );
  }

  const orderId = activeCalcOrderId;
  const order = orders.find(o => o.id === orderId);
  const crmData = crmOrders.find(c => c.oid === orderId);

  const materials = orderMaterials.filter(m => m.order_id === orderId);
  const labor = orderLabor.filter(l => l.order_id === orderId);
  const calcMeta = orderCalcMetas.find(m => m.order_id === orderId) || {
    order_id: orderId,
    delivery_cost: 0,
    sale_price: typeof crmData?.price === 'number' ? crmData.price : parseFloat(crmData?.price as any) || 0,
    notes: ''
  };

  const matTotal = materials.reduce((s, m) => s + (m.qty || 0) * (m.unit_price || 0), 0);
  const laborTotal = labor.reduce((s, l) => s + (l.qty || 1) * (l.unit_price || 0), 0);
  const delivery = calcMeta.delivery_cost || 0;
  const cost = matTotal + laborTotal + delivery;
  const salePrice = calcMeta.sale_price || 0;
  const profit = salePrice - cost;
  const marginPct = salePrice > 0 ? ((profit / salePrice) * 100).toFixed(1) : '0';

  // --- Material CRUD ---
  const handleAddMaterialFromWarehouse = async () => {
    if (!warehousePickId) {
      showToast('Выберите товар со склада', 'error');
      return;
    }
    const item = warehouseItems.find(i => i.id === parseInt(warehousePickId, 10));
    if (!item) return;

    try {
      await supabase.from('order_materials').insert({
        order_id: orderId,
        name: item.name,
        color: '',
        package: '',
        qty: 1,
        unit: item.unit || 'шт',
        unit_price: item.unit_cost || 0
      });
      setWarehousePickId('');
      showToast(`Добавлено со склада: ${item.name}`);
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка: ' + e.message, 'error');
    }
  };

  const handleAddManualMaterial = async () => {
    try {
      await supabase.from('order_materials').insert({
        order_id: orderId,
        name: 'Новый материал',
        color: '',
        package: '',
        qty: 1,
        unit: 'шт',
        unit_price: 0
      });
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка: ' + e.message, 'error');
    }
  };

  const handleUpdateMaterial = async (id: number, field: string, value: any) => {
    try {
      const val = ['qty', 'unit_price'].includes(field) ? parseFloat(value) || 0 : value;
      await supabase.from('order_materials').update({ [field]: val }).eq('id', id);
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка обновления: ' + e.message, 'error');
    }
  };

  const handleDeleteMaterial = async (id: number) => {
    if (!confirm('Удалить строку материала?')) return;
    try {
      await supabase.from('order_materials').delete().eq('id', id);
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка удаления: ' + e.message, 'error');
    }
  };

  // --- Labor CRUD ---
  const handleAddLaborFromCatalog = async (catItem: any) => {
    try {
      await supabase.from('order_labor').insert({
        order_id: orderId,
        name: catItem.name,
        qty: 1,
        unit_price: catItem.rate || 0
      });
      showToast(`Добавлена работа: ${catItem.name}`);
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка: ' + e.message, 'error');
    }
  };

  const handleAddManualLabor = async () => {
    try {
      await supabase.from('order_labor').insert({
        order_id: orderId,
        name: 'Новая работа/монтаж',
        qty: 1,
        unit_price: 0
      });
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка: ' + e.message, 'error');
    }
  };

  const handleUpdateLabor = async (id: number, field: string, value: any) => {
    try {
      const val = ['qty', 'unit_price'].includes(field) ? parseFloat(value) || 0 : value;
      await supabase.from('order_labor').update({ [field]: val }).eq('id', id);
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка обновления: ' + e.message, 'error');
    }
  };

  const handleDeleteLabor = async (id: number) => {
    if (!confirm('Удалить работу?')) return;
    try {
      await supabase.from('order_labor').delete().eq('id', id);
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка удаления: ' + e.message, 'error');
    }
  };

  // --- Meta Updates ---
  const handleUpdateMeta = async (field: 'delivery_cost' | 'sale_price' | 'notes', val: any) => {
    try {
      const parsed = field === 'notes' ? val : parseFloat(val) || 0;
      const updatedMeta = {
        order_id: orderId,
        delivery_cost: field === 'delivery_cost' ? parsed : calcMeta.delivery_cost || 0,
        sale_price: field === 'sale_price' ? parsed : calcMeta.sale_price || 0,
        notes: field === 'notes' ? parsed : calcMeta.notes || ''
      };

      await supabase.from('order_calc_meta').upsert(updatedMeta);
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка сохранения: ' + e.message, 'error');
    }
  };

  // --- Launch order from Calc view ---
  const handleToggleLaunchProc = (proc: string) => {
    setSelectedLaunchProcs(prev =>
      prev.includes(proc) ? prev.filter(p => p !== proc) : [...prev, proc]
    );
  };

  const handleLaunchOrder = async () => {
    if (selectedLaunchProcs.length === 0) {
      showToast('Выберите хотя бы один процесс для запуска', 'error');
      return;
    }

    try {
      const history: Record<string, any> = { ...(order?.history || {}) };
      selectedLaunchProcs.forEach(p => {
        if (!history[p]) history[p] = {};
      });

      await supabase.from('orders').upsert({
        id: orderId,
        path: selectedLaunchProcs,
        history
      });

      await logActivity(
        currentUser?.name || 'Админ',
        'Запустил заказ из калькулятора',
        `Заказ #${orderId}, процессов: ${selectedLaunchProcs.length}`,
        'order'
      );

      showToast(`🚀 Заказ #${orderId} успешно запущен в цех!`);
      setLaunchPanelOpen(false);
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка запуска: ' + e.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCurrentView('crm')}
            className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors border border-slate-200"
            title="Назад в CRM"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold font-headline text-slate-900">
                Паспорт & Смета Заказа #{orderId}
              </h2>
              {crmData?.client && (
                <span className="text-xs px-2.5 py-0.5 bg-blue-50 text-blue-700 font-bold rounded-lg border border-blue-200">
                  {crmData.client}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500 font-medium mt-0.5">
              {crmData?.item || 'Изделие'} · {crmData?.phone || 'Без телефона'}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => printMaterialsWorkshop(orderId, crmData, materials, labor, calcMeta.delivery_cost || 0, calcMeta.notes || '')}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors border border-slate-200"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Материалы цеха</span>
          </button>
          <button
            onClick={() => printClientInvoice(orderId, crmData, salePrice, materials, labor)}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors border border-slate-200"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Накладная клиенту</span>
          </button>
          <button
            onClick={() => {
              if (order?.path?.length) {
                printProductionSheet(orderId, order.path, crmData, materials);
              } else {
                showToast('Заказ ещё не запущен в производство', 'error');
              }
            }}
            className="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors border border-blue-200"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Маршрутный лист</span>
          </button>
          <button
            onClick={() => {
              if (!launchPanelOpen) {
                setSelectedLaunchProcs(order?.path?.length ? order.path : PROCS.slice(0, 4));
              }
              setLaunchPanelOpen(!launchPanelOpen);
            }}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs transition-colors"
          >
            <Rocket className="w-3.5 h-3.5" />
            <span>{order?.path?.length ? 'Маршрут в цехе' : 'В производство'}</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Banner */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
        {/* Launch Panel Dropdown */}
        {launchPanelOpen && (
          <div className="mb-6 p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-emerald-950 text-xs uppercase tracking-wider">
                Выбор технологического маршрута заказа в цехе:
              </h4>
              <span className="text-[11px] text-emerald-700 font-bold">
                Выбрано: {selectedLaunchProcs.length} процессов
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PROCS.map(proc => (
                <label
                  key={proc}
                  className={`flex items-center gap-2 p-2 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                    selectedLaunchProcs.includes(proc)
                      ? 'bg-emerald-100/70 border-emerald-300 text-emerald-900'
                      : 'bg-white border-slate-200 text-slate-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedLaunchProcs.includes(proc)}
                    onChange={() => handleToggleLaunchProc(proc)}
                    className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="truncate">{proc}</span>
                </label>
              ))}
            </div>

            <button
              onClick={handleLaunchOrder}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-xs transition-all cursor-pointer"
            >
              Запустить выбранный маршрут ({selectedLaunchProcs.length} процессов)
            </button>
          </div>
        )}

        {/* KPI Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
            <div className="text-lg font-black font-mono text-slate-900">{formatMoney(matTotal)}</div>
            <div className="text-[10px] uppercase font-bold text-slate-500 mt-1">Материалы</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
            <div className="text-lg font-black font-mono text-slate-900">{formatMoney(laborTotal)}</div>
            <div className="text-[10px] uppercase font-bold text-slate-500 mt-1">Работа/монтаж</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
            <div className="text-lg font-black font-mono text-slate-900">{formatMoney(delivery)}</div>
            <div className="text-[10px] uppercase font-bold text-slate-500 mt-1">Доставка</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
            <div className="text-lg font-black font-mono text-slate-900">{formatMoney(cost)}</div>
            <div className="text-[10px] uppercase font-bold text-slate-500 mt-1">Себестоимость</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
            <div className="text-lg font-black font-mono text-blue-600">{formatMoney(salePrice)}</div>
            <div className="text-[10px] uppercase font-bold text-slate-500 mt-1">Цена продажи</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center col-span-2 sm:col-span-1">
            <div className={`text-lg font-black font-mono ${profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {formatMoney(profit)}
            </div>
            <div className="text-[10px] uppercase font-bold text-slate-500 mt-1">Прибыль ({marginPct}%)</div>
          </div>
        </div>
      </div>

      {/* Main Tabs */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-5">
        <div className="flex gap-2 p-1 bg-slate-100 rounded-xl max-w-lg">
          <button
            onClick={() => setActiveTab('progress')}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'progress' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            📊 Прогресс
          </button>
          <button
            onClick={() => setActiveTab('materials')}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'materials' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            📦 Материалы ({materials.length})
          </button>
          <button
            onClick={() => setActiveTab('labor')}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'labor' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            🔧 Работа ({labor.length})
          </button>
          <button
            onClick={() => setActiveTab('summary')}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'summary' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            💰 Итог & Маржа
          </button>
        </div>

        {/* 1. PROGRESS TAB */}
        {activeTab === 'progress' && (
          <div className="space-y-4">
            <h4 className="font-bold text-slate-900 text-sm font-headline">Ход выполнения в цехе</h4>

            {!order?.path?.length ? (
              <div className="text-center py-12 text-slate-400 text-xs">
                Заказ ещё не запущен в производство. Нажмите кнопку «В производство» выше.
              </div>
            ) : (
              <div className="space-y-2">
                {(order?.path || []).map((proc) => {
                  const h = order?.history?.[proc];
                  const code = getProcessCode(order, proc);
                  const isDone = !!h?.end;
                  const isActive = !!h?.start && !isDone;

                  return (
                    <div
                      key={proc}
                      className={`p-3.5 rounded-xl border flex items-center justify-between text-xs transition-all ${
                        isDone
                          ? 'bg-emerald-50/80 border-emerald-200 text-emerald-800'
                          : isActive
                          ? 'bg-blue-50/80 border-blue-200 ring-2 ring-blue-500/10 text-blue-900'
                          : 'bg-slate-50 border-slate-200 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono px-2 py-0.5 bg-white text-slate-800 rounded-md font-bold border border-slate-200 shadow-xs">
                          {code}
                        </span>
                        <span className="font-bold text-slate-900 text-sm">{proc}</span>
                      </div>

                      <div>
                        {isDone ? (
                          <span className="text-emerald-700 font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Выполнил: {h?.completed_by || h?.worker || '—'}</span>
                          </span>
                        ) : isActive ? (
                          <span className="text-blue-700 font-bold flex items-center gap-1">
                            <Clock className="w-4 h-4 animate-spin" />
                            <span>В работе: {h?.worker || '—'}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 font-medium">Ожидает очереди</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 2. MATERIALS TAB */}
        {activeTab === 'materials' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex-1 flex gap-2">
                <select
                  value={warehousePickId}
                  onChange={(e) => setWarehousePickId(e.target.value)}
                  className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="">Выберите товар со склада...</option>
                  {warehouseItems.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.name} (остаток: {i.qty_in_stock} {i.unit}, цена: {formatMoney(i.unit_cost)})
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAddMaterialFromWarehouse}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl whitespace-nowrap shadow-xs transition-colors"
                >
                  + Со склада
                </button>
              </div>

              <button
                onClick={handleAddManualMaterial}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl whitespace-nowrap border border-slate-200 transition-colors"
              >
                + Добавить вручную
              </button>
            </div>

            {materials.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs">
                Материалы ещё не добавлены
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="p-3">Материал</th>
                      <th className="p-3">Цвет</th>
                      <th className="p-3">Упаковка</th>
                      <th className="p-3 text-center">Кол-во</th>
                      <th className="p-3 text-center">Ед.</th>
                      <th className="p-3 text-right">Цена/ед</th>
                      <th className="p-3 text-right">Сумма</th>
                      <th className="p-3 text-center">Удалить</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {materials.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50">
                        <td className="p-2">
                          <input
                            type="text"
                            value={m.name || ''}
                            onChange={(e) => handleUpdateMaterial(m.id, 'name', e.target.value)}
                            className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-900"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={m.color || ''}
                            onChange={(e) => handleUpdateMaterial(m.id, 'color', e.target.value)}
                            className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs text-slate-800"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={m.package || ''}
                            onChange={(e) => handleUpdateMaterial(m.id, 'package', e.target.value)}
                            className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs text-slate-800"
                          />
                        </td>
                        <td className="p-2 text-center w-20">
                          <input
                            type="number"
                            step="any"
                            value={m.qty}
                            onChange={(e) => handleUpdateMaterial(m.id, 'qty', e.target.value)}
                            className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-center font-bold text-slate-900"
                          />
                        </td>
                        <td className="p-2 text-center w-16">
                          <input
                            type="text"
                            value={m.unit || 'шт'}
                            onChange={(e) => handleUpdateMaterial(m.id, 'unit', e.target.value)}
                            className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-center text-slate-700"
                          />
                        </td>
                        <td className="p-2 text-right w-28">
                          <input
                            type="number"
                            value={m.unit_price}
                            onChange={(e) => handleUpdateMaterial(m.id, 'unit_price', e.target.value)}
                            className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-right font-mono font-bold text-slate-900"
                          />
                        </td>
                        <td className="p-2 text-right font-mono font-bold text-slate-900">
                          {formatMoney((m.qty || 0) * (m.unit_price || 0))}
                        </td>
                        <td className="p-2 text-center">
                          <button
                            onClick={() => handleDeleteMaterial(m.id)}
                            className="text-rose-500 hover:text-rose-700 p-1 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 3. LABOR TAB */}
        {activeTab === 'labor' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex-1 flex gap-2">
                <select
                  onChange={(e) => {
                    const item = laborCatalog.find(c => c.id === parseInt(e.target.value, 10));
                    if (item) handleAddLaborFromCatalog(item);
                    e.target.value = '';
                  }}
                  defaultValue=""
                  className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900"
                >
                  <option value="">Добавить из справочника расценок...</option>
                  {laborCatalog.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({formatMoney(c.rate)} сум)
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleAddManualLabor}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl whitespace-nowrap border border-slate-200 transition-colors"
              >
                + Добавить вручную
              </button>
            </div>

            {labor.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs">
                Работы ещё не добавлены
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="p-3">Вид работы / Монтаж</th>
                      <th className="p-3 text-center">Кол-во</th>
                      <th className="p-3 text-right">Ставка/ед</th>
                      <th className="p-3 text-right">Сумма</th>
                      <th className="p-3 text-center">Удалить</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {labor.map((l) => (
                      <tr key={l.id} className="hover:bg-slate-50">
                        <td className="p-2">
                          <input
                            type="text"
                            value={l.name || ''}
                            onChange={(e) => handleUpdateLabor(l.id, 'name', e.target.value)}
                            className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-900"
                          />
                        </td>
                        <td className="p-2 text-center w-24">
                          <input
                            type="number"
                            step="any"
                            value={l.qty}
                            onChange={(e) => handleUpdateLabor(l.id, 'qty', e.target.value)}
                            className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-center font-bold text-slate-900"
                          />
                        </td>
                        <td className="p-2 text-right w-32">
                          <input
                            type="number"
                            value={l.unit_price}
                            onChange={(e) => handleUpdateLabor(l.id, 'unit_price', e.target.value)}
                            className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-right font-mono font-bold text-slate-900"
                          />
                        </td>
                        <td className="p-2 text-right font-mono font-bold text-slate-900">
                          {formatMoney((l.qty || 1) * (l.unit_price || 0))}
                        </td>
                        <td className="p-2 text-center">
                          <button
                            onClick={() => handleDeleteLabor(l.id)}
                            className="text-rose-500 hover:text-rose-700 p-1 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 4. SUMMARY TAB */}
        {activeTab === 'summary' && (
          <div className="space-y-6 max-w-xl">
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
              <h4 className="font-bold text-slate-900 text-sm">Финансовая сводка и расчёт маржинальности</h4>

              <div className="space-y-3 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-slate-200">
                  <span className="text-slate-600">Стоимость материалов:</span>
                  <span className="font-mono font-bold text-slate-900">{formatMoney(matTotal)} сум</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200">
                  <span className="text-slate-600">Оплата труда (сборка/монтаж):</span>
                  <span className="font-mono font-bold text-slate-900">{formatMoney(laborTotal)} сум</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200">
                  <span className="text-slate-600">Доставка и накладные расходы:</span>
                  <div className="w-32">
                    <input
                      type="number"
                      value={delivery}
                      onChange={(e) => handleUpdateMeta('delivery_cost', e.target.value)}
                      className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-right font-mono font-bold text-slate-900"
                    />
                  </div>
                </div>
                <div className="flex justify-between items-center py-2 bg-slate-100/70 px-3 rounded-xl">
                  <span className="font-bold text-slate-900">Итого Себестоимость:</span>
                  <span className="font-mono font-black text-slate-900 text-sm">{formatMoney(cost)} сум</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200">
                  <span className="text-slate-900 font-bold">Цена продажи клиенту:</span>
                  <div className="w-36">
                    <input
                      type="number"
                      value={salePrice}
                      onChange={(e) => handleUpdateMeta('sale_price', e.target.value)}
                      className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-right font-mono font-bold text-blue-600 text-sm"
                    />
                  </div>
                </div>
                <div className={`flex justify-between items-center py-3 px-3 rounded-xl border ${profit >= 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'}`}>
                  <span className="font-bold text-sm">Чистая прибыль (Маржа {marginPct}%):</span>
                  <span className="font-mono font-black text-base">{formatMoney(profit)} сум</span>
                </div>
              </div>

              <div className="pt-2">
                <label className="block text-xs font-bold text-slate-600 uppercase mb-1">
                  Заметки к расчёту
                </label>
                <textarea
                  rows={3}
                  value={calcMeta.notes || ''}
                  onChange={(e) => handleUpdateMeta('notes', e.target.value)}
                  placeholder="Дополнительные условия, особенности проекта..."
                  className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
