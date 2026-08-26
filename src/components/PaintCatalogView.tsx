import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { Palette, Plus, Trash2 } from 'lucide-react';

export const PaintCatalogView: React.FC = () => {
  const { paintCatalog, loadAllData, showToast } = useApp();

  const [categoryInput, setCategoryInput] = useState('Фасады');
  const [nameInput, setNameInput] = useState('');
  const [areaInput, setAreaInput] = useState('0.25');

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = nameInput.trim();
    if (!name) {
      showToast('Введите название изделия', 'error');
      return;
    }

    try {
      const { error } = await supabase.from('paint_catalog').insert({
        category: categoryInput.trim() || 'Прочее',
        name,
        area_m2: parseFloat(areaInput) || 0
      });
      if (error) throw error;

      showToast(`Изделие «${name}» добавлено в каталог покраски`);
      setNameInput('');
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка: ' + e.message, 'error');
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Удалить изделие «${name}»?`)) return;
    try {
      await supabase.from('paint_catalog').delete().eq('id', id);
      showToast(`«${name}» удалено`);
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка: ' + e.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white backdrop-blur-xl rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl shadow-black/20 text-slate-700">
        <h3 className="font-bold text-slate-900 text-lg font-headline flex items-center gap-2 mb-4">
          <Palette className="w-5 h-5 text-amber-400" />
          <span>Каталог покрасочных изделий и площадей</span>
        </h3>
        <p className="text-xs text-slate-500 mb-6 font-medium">
          Используется в малярном терминале и при расчете площадей покрытия (м²)
        </p>

        <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Категория</label>
            <input
              type="text"
              value={categoryInput}
              onChange={(e) => setCategoryInput(e.target.value)}
              placeholder="Фасады / Карнизы / Декор"
              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-amber-400"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Наименование изделия</label>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Фасад глухой МДФ 720х396"
              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Площадь (м²/шт)</label>
            <input
              type="number"
              step="0.001"
              value={areaInput}
              onChange={(e) => setAreaInput(e.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold text-center text-slate-900 focus:outline-none focus:border-amber-400"
            />
          </div>

          <div className="sm:col-span-4 flex justify-end pt-2">
            <button
              type="submit"
              className="px-6 py-2.5 bg-amber-600 hover:bg-amber-500 text-slate-900 font-bold text-xs rounded-xl shadow-lg shadow-amber-900/30 transition-colors"
            >
              + Добавить изделие
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white backdrop-blur-xl rounded-3xl border border-slate-200 shadow-xl shadow-black/20 overflow-hidden text-slate-700">
        {paintCatalog.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs">Каталог покраски пуст</div>
        ) : (
          <table className="w-full text-xs text-left">
            <thead className="bg-white text-slate-500 uppercase tracking-wider text-[11px] border-b border-slate-200">
              <tr>
                <th className="p-3.5">Категория</th>
                <th className="p-3.5">Изделие</th>
                <th className="p-3.5 text-center">Площадь единицы</th>
                <th className="p-3.5 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {paintCatalog.map((item) => (
                <tr key={item.id} className="hover:bg-white transition-colors">
                  <td className="p-3.5">
                    <span className="px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg font-bold text-[11px]">
                      {item.category}
                    </span>
                  </td>
                  <td className="p-3.5 font-bold text-slate-900 text-sm">{item.name}</td>
                  <td className="p-3.5 text-center font-mono font-bold text-slate-700 text-sm">
                    {item.area_m2} м²
                  </td>
                  <td className="p-3.5 text-right">
                    <button
                      onClick={() => handleDelete(item.id, item.name)}
                      className="p-1.5 text-rose-400 hover:bg-rose-500/20 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
