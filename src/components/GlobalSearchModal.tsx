import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { getProcessCode, formatMoney, getPathProcUnit, calculateOrderProgress, formatDuration } from '../utils/formatters';
import { printMaterialsWorkshop, printClientInvoice, printProductionSheet } from '../utils/printUtils';
import {
  X,
  Search,
  CheckCircle2,
  Clock,
  PlayCircle,
  Boxes,
  Wrench,
  DollarSign,
  Printer,
  Calendar,
  Phone,
  MapPin,
  FileText,
  User,
  ChevronRight,
  TrendingUp,
  Layers,
  Palette,
  ExternalLink
} from 'lucide-react';

export const GlobalSearchModal: React.FC = () => {
  const {
    searchModalOpen,
    searchModalOrder,
    closeSearchModal,
    crmOrders,
    orderMaterials,
    orderLabor,
    orderCalcMetas,
    paintOrderItems,
    paintRecords,
    paintOrderLayers,
    laborCatalog,
    setCurrentView,
    setActiveCalcOrderId
  } = useApp();

  const [activeTab, setActiveTab] = useState<'overview' | 'processes' | 'materials' | 'labor' | 'finances'>('overview');

  if (!searchModalOpen || !searchModalOrder) return null;

  const orderId = searchModalOrder.id;
  const crmData = crmOrders.find(c => c.oid === orderId);
  const materials = orderMaterials.filter(m => m.order_id === orderId);
  const labor = orderLabor.filter(l => l.order_id === orderId);
  const calcMeta = orderCalcMetas.find(m => m.order_id === orderId);
  const paintItems = paintOrderItems.filter(p => p.order_id === orderId);
  const myPaintRecords = paintRecords.filter(r => r.order_id === orderId);

  const clientPrice = typeof crmData?.price === 'number' ? crmData.price : parseFloat(crmData?.price as any) || 0;
  const matTotal = materials.reduce((s, m) => s + (m.qty || 0) * (m.unit_price || 0), 0);
  const laborTotal = labor.reduce((s, l) => s + (l.qty || 1) * (l.unit_price || 0), 0);
  const delivery = calcMeta?.delivery_cost || 0;
  const primeCost = matTotal + laborTotal + delivery;
  const netProfit = clientPrice - primeCost;
  const marginPct = clientPrice > 0 ? ((netProfit / clientPrice) * 100).toFixed(1) : '0';
  const progressPct = calculateOrderProgress(searchModalOrder);

  const handleOpenInCalc = () => {
    setActiveCalcOrderId(orderId);
    setCurrentView('order-calc');
    closeSearchModal();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeSearchModal();
      }}
    >
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-slate-800">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-widest font-bold text-blue-400">
                Паспорт заказа ERP
              </span>
              <span className="bg-blue-600/30 border border-blue-400/30 text-blue-200 text-[11px] font-bold px-2 py-0.5 rounded-md">
                Готовность: {progressPct}%
              </span>
            </div>
            <div className="text-2xl sm:text-3xl font-black font-headline tracking-tight mt-1 flex items-center gap-3">
              <span>Заказ № {orderId}</span>
              {crmData?.client && (
                <span className="text-base sm:text-lg font-normal text-slate-300 font-sans">
                  · {crmData.client}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-300 mt-1 flex flex-wrap items-center gap-3 font-medium">
              {crmData?.item && <span>Изделие: <b>{crmData.item}</b></span>}
              {crmData?.phone && <span>Тел: <b>{crmData.phone}</b></span>}
              {crmData?.due_date && (
                <span>Срок сдачи: <b>{new Date(crmData.due_date).toLocaleDateString('ru-RU')}</b></span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenInCalc}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors shadow-xs"
              title="Открыть в калькуляторе заказа"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Калькулятор</span>
            </button>

            <button
              onClick={closeSearchModal}
              className="p-2 text-slate-400 hover:text-white bg-white/10 hover:bg-white/20 rounded-xl transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 px-4 pt-2 bg-slate-50 gap-2 overflow-x-auto no-scrollbar">
          {[
            { id: 'overview', label: 'Сводка', icon: FileText },
            { id: 'processes', label: `Техпроцессы (${searchModalOrder.path?.length || 0})`, icon: Clock },
            { id: 'materials', label: `Материалы (${materials.length})`, icon: Boxes },
            { id: 'labor', label: `Работы (${labor.length})`, icon: Wrench },
            { id: 'finances', label: 'Финансы & Маржа', icon: DollarSign },
          ].map(tab => {
            const Icon = tab.icon;
            const isSel = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold border-b-2 transition-all whitespace-nowrap ${
                  isSel
                    ? 'border-blue-600 text-blue-600 bg-white rounded-t-xl'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-4">
          {/* 1. Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {/* Progress & Quick Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Сумма заказа</div>
                  <div className="text-xl font-black font-mono text-slate-900 mt-1">{formatMoney(clientPrice)} сум</div>
                </div>
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Себестоимость</div>
                  <div className="text-xl font-black font-mono text-rose-600 mt-1">{formatMoney(primeCost)} сум</div>
                </div>
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Чистая маржа</div>
                  <div className="text-xl font-black font-mono text-emerald-600 mt-1">
                    {formatMoney(netProfit)} сум ({marginPct}%)
                  </div>
                </div>
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Этапов завершено</div>
                  <div className="text-xl font-black font-mono text-blue-600 mt-1">
                    {(searchModalOrder.path || []).filter(p => searchModalOrder.history?.[p]?.end).length} / {searchModalOrder.path?.length || 0}
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                <div className="flex justify-between text-xs font-bold text-slate-700">
                  <span>Готовность изделия в цехе</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* CRM Card */}
              {crmData && (
                <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Реквизиты клиента и заказа</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div><span className="text-slate-500">Клиент:</span> <b className="text-slate-900 ml-1">{crmData.client}</b></div>
                    <div><span className="text-slate-500">Телефон:</span> <b className="text-slate-900 ml-1">{crmData.phone || '—'}</b></div>
                    <div><span className="text-slate-500">Изделие / Комплект:</span> <b className="text-slate-900 ml-1">{crmData.item || '—'}</b></div>
                    <div><span className="text-slate-500">Адрес / Объект:</span> <b className="text-slate-900 ml-1">{crmData.loc || '—'}</b></div>
                    <div><span className="text-slate-500">Дата заказа:</span> <b className="text-slate-900 ml-1">{crmData.date || '—'}</b></div>
                    <div><span className="text-slate-500">Срок сдачи (дедлайн):</span> <b className="text-slate-900 ml-1 text-blue-600">{crmData.due_date || '—'}</b></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2. Processes Tab */}
          {activeTab === 'processes' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                <span>Технологический маршрут производства и назначенные мастера:</span>
                <span>Всего процессов: {searchModalOrder.path?.length || 0}</span>
              </div>

              <div className="space-y-2">
                {(searchModalOrder.path || []).map((process, idx) => {
                  const code = getProcessCode(searchModalOrder, process);
                  const history = searchModalOrder.history?.[process];
                  const isDone = !!history?.end;
                  const isActive = !!history?.start && !history?.end;
                  const unit = history?.unit || getPathProcUnit(process);
                  const planned = history?.planned_qty || 1;
                  const done = history?.qty_done || (isDone ? planned : 0);
                  const assigned = history?.assigned_worker;
                  const completedBy = history?.completed_by || history?.worker;

                  return (
                    <div
                      key={idx}
                      className={`p-4 rounded-2xl border transition-all ${
                        isDone
                          ? 'bg-emerald-50/70 border-emerald-200'
                          : isActive
                          ? 'bg-blue-50/70 border-blue-200 ring-2 ring-blue-500/20'
                          : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <span className="font-mono px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-black text-xs border border-slate-200">
                            {code}
                          </span>
                          <div>
                            <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                              <span>{process}</span>
                              {isDone ? (
                                <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md">
                                  ✔ Выполнено
                                </span>
                              ) : isActive ? (
                                <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-600 text-white rounded-md animate-pulse">
                                  ● В работе
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md">
                                  Ожидает
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-2">
                              <span>Объем: <b>{done}</b> из <b>{planned}</b> {unit}</span>
                              {assigned && <span>Назначен: <b className="text-slate-700">{assigned}</b></span>}
                              {completedBy && <span>Сделал: <b className="text-emerald-700">{completedBy}</b></span>}
                            </div>
                          </div>
                        </div>

                        <div className="text-left sm:text-right text-xs">
                          {history?.start && (
                            <div className="text-slate-500">
                              Старт: {new Date(history.start).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                          {history?.end && (
                            <div className="text-emerald-700 font-medium">
                              Финиш: {new Date(history.end).toLocaleDateString('ru-RU')} {new Date(history.end).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. Materials Tab */}
          {activeTab === 'materials' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-slate-600">
                <span>Спецификация материалов заказа:</span>
                <span>Итого материалы: <b className="text-slate-900">{formatMoney(matTotal)} сум</b></span>
              </div>

              {materials.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-2xl text-slate-400 text-xs">
                  В этот заказ еще не добавлены материалы со склада.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-2xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
                      <tr>
                        <th className="p-3">Материал</th>
                        <th className="p-3">Цвет / Параметры</th>
                        <th className="p-3 text-right">Кол-во</th>
                        <th className="p-3 text-right">Цена за ед.</th>
                        <th className="p-3 text-right">Сумма</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {materials.map(m => (
                        <tr key={m.id} className="hover:bg-slate-50">
                          <td className="p-3 font-semibold text-slate-800">{m.name}</td>
                          <td className="p-3 text-slate-500">{m.color || m.package || '—'}</td>
                          <td className="p-3 text-right font-mono font-bold text-slate-700">{m.qty} {m.unit}</td>
                          <td className="p-3 text-right font-mono text-slate-600">{formatMoney(m.unit_price)} сум</td>
                          <td className="p-3 text-right font-mono font-bold text-slate-900">{formatMoney((m.qty || 0) * (m.unit_price || 0))} сум</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 4. Labor Tab */}
          {activeTab === 'labor' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-slate-600">
                <span>Работы и сдельная оплата мастеров:</span>
                <span>Итого труд: <b className="text-slate-900">{formatMoney(laborTotal)} сум</b></span>
              </div>

              {labor.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-2xl text-slate-400 text-xs">
                  В этот заказ еще не добавлены сдельные начисления.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-2xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
                      <tr>
                        <th className="p-3">Вид работы</th>
                        <th className="p-3">Исполнитель</th>
                        <th className="p-3 text-right">Объем</th>
                        <th className="p-3 text-right">Ставка</th>
                        <th className="p-3 text-right">Начислено</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {labor.map(l => (
                        <tr key={l.id} className="hover:bg-slate-50">
                          <td className="p-3 font-semibold text-slate-800">{l.description}</td>
                          <td className="p-3 text-slate-600 font-medium">{l.worker || '—'}</td>
                          <td className="p-3 text-right font-mono font-bold text-slate-700">{l.qty}</td>
                          <td className="p-3 text-right font-mono text-slate-600">{formatMoney(l.unit_price)} сум</td>
                          <td className="p-3 text-right font-mono font-bold text-emerald-700">{formatMoney((l.qty || 1) * (l.unit_price || 0))} сум</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 5. Finances Tab */}
          {activeTab === 'finances' && (
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Экономика и рентабельность заказа</div>
                
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1.5 border-b border-slate-200">
                    <span className="text-slate-600 font-medium">Стоимость для клиента (Счёт):</span>
                    <span className="font-mono font-bold text-slate-900 text-sm">{formatMoney(clientPrice)} сум</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-200">
                    <span className="text-slate-600">Расход материалов:</span>
                    <span className="font-mono font-semibold text-rose-600">- {formatMoney(matTotal)} сум</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-200">
                    <span className="text-slate-600">Сдельная оплата труда мастеров:</span>
                    <span className="font-mono font-semibold text-rose-600">- {formatMoney(laborTotal)} сум</span>
                  </div>
                  {delivery > 0 && (
                    <div className="flex justify-between py-1.5 border-b border-slate-200">
                      <span className="text-slate-600">Доставка и накладные расходы:</span>
                      <span className="font-mono font-semibold text-rose-600">- {formatMoney(delivery)} сум</span>
                    </div>
                  )}
                  <div className="flex justify-between py-2 border-t border-slate-300 text-sm font-bold">
                    <span className="text-slate-800">Чистая прибыль по заказу:</span>
                    <span className={`font-mono text-base ${netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {formatMoney(netProfit)} сум ({marginPct}%)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => printProductionSheet(orderId, searchModalOrder.path || [], crmData, materials)}
              className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-bold text-xs rounded-xl shadow-xs transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Наряд в цех</span>
            </button>

            <button
              onClick={() => printClientInvoice(orderId, crmData, clientPrice, materials, labor)}
              className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-bold text-xs rounded-xl shadow-xs transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Счёт клиенту</span>
            </button>

            <button
              onClick={() => printMaterialsWorkshop(orderId, crmData, materials, labor, calcMeta?.delivery_cost || 0, calcMeta?.notes || '')}
              className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-bold text-xs rounded-xl shadow-xs transition-colors"
            >
              <Boxes className="w-3.5 h-3.5" />
              <span>Накладная склада</span>
            </button>
          </div>

          <button
            onClick={closeSearchModal}
            className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl transition-colors"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
