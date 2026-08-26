import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { formatMoney } from '../utils/formatters';
import {
  Boxes,
  Plus,
  ArrowDownRight,
  ArrowUpRight,
  Search,
  AlertTriangle,
  History,
  Trash2,
  Edit2,
  Package,
  Layers,
  Minus
} from 'lucide-react';

export const WarehouseView: React.FC = () => {
  const {
    warehouseItems = [],
    warehouseTransactions = [],
    orders = [],
    loadAllData,
    showToast,
    logActivity,
    currentUser
  } = useApp();

  const [activeTab, setActiveTab] = useState<'inventory' | 'income' | 'expense' | 'history'>('inventory');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // New item modal / form
  const [newItemData, setNewItemData] = useState({
    name: '',
    category: 'Плитные материалы',
    unit: 'лист',
    qty_in_stock: '0',
    min_qty_alert: '5',
    unit_cost: '0',
    supplier: ''
  });

  // Income form
  const [incomeData, setIncomeData] = useState({
    item_id: '',
    qty: '1',
    unit_cost: '0',
    supplier: '',
    notes: ''
  });

  // Expense form
  const [expenseData, setExpenseData] = useState({
    item_id: '',
    qty: '1',
    order_id: '',
    reason: 'Списание на заказ'
  });

  const categories = Array.from(new Set(warehouseItems.map(i => i.category || 'Прочее')));

  // Add new item
  const handleAddNewItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newItemData.name.trim();
    if (!name) {
      showToast('Введите наименование товара', 'error');
      return;
    }

    try {
      const { error } = await supabase.from('warehouse_items').insert({
        name,
        category: newItemData.category,
        unit: newItemData.unit,
        qty_in_stock: parseFloat(newItemData.qty_in_stock) || 0,
        min_qty_alert: parseFloat(newItemData.min_qty_alert) || 0,
        unit_cost: parseFloat(newItemData.unit_cost) || 0,
        supplier: newItemData.supplier
      });
      if (error) throw error;

      await logActivity(
        currentUser?.name || 'Админ',
        'Добавил позицию на склад',
        `Товар: ${name}, нач. остаток: ${newItemData.qty_in_stock} ${newItemData.unit}`,
        'warehouse'
      );

      showToast(`Товар «${name}» добавлен на склад`);
      setNewItemData({
        name: '',
        category: 'Плитные материалы',
        unit: 'лист',
        qty_in_stock: '0',
        min_qty_alert: '5',
        unit_cost: '0',
        supplier: ''
      });
      await loadAllData();
    } catch (err: any) {
      showToast('Ошибка добавления: ' + err.message, 'error');
    }
  };

  // Income supply submit
  const handleIncomeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!incomeData.item_id) {
      showToast('Выберите товар для прихода', 'error');
      return;
    }
    const item = warehouseItems.find(i => i.id === parseInt(incomeData.item_id, 10));
    if (!item) return;

    const qty = parseFloat(incomeData.qty) || 0;
    const unit_cost = parseFloat(incomeData.unit_cost) || item.unit_cost;
    if (qty <= 0) {
      showToast('Укажите корректное количество', 'error');
      return;
    }

    try {
      // 1. Insert transaction
      await supabase.from('warehouse_transactions').insert({
        item_id: item.id,
        type: 'income',
        qty,
        unit_cost,
        supplier: incomeData.supplier || item.supplier,
        notes: incomeData.notes
      });

      // 2. Update stock qty
      await supabase.from('warehouse_items').update({
        qty_in_stock: item.qty_in_stock + qty,
        unit_cost: unit_cost > 0 ? unit_cost : item.unit_cost
      }).eq('id', item.id);

      await logActivity(
        currentUser?.name || 'Админ',
        'Оприходовал товар',
        `+${qty} ${item.unit} «${item.name}»`,
        'warehouse'
      );

      showToast(`Приход +${qty} ${item.unit} «${item.name}» сохранен!`);
      setIncomeData({ item_id: '', qty: '1', unit_cost: '0', supplier: '', notes: '' });
      await loadAllData();
    } catch (err: any) {
      showToast('Ошибка прихода: ' + err.message, 'error');
    }
  };

  // Expense submit
  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseData.item_id) {
      showToast('Выберите товар для списания', 'error');
      return;
    }
    const item = warehouseItems.find(i => i.id === parseInt(expenseData.item_id, 10));
    if (!item) return;

    const qty = parseFloat(expenseData.qty) || 0;
    if (qty <= 0) {
      showToast('Укажите количество для списания', 'error');
      return;
    }

    try {
      // 1. Insert transaction
      await supabase.from('warehouse_transactions').insert({
        item_id: item.id,
        type: 'expense',
        qty,
        unit_cost: item.unit_cost,
        order_id: expenseData.order_id || null,
        notes: expenseData.reason
      });

      // 2. Update stock qty
      await supabase.from('warehouse_items').update({
        qty_in_stock: Math.max(0, item.qty_in_stock - qty)
      }).eq('id', item.id);

      await logActivity(
        currentUser?.name || 'Админ',
        'Списал товар со склада',
        `-${qty} ${item.unit} «${item.name}» (${expenseData.reason})`,
        'warehouse'
      );

      showToast(`Списано -${qty} ${item.unit} «${item.name}»`);
      setExpenseData({ item_id: '', qty: '1', order_id: '', reason: 'Списание на заказ' });
      await loadAllData();
    } catch (err: any) {
      showToast('Ошибка списания: ' + err.message, 'error');
    }
  };

  const handleDeleteItem = async (id: number, name: string) => {
    if (!confirm(`Удалить товар «${name}» со склада?`)) return;
    try {
      await supabase.from('warehouse_items').delete().eq('id', id);
      await logActivity(currentUser?.name || 'Админ', 'Удалил товар со склада', `Товар: ${name}`, 'delete');
      showToast(`Товар «${name}» удален`);
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка: ' + e.message, 'error');
    }
  };

  const filteredItems = warehouseItems.filter(i => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      (i.name || '').toLowerCase().includes(q) ||
      (i.supplier || '').toLowerCase().includes(q) ||
      (i.category || '').toLowerCase().includes(q);

    const matchesCat = selectedCategory === 'all' || i.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  const lowStockItems = warehouseItems.filter(i => i.qty_in_stock <= (i.min_qty_alert || 0));
  const totalStockValuation = warehouseItems.reduce((s, i) => s + (i.qty_in_stock || 0) * (i.unit_cost || 0), 0);

  return (
    <div className="space-y-6">
      {/* Subtabs & Valuation banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex gap-2 p-1.5 bg-white border border-slate-200 backdrop-blur-md rounded-2xl max-w-xl">
          <button
            onClick={() => setActiveTab('inventory')}
            className={`py-2 px-4 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'inventory' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            📦 Остатки ({warehouseItems.length})
          </button>
          <button
            onClick={() => setActiveTab('income')}
            className={`py-2 px-4 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'income' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/40' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            📥 Приход
          </button>
          <button
            onClick={() => setActiveTab('expense')}
            className={`py-2 px-4 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'expense' ? 'bg-rose-600 text-white shadow-lg shadow-rose-900/40' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            📤 Расход
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`py-2 px-4 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'history' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            📜 Журнал ({warehouseTransactions.length})
          </button>
        </div>

        <div className="p-3 bg-white backdrop-blur-xl border border-slate-200 rounded-2xl shadow-xl shadow-black/20 text-right">
          <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">Оценка склада</div>
          <div className="text-lg font-black font-mono text-blue-400">{formatMoney(totalStockValuation)}</div>
        </div>
      </div>

      {/* Low stock alert */}
      {lowStockItems.length > 0 && activeTab === 'inventory' && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between text-sm text-rose-700 shadow-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
            <span>
              Внимание: <b className="text-rose-700 font-black">{lowStockItems.length}</b> товаров заканчиваются на складе (меньше мин. остатка).
            </span>
          </div>
        </div>
      )}

      {/* 1. INVENTORY TAB */}
      {activeTab === 'inventory' && (
        <div className="space-y-6">
          {/* Add New Item Form */}
          <div className="bg-white backdrop-blur-xl rounded-3xl p-6 border border-slate-200 shadow-xl shadow-black/20 text-slate-700">
            <h4 className="font-bold text-slate-900 text-sm font-headline mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4 text-blue-400" />
              <span>Добавить новый товар в номенклатуру</span>
            </h4>

            <form onSubmit={handleAddNewItem} className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Наименование</label>
                <input
                  type="text"
                  value={newItemData.name}
                  onChange={(e) => setNewItemData({ ...newItemData, name: e.target.value })}
                  placeholder="ЛДСП 18мм Белый Кроношпан"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-400"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Категория</label>
                <input
                  type="text"
                  value={newItemData.category}
                  onChange={(e) => setNewItemData({ ...newItemData, category: e.target.value })}
                  placeholder="Плитные"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-blue-400"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Ед. изм.</label>
                <input
                  type="text"
                  value={newItemData.unit}
                  onChange={(e) => setNewItemData({ ...newItemData, unit: e.target.value })}
                  placeholder="лист/м/шт"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-center font-bold text-slate-900 focus:outline-none focus:border-blue-400"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Мин. остаток</label>
                <input
                  type="number"
                  value={newItemData.min_qty_alert}
                  onChange={(e) => setNewItemData({ ...newItemData, min_qty_alert: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-center font-bold font-mono text-slate-900 focus:outline-none focus:border-blue-400"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Цена закупки</label>
                <input
                  type="number"
                  value={newItemData.unit_cost}
                  onChange={(e) => setNewItemData({ ...newItemData, unit_cost: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-right font-bold font-mono text-slate-900 focus:outline-none focus:border-blue-400"
                />
              </div>

              <div className="sm:col-span-3 lg:col-span-2">
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Поставщик</label>
                <input
                  type="text"
                  value={newItemData.supplier}
                  onChange={(e) => setNewItemData({ ...newItemData, supplier: e.target.value })}
                  placeholder="ООО ЛесПром"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-blue-400"
                />
              </div>

              <div className="sm:col-span-3 lg:col-span-4 flex justify-end">
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-slate-900 font-bold text-xs rounded-xl shadow-lg shadow-blue-900/30 transition-colors"
                >
                  + Сохранить товар
                </button>
              </div>
            </form>
          </div>

          {/* Search & Category Filter */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск по названию, поставщику..."
                className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 placeholder-slate-500 focus:outline-none focus:border-blue-400 backdrop-blur-md"
              />
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5 pointer-events-none" />
            </div>

            <div className="flex gap-1.5 overflow-x-auto pb-1">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                  selectedCategory === 'all' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'bg-white text-slate-600 border border-slate-200 hover:bg-white/10 hover:text-slate-900'
                }`}
              >
                Все категории
              </button>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                    selectedCategory === cat ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'bg-white text-slate-600 border border-slate-200 hover:bg-white/10 hover:text-slate-900'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="bg-white backdrop-blur-xl rounded-3xl border border-slate-200 shadow-xl shadow-black/20 overflow-hidden text-slate-700">
            {filteredItems.length === 0 ? (
              <div className="text-center py-16 text-slate-500 text-sm">
                Товары не найдены
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-white text-slate-500 uppercase tracking-wider text-[11px] border-b border-slate-200">
                    <tr>
                      <th className="p-3.5">Наименование</th>
                      <th className="p-3.5">Категория</th>
                      <th className="p-3.5 text-center">Остаток</th>
                      <th className="p-3.5 text-center">Мин. ост.</th>
                      <th className="p-3.5 text-right">Закупочная цена</th>
                      <th className="p-3.5 text-right">Сумма на складе</th>
                      <th className="p-3.5">Поставщик</th>
                      <th className="p-3.5 text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredItems.map((item) => {
                      const isLow = item.qty_in_stock <= (item.min_qty_alert || 0);
                      return (
                        <tr key={item.id} className={`hover:bg-slate-50 transition-colors ${isLow ? 'bg-rose-50/50' : ''}`}>
                          <td className="p-3.5 font-bold text-slate-900 text-sm">
                            <div className="flex items-center gap-2">
                              {isLow && <div className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)] animate-pulse" title="Критический остаток" />}
                              {item.name}
                            </div>
                          </td>
                          <td className="p-3.5">
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-md font-medium text-[11px]">
                              {item.category || 'Прочее'}
                            </span>
                          </td>
                          <td className="p-3.5 text-center">
                            <span
                              className={`font-mono font-bold text-sm px-2.5 py-1 rounded-lg border ${
                                isLow ? 'bg-rose-100 text-rose-700 border-rose-200 shadow-sm' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              }`}
                            >
                              {item.qty_in_stock} {item.unit}
                            </span>
                          </td>
                          <td className="p-3.5 text-center font-mono text-slate-500">
                            {item.min_qty_alert} {item.unit}
                          </td>
                          <td className="p-3.5 text-right font-mono font-bold text-slate-700">
                            {formatMoney(item.unit_cost)}
                          </td>
                          <td className="p-3.5 text-right font-mono font-black text-slate-900 text-sm">
                            {formatMoney((item.qty_in_stock || 0) * (item.unit_cost || 0))}
                          </td>
                          <td className="p-3.5 text-slate-500">{item.supplier || '—'}</td>
                          <td className="p-3.5 text-right flex justify-end gap-1">
                            <button
                              onClick={() => setExpenseData({ ...expenseData, item_id: item.id.toString(), qty: '1' })}
                              className="p-1.5 text-rose-600 hover:bg-rose-100 rounded-lg transition-colors"
                              title="Списать"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteItem(item.id, item.name)}
                              className="p-1.5 text-rose-600 hover:bg-rose-100 rounded-lg transition-colors"
                              title="Удалить"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. INCOME TAB */}
      {activeTab === 'income' && (
        <div className="bg-white backdrop-blur-xl rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl shadow-black/20 max-w-2xl mx-auto space-y-6 text-slate-700">
          <div>
            <h4 className="font-bold text-slate-900 text-lg font-headline flex items-center gap-2">
              <ArrowDownRight className="w-5 h-5 text-emerald-400" />
              <span>Оприходование партии товара на склад</span>
            </h4>
            <p className="text-xs text-slate-500 mt-1 font-medium">
              Увеличивает остаток на складе и фиксирует партию в журнале приходов
            </p>
          </div>

          <form onSubmit={handleIncomeSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Товар</label>
              <select
                value={incomeData.item_id}
                onChange={(e) => {
                  const selItem = warehouseItems.find(i => i.id === parseInt(e.target.value, 10));
                  setIncomeData({
                    ...incomeData,
                    item_id: e.target.value,
                    unit_cost: selItem ? String(selItem.unit_cost) : incomeData.unit_cost,
                    supplier: selItem?.supplier || incomeData.supplier
                  });
                }}
                className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-blue-400"
              >
                <option value="">Выберите товар...</option>
                {warehouseItems.map(i => (
                  <option key={i.id} value={i.id}>
                    {i.name} (остаток: {i.qty_in_stock} {i.unit})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Количество</label>
                <input
                  type="number"
                  step="0.01"
                  value={incomeData.qty}
                  onChange={(e) => setIncomeData({ ...incomeData, qty: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold font-mono text-slate-900 focus:outline-none focus:border-blue-400"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Закупочная цена (ед)</label>
                <input
                  type="number"
                  step="0.01"
                  value={incomeData.unit_cost}
                  onChange={(e) => setIncomeData({ ...incomeData, unit_cost: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold font-mono text-slate-900 focus:outline-none focus:border-blue-400"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Поставщик</label>
              <input
                type="text"
                value={incomeData.supplier}
                onChange={(e) => setIncomeData({ ...incomeData, supplier: e.target.value })}
                placeholder="Поставщик / Накладная"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:border-blue-400"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Примечание</label>
              <input
                type="text"
                value={incomeData.notes}
                onChange={(e) => setIncomeData({ ...incomeData, notes: e.target.value })}
                placeholder="Номер накладной, комментарии..."
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:border-blue-400"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-slate-900 font-bold rounded-xl text-sm shadow-xl shadow-emerald-900/30 transition-all border border-emerald-400/20"
            >
              Оприходовать на склад
            </button>
          </form>
        </div>
      )}

      {/* 3. EXPENSE TAB */}
      {activeTab === 'expense' && (
        <div className="bg-white backdrop-blur-xl rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl shadow-black/20 max-w-2xl mx-auto space-y-6 text-slate-700">
          <div>
            <h4 className="font-bold text-slate-900 text-lg font-headline flex items-center gap-2">
              <ArrowUpRight className="w-5 h-5 text-rose-400" />
              <span>Списание материала со склада</span>
            </h4>
            <p className="text-xs text-slate-500 mt-1 font-medium">
              Уменьшает остаток и привязывает расход к заказу или производственной нужде
            </p>
          </div>

          <form onSubmit={handleExpenseSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Товар</label>
              <select
                value={expenseData.item_id}
                onChange={(e) => setExpenseData({ ...expenseData, item_id: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-blue-400"
              >
                <option value="">Выберите товар...</option>
                {warehouseItems.map(i => (
                  <option key={i.id} value={i.id}>
                    {i.name} (в наличии: {i.qty_in_stock} {i.unit})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Количество</label>
                <input
                  type="number"
                  step="0.01"
                  value={expenseData.qty}
                  onChange={(e) => setExpenseData({ ...expenseData, qty: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold font-mono text-slate-900 focus:outline-none focus:border-blue-400"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">№ Заказа (если на заказ)</label>
                <input
                  type="text"
                  value={expenseData.order_id}
                  onChange={(e) => setExpenseData({ ...expenseData, order_id: e.target.value })}
                  placeholder="Например: 0001"
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-mono font-bold text-slate-900 focus:outline-none focus:border-blue-400"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Причина списания</label>
              <input
                type="text"
                value={expenseData.reason}
                onChange={(e) => setExpenseData({ ...expenseData, reason: e.target.value })}
                placeholder="Списание на раскрой, брак, образец..."
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:border-blue-400"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3.5 bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-slate-900 font-bold rounded-xl text-sm shadow-xl shadow-rose-900/30 transition-all border border-rose-400/20"
            >
              Списать со склада
            </button>
          </form>
        </div>
      )}

      {/* 4. HISTORY TAB */}
      {activeTab === 'history' && (
        <div className="bg-white backdrop-blur-xl rounded-3xl p-6 border border-slate-200 shadow-xl shadow-black/20 space-y-4 text-slate-700">
          <h4 className="font-bold text-slate-900 text-base font-headline">История складских движений</h4>

          {warehouseTransactions.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">Транзакций пока нет</div>
          ) : (
            <div className="border border-slate-200 rounded-2xl overflow-x-auto bg-white">
              <table className="w-full text-xs text-left">
                <thead className="bg-white text-slate-500 uppercase tracking-wider text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="p-3.5">Дата</th>
                    <th className="p-3.5">Тип</th>
                    <th className="p-3.5">Товар</th>
                    <th className="p-3.5 text-center">Кол-во</th>
                    <th className="p-3.5 text-right">Цена</th>
                    <th className="p-3.5 text-right">Сумма</th>
                    <th className="p-3.5">Заказ / Поставщик / Примечание</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {warehouseTransactions.map((tx) => {
                    const item = warehouseItems.find(i => i.id === tx.item_id);
                    const isIncome = tx.type === 'income';

                    return (
                      <tr key={tx.id} className="hover:bg-white transition-colors">
                        <td className="p-3.5 text-slate-500 whitespace-nowrap">
                          {tx.created_at ? new Date(tx.created_at).toLocaleString('ru-RU') : '—'}
                        </td>
                        <td className="p-3.5">
                          <span
                            className={`px-2 py-0.5 rounded font-bold text-[10px] uppercase border ${
                              isIncome ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                            }`}
                          >
                            {isIncome ? 'Приход' : 'Расход'}
                          </span>
                        </td>
                        <td className="p-3.5 font-bold text-slate-900">{item?.name || `Товар #${tx.item_id}`}</td>
                        <td className="p-3.5 text-center font-mono font-bold text-slate-700">
                          {isIncome ? `+${tx.qty}` : `-${tx.qty}`} {item?.unit || 'шт'}
                        </td>
                        <td className="p-3.5 text-right font-mono text-slate-600">{formatMoney(tx.unit_cost)}</td>
                        <td className="p-3.5 text-right font-mono font-bold text-slate-900">
                          {formatMoney((tx.qty || 0) * (tx.unit_cost || 0))}
                        </td>
                        <td className="p-3.5 text-slate-500">
                          {tx.order_id && <b className="text-blue-400 mr-1.5">Заказ #{tx.order_id}</b>}
                          {tx.supplier && <span className="mr-1.5">{tx.supplier}</span>}
                          {tx.notes && <span className="text-slate-500">({tx.notes})</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
