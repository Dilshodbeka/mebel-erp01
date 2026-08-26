import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { Layers, Plus, Minus, CheckCircle2, TrendingUp, Package, Search } from 'lucide-react';

/**
 * Терминал ШЛИПОВКИ для работника.
 *
 * Отличие от покраски: детали НЕ привязаны к конкретному заказу — работник всегда
 * видит полный каталог деталей, выбирает что именно отшлифовал и сколько штук.
 * Результат:
 *   1) записывается в журнал выработки (sanding_records) — видно кто/что/сколько/когда;
 *   2) приходуется на склад шлиповки (sanding_items.qty_in_stock);
 *   3) сразу отображается его личный объём за сегодня (шт и м²).
 */
export const WorkerSandingTerminal: React.FC = () => {
  const {
    currentUser,
    sandingItems,
    sandingRecords,
    orders,
    loadAllData,
    showToast,
    logActivity
  } = useApp();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [qty, setQty] = useState<number>(1);
  const [orderId, setOrderId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selected = sandingItems.find(i => i.id === selectedId) || null;

  const categories = useMemo(
    () => Array.from(new Set(sandingItems.map(i => i.category || 'Без категории'))),
    [sandingItems]
  );

  const visibleItems = useMemo(() => {
    return sandingItems.filter(i => {
      if (category && (i.category || 'Без категории') !== category) return false;
      if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [sandingItems, category, search]);

  // Мой объём за сегодня
  const todayStats = useMemo(() => {
    const today = new Date().toDateString();
    const mine = sandingRecords.filter(
      r => r.worker === currentUser?.name && new Date(r.created_at).toDateString() === today
    );
    return {
      qty: mine.reduce((s, r) => s + (r.qty_done || 0), 0),
      area: mine.reduce((s, r) => s + (r.area_m2 || 0), 0),
      count: mine.length,
      records: mine
    };
  }, [sandingRecords, currentUser]);

  const handleSubmit = async () => {
    if (!selected || qty <= 0 || !currentUser) {
      showToast('Выберите деталь и укажите количество', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const areaTotal = (selected.area_m2 || 0) * qty;

      // 1) Журнал выработки
      const { error: recErr } = await supabase.from('sanding_records').insert({
        item_id: selected.id,
        item_name: selected.name,
        category: selected.category || '',
        qty_done: qty,
        area_m2: areaTotal,
        worker: currentUser.name,
        order_id: orderId.trim() || null,
        created_at: new Date().toISOString()
      });
      if (recErr) throw recErr;

      // 2) Приход на склад шлиповки
      const { error: stockErr } = await supabase.from('sanding_items')
        .update({ qty_in_stock: (selected.qty_in_stock || 0) + qty })
        .eq('id', selected.id);
      if (stockErr) throw stockErr;

      // 3) Движение склада (для истории)
      await supabase.from('sanding_movements').insert({
        item_id: selected.id,
        item_name: selected.name,
        type: 'in',
        qty,
        reason: 'Отшлифовано',
        order_id: orderId.trim() || null,
        user_name: currentUser.name,
        created_at: new Date().toISOString()
      });

      await logActivity(
        currentUser.name,
        'Шлиповка',
        `${selected.name} × ${qty} шт (${areaTotal.toFixed(2)} м²)${orderId ? `, заказ #${orderId}` : ''}`,
        'process'
      );

      showToast(`✅ Записано: ${selected.name} — ${qty} шт (${areaTotal.toFixed(2)} м²)`);
      setSelectedId(null);
      setQty(1);
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка сохранения: ' + e.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Мой объём за сегодня */}
      <div className="bg-gradient-to-r from-cyan-600 to-sky-600 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2.5">
            <Layers className="w-5 h-5" />
            <div>
              <div className="font-black text-lg leading-tight">Шлиповка</div>
              <div className="text-xs text-cyan-50/90 font-medium">Мой объём за сегодня</div>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="bg-white/15 rounded-xl px-4 py-2.5 text-center min-w-[80px]">
              <div className="font-mono text-2xl font-black">{todayStats.qty}</div>
              <div className="text-[10px] uppercase tracking-wider opacity-90">штук</div>
            </div>
            <div className="bg-white/15 rounded-xl px-4 py-2.5 text-center min-w-[80px]">
              <div className="font-mono text-2xl font-black">{todayStats.area.toFixed(1)}</div>
              <div className="text-[10px] uppercase tracking-wider opacity-90">м²</div>
            </div>
            <div className="bg-white/15 rounded-xl px-4 py-2.5 text-center min-w-[80px]">
              <div className="font-mono text-2xl font-black">{todayStats.count}</div>
              <div className="text-[10px] uppercase tracking-wider opacity-90">записей</div>
            </div>
          </div>
        </div>
      </div>

      {sandingItems.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
          <Package className="w-10 h-10 text-slate-500 mx-auto mb-3" />
          <div className="text-slate-300 font-bold text-sm">Каталог деталей пуст</div>
          <div className="text-slate-500 text-xs mt-1">Администратор должен добавить детали в разделе «Шлиповка»</div>
        </div>
      ) : (
        <>
          {/* Поиск и категории */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск детали..."
                className="w-full pl-9 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setCategory('')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  !category ? 'bg-cyan-600 text-white' : 'bg-white/5 text-slate-300 border border-white/10'
                }`}
              >
                Все
              </button>
              {categories.map(c => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    category === c ? 'bg-cyan-600 text-white' : 'bg-white/5 text-slate-300 border border-white/10'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Список деталей */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Выберите деталь, которую отшлифовали
            </div>
            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
              {visibleItems.map(item => {
                const isSelected = selectedId === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      setSelectedId(item.id);
                      setQty(1);
                    }}
                    className={`p-3.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-cyan-600 text-white border-cyan-500 shadow-lg shadow-cyan-900/40'
                        : 'bg-white/5 border-white/10 hover:border-white/20 text-slate-200'
                    }`}
                  >
                    <div>
                      <div className="font-bold text-sm leading-snug">{item.name}</div>
                      <div className={`text-xs ${isSelected ? 'text-cyan-100' : 'text-slate-400'}`}>
                        {item.category || 'Без категории'} · {item.area_m2} м²/шт
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-base font-black">{item.qty_in_stock}</div>
                      <div className={`text-[10px] ${isSelected ? 'text-cyan-200' : 'text-slate-500'}`}>
                        на складе
                      </div>
                    </div>
                  </div>
                );
              })}
              {visibleItems.length === 0 && (
                <div className="text-center py-6 text-slate-500 text-sm">Ничего не найдено</div>
              )}
            </div>
          </div>

          {/* Ввод количества */}
          {selected && (
            <div className="bg-white/5 p-4 rounded-2xl border border-white/10 space-y-4">
              <div className="text-center">
                <div className="font-bold text-white text-sm">{selected.name}</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {selected.area_m2} м² за штуку → итого{' '}
                  <b className="text-cyan-400">{((selected.area_m2 || 0) * qty).toFixed(2)} м²</b>
                </div>
              </div>

              <div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 text-center">
                  Сколько штук отшлифовано
                </div>
                <div className="flex items-center justify-center gap-4">
                  <button
                    onClick={() => setQty(Math.max(1, qty - 1))}
                    className="w-12 h-12 rounded-full bg-white/5 border border-white/20 text-slate-200 flex items-center justify-center hover:bg-white/10 transition-colors"
                  >
                    <Minus className="w-5 h-5" />
                  </button>
                  <div className="font-mono text-4xl font-black text-white w-24 text-center">{qty}</div>
                  <button
                    onClick={() => setQty(qty + 1)}
                    className="w-12 h-12 rounded-full bg-white/5 border border-white/20 text-slate-200 flex items-center justify-center hover:bg-white/10 transition-colors"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  № заказа (необязательно)
                </label>
                <input
                  type="text"
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  list="sanding-order-list"
                  placeholder="Например: 1001"
                  className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
                <datalist id="sanding-order-list">
                  {orders.map(o => <option key={o.id} value={o.id} />)}
                </datalist>
              </div>

              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl text-base shadow-lg shadow-emerald-950/40 transition-colors"
              >
                {isSubmitting ? 'Запись...' : '✔ Записать и отправить на склад'}
              </button>
            </div>
          )}

          {/* Что я сделал сегодня */}
          {todayStats.records.length > 0 && (
            <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Что я сделал сегодня</span>
              </div>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {todayStats.records.map((r, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2.5 bg-white/5 rounded-lg">
                    <div>
                      <div className="text-sm font-bold text-slate-200">{r.item_name}</div>
                      <div className="text-[11px] text-slate-500">
                        {new Date(r.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        {r.order_id ? ` · заказ #${r.order_id}` : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-black text-sm text-white">{r.qty_done} шт</div>
                      <div className="text-[10px] font-bold text-cyan-400">{(r.area_m2 || 0).toFixed(2)} м²</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10">
                <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Итого за день
                </span>
                <span className="font-mono font-black text-white">
                  {todayStats.qty} шт · <span className="text-cyan-400">{todayStats.area.toFixed(2)} м²</span>
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
