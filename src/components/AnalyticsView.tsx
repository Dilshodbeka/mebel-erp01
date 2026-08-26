import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import {
  formatMoney,
  formatDuration,
  calculateOrderProgress,
  isOrderFinished,
  getPathProcUnit
} from '../utils/formatters';
import { PROCS } from '../constants';
import {
  TrendingUp,
  DollarSign,
  Users,
  Calendar,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Sparkles,
  Layers,
  Scissors,
  Wrench,
  Palette,
  Package,
  Boxes,
  Filter,
  BarChart3,
  Search,
  ExternalLink,
  ChevronRight,
  Download
} from 'lucide-react';

export const AnalyticsView: React.FC = () => {
  const {
    crmOrders,
    orders,
    orderMaterials,
    orderLabor,
    orderCalcMetas,
    paintRecords,
    paintOrderItems,
    workers,
    warehouseItems,
    openSearchModal
  } = useApp();

  const [period, setPeriod] = useState<'month' | 'prev_month' | 'week' | 'quarter' | 'year' | 'all'>('month');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedWorker, setSelectedWorker] = useState<string>('all');
  const [searchOrderQuery, setSearchOrderQuery] = useState<string>('');
  
  const [warehouseCategoryFilter, setWarehouseCategoryFilter] = useState<string>('all');
  const [isExporting, setIsExporting] = useState<boolean>(false);


  // Date period helper
  const isInSelectedPeriod = (dateStr?: string | null) => {
    if (!dateStr) return false;
    if (period === 'all') return true;
    const d = new Date(dateStr);
    const now = new Date();

    if (period === 'month') {
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }
    if (period === 'prev_month') {
      const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      return d.getFullYear() === prevYear && d.getMonth() === prevMonth;
    }
    if (period === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      return d >= weekAgo && d <= now;
    }
    if (period === 'quarter') {
      const curQuarter = Math.floor(now.getMonth() / 3);
      const targetQuarter = Math.floor(d.getMonth() / 3);
      return d.getFullYear() === now.getFullYear() && curQuarter === targetQuarter;
    }
    if (period === 'year') {
      return d.getFullYear() === now.getFullYear();
    }
    return true;
  };

  // Helper to categorize processes
  const getProcessCategory = (procName: string): string => {
    const p = (procName || '').toLowerCase();
    if (p.includes('раскрой') || p.includes('nesting') || p.includes('нестинг') || p.includes('пильн')) return 'nesting';
    if (p.includes('кромк')) return 'edging';
    if (p.includes('присад') || p.includes('ровер')) return 'cnc';
    if (p.includes('фасад') || p.includes('пленка')) return 'facades';
    if (p.includes('краск') || p.includes('шлип') || p.includes('шлиф') || p.includes('грунт')) return 'paint';
    if (p.includes('сборк')) return 'assembly';
    if (p.includes('упаковк') || p.includes('otk')) return 'packaging';
    return 'other';
  };

  // Aggregated Process Operations History
  interface CompletedOperation {
    id: string;
    orderId: string;
    client: string;
    item: string;
    process: string;
    category: string;
    worker: string;
    qtyDone: number;
    plannedQty: number;
    unit: string;
    startTime: string | null;
    endTime: string;
    durationMs: number | null;
    estimatedLaborCost: number;
  }

  const allCompletedOperations = useMemo(() => {
    const ops: CompletedOperation[] = [];

    orders.forEach(order => {
      if (!order.history) return;
      const crm = crmOrders.find(c => c.oid === order.id);

      Object.entries(order.history).forEach(([procName, h]: [string, any]) => {
        if (!h || !h.end) return;
        if (!isInSelectedPeriod(h.end)) return;

        const workerName = h.completed_by || h.worker || h.assigned_worker || 'Не указан';
        if (selectedWorker !== 'all' && workerName !== selectedWorker) return;

        const cat = getProcessCategory(procName);
        if (selectedCategory !== 'all' && cat !== selectedCategory) return;

        const unit = h.unit || getPathProcUnit(procName);
        const qtyDone = typeof h.qty_done === 'number' ? h.qty_done : h.planned_qty || 1;
        const plannedQty = h.planned_qty || qtyDone || 1;

        // Estimate labor cost from orderLabor or default
        const laborMatch = orderLabor.find(l => l.order_id === order.id && l.description?.toLowerCase().includes(procName.toLowerCase()));
        const unitPrice = laborMatch ? laborMatch.unit_price : 0;

        let durationMs: number | null = null;
        if (h.start && h.end) {
          durationMs = new Date(h.end).getTime() - new Date(h.start).getTime();
        }

        ops.push({
          id: `${order.id}-${procName}`,
          orderId: order.id,
          client: crm?.client || 'Заказчик',
          item: crm?.item || 'Изделие',
          process: procName,
          category: cat,
          worker: workerName,
          qtyDone,
          plannedQty,
          unit,
          startTime: h.start || null,
          endTime: h.end,
          durationMs,
          estimatedLaborCost: unitPrice * qtyDone
        });
      });
    });

    return ops.sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime());
  }, [orders, crmOrders, orderLabor, period, selectedCategory, selectedWorker]);

  // Specific Process Volume Calculations
  const volumes = useMemo(() => {
    let nestingM2 = 0;
    let nestingOrders = new Set<string>();

    let edgingMeters = 0;
    let edgingOrders = new Set<string>();

    let cncQty = 0;
    let cncOrders = new Set<string>();

    let paintM2 = 0;
    let paintOrders = new Set<string>();

    let assemblyItems = 0;
    let assemblyOrders = new Set<string>();

    let totalOperationsCount = allCompletedOperations.length;

    allCompletedOperations.forEach(op => {
      if (op.category === 'nesting') {
        nestingM2 += op.qtyDone;
        nestingOrders.add(op.orderId);
      } else if (op.category === 'edging') {
        edgingMeters += op.qtyDone;
        edgingOrders.add(op.orderId);
      } else if (op.category === 'cnc') {
        cncQty += op.qtyDone;
        cncOrders.add(op.orderId);
      } else if (op.category === 'paint') {
        paintM2 += op.qtyDone;
        paintOrders.add(op.orderId);
      } else if (op.category === 'assembly') {
        assemblyItems += op.qtyDone;
        assemblyOrders.add(op.orderId);
      }
    });

    return {
      nestingM2: Math.round(nestingM2 * 10) / 10,
      nestingOrdersCount: nestingOrders.size,
      edgingMeters: Math.round(edgingMeters * 10) / 10,
      edgingOrdersCount: edgingOrders.size,
      cncQty: Math.round(cncQty),
      cncOrdersCount: cncOrders.size,
      paintM2: Math.round(paintM2 * 10) / 10,
      paintOrdersCount: paintOrders.size,
      assemblyItems: Math.round(assemblyItems),
      assemblyOrdersCount: assemblyOrders.size,
      totalOperationsCount
    };
  }, [allCompletedOperations]);

  // Process Breakdown Matrix
  const processBreakdown = useMemo(() => {
    const map: Record<string, {
      process: string;
      category: string;
      unit: string;
      totalQty: number;
      totalPlanned: number;
      ordersCount: number;
      workers: Record<string, number>;
    }> = {};

    allCompletedOperations.forEach(op => {
      if (!map[op.process]) {
        map[op.process] = {
          process: op.process,
          category: op.category,
          unit: op.unit,
          totalQty: 0,
          totalPlanned: 0,
          ordersCount: 0,
          workers: {}
        };
      }

      map[op.process].totalQty += op.qtyDone;
      map[op.process].totalPlanned += op.plannedQty;
      map[op.process].ordersCount += 1;
      map[op.process].workers[op.worker] = (map[op.process].workers[op.worker] || 0) + op.qtyDone;
    });

    return Object.values(map).sort((a, b) => b.totalQty - a.totalQty);
  }, [allCompletedOperations]);

  // Worker Performance Matrix
  const workerMatrix = useMemo(() => {
    const matrix: Record<string, {
      name: string;
      totalOps: number;
      categories: Record<string, number>;
      processes: Record<string, number>;
      ordersSet: Set<string>;
      totalPieceRateEarned: number;
    }> = {};

    allCompletedOperations.forEach(op => {
      if (!matrix[op.worker]) {
        matrix[op.worker] = {
          name: op.worker,
          totalOps: 0,
          categories: {},
          processes: {},
          ordersSet: new Set(),
          totalPieceRateEarned: 0
        };
      }

      matrix[op.worker].totalOps += 1;
      matrix[op.worker].ordersSet.add(op.orderId);
      matrix[op.worker].categories[op.category] = (matrix[op.worker].categories[op.category] || 0) + op.qtyDone;
      matrix[op.worker].processes[op.process] = (matrix[op.worker].processes[op.process] || 0) + op.qtyDone;
      matrix[op.worker].totalPieceRateEarned += op.estimatedLaborCost;
    });

    return Object.values(matrix)
      .map(m => ({ ...m, ordersCount: m.ordersSet.size }))
      .sort((a, b) => b.totalOps - a.totalOps);
  }, [allCompletedOperations]);

  // Financial summary for period
  const filteredCrm = crmOrders.filter(c => isInSelectedPeriod(c.date || c.created_at));
  const totalRevenue = filteredCrm.reduce((s, c) => {
    const val = typeof c.price === 'number' ? c.price : parseFloat(c.price as any) || 0;
    return s + val;
  }, 0);

  const filteredMaterials = orderMaterials.filter(m => isInSelectedPeriod(m.created_at));
  const totalMaterialCost = filteredMaterials.reduce((s, m) => s + (m.qty || 0) * (m.unit_price || 0), 0);

  const filteredLabor = orderLabor.filter(l => isInSelectedPeriod(l.created_at));
  const totalLaborCost = filteredLabor.reduce((s, l) => s + (l.qty || 1) * (l.unit_price || 0), 0);

  const totalCosts = totalMaterialCost + totalLaborCost;
  const netProfit = totalRevenue - totalCosts;
  const marginPct = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : '0';

  // Filter operations list by search query
  const displayedOperations = allCompletedOperations.filter(op => {
    if (!searchOrderQuery.trim()) return true;
    const q = searchOrderQuery.toLowerCase();
    return (
      op.orderId.toLowerCase().includes(q) ||
      op.client.toLowerCase().includes(q) ||
      op.process.toLowerCase().includes(q) ||
      op.worker.toLowerCase().includes(q)
    );
  });

  // Warehouse Analytics
  const { stockByCategory, topItems, totalStockValue, availableCategories } = useMemo(() => {
    const safeWarehouseItems = Array.isArray(warehouseItems) ? warehouseItems : [];
    
    // Extract unique categories
    const availableCategories = Array.from(new Set(safeWarehouseItems.map(i => i.category || 'Прочее'))).sort();
    
    // Filter by selected category
    const filteredWarehouseItems = warehouseCategoryFilter === 'all' 
      ? safeWarehouseItems 
      : safeWarehouseItems.filter(i => (i.category || 'Прочее') === warehouseCategoryFilter);
      
    // Group by category for Pie Chart
    const catMap: Record<string, number> = {};
    let totalVal = 0;
    
    const itemsWithValue = filteredWarehouseItems.map(item => {
      const val = (item.qty_in_stock || 0) * (item.unit_cost || 0);
      const cat = item.category || 'Прочее';
      
      catMap[cat] = (catMap[cat] || 0) + val;
      totalVal += val;
      
      return {
        name: item.name,
        value: val,
        qty: item.qty_in_stock || 0,
        unit: item.unit
      };
    });

    const stockByCategory = Object.entries(catMap)
      .map(([name, value]) => ({ name, value }))
      .filter(c => c.value > 0)
      .sort((a, b) => b.value - a.value);

    // Top 10 items by value
    const topItems = itemsWithValue
      .filter(i => i.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    return { stockByCategory, topItems, totalStockValue: totalVal, availableCategories };
  }, [warehouseItems, warehouseCategoryFilter]);

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f43f5e', '#64748b'];

  const exportWarehouseToCSV = () => {
    setIsExporting(true);
    try {
      const safeWarehouseItems = Array.isArray(warehouseItems) ? warehouseItems : [];
      const filteredItems = warehouseCategoryFilter === 'all'
        ? safeWarehouseItems
        : safeWarehouseItems.filter(i => (i.category || 'Прочее') === warehouseCategoryFilter);

      let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
      csvContent += "Название,Категория,Ед. изм.,Остаток,Себестоимость,Общая стоимость\n";

      filteredItems.forEach(item => {
        const name = `"${(item.name || '').replace(/"/g, '""')}"`;
        const cat = `"${(item.category || 'Прочее').replace(/"/g, '""')}"`;
        const unit = `"${(item.unit || '').replace(/"/g, '""')}"`;
        const qty = item.qty_in_stock || 0;
        const cost = item.unit_cost || 0;
        const total = qty * cost;
        csvContent += `${name},${cat},${unit},${qty},${cost},${total}\n`;
      });

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `warehouse_report_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error("Export error", e);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Main Period Selection */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold font-headline text-slate-900 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-blue-600" />
            <span>Аналитика технологических объёмов и процессов цеха</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            Сводная выработка по операциям (раскрой м², кромка п.м., ЧПУ, малярка), выработка мастеров и финансовые итоги
          </p>
        </div>

        {/* Period Selector Pills */}
        <div className="flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-2xl shadow-xs overflow-x-auto no-scrollbar">
          {[
            { id: 'month', label: 'Этот месяц' },
            { id: 'prev_month', label: 'Прошлый месяц' },
            { id: 'week', label: 'За 7 дней' },
            { id: 'quarter', label: 'Квартал' },
            { id: 'year', label: 'Текущий год' },
            { id: 'all', label: 'Всё время' },
          ].map(p => {
            const isSel = period === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  isSel
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Category & Worker Filters Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-blue-600" />
            <span>Категория процесса:</span>
          </span>

          {[
            { id: 'all', label: 'Все процессы' },
            { id: 'nesting', label: '🪚 Раскрой / Нестинг' },
            { id: 'edging', label: '📏 Кромкооблицовка' },
            { id: 'cnc', label: '⚙️ Присадка ЧПУ' },
            { id: 'paint', label: '🎨 Малярка / Шлифовка' },
            { id: 'assembly', label: '🔨 Сборка' },
            { id: 'packaging', label: '📦 Упаковка / Отгрузка' },
          ].map(cat => {
            const isSel = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  isSel
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Worker Filter Dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-blue-600" />
            <span>Мастер:</span>
          </span>
          <select
            value={selectedWorker}
            onChange={e => setSelectedWorker(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="all">Все мастера цеха</option>
            {workers.map(w => (
              <option key={w.id} value={w.name}>{w.name} ({w.role || 'Мастер'})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Primary Process Volume KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* 1. Nesting / Cutting */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
            <span>Раскрой & Нестинг</span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100 font-bold">
              🪚
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-slate-900">
            {volumes.nestingM2} <span className="text-sm font-sans font-bold text-slate-500">м²</span>
          </div>
          <div className="text-[11px] text-slate-500 font-medium">
            В <b className="text-slate-800">{volumes.nestingOrdersCount}</b> заказах
          </div>
        </div>

        {/* 2. Edging */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
            <span>Кромкооблицовка</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 font-bold">
              📏
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-emerald-600">
            {volumes.edgingMeters} <span className="text-sm font-sans font-bold text-slate-500">п.м.</span>
          </div>
          <div className="text-[11px] text-slate-500 font-medium">
            В <b className="text-slate-800">{volumes.edgingOrdersCount}</b> заказах
          </div>
        </div>

        {/* 3. CNC Drilling */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
            <span>Присадка ЧПУ</span>
            <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100 font-bold">
              ⚙️
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-indigo-600">
            {volumes.cncQty} <span className="text-sm font-sans font-bold text-slate-500">деталей</span>
          </div>
          <div className="text-[11px] text-slate-500 font-medium">
            В <b className="text-slate-800">{volumes.cncOrdersCount}</b> заказах
          </div>
        </div>

        {/* 4. Paint / Sanding */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
            <span>Малярка / Грунт</span>
            <div className="w-7 h-7 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center border border-violet-100 font-bold">
              🎨
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-violet-600">
            {volumes.paintM2} <span className="text-sm font-sans font-bold text-slate-500">м²</span>
          </div>
          <div className="text-[11px] text-slate-500 font-medium">
            В <b className="text-slate-800">{volumes.paintOrdersCount}</b> заказах
          </div>
        </div>

        {/* 5. Assembly */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
            <span>Сборка изделий</span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100 font-bold">
              🔨
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-amber-600">
            {volumes.assemblyItems} <span className="text-sm font-sans font-bold text-slate-500">изд.</span>
          </div>
          <div className="text-[11px] text-slate-500 font-medium">
            В <b className="text-slate-800">{volumes.assemblyOrdersCount}</b> заказах
          </div>
        </div>
      </div>

      {/* Financial Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-1.5">
          <div className="text-xs font-bold uppercase text-slate-500 flex items-center justify-between">
            <span>Выручка по заказам</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black font-mono text-slate-900">{formatMoney(totalRevenue)} сум</div>
          <div className="text-xs text-slate-500">Заказов за период: {filteredCrm.length}</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-1.5">
          <div className="text-xs font-bold uppercase text-slate-500 flex items-center justify-between">
            <span>Расход материалов</span>
            <Layers className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-2xl font-black font-mono text-rose-600">{formatMoney(totalMaterialCost)} сум</div>
          <div className="text-xs text-slate-500">Складские списания</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-1.5">
          <div className="text-xs font-bold uppercase text-slate-500 flex items-center justify-between">
            <span>Сдельная ЗП мастеров</span>
            <Users className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-black font-mono text-amber-600">{formatMoney(totalLaborCost)} сум</div>
          <div className="text-xs text-slate-500">Оплата за выполненные объемы</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-1.5">
          <div className="text-xs font-bold uppercase text-slate-500 flex items-center justify-between">
            <span>Чистая прибыль цеха</span>
            <Sparkles className="w-4 h-4 text-blue-600" />
          </div>
          <div className={`text-2xl font-black font-mono ${netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {formatMoney(netProfit)} сум
          </div>
          <div className="text-xs font-bold text-emerald-600">Маржинальность: {marginPct}%</div>
        </div>
      </div>

      {/* Process Performance Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-600" />
            <span>Сводная таблица выполнения технологических процессов</span>
          </h3>
          <span className="text-xs text-slate-500 font-medium">
            Всего операций: <b>{volumes.totalOperationsCount}</b>
          </span>
        </div>

        {processBreakdown.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            За выбранный период операции по данным фильтрам не найдены.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3.5">Технологический процесс</th>
                  <th className="p-3.5">Категория</th>
                  <th className="p-3.5 text-right">Выполненный объем (Факт)</th>
                  <th className="p-3.5 text-right">Плановый объем</th>
                  <th className="p-3.5 text-right">Закрыто заказов</th>
                  <th className="p-3.5">Топ исполнители этапа</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {processBreakdown.map(item => {
                  const topWorker = Object.entries(item.workers).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
                  return (
                    <tr key={item.process} className="hover:bg-slate-50/80">
                      <td className="p-3.5 font-bold text-slate-900 flex items-center gap-2">
                        <span>{item.process}</span>
                      </td>
                      <td className="p-3.5">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold text-[11px]">
                          {item.category}
                        </span>
                      </td>
                      <td className="p-3.5 text-right font-mono font-black text-slate-900 text-sm">
                        {Math.round(item.totalQty * 10) / 10} <span className="text-xs font-sans font-normal text-slate-500">{item.unit}</span>
                      </td>
                      <td className="p-3.5 text-right font-mono text-slate-600">
                        {Math.round(item.totalPlanned * 10) / 10} {item.unit}
                      </td>
                      <td className="p-3.5 text-right font-mono font-bold text-blue-600">
                        {item.ordersCount}
                      </td>
                      <td className="p-3.5 text-slate-700">
                        {topWorker ? (
                          <span className="font-medium">
                            <b className="text-slate-900">{topWorker[0]}</b> ({Math.round(Number(topWorker[1]) * 10) / 10} {item.unit})
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Worker Performance Matrix */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-600" />
            <span>Выработка мастеров и сдельная нагрузка</span>
          </h3>
          <span className="text-xs text-slate-500">Мастеров с выработкой: <b>{workerMatrix.length}</b></span>
        </div>

        {workerMatrix.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-xs">
            Нет данных по выработке мастеров за указанный период.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3.5">Мастер / Сотрудник</th>
                  <th className="p-3.5">Выполненные процессы и объемы</th>
                  <th className="p-3.5 text-right">Заказов закрыто</th>
                  <th className="p-3.5 text-right">Всего операций</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {workerMatrix.map(w => (
                  <tr key={w.name} className="hover:bg-slate-50/80">
                    <td className="p-3.5 font-bold text-slate-900 text-sm">
                      {w.name}
                    </td>
                    <td className="p-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(w.processes).map(([pName, pQty]) => (
                          <span
                            key={pName}
                            className="px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-100 rounded-md text-[11px] font-medium"
                          >
                            {pName}: <b className="font-mono">{Math.round(Number(pQty) * 10) / 10} {getPathProcUnit(pName)}</b>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3.5 text-right font-mono font-bold text-slate-900 text-sm">
                      {w.ordersCount}
                    </td>
                    <td className="p-3.5 text-right font-mono font-bold text-blue-600 text-sm">
                      {w.totalOps}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detailed Operations Log Table with Search & Link to Order Dossier */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-600" />
              <span>Журнал завершённых операций цеха ({displayedOperations.length})</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Нажмите на строку или кнопку заказа для открытия полного паспорта заказа
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <input
              type="text"
              value={searchOrderQuery}
              onChange={e => setSearchOrderQuery(e.target.value)}
              placeholder="Поиск по заказу, клиенту, мастеру..."
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          </div>
        </div>

        {displayedOperations.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-xs">
            Операции не найдены по указанным критериям.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-xs text-left">
              <thead className="sticky top-0 bg-slate-100 text-slate-600 font-bold border-b border-slate-200 z-10">
                <tr>
                  <th className="p-3">Дата / Время</th>
                  <th className="p-3">№ Заказа</th>
                  <th className="p-3">Клиент & Изделие</th>
                  <th className="p-3">Техпроцесс</th>
                  <th className="p-3">Мастер</th>
                  <th className="p-3 text-right">Выполненный объем</th>
                  <th className="p-3 text-right">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedOperations.slice(0, 100).map(op => (
                  <tr
                    key={op.id}
                    onClick={() => openSearchModal(op.orderId)}
                    className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                  >
                    <td className="p-3 text-slate-500 whitespace-nowrap">
                      {new Date(op.endTime).toLocaleDateString('ru-RU')} {new Date(op.endTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="p-3 font-mono font-black text-blue-600">
                      № {op.orderId}
                    </td>
                    <td className="p-3">
                      <div className="font-semibold text-slate-800">{op.client}</div>
                      <div className="text-[11px] text-slate-500">{op.item}</div>
                    </td>
                    <td className="p-3">
                      <span className="font-bold text-slate-900">{op.process}</span>
                    </td>
                    <td className="p-3 font-medium text-slate-700">
                      {op.worker}
                    </td>
                    <td className="p-3 text-right font-mono font-black text-slate-900 text-sm whitespace-nowrap">
                      {op.qtyDone} <span className="text-xs font-sans font-normal text-slate-500">{op.unit}</span>
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openSearchModal(op.orderId);
                        }}
                        className="px-2 py-1 bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-700 font-bold text-[11px] rounded-lg transition-colors inline-flex items-center gap-1"
                      >
                        <span>Паспорт</span>
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* Warehouse Charts */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-600" />
              <span>Аналитика складских остатков</span>
            </h3>
            
            <div className="h-4 w-px bg-slate-200 hidden sm:block"></div>
            
            <select
              value={warehouseCategoryFilter}
              onChange={(e) => setWarehouseCategoryFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer"
            >
              <option value="all">Все категории (цеха)</option>
              {availableCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500 font-medium">
              Оценочная стоимость: <b className="text-slate-900">{formatMoney(totalStockValue)} сум</b>
            </span>
            <button
              onClick={exportWarehouseToCSV}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 font-bold text-xs rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isExporting ? 'Экспорт...' : 'Excel / CSV'}</span>
            </button>
          </div>
        </div>
        
        <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Top Items Bar Chart */}
          <div className="h-[300px] w-full">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 text-center">Топ-10 позиций по стоимости</h4>
            {topItems.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topItems} layout="vertical" margin={{ top: 0, right: 20, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" tickFormatter={(value) => formatMoney(value)} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    formatter={(value: number) => [`${formatMoney(value)} сум`, 'Стоимость']}
                    contentStyle={{ borderRadius: '0.75rem', fontSize: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    cursor={{ fill: '#f8fafc' }}
                  />
                  <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">Нет данных по остаткам</div>
            )}
          </div>

          {/* Category Pie Chart */}
          <div className="h-[300px] w-full">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 text-center">Стоимость по категориям</h4>
            {stockByCategory.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <Pie
                    data={stockByCategory}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    labelLine={false}
                    label={({ name, percent }) => percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ''}
                  >
                    {stockByCategory.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => [`${formatMoney(value)} сум`, 'Стоимость']}
                    contentStyle={{ borderRadius: '0.75rem', fontSize: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">Нет данных по остаткам</div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
};
