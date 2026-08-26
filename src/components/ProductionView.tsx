import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { PROCS } from '../constants';
import { isPaintProc, pad2, formatMoney, getPathProcUnit } from '../utils/formatters';
import { printProductionSheet } from '../utils/printUtils';
import { Cog, Rocket, Palette, Plus, Trash2, Printer, CheckCircle2, ChevronRight } from 'lucide-react';

export const ProductionView: React.FC = () => {
  const {
    crmOrders,
    orders,
    workers,
    paintCatalog,
    loadAllData,
    showToast,
    logActivity,
    currentUser,
    orderMaterials
  } = useApp();

  const [orderIdInput, setOrderIdInput] = useState('');
  const [selectedPath, setSelectedPath] = useState<string[]>([
    "Раскрой NESTING",
    "кромка",
    "Присадка",
    "Сборка",
    "Упаковка"
  ]);
  const [procConfigs, setProcConfigs] = useState<Record<string, { qty: number; worker: string }>>({
    "Раскрой NESTING": { qty: 25, worker: '' },
    "кромка": { qty: 120, worker: '' },
    "Присадка": { qty: 40, worker: '' },
    "Сборка": { qty: 1, worker: '' },
    "Упаковка": { qty: 1, worker: '' }
  });
  
  // Paint items for order
  const [paintItems, setPaintItems] = useState<{ category: string; item_name: string; qty: number }[]>([]);
  const [paintCategoryInput, setPaintCategoryInput] = useState('');
  const [paintItemNameInput, setPaintItemNameInput] = useState('');
  const [paintQtyInput, setPaintQtyInput] = useState<number>(1);
  const [layersCount, setLayersCount] = useState<number>(2);
  const [coatsCount, setCoatsCount] = useState<number>(2);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const crmData = crmOrders.find(c => c.oid === orderIdInput.trim());

  const handleToggleProc = (proc: string) => {
    setSelectedPath(prev => {
      const next = prev.includes(proc) ? prev.filter(p => p !== proc) : [...prev, proc];
      return next;
    });
  };

  const handleConfigChange = (proc: string, field: 'qty' | 'worker', val: any) => {
    setProcConfigs(prev => ({
      ...prev,
      [proc]: {
        qty: field === 'qty' ? parseFloat(val) || 1 : prev[proc]?.qty || 1,
        worker: field === 'worker' ? val : prev[proc]?.worker || ''
      }
    }));
  };

  const handleAddPaintItem = () => {
    if (!paintCategoryInput || !paintItemNameInput || paintQtyInput <= 0) {
      showToast('Заполните категорию, изделие и количество', 'error');
      return;
    }

    setPaintItems(prev => {
      const existing = prev.find(i => i.category === paintCategoryInput && i.item_name === paintItemNameInput);
      if (existing) {
        return prev.map(i =>
          i.category === paintCategoryInput && i.item_name === paintItemNameInput
            ? { ...i, qty: i.qty + paintQtyInput }
            : i
        );
      }
      return [...prev, { category: paintCategoryInput, item_name: paintItemNameInput, qty: paintQtyInput }];
    });

    setPaintQtyInput(1);
  };

  const handleRemovePaintItem = (idx: number) => {
    setPaintItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleLaunch = async () => {
    const oid = orderIdInput.trim();
    if (!oid) {
      showToast('Введите номер заказа', 'error');
      return;
    }
    if (selectedPath.length === 0) {
      showToast('Выберите хотя бы один технологический процесс', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const existingOrder = orders.find(o => o.id === oid);
      const history: Record<string, any> = { ...(existingOrder?.history || {}) };

      selectedPath.forEach(p => {
        if (!history[p]) history[p] = {};
        history[p].planned_qty = procConfigs[p]?.qty || 1;
        history[p].unit = getPathProcUnit(p);
        if (procConfigs[p]?.worker) history[p].assigned_worker = procConfigs[p].worker;
      });

      // 1. Upsert order
      const { error: orderError } = await supabase.from('orders').upsert({
        id: oid,
        path: selectedPath,
        history
      });
      if (orderError) throw orderError;

      // 2. If paint items exist
      const hasPaint = selectedPath.some(p => isPaintProc(p));
      if (hasPaint && paintItems.length > 0) {
        await supabase.from('paint_order_items').delete().eq('order_id', oid);
        await supabase.from('paint_order_items').insert(
          paintItems.map(i => ({ order_id: oid, category: i.category, item_name: i.item_name, qty: i.qty }))
        );
        await supabase.from('paint_layer_config').upsert({
          order_id: oid,
          layers: layersCount,
          coats: coatsCount
        });
      }

      await logActivity(
        currentUser?.name || 'Админ',
        'Запустил заказ в цех',
        `Заказ #${oid}, процессов: ${selectedPath.length}`,
        'order'
      );

      showToast(`🚀 Заказ #${oid} успешно запущен в цех!`);

      // Print production sheet
      const materials = orderMaterials.filter(m => m.order_id === oid);
      printProductionSheet(oid, selectedPath, crmData, materials);

      // Reset
      setOrderIdInput('');
      setPaintItems([]);

      await loadAllData();
    } catch (err: any) {
      showToast('Ошибка запуска: ' + err.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasPaintSelected = selectedPath.some(p => isPaintProc(p));
  const paintCategories = Array.from(new Set(paintCatalog.map(p => p.category)));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold font-headline text-slate-900 flex items-center gap-2">
          <Cog className="w-6 h-6 text-blue-600" />
          <span>Цеховой запуск и Маршрутные карты</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1 font-medium">
          Конфигурация технологического маршрута, объёмов и закрепление мастеров за станками
        </p>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
        {/* Order Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pb-6 border-b border-slate-100 items-center">
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase mb-1">
              Номер заказа *
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={orderIdInput}
                onChange={e => setOrderIdInput(e.target.value)}
                placeholder="напр. 0001"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <select
                onChange={e => setOrderIdInput(e.target.value)}
                value=""
                className="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium"
              >
                <option value="">Из CRM...</option>
                {crmOrders.map(c => (
                  <option key={c.oid} value={c.oid}>
                    № {c.oid} — {c.client}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="sm:col-span-2">
            {crmData ? (
              <div className="p-3 bg-blue-50/70 border border-blue-100 rounded-xl flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-blue-950">{crmData.client}</span>
                  <span className="text-blue-800 ml-2">({crmData.item || 'Без изделия'})</span>
                </div>
                <div className="font-mono font-bold text-blue-900">
                  {formatMoney(crmData.price)} сум
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-400">
                Укажите существующий номер заказа или выберите из CRM для автоподгрузки данных
              </div>
            )}
          </div>
        </div>

        {/* Process Selection Grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-slate-900 text-sm">
              Технологические процессы цеха ({selectedPath.length} выбрано):
            </h4>
            <span className="text-xs text-slate-500">Укажите плановый объем и мастера</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {PROCS.map(proc => {
              const isSelected = selectedPath.includes(proc);
              const isPaint = isPaintProc(proc);
              const unit = getPathProcUnit(proc);
              const config = procConfigs[proc] || { qty: 1, worker: '' };

              return (
                <div
                  key={proc}
                  className={`p-3.5 rounded-xl border transition-all ${
                    isSelected
                      ? 'bg-blue-50/70 border-blue-200 ring-2 ring-blue-500/10'
                      : 'bg-slate-50/60 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <label className="flex items-center justify-between cursor-pointer">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleProc(proc)}
                        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span className="font-bold text-xs text-slate-900">
                        {isPaint ? `🎨 ${proc}` : proc}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">({unit})</span>
                  </label>

                  {isSelected && (
                    <div className="mt-2.5 pt-2.5 border-t border-blue-100 flex items-center gap-2 text-xs">
                      <div className="w-24">
                        <span className="text-[10px] font-bold text-slate-500 block mb-0.5">Объём:</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min="0.1"
                            step="any"
                            value={config.qty}
                            onChange={e => handleConfigChange(proc, 'qty', e.target.value)}
                            className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-800"
                          />
                          <span className="text-[10px] text-slate-500">{unit}</span>
                        </div>
                      </div>

                      <div className="flex-1">
                        <span className="text-[10px] font-bold text-slate-500 block mb-0.5">Мастер:</span>
                        <select
                          value={config.worker}
                          onChange={e => handleConfigChange(proc, 'worker', e.target.value)}
                          className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs text-slate-800"
                        >
                          <option value="">(Любой)</option>
                          {workers.map(w => (
                            <option key={w.name} value={w.name}>{w.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Paint Special Block */}
        {hasPaintSelected && (
          <div className="p-5 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-4">
            <div className="flex items-center gap-2">
              <Palette className="w-5 h-5 text-amber-600" />
              <h4 className="font-bold text-amber-900 text-sm font-headline">Покрасочные изделия и слои заказа</h4>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <div>
                <label className="block text-[11px] font-bold uppercase text-amber-800 mb-1">Категория</label>
                <select
                  value={paintCategoryInput}
                  onChange={e => setPaintCategoryInput(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-amber-200 rounded-xl text-xs font-medium text-slate-900"
                >
                  <option value="">Выберите категорию...</option>
                  {paintCategories.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-amber-800 mb-1">Изделие</label>
                <select
                  value={paintItemNameInput}
                  onChange={e => setPaintItemNameInput(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-amber-200 rounded-xl text-xs font-medium text-slate-900"
                >
                  <option value="">Выберите изделие...</option>
                  {paintCatalog
                    .filter(c => !paintCategoryInput || c.category === paintCategoryInput)
                    .map(i => (
                      <option key={i.name} value={i.name}>
                        {i.name} ({i.area_m2} м²/шт)
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-amber-800 mb-1">Количество</label>
                <input
                  type="number"
                  min="1"
                  value={paintQtyInput}
                  onChange={e => setPaintQtyInput(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 bg-white border border-amber-200 rounded-xl text-xs font-bold font-mono text-slate-900"
                />
              </div>

              <button
                type="button"
                onClick={handleAddPaintItem}
                className="py-2.5 px-4 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all"
              >
                + Добавить
              </button>
            </div>

            {paintItems.length > 0 && (
              <div className="space-y-1.5 pt-2">
                {paintItems.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2.5 bg-white rounded-xl border border-amber-200 text-xs text-slate-800">
                    <div>
                      <span className="font-bold text-slate-900">{item.item_name}</span>
                      <span className="text-slate-500 ml-2">({item.category})</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-amber-700">{item.qty} шт</span>
                      <button
                        onClick={() => handleRemovePaintItem(idx)}
                        className="text-rose-500 hover:text-rose-700 p-1 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action Button */}
        <div className="pt-4 border-t border-slate-100 flex justify-end">
          <button
            onClick={handleLaunch}
            disabled={isSubmitting || !orderIdInput.trim() || selectedPath.length === 0}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs sm:text-sm shadow-md shadow-blue-600/20 flex items-center gap-2 transition-all cursor-pointer"
          >
            <Rocket className="w-4 h-4" />
            <span>{isSubmitting ? 'Запуск...' : 'Запустить заказ в цех и распечатать'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
