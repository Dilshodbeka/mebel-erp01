import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { PAINT_STAGES_DEF, PAINT_WORKER_TYPES } from '../constants';
import { isPaintProc } from '../utils/formatters';
import { Palette, CheckCircle2, ArrowLeft, Plus, Minus } from 'lucide-react';

export const WorkerInlinePaint: React.FC<{
  orderId: string;
  onFinishOrder: () => void;
  onBack: () => void;
}> = ({ orderId, onFinishOrder, onBack }) => {
  const {
    currentUser,
    paintCatalog,
    paintRecords,
    paintOrderItems,
    paintOrderLayers,
    orders,
    loadAllData,
    showToast,
    logActivity
  } = useApp();

  const [selectedStageKey, setSelectedStageKey] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedItemName, setSelectedItemName] = useState<string | null>(null);
  const [qty, setQty] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const order = orders.find(o => o.id === orderId);
  const itemsForOrder = paintOrderItems.filter(i => i.order_id === orderId);
  const layersConfig = paintOrderLayers[orderId] || { layers: 2, coats: 2 };

  // Worker available stage keys
  const workerAllowedStages: string[] = [];
  (currentUser?.procs || []).forEach(proc => {
    (PAINT_WORKER_TYPES[proc] || []).forEach(k => {
      if (!workerAllowedStages.includes(k)) workerAllowedStages.push(k);
    });
  });

  const isStageActive = (stageKey: string) => {
    if (stageKey === 'шлиф_2' || stageKey === 'грунт_2') return layersConfig.layers >= 2;
    if (stageKey === 'краска_2') return layersConfig.coats >= 2;
    return true;
  };

  const activeStages = PAINT_STAGES_DEF.filter(s => workerAllowedStages.includes(s.key) && isStageActive(s.key));
  const totalQtyPerStage = itemsForOrder.reduce((s, i) => s + i.qty, 0);

  const getStageDoneCount = (stKey: string) => {
    return paintRecords
      .filter(r => r.order_id === orderId && r.stage_key === stKey)
      .reduce((sum, r) => sum + (r.qty_done || 0), 0);
  };

  const getItemDoneCount = (stKey: string, itemName: string) => {
    return paintRecords
      .filter(r => r.order_id === orderId && r.stage_key === stKey && r.item_name === itemName)
      .reduce((sum, r) => sum + (r.qty_done || 0), 0);
  };

  const handleSubmit = async () => {
    if (!selectedStageKey || !selectedItemName || qty <= 0 || !currentUser) {
      showToast('Укажите этап, изделие и количество', 'error');
      return;
    }

    const item = itemsForOrder.find(i => i.item_name === selectedItemName);
    const category = item?.category || selectedCategory || '';

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('paint_records').insert({
        order_id: orderId,
        stage_key: selectedStageKey,
        category,
        item_name: selectedItemName,
        qty_done: qty,
        worker: currentUser.name,
        created_at: new Date().toISOString()
      });

      if (error) throw error;

      await logActivity(
        currentUser.name,
        'Покраска (этап завершен)',
        `Заказ #${orderId}, этап: ${selectedStageKey}, ${selectedItemName} × ${qty}`,
        'process'
      );

      showToast(`✅ Записано: ${selectedItemName} — ${qty} шт`);

      // Refresh data
      await loadAllData();

      // Check if all painting for this order is completed
      const allActiveStages = PAINT_STAGES_DEF.filter(s => isStageActive(s.key));
      const allDone = allActiveStages.every(st =>
        itemsForOrder.every(oi => {
          const done = paintRecords
            .filter(r => r.order_id === orderId && r.stage_key === st.key && r.item_name === oi.item_name)
            .reduce((sum, r) => sum + (r.qty_done || 0), 0) + (st.key === selectedStageKey && oi.item_name === selectedItemName ? qty : 0);
          return done >= oi.qty;
        })
      );

      if (allDone && order) {
        const now = new Date().toISOString();
        const updatedHistory = { ...(order.history || {}) };
        (order.path || []).filter(p => isPaintProc(p)).forEach(pName => {
          if (!updatedHistory[pName]?.end) {
            updatedHistory[pName] = {
              start: updatedHistory[pName]?.start || now,
              end: now,
              completed_by: currentUser.name,
              worker: updatedHistory[pName]?.worker || currentUser.name
            };
          }
        });

        await supabase.from('orders').upsert({ id: orderId, path: order.path || [], history: updatedHistory });
        showToast(`🎉 Покраска заказа #${orderId} полностью завершена!`);
        onFinishOrder();
      } else {
        setSelectedItemName(null);
        setQty(1);
      }
    } catch (e: any) {
      showToast('Ошибка сохранения: ' + e.message, 'error');
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
        <span className="text-xs font-bold text-amber-300 bg-amber-500/20 border border-amber-500/30 px-2.5 py-1 rounded-md flex items-center gap-1">
          <Palette className="w-3.5 h-3.5" />
          <span>Режим покраски</span>
        </span>
      </div>

      {/* Stage selector */}
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Этапы покраски</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {activeStages.map(stage => {
            const done = getStageDoneCount(stage.key);
            const isDone = totalQtyPerStage > 0 && done >= totalQtyPerStage;
            const isSelected = selectedStageKey === stage.key;
            return (
              <button
                key={stage.key}
                onClick={() => {
                  setSelectedStageKey(stage.key);
                  setSelectedItemName(null);
                }}
                className={`p-3 rounded-xl border text-left transition-all ${
                  isSelected
                    ? 'border-blue-500 bg-blue-600/20 shadow-md ring-1 ring-blue-500/30'
                    : isDone
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                <div className="font-bold text-xs text-white">{stage.label}</div>
                <div className="flex items-center justify-between text-[11px] mt-1.5 text-slate-400 font-medium">
                  <span>{done} / {totalQtyPerStage} шт</span>
                  {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Items in order */}
      {selectedStageKey && (
        <div className="space-y-3 bg-white/5 p-4 rounded-2xl border border-white/10">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Выберите изделие для этапа: <b className="text-blue-400">{PAINT_STAGES_DEF.find(s => s.key === selectedStageKey)?.label}</b>
          </div>

          <div className="space-y-2">
            {itemsForOrder.map(item => {
              const done = getItemDoneCount(selectedStageKey, item.item_name);
              const remaining = Math.max(0, item.qty - done);
              const isDone = remaining === 0;
              const isSelected = selectedItemName === item.item_name;
              const cat = paintCatalog.find(c => c.name === item.item_name);

              return (
                <div
                  key={item.item_name}
                  onClick={() => {
                    if (isDone) return;
                    setSelectedItemName(item.item_name);
                    setSelectedCategory(item.category);
                    setQty(remaining);
                  }}
                  className={`p-3.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-900/40'
                      : isDone
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300 cursor-default opacity-75'
                      : 'bg-white/5 border-white/10 hover:border-white/20'
                  }`}
                >
                  <div>
                    <div className="font-bold text-sm leading-snug">{item.item_name}</div>
                    <div className={`text-xs ${isSelected ? 'text-blue-100' : 'text-slate-400'}`}>
                      {item.category} {cat ? `· ${cat.area_m2} м²/шт` : ''}
                    </div>
                  </div>

                  <div className="text-right font-mono">
                    <div className="text-base font-black">
                      {isDone ? '✔ Готово' : `${remaining} шт`}
                    </div>
                    <div className={`text-[10px] ${isSelected ? 'text-blue-200' : 'text-slate-500'}`}>
                      из {item.qty} шт
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quantity selector */}
          {selectedItemName && (
            <div className="pt-4 border-t border-white/10 space-y-4">
              <div className="text-center">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Сколько штук выполнено сейчас:
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
                    onClick={() => {
                      const item = itemsForOrder.find(i => i.item_name === selectedItemName);
                      const done = getItemDoneCount(selectedStageKey, selectedItemName);
                      const maxPossible = Math.max(1, (item?.qty || 1) - done);
                      setQty(Math.min(maxPossible, qty + 1));
                    }}
                    className="w-12 h-12 rounded-full bg-white/5 border border-white/20 text-slate-200 text-xl font-bold flex items-center justify-center hover:bg-white/10 shadow-xs transition-colors"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl text-base shadow-lg shadow-emerald-950/40 transition-colors cursor-pointer"
              >
                {isSubmitting ? 'Запись...' : '✔ Подтвердить выполнение'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
