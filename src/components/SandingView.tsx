import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { formatMoney } from '../utils/formatters';
import {
  Layers,
  Plus,
  Trash2,
  Package,
  ClipboardList,
  Users,
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Pencil,
  X
} from 'lucide-react';

type SandingTab = 'stock' | 'journal' | 'workers';
type Period = 'day' | 'week' | 'month' | 'all';

export const SandingView: React.FC = () => {
  const {
    sandingItems,
    sandingRecords,
    sandingMovements,
    currentUser,
    loadAllData,
    showToast,
    logActivity
  } = useApp();

  const [tab, setTab] = useState<SandingTab>('stock');
  const [period, setPeriod] = useState<Period>('week');
  const [search, setSearch] = useState('');

  // Форма добавления детали
  const [categoryInput, setCategoryInput] = useState('Фасады');
  const [nameInput, setNameInput] = useState('');
  const [areaInput, setAreaInput] = useState('0.25');
  const [minInput, setMinInput] = useState('0');

  // Редактирование
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editArea, setEditArea] = useState('0');
  const [editMin, setEditMin] = useState('0');

  const inPeriod = (dateStr?: string) => {
    if (!dateStr) return false;
    if (period === 'all') return true;
    const d = new Date(dateStr);
    const now = new Date();
    if (period === 'day') return d.toDateString() === now.toDateString();
    if (period === 'week') {
      const weekAgo = new Date(now);
      weekAgo.setDate(now.getDate() - 7);
      return d >= weekAgo && d <= now;
    }
    if (period === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    return true;
  };

  const periodRecords = useMemo(
    () => sandingRecords.filter(r => inPeriod(r.created_at)),
    [sandingRecords, period]
  );

  const totals = useMemo(() => {
    const qty = periodRecords.reduce((s, r) => s + (r.qty_done || 0), 0);
    const area = periodRecords.reduce((s, r) => s + (r.area_m2 || 0), 0);
    const workers = new Set(periodRecords.map(r => r.worker).filter(Boolean));
    const stockQty = sandingItems.reduce((s, i) => s + (i.qty_in_stock || 0), 0);
    return { qty, area, workers: workers.size, stockQty };
  }, [periodRecords, sandingItems]);

  const lowStock = sandingItems.filter(i => i.min_qty > 0 && i.qty_in_stock <= i.min_qty);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = nameInput.trim();
    if (!name) {
      showToast('Введите название детали', 'error');
      return;
    }
    try {
      const { error } = await supabase.from('sanding_items').insert({
        category: categoryInput.trim() || 'Прочее',
        name,
        unit: 'шт',
        area_m2: parseFloat(areaInput) || 0,
        qty_in_stock: 0,
        min_qty: parseFloat(minInput) || 0
      });
      if (error) throw error;
      showToast(`Деталь «${name}» добавлена в каталог шлиповки`);
      setNameInput('');
      await loadAllData();
    } catch (err: any) {
      showToast('Ошибка: ' + err.message, 'error');
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Удалить деталь «${name}» из каталога шлиповки?`)) return;
    try {
      await supabase.from('sanding_items').delete().eq('id', id);
      showToast(`«${name}» удалено`);
      await loadAllData();
    } catch (err: any) {
      showToast('Ошибка: ' + err.message, 'error');
    }
  };

  const openEdit = (item: typeof sandingItems[number]) => {
    setEditId(item.id);
    setEditName(item.name);
    setEditCategory(item.category || '');
    setEditArea(String(item.area_m2 || 0));
    setEditMin(String(item.min_qty || 0));
  };

  const saveEdit = async () => {
    if (editId === null) return;
    if (!editName.trim()) {
      showToast('Введите название', 'error');
      return;
    }
    try {
      const { error } = await supabase.from('sanding_items').update({
        name: editName.trim(),
        category: editCategory.trim(),
        area_m2: parseFloat(editArea) || 0,
        min_qty: parseFloat(editMin) || 0
      }).eq('id', editId);
      if (error) throw error;
      setEditId(null);
      showToast('Изменения сохранены');
      await loadAllData();
    } catch (err: any) {
      showToast('Ошибка: ' + err.message, 'error');
    }
  };

  // Ручная корректировка остатка (списание со склада шлиповки, например в покраску)
  const adjustStock = async (item: typeof sandingItems[number], type: 'in' | 'out') => {
    const raw = prompt(
      `${type === 'in' ? 'Приход' : 'Списание'} — «${item.name}»\nСейчас на складе: ${item.qty_in_stock} ${item.unit}\nКоличество:`
    );
    const qty = parseFloat(raw || '');
    if (!qty || qty <= 0) return;
    const reason = prompt('Причина / комментарий:') || (type === 'in' ? 'Ручной приход' : 'Списание');
    try {
      const delta = type === 'in' ? qty : -qty;
      await supabase.from('sanding_items')
        .update({ qty_in_stock: (item.qty_in_stock || 0) + delta })
        .eq('id', item.id);
      await supabase.from('sanding_movements').insert({
        item_id: item.id,
        item_name: item.name,
        type,
        qty,
        reason,
        user_name: currentUser?.name || 'Система',
        created_at: new Date().toISOString()
      });
      showToast(`${type === 'in' ? '+' : '−'}${qty} ${item.unit} — ${item.name}`);
      await loadAllData();
    } catch (err: any) {
      showToast('Ошибка: ' + err.message, 'error');
    }
  };

  const filteredItems = sandingItems.filter(i =>
    !search ||
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.category || '').toLowerCase().includes(search.toLowerCase())
  );

  // Статистика по работникам за период
  const byWorker = useMemo(() => {
    const map: Record<string, { qty: number; area: number; count: number }> = {};
    periodRecords.forEach(r => {
      const w = r.worker || 'Неизвестно';
      if (!map[w]) map[w] = { qty: 0, area: 0, count: 0 };
      map[w].qty += r.qty_done || 0;
      map[w].area += r.area_m2 || 0;
      map[w].count += 1;
    });
    return Object.entries(map).sort((a, b) => b[1].area - a[1].area);
  }, [periodRecords]);

  // Журнал по дням
  const journalByDay = useMemo(() => {
    const map: Record<string, typeof periodRecords> = {};
    periodRecords.forEach(r => {
      const d = (r.created_at || '').slice(0, 10);
      if (!map[d]) map[d] = [] as any;
      (map[d] as any).push(r);
    });
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [periodRecords]);

  const periodLabels: Record<Period, string> = {
    day: 'Сегодня',
    week: 'Неделя',
    month: 'Месяц',
    all: 'Всё время'
  };

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div className="bg-gradient-to-r from-cyan-600 to-sky-600 rounded-3xl p-6 sm:p-8 text-white shadow-xl">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <Layers className="w-6 h-6" />
              <h2 className="font-headline text-2xl font-black">Шлиповка</h2>
            </div>
            <p className="text-sm text-cyan-50/90 mt-1.5 font-medium">
              Каталог деталей, склад отшлифованного и выработка работников
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white/15 rounded-2xl px-4 py-3 text-center min-w-[92px]">
              <div className="font-mono text-2xl font-black">{totals.qty}</div>
              <div className="text-[10px] uppercase tracking-wider opacity-90 mt-0.5">шт за период</div>
            </div>
            <div className="bg-white/15 rounded-2xl px-4 py-3 text-center min-w-[92px]">
              <div className="font-mono text-2xl font-black">{totals.area.toFixed(1)}</div>
              <div className="text-[10px] uppercase tracking-wider opacity-90 mt-0.5">м² за период</div>
            </div>
            <div className="bg-white/15 rounded-2xl px-4 py-3 text-center min-w-[92px]">
              <div className="font-mono text-2xl font-black">{totals.stockQty}</div>
              <div className="text-[10px] uppercase tracking-wider opacity-90 mt-0.5">на складе</div>
            </div>
            <div className="bg-white/15 rounded-2xl px-4 py-3 text-center min-w-[92px]">
              <div className="font-mono text-2xl font-black">{totals.workers}</div>
              <div className="text-[10px] uppercase tracking-wider opacity-90 mt-0.5">работников</div>
            </div>
          </div>
        </div>
      </div>

      {/* Алерт низкого остатка */}
      {lowStock.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <b>Мало на складе шлиповки:</b>{' '}
            {lowStock.map(i => `${i.name} (${i.qty_in_stock} из мин. ${i.min_qty})`).join(' · ')}
          </div>
        </div>
      )}

      {/* Табы */}
      <div className="flex flex-wrap gap-2">
        {([
          ['stock', 'Каталог и склад', <Package className="w-4 h-4" key="i" />],
          ['journal', 'Журнал выработки', <ClipboardList className="w-4 h-4" key="i" />],
          ['workers', 'По работникам', <Users className="w-4 h-4" key="i" />]
        ] as const).map(([key, label, icon]) => (
          <button
            key={key}
            onClick={() => setTab(key as SandingTab)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
              tab === key
                ? 'bg-cyan-600 text-white shadow-md shadow-cyan-500/25'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}

        {tab !== 'stock' && (
          <div className="flex gap-1.5 ml-auto bg-white border border-slate-200 rounded-xl p-1">
            {(Object.keys(periodLabels) as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  period === p ? 'bg-cyan-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {periodLabels[p]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── КАТАЛОГ И СКЛАД ── */}
      {tab === 'stock' && (
        <div className="space-y-6">
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl shadow-black/5">
            <h3 className="font-bold text-slate-900 text-lg font-headline flex items-center gap-2 mb-1">
              <Plus className="w-5 h-5 text-cyan-600" />
              <span>Добавить деталь в каталог шлиповки</span>
            </h3>
            <p className="text-xs text-slate-500 mb-6 font-medium">
              Эти детали работник видит в своём терминале и выбирает, что отшлифовал
            </p>

            <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Категория</label>
                <input
                  type="text"
                  value={categoryInput}
                  onChange={(e) => setCategoryInput(e.target.value)}
                  placeholder="Фасады / Корпус"
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Название детали</label>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Например: Фасад 716×396"
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">м² за 1 шт</label>
                <input
                  type="number"
                  step="0.01"
                  value={areaInput}
                  onChange={(e) => setAreaInput(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Мин.</label>
                  <input
                    type="number"
                    step="1"
                    value={minInput}
                    onChange={(e) => setMinInput(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <button
                  type="submit"
                  className="h-[42px] px-4 bg-cyan-600 hover:bg-cyan-700 text-white font-bold rounded-xl text-xs shadow-md transition-colors self-end"
                >
                  Добавить
                </button>
              </div>
            </form>
          </div>

          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl shadow-black/5">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
              <h3 className="font-bold text-slate-900 text-lg font-headline flex items-center gap-2">
                <Package className="w-5 h-5 text-cyan-600" />
                <span>Склад отшлифованных деталей</span>
              </h3>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск детали..."
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-cyan-500 w-56"
              />
            </div>

            {filteredItems.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm font-medium">
                Каталог пуст — добавьте детали выше
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredItems.map(item => {
                  const isLow = item.min_qty > 0 && item.qty_in_stock <= item.min_qty;
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-4 p-4 rounded-2xl border transition-all flex-wrap ${
                        isLow ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50/60 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex-1 min-w-[180px]">
                        <div className="font-bold text-sm text-slate-900">
                          {isLow && <AlertTriangle className="w-3.5 h-3.5 text-rose-500 inline mr-1.5 -mt-0.5" />}
                          {item.name}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-200 text-slate-600 rounded-md">
                            {item.category || 'Без категории'}
                          </span>
                          <span className="text-[10px] font-bold px-2 py-0.5 bg-cyan-100 text-cyan-700 rounded-md">
                            {item.area_m2} м²/шт
                          </span>
                          {item.min_qty > 0 && (
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-100 text-amber-700 rounded-md">
                              мин. {item.min_qty} {item.unit}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-center min-w-[76px]">
                        <div className={`font-mono text-2xl font-black ${isLow ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {item.qty_in_stock}
                        </div>
                        <div className="text-[11px] font-bold text-slate-500">{item.unit}</div>
                        <div className="text-[10px] text-slate-400">на складе</div>
                      </div>

                      <div className="flex gap-1.5">
                        <button
                          onClick={() => adjustStock(item, 'in')}
                          className="p-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg transition-colors"
                          title="Приход"
                        >
                          <ArrowDownCircle className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => adjustStock(item, 'out')}
                          className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg transition-colors"
                          title="Списание"
                        >
                          <ArrowUpCircle className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEdit(item)}
                          className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 rounded-lg transition-colors"
                          title="Изменить"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(item.id, item.name)}
                          className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-lg transition-colors"
                          title="Удалить"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ЖУРНАЛ ВЫРАБОТКИ ── */}
      {tab === 'journal' && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl shadow-black/5">
          <h3 className="font-bold text-slate-900 text-lg font-headline flex items-center gap-2 mb-5">
            <ClipboardList className="w-5 h-5 text-cyan-600" />
            <span>Журнал выработки · {periodLabels[period]}</span>
          </h3>

          {journalByDay.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm font-medium">
              Нет записей за выбранный период
            </div>
          ) : (
            <div className="space-y-6">
              {journalByDay.map(([date, recs]) => {
                const dayQty = (recs as any[]).reduce((s, r) => s + (r.qty_done || 0), 0);
                const dayArea = (recs as any[]).reduce((s, r) => s + (r.area_m2 || 0), 0);
                return (
                  <div key={date}>
                    <div className="flex items-center justify-between pb-2 mb-3 border-b-2 border-slate-100">
                      <b className="text-sm text-cyan-700">
                        {new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', {
                          day: '2-digit', month: 'long', weekday: 'short'
                        })}
                      </b>
                      <span className="text-xs font-bold text-slate-600">
                        {dayQty} шт · <span className="text-cyan-600">{dayArea.toFixed(2)} м²</span>
                      </span>
                    </div>
                    <div className="space-y-2">
                      {(recs as any[]).map((r, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl flex-wrap">
                          <div className="flex-1 min-w-[160px]">
                            <div className="font-bold text-sm text-slate-800">{r.item_name}</div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {new Date(r.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                              {' · 👤 '}{r.worker || '—'}
                              {r.order_id ? ` · заказ #${r.order_id}` : ''}
                              {r.category ? ` · ${r.category}` : ''}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono font-black text-base text-slate-900">{r.qty_done} шт</div>
                            <div className="text-[11px] font-bold text-cyan-600">{(r.area_m2 || 0).toFixed(2)} м²</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── ПО РАБОТНИКАМ ── */}
      {tab === 'workers' && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl shadow-black/5">
          <h3 className="font-bold text-slate-900 text-lg font-headline flex items-center gap-2 mb-5">
            <Users className="w-5 h-5 text-cyan-600" />
            <span>Выработка по работникам · {periodLabels[period]}</span>
          </h3>

          {byWorker.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm font-medium">
              Нет данных за выбранный период
            </div>
          ) : (
            <div className="space-y-3">
              {byWorker.map(([name, st]) => (
                <div key={name} className="flex items-center justify-between gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-200 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-cyan-600 text-white flex items-center justify-center font-black">
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-bold text-sm text-slate-900">{name}</div>
                      <div className="text-[11px] text-slate-500">{st.count} записей</div>
                    </div>
                  </div>
                  <div className="flex gap-6">
                    <div className="text-right">
                      <div className="font-mono text-xl font-black text-slate-900">{st.qty}</div>
                      <div className="text-[10px] uppercase font-bold text-slate-500">штук</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-xl font-black text-cyan-600">{st.area.toFixed(1)}</div>
                      <div className="text-[10px] uppercase font-bold text-slate-500">м²</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Модалка редактирования */}
      {editId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-cyan-600 to-sky-600 px-6 py-4 text-white flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase font-bold tracking-wider opacity-90">Изменить деталь</div>
                <div className="font-black text-lg">{editName}</div>
              </div>
              <button onClick={() => setEditId(null)} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Название</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Категория</label>
                  <input
                    type="text"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">м²/шт</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editArea}
                    onChange={(e) => setEditArea(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Мин.</label>
                  <input
                    type="number"
                    value={editMin}
                    onChange={(e) => setEditMin(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setEditId(null)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-sm transition-colors"
                >
                  Отмена
                </button>
                <button
                  onClick={saveEdit}
                  className="flex-1 py-3 bg-cyan-600 hover:bg-cyan-700 text-white font-bold rounded-xl text-sm transition-colors"
                >
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
