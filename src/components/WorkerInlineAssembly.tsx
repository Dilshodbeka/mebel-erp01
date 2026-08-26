import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { formatMoney } from '../utils/formatters';
import { Hammer, ArrowLeft, Plus, Minus, AlertTriangle, CheckCircle2 } from 'lucide-react';

export const WorkerInlineAssembly: React.FC<{
  orderId: string;
  processName: string;
  onFinishOrder: () => void;
  onBack: () => void;
}> = ({ orderId, processName, onFinishOrder, onBack }) => {
  const {
    currentUser,
    finishedItems,
    finishedRecipe,
    blankItems,
    laborCatalog,
    orders,
    loadAllData,
    showToast,
    logActivity
  } = useApp();

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [qty, setQty] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const order = orders.find(o => o.id === orderId);

  // Filter finished items that have at least 1 component in recipe
  const safeFinishedRecipe = Array.isArray(finishedRecipe) ? finishedRecipe : [];
  const safeFinishedItems = Array.isArray(finishedItems) ? finishedItems : [];
  const safeBlankItems = Array.isArray(blankItems) ? blankItems : [];

  const assemblableItems = safeFinishedItems.filter(i =>
    safeFinishedRecipe.some(r => r.finished_item_id === i.id)
  );

  const categories = Array.from(new Set(assemblableItems.map(i => i.category || 'Без категории')));

  const selectedItem = safeFinishedItems.find(i => i.id === selectedItemId);
  const currentRecipe = safeFinishedRecipe.filter(r => r.finished_item_id === selectedItemId);

  // Shortage check
  const shortages: string[] = [];
  currentRecipe.forEach(r => {
    const blank = safeBlankItems.find(b => b.id === r.blank_item_id);
    const needed = r.qty_per_unit * qty;
    if (!blank || blank.qty_in_stock < needed) {
      shortages.push(`${r.blank_item_name}: требуется ${needed}, на складе ${blank?.qty_in_stock || 0}`);
    }
  });

  const handleAssemble = async () => {
    if (!selectedItem || !currentUser || !order) return;
    if (!currentRecipe.length) {
      showToast('У выбранного изделия нет настроенного рецепта', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();

      // 1. Deduct blanks
      for (const r of currentRecipe) {
        const blank = blankItems.find(b => b.id === r.blank_item_id);
        const neededQty = r.qty_per_unit * qty;

        await supabase.from('blank_movements').insert({
          item_id: r.blank_item_id,
          item_name: r.blank_item_name,
          type: 'out',
          qty: neededQty,
          reason: `Сборка: ${selectedItem.name} × ${qty} (заказ #${orderId})`,
          user_name: currentUser.name,
          created_at: now
        });

        if (blank) {
          const newQty = (blank.qty_in_stock || 0) - neededQty;
          await supabase.from('blank_items').update({ qty_in_stock: newQty }).eq('id', blank.id);
        }
      }

      // 2. Add finished item to warehouse
      await supabase.from('finished_movements').insert({
        item_id: selectedItem.id,
        item_name: selectedItem.name,
        type: 'in',
        qty,
        reason: `Собрано по заказу #${orderId}`,
        user_name: currentUser.name,
        created_at: now
      });

      const newFinishedQty = (selectedItem.qty_in_stock || 0) + qty;
      await supabase.from('finished_items').update({ qty_in_stock: newFinishedQty }).eq('id', selectedItem.id);

      // 3. Complete assembly step on order
      const updatedHistory = { ...(order.history || {}) };
      updatedHistory[processName] = {
        start: updatedHistory[processName]?.start || now,
        end: now,
        completed_by: currentUser.name,
        worker: currentUser.name,
        qty_done: qty,
        unit: 'шт',
        assembled_item: selectedItem.name
      };

      await supabase.from('orders').upsert({ id: orderId, path: order?.path || [], history: updatedHistory });

      // 4. If labor catalog rate exists for assembly, credit labor earnings
      const laborRate = laborCatalog.find(
        lc => lc.name.toLowerCase().includes('сборк') || lc.category.toLowerCase().includes('сборк')
      );
      if (laborRate) {
        await supabase.from('order_labor').insert({
          order_id: orderId,
          description: `Сборка: ${selectedItem.name}`,
          qty,
          unit_price: laborRate.price_ours || 0,
          worker: currentUser.name,
          created_at: now
        });
      }

      await logActivity(
        currentUser.name,
        'Собрал изделие',
        `Заказ #${orderId}, ${selectedItem.name} × ${qty}`,
        'process'
      );

      showToast(`✔ Собрано: ${selectedItem.name} — ${qty} шт`);
      await loadAllData();
      onFinishOrder();
    } catch (e: any) {
      showToast('Ошибка при сборке: ' + e.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 text-slate-200">
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-white bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>К задачам</span>
        </button>
        <span className="text-xs font-bold text-blue-300 bg-blue-500/20 border border-blue-500/30 px-2.5 py-1 rounded-md flex items-center gap-1">
          <Hammer className="w-3.5 h-3.5" />
          <span>Режим сборки</span>
        </span>
      </div>

      {/* Category selector */}
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Категория изделия</div>
        <div className="flex flex-wrap gap-2">
          {categories.map(cat => {
            const isSel = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => {
                  setSelectedCategory(cat);
                  setSelectedItemId(null);
                }}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                  isSel
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
                    : 'bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Finished Items list */}
      {selectedCategory && (
        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Выберите изделие для сборки:</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {assemblableItems
              .filter(i => (i.category || 'Без категории') === selectedCategory)
              .map(item => {
                const recipeCount = safeFinishedRecipe.filter(r => r.finished_item_id === item.id).length;
                const isSel = selectedItemId === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedItemId(item.id)}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      isSel
                        ? 'bg-blue-600/20 border-blue-500/50 ring-1 ring-blue-500/30'
                        : 'bg-white/5 border-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="font-bold text-sm text-white">{item.name}</div>
                    <div className="text-xs text-slate-400 mt-1">
                      Рецепт: {recipeCount} заготовок · На складе: {item.qty_in_stock || 0} {item.unit}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Selected Item Recipe & Counter */}
      {selectedItem && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div>
              <div className="text-xs uppercase text-slate-400 font-bold tracking-wider">Сборка изделия</div>
              <div className="text-lg font-black text-white font-headline">{selectedItem.name}</div>
            </div>
            <div className="text-xs text-slate-400 font-medium">
              Ед: <b className="text-slate-200">{selectedItem.unit}</b>
            </div>
          </div>

          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Состав рецепта (на 1 шт):</div>
            <div className="space-y-1 text-xs">
              {currentRecipe.map(r => (
                <div key={r.id} className="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-white/10">
                  <span className="font-medium text-slate-200">{r.blank_item_name}</span>
                  <span className="font-bold text-blue-400 font-mono">× {r.qty_per_unit}</span>
                </div>
              ))}
            </div>
          </div>

          {shortages.length > 0 && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>Предупреждение о нехватке заготовок на складе:</span>
              </div>
              {shortages.map((s, idx) => (
                <div key={idx} className="pl-5 text-[11px] text-rose-300">• {s}</div>
              ))}
            </div>
          )}

          {/* Qty counter */}
          <div className="text-center pt-2">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              Сколько единиц собрать:
            </div>
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => setQty(Math.max(1, qty - 1))}
                className="w-12 h-12 rounded-full bg-white/5 border border-white/20 text-slate-200 text-xl font-bold flex items-center justify-center hover:bg-white/10 shadow-xs transition-colors"
              >
                <Minus className="w-5 h-5" />
              </button>
              <div className="font-mono text-4xl font-black text-white w-24 text-center">{qty}</div>
              <button
                onClick={() => setQty(qty + 1)}
                className="w-12 h-12 rounded-full bg-white/5 border border-white/20 text-slate-200 text-xl font-bold flex items-center justify-center hover:bg-white/10 shadow-xs transition-colors"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>

          <button
            onClick={handleAssemble}
            disabled={isSubmitting}
            className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl text-base shadow-lg shadow-blue-900/40 transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <Hammer className="w-5 h-5" />
            <span>{isSubmitting ? 'Сборка...' : `Собрать (${qty} шт) и завершить этап`}</span>
          </button>
        </div>
      )}
    </div>
  );
};
