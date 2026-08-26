import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Plus, Trash2, Edit2, Package } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { BlankItem } from '../types';

export const BlanksCatalogView: React.FC = () => {
  const { blankItems, showToast, loadAllData } = useApp();
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState<Partial<BlankItem>>({
    name: '', category: '', type: '', unit: 'шт', qty_in_stock: 0, min_qty: 0
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return showToast('Введите название', 'error');

    try {
      const { error } = await supabase.from('blank_items').insert([{
        name: formData.name,
        category: formData.category,
        type: formData.type,
        unit: formData.unit || 'шт',
        qty_in_stock: Number(formData.qty_in_stock) || 0,
        min_qty: Number(formData.min_qty) || 0
      }]);

      if (error) throw error;
      showToast('Заготовка добавлена');
      setIsAdding(false);
      setFormData({ name: '', category: '', type: '', unit: 'шт', qty_in_stock: 0, min_qty: 0 });
      loadAllData();
    } catch (err) {
      console.error(err);
      showToast('Ошибка при добавлении', 'error');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Удалить заготовку?')) return;
    try {
      const { error } = await supabase.from('blank_items').delete().eq('id', id);
      if (error) throw error;
      showToast('Удалено');
      loadAllData();
    } catch (err) {
      console.error(err);
      showToast('Ошибка удаления', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">Справочник Заготовок</h2>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-900/20 hover:bg-blue-500 transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Добавить
        </button>
      </div>

      {isAdding && (
        <form onSubmit={handleSave} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="lg:col-span-2">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Наименование</label>
              <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm" required />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Категория</label>
              <input type="text" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Тип</label>
              <input type="text" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Остаток</label>
              <input type="number" value={formData.qty_in_stock} onChange={e => setFormData({...formData, qty_in_stock: Number(e.target.value)})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono" />
            </div>
            <div className="flex items-end">
              <button type="submit" className="w-full px-4 py-2 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-500 transition-colors">Сохранить</button>
            </div>
          </div>
        </form>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-bold border-b border-slate-200">
            <tr>
              <th className="p-4">Наименование</th>
              <th className="p-4">Категория / Тип</th>
              <th className="p-4 text-center">Ед.изм</th>
              <th className="p-4 text-center">На складе</th>
              <th className="p-4 text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {blankItems.map(item => (
              <tr key={item.id} className="hover:bg-slate-50">
                <td className="p-4 font-bold text-slate-900 flex items-center gap-3">
                  <Package className="w-5 h-5 text-slate-400" />
                  {item.name}
                </td>
                <td className="p-4 text-slate-600">
                  <span className="bg-slate-100 px-2 py-1 rounded text-xs mr-2">{item.category || '—'}</span>
                  <span className="text-slate-500 text-xs">{item.type}</span>
                </td>
                <td className="p-4 text-center text-slate-500">{item.unit}</td>
                <td className="p-4 text-center font-mono font-bold text-blue-600">{item.qty_in_stock}</td>
                <td className="p-4 text-right">
                  <button onClick={() => handleDelete(item.id)} className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {blankItems.length === 0 && (
              <tr><td colSpan={5} className="p-8 text-center text-slate-500">Нет добавленных заготовок</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
