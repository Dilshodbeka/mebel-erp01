import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { formatMoney } from '../utils/formatters';
import { Wrench, Plus, Trash2, Edit2, DollarSign } from 'lucide-react';

export const LaborCatalogView: React.FC = () => {
  const { laborCatalog, loadAllData, showToast, logActivity, currentUser } = useApp();

  const [nameInput, setNameInput] = useState('');
  const [unitInput, setUnitInput] = useState('шт');
  const [priceOursInput, setPriceOursInput] = useState('0');
  const [priceClientInput, setPriceClientInput] = useState('0');

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = nameInput.trim();
    if (!name) {
      showToast('Введите наименование работы', 'error');
      return;
    }

    try {
      const { error } = await supabase.from('labor_catalog').insert({
        name,
        unit: unitInput.trim() || 'шт',
        price_ours: parseFloat(priceOursInput) || 0,
        price_client: parseFloat(priceClientInput) || 0
      });
      if (error) throw error;

      showToast(`Расценка «${name}» добавлена`);
      setNameInput('');
      setPriceOursInput('0');
      setPriceClientInput('0');
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка: ' + e.message, 'error');
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Удалить расценку «${name}»?`)) return;
    try {
      await supabase.from('labor_catalog').delete().eq('id', id);
      showToast(`Расценка «${name}» удалена`);
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка: ' + e.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white backdrop-blur-xl rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl shadow-black/20 text-slate-700">
        <h3 className="font-bold text-slate-900 text-lg font-headline flex items-center gap-2 mb-4">
          <Wrench className="w-5 h-5 text-blue-400" />
          <span>Справочник расценок на работы и монтаж</span>
        </h3>
        <p className="text-xs text-slate-500 mb-6 font-medium">
          Базовые тарифы для начисления мастерам и выставления счетов клиентам
        </p>

        <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Наименование работы</label>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Сборка корпусов стандарт"
              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-400"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Ед. изм.</label>
            <input
              type="text"
              value={unitInput}
              onChange={(e) => setUnitInput(e.target.value)}
              placeholder="шт / п.м / м2"
              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-center text-slate-900 focus:outline-none focus:border-blue-400"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Тариф мастеру (себест.)</label>
            <input
              type="number"
              value={priceOursInput}
              onChange={(e) => setPriceOursInput(e.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold text-right text-slate-900 focus:outline-none focus:border-blue-400"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Тариф клиенту (продажа)</label>
            <input
              type="number"
              value={priceClientInput}
              onChange={(e) => setPriceClientInput(e.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold text-right text-blue-400 focus:outline-none focus:border-blue-400"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-5 flex justify-end pt-2">
            <button
              type="submit"
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-slate-900 font-bold text-xs rounded-xl shadow-lg shadow-blue-900/30 transition-colors"
            >
              + Добавить в справочник
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white backdrop-blur-xl rounded-3xl border border-slate-200 shadow-xl shadow-black/20 overflow-hidden text-slate-700">
        {laborCatalog.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs">Справочник пока пуст</div>
        ) : (
          <table className="w-full text-xs text-left">
            <thead className="bg-white text-slate-500 uppercase tracking-wider text-[11px] border-b border-slate-200">
              <tr>
                <th className="p-3.5">Работа / Услуга</th>
                <th className="p-3.5 text-center">Ед. изм.</th>
                <th className="p-3.5 text-right">Тариф мастеру</th>
                <th className="p-3.5 text-right">Тариф клиенту</th>
                <th className="p-3.5 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {laborCatalog.map((item) => (
                <tr key={item.id} className="hover:bg-white transition-colors">
                  <td className="p-3.5 font-bold text-slate-900 text-sm">{item.name}</td>
                  <td className="p-3.5 text-center font-semibold text-slate-500">{item.unit || 'шт'}</td>
                  <td className="p-3.5 text-right font-mono font-bold text-slate-600">
                    {formatMoney(item.price_ours)}
                  </td>
                  <td className="p-3.5 text-right font-mono font-black text-blue-400 text-sm">
                    {formatMoney(item.price_client)}
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
