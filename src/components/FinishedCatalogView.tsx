import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Plus, Trash2, Link, Layers } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { FinishedItem } from '../types';

export const FinishedCatalogView: React.FC = () => {
  const { finishedItems, finishedRecipe, blankItems, showToast, loadAllData } = useApp();
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState<Partial<FinishedItem>>({
    name: '', category: '', unit: 'шт', qty_in_stock: 0
  });

  const [selectedItem, setSelectedItem] = useState<number | null>(null);
  const [recipeForm, setRecipeForm] = useState({ blank_id: '', qty: 1 });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return showToast('Введите название', 'error');

    try {
      const { error } = await supabase.from('finished_items').insert([{
        name: formData.name,
        category: formData.category,
        unit: formData.unit || 'шт',
        qty_in_stock: Number(formData.qty_in_stock) || 0
      }]);

      if (error) throw error;
      showToast('Изделие добавлено');
      setIsAdding(false);
      setFormData({ name: '', category: '', unit: 'шт', qty_in_stock: 0 });
      loadAllData();
    } catch (err) {
      console.error(err);
      showToast('Ошибка при добавлении', 'error');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Удалить изделие?')) return;
    try {
      const { error } = await supabase.from('finished_items').delete().eq('id', id);
      if (error) throw error;
      showToast('Удалено');
      if (selectedItem === id) setSelectedItem(null);
      loadAllData();
    } catch (err) {
      console.error(err);
      showToast('Ошибка удаления', 'error');
    }
  };

  const handleAddRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !recipeForm.blank_id) return;
    const blank = blankItems.find(b => b.id.toString() === recipeForm.blank_id);
    if (!blank) return;

    try {
      const { error } = await supabase.from('finished_recipe').insert([{
        finished_item_id: selectedItem,
        blank_item_id: blank.id,
        blank_item_name: blank.name,
        qty_per_unit: Number(recipeForm.qty)
      }]);
      if (error) throw error;
      showToast('Компонент добавлен в рецепт');
      setRecipeForm({ blank_id: '', qty: 1 });
      loadAllData();
    } catch (err) {
      console.error(err);
      showToast('Ошибка сохранения рецепта', 'error');
    }
  };

  const handleDeleteRecipe = async (id: number) => {
    try {
      const { error } = await supabase.from('finished_recipe').delete().eq('id', id);
      if (error) throw error;
      showToast('Компонент удален');
      loadAllData();
    } catch(err) {
      showToast('Ошибка', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">Готовые изделия и Спецификации (Связка)</h2>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-900/20 hover:bg-blue-500 transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Добавить
        </button>
      </div>

      {isAdding && (
        <form onSubmit={handleSave} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Наименование</label>
              <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm" required />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Категория</label>
              <input type="text" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
            </div>
            <div className="flex items-end">
              <button type="submit" className="w-full px-4 py-2 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-500 transition-colors">Сохранить</button>
            </div>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-bold border-b border-slate-200">
              <tr>
                <th className="p-4">Наименование</th>
                <th className="p-4">Категория</th>
                <th className="p-4 text-center">На складе</th>
                <th className="p-4 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {finishedItems.map(item => (
                <tr key={item.id} className={`hover:bg-slate-50 cursor-pointer transition-colors ${selectedItem === item.id ? 'bg-blue-50/50' : ''}`} onClick={() => setSelectedItem(item.id)}>
                  <td className="p-4 font-bold text-slate-900 flex items-center gap-3">
                    <Layers className="w-5 h-5 text-blue-400" />
                    {item.name}
                  </td>
                  <td className="p-4 text-slate-600">{item.category || '—'}</td>
                  <td className="p-4 text-center font-mono font-bold text-blue-600">{item.qty_in_stock} {item.unit}</td>
                  <td className="p-4 text-right">
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }} className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {finishedItems.length === 0 && (
                <tr><td colSpan={4} className="p-8 text-center text-slate-500">Нет готовых изделий</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 flex flex-col h-full min-h-[400px]">
          {selectedItem ? (
            <>
              <h3 className="font-black text-slate-900 mb-4 flex items-center gap-2 text-lg">
                <Link className="w-5 h-5 text-indigo-500" />
                Спецификация (Рецепт)
              </h3>
              <div className="flex-1 overflow-y-auto mb-4 border border-slate-200 rounded-xl bg-white divide-y divide-slate-100">
                {finishedRecipe.filter(r => r.finished_item_id === selectedItem).length === 0 ? (
                  <div className="p-6 text-center text-slate-400 text-sm">Нет компонентов в рецепте</div>
                ) : (
                  finishedRecipe.filter(r => r.finished_item_id === selectedItem).map(r => (
                    <div key={r.id} className="p-3 flex justify-between items-center hover:bg-slate-50">
                      <div>
                        <div className="font-bold text-sm text-slate-900">{r.blank_item_name}</div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5">{r.qty_per_unit} шт на 1 изделие</div>
                      </div>
                      <button onClick={() => handleDeleteRecipe(r.id)} className="p-1.5 text-rose-500 hover:bg-rose-100 rounded-lg">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <form onSubmit={handleAddRecipe} className="bg-white p-3 rounded-xl border border-slate-200 flex gap-2">
                <select required value={recipeForm.blank_id} onChange={e => setRecipeForm({...recipeForm, blank_id: e.target.value})} className="flex-1 px-2 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg">
                  <option value="">Выберите заготовку...</option>
                  {blankItems.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <input type="number" step="0.1" required value={recipeForm.qty} onChange={e => setRecipeForm({...recipeForm, qty: Number(e.target.value)})} className="w-16 px-2 py-1.5 text-sm font-mono text-center bg-slate-50 border border-slate-200 rounded-lg" title="Кол-во на 1 изделие" />
                <button type="submit" className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-500">+</button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-6 text-center">
              <Layers className="w-12 h-12 text-slate-300 mb-3" />
              <p className="text-sm">Выберите изделие слева, чтобы настроить его спецификацию (связку с заготовками)</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
