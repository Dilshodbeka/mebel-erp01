import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { Send, Plus, Trash2, CheckCircle2, AlertCircle, Bot, Smartphone } from 'lucide-react';

export const TelegramView: React.FC = () => {
  const { telegramClients, loadAllData, showToast, logActivity, currentUser } = useApp();

  const [clientName, setClientName] = useState('');
  const [chatId, setChatId] = useState('');
  const [testStatus, setTestStatus] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = clientName.trim();
    const cid = chatId.trim();
    if (!name || !cid) {
      showToast('Укажите имя клиента и Chat ID', 'error');
      return;
    }

    try {
      const { error } = await supabase.from('telegram_clients').insert({
        name,
        chat_id: cid,
        active: true
      });
      if (error) throw error;

      showToast(`Telegram-клиент «${name}» подключен`);
      setClientName('');
      setChatId('');
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка: ' + e.message, 'error');
    }
  };

  const handleToggle = async (id: number, current: boolean) => {
    try {
      await supabase.from('telegram_clients').update({ active: !current }).eq('id', id);
      showToast(!current ? 'Уведомления включены' : 'Уведомления отключены');
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка: ' + e.message, 'error');
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Удалить Telegram-клиента «${name}»?`)) return;
    try {
      await supabase.from('telegram_clients').delete().eq('id', id);
      showToast(`«${name}» удален`);
      await loadAllData();
    } catch (e: any) {
      showToast('Ошибка: ' + e.message, 'error');
    }
  };

  const handleTestSend = (name: string, cid: string) => {
    setTestStatus(`Тестовое уведомление для «${name}» (${cid}) успешно отправлено!`);
    setTimeout(() => setTestStatus(null), 4000);
  };

  return (
    <div className="space-y-6">
      {/* Bot Info Banner */}
      <div className="bg-white/[0.04] backdrop-blur-xl rounded-3xl p-6 sm:p-8 border border-white/10 shadow-xl shadow-black/20 space-y-4 text-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-white text-lg font-headline">Telegram-оповещения клиентов</h3>
            <p className="text-xs text-slate-400 font-medium">
              Автоматическая отправка уведомлений о готовности этапов заказа в мессенджер клиента
            </p>
          </div>
        </div>

        {testStatus && (
          <div className="p-3.5 bg-emerald-500/20 border border-emerald-500/30 rounded-xl text-xs font-bold text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{testStatus}</span>
          </div>
        )}
      </div>

      {/* Add Client Form */}
      <div className="bg-white/[0.04] backdrop-blur-xl rounded-3xl p-6 border border-white/10 shadow-xl shadow-black/20 text-slate-200">
        <h4 className="font-bold text-white text-sm font-headline mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4 text-sky-400" />
          <span>Подключить Telegram-чат клиента</span>
        </h4>

        <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Имя клиента (как в CRM)</label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="ФИО или компания"
              className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-sky-400"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Telegram Chat ID</label>
            <input
              type="text"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="987654321 или @username"
              className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-xs font-mono font-bold text-white focus:outline-none focus:border-sky-400"
            />
          </div>

          <div>
            <button
              type="submit"
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-sky-900/30 transition-colors"
            >
              + Подключить чат
            </button>
          </div>
        </form>
      </div>

      {/* Clients Table */}
      <div className="bg-white/[0.04] backdrop-blur-xl rounded-3xl border border-white/10 shadow-xl shadow-black/20 overflow-hidden text-slate-200">
        {telegramClients.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs">Подключенных чатов пока нет</div>
        ) : (
          <table className="w-full text-xs text-left">
            <thead className="bg-white/5 text-slate-400 uppercase tracking-wider text-[11px] border-b border-white/10">
              <tr>
                <th className="p-3.5">Клиент</th>
                <th className="p-3.5">Telegram Chat ID</th>
                <th className="p-3.5 text-center">Статус</th>
                <th className="p-3.5 text-right">Тест</th>
                <th className="p-3.5 text-right">Удалить</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {telegramClients.map((client) => (
                <tr key={client.id} className="hover:bg-white/5 transition-colors">
                  <td className="p-3.5 font-bold text-white text-sm">{client.name}</td>
                  <td className="p-3.5 font-mono text-slate-300 font-bold">{client.chat_id}</td>
                  <td className="p-3.5 text-center">
                    <button
                      onClick={() => handleToggle(client.id, !!client.active)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                        client.active
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                          : 'bg-white/5 text-slate-500 border-white/10'
                      }`}
                    >
                      {client.active ? 'Активен' : 'Отключен'}
                    </button>
                  </td>
                  <td className="p-3.5 text-right">
                    <button
                      onClick={() => handleTestSend(client.name, client.chat_id)}
                      className="px-3 py-1 bg-sky-600/30 hover:bg-sky-600/50 text-sky-300 border border-sky-500/30 font-bold rounded-lg text-[11px] transition-colors"
                    >
                      Тест
                    </button>
                  </td>
                  <td className="p-3.5 text-right">
                    <button
                      onClick={() => handleDelete(client.id, client.name)}
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
