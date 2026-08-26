import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  ActivityLogItem,
  BlankItem,
  BlankMovementItem,
  CRMOrderItem,
  CurrentUser,
  ExpenseItem,
  FinishedItem,
  FinishedMovementItem,
  FinishedRecipeItem,
  LaborCatalogItem,
  OrderCalcMeta,
  OrderItem,
  OrderLaborItem,
  OrderMaterialItem,
  PaintCatalogItem,
  PaintLayerConfig,
  PaintOrderItem,
  PaintRecordItem,
  SandingItem,
  SandingMovementItem,
  SandingRecordItem,
  SvcClientItem,
  SvcPriceItem,
  SvcTransactionItem,
  TelegramClientItem,
  TelegramNotificationItem,
  ToastMessage,
  WarehouseItem,
  WarehouseMovementItem,
  WarehouseTransactionItem,
  WorkerItem
} from '../types';

export type AppView =
  | 'login'
  | 'dashboard'
  | 'workers'
  | 'telegram'
  | 'crm'
  | 'orders'
  | 'monitor'
  | 'warehouse'
  | 'blanks'
  | 'finished'
  | 'paint'
  | 'sanding'
  | 'finance'
  | 'kanban'
  | 'services'
  | 'labor-catalog'
  | 'paint-catalog'
  | 'worker-terminal'
  | 'paint-worker'
  | 'order-calc';

interface AppContextType {
  currentUser: CurrentUser | null;
  currentView: AppView;
  setCurrentView: (view: AppView) => void;
  activeCalcOrderId: string | null;
  setActiveCalcOrderId: (id: string | null) => void;
  
  // Data
  workers: WorkerItem[];
  orders: OrderItem[];
  crmOrders: CRMOrderItem[];
  telegramClients: TelegramClientItem[];
  notificationHistory: TelegramNotificationItem[];
  botToken: string;
  activityLogs: ActivityLogItem[];
  paintCatalog: PaintCatalogItem[];
  paintRecords: PaintRecordItem[];
  paintOrderItems: PaintOrderItem[];
  paintOrderLayers: Record<string, { layers: number; coats: number }>;
  sandingItems: SandingItem[];
  sandingRecords: SandingRecordItem[];
  sandingMovements: SandingMovementItem[];
  svcClients: SvcClientItem[];
  svcTransactions: SvcTransactionItem[];
  svcPrices: SvcPriceItem[];
  orderMaterials: OrderMaterialItem[];
  orderLabor: OrderLaborItem[];
  orderCalcMetas: OrderCalcMeta[];
  laborCatalog: LaborCatalogItem[];
  warehouseItems: WarehouseItem[];
  warehouseMovements: WarehouseMovementItem[];
  warehouseTransactions: WarehouseTransactionItem[];
  blankItems: BlankItem[];
  blankMovements: BlankMovementItem[];
  finishedItems: FinishedItem[];
  finishedRecipe: FinishedRecipeItem[];
  finishedMovements: FinishedMovementItem[];
  expenses: ExpenseItem[];
  
  // State helpers
  isLoading: boolean;
  toasts: ToastMessage[];
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  removeToast: (id: string) => void;
  
  // Auth
  login: (username: string) => Promise<boolean>;
  logout: () => Promise<void>;
  
  // Actions
  loadAllData: () => Promise<void>;
  logActivity: (userName: string, action: string, details?: string, type?: ActivityLogItem['type']) => Promise<void>;
  sendTelegramNotification: (clientName: string, orderId: string, processName: string, itemName?: string) => Promise<boolean>;
  
  // Global search modal
  searchModalOpen: boolean;
  searchModalOrder: OrderItem | null;
  openSearchModal: (query: string) => void;
  closeSearchModal: () => void;
  
  // TV Mode for Kanban
  isTVMode: boolean;
  toggleTVMode: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [currentView, setCurrentView] = useState<AppView>('login');
  const [activeCalcOrderId, setActiveCalcOrderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isTVMode, setIsTVMode] = useState<boolean>(() => localStorage.getItem('erp_tv_mode') === '4k');

  // Search modal state
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchModalOrder, setSearchModalOrder] = useState<OrderItem | null>(null);

  // Entities
  const [workers, setWorkers] = useState<WorkerItem[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [crmOrders, setCrmOrders] = useState<CRMOrderItem[]>([]);
  const [telegramClients, setTelegramClients] = useState<TelegramClientItem[]>([]);
  const [notificationHistory, setNotificationHistory] = useState<TelegramNotificationItem[]>([]);
  const [botToken, setBotToken] = useState<string>('');
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>([]);
  const [paintCatalog, setPaintCatalog] = useState<PaintCatalogItem[]>([]);
  const [paintRecords, setPaintRecords] = useState<PaintRecordItem[]>([]);
  const [paintOrderItems, setPaintOrderItems] = useState<PaintOrderItem[]>([]);
  const [paintOrderLayers, setPaintOrderLayers] = useState<Record<string, { layers: number; coats: number }>>({});
  const [sandingItems, setSandingItems] = useState<SandingItem[]>([]);
  const [sandingRecords, setSandingRecords] = useState<SandingRecordItem[]>([]);
  const [sandingMovements, setSandingMovements] = useState<SandingMovementItem[]>([]);
  const [svcClients, setSvcClients] = useState<SvcClientItem[]>([]);
  const [svcTransactions, setSvcTransactions] = useState<SvcTransactionItem[]>([]);
  const [svcPrices, setSvcPrices] = useState<SvcPriceItem[]>([]);
  const [orderMaterials, setOrderMaterials] = useState<OrderMaterialItem[]>([]);
  const [orderLabor, setOrderLabor] = useState<OrderLaborItem[]>([]);
  const [orderCalcMetas, setOrderCalcMetas] = useState<OrderCalcMeta[]>([]);
  const [laborCatalog, setLaborCatalog] = useState<LaborCatalogItem[]>([]);
  const [warehouseItems, setWarehouseItems] = useState<WarehouseItem[]>([]);
  const [warehouseMovements, setWarehouseMovements] = useState<WarehouseMovementItem[]>([]);
  const [warehouseTransactions, setWarehouseTransactions] = useState<WarehouseTransactionItem[]>([]);
  const [blankItems, setBlankItems] = useState<BlankItem[]>([]);
  const [blankMovements, setBlankMovements] = useState<BlankMovementItem[]>([]);
  const [finishedItems, setFinishedItems] = useState<FinishedItem[]>([]);
  const [finishedRecipe, setFinishedRecipe] = useState<FinishedRecipeItem[]>([]);
  const [finishedMovements, setFinishedMovements] = useState<FinishedMovementItem[]>([]);
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const logActivity = useCallback(async (userName: string, action: string, details = '', type: ActivityLogItem['type'] = 'system') => {
    if (userName === 'admin939291' || userName === 'Администратор') return;
    try {
      const { data, error } = await supabase.from('activity_logs').insert({
        user_name: userName,
        action,
        details,
        type
      }).select();
      if (!error && data?.[0]) {
        setActivityLogs(prev => [data[0], ...prev]);
      }
    } catch (err) {
      console.warn('Log activity error:', err);
    }
  }, []);

  const loadAllData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [
        wRes, oRes, cRes, tcRes, nhRes, tgSetRes, actRes,
        pCatRes, pRecRes, pOiRes, pLayRes,
        sdItRes, sdRecRes, sdMvRes,
        sClRes, sTxRes, sPrRes,
        omRes, olRes, ocMetaRes, lcRes,
        whItRes, whMvRes, whTxRes, blItRes, blMvRes, fnItRes, fnRcRes, fnMvRes, expRes
      ] = await Promise.allSettled([
        supabase.from('workers').select('*'),
        supabase.from('orders').select('*'),
        supabase.from('crm_orders').select('*'),
        supabase.from('telegram_clients').select('*'),
        supabase.from('notification_history').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('telegram_settings').select('*').maybeSingle(),
        supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(150),
        supabase.from('paint_catalog').select('*').order('category'),
        supabase.from('paint_records').select('*').order('created_at', { ascending: false }),
        supabase.from('paint_order_items').select('*'),
        supabase.from('paint_layer_config').select('*'),
        supabase.from('sanding_items').select('*').order('category'),
        supabase.from('sanding_records').select('*').order('created_at', { ascending: false }).limit(300),
        supabase.from('sanding_movements').select('*').order('created_at', { ascending: false }).limit(150),
        supabase.from('svc_clients').select('*').order('name'),
        supabase.from('svc_transactions').select('*').order('created_at', { ascending: false }),
        supabase.from('svc_prices').select('*').order('service_type'),
        supabase.from('order_materials').select('*'),
        supabase.from('order_labor').select('*'),
        supabase.from('order_calc_meta').select('*'),
        supabase.from('labor_catalog').select('*').order('name'),
        supabase.from('warehouse_items').select('*').order('name'),
        supabase.from('warehouse_movements').select('*').order('created_at', { ascending: false }).limit(150),
        supabase.from('warehouse_transactions').select('*').order('created_at', { ascending: false }).limit(150),
        supabase.from('blank_items').select('*').order('category'),
        supabase.from('blank_movements').select('*').order('created_at', { ascending: false }).limit(150),
        supabase.from('finished_items').select('*').order('category'),
        supabase.from('finished_recipe').select('*'),
        supabase.from('finished_movements').select('*').order('created_at', { ascending: false }).limit(150),
        supabase.from('expenses').select('*').order('date', { ascending: false })
      ]);

      if (wRes.status === 'fulfilled' && !wRes.value.error) {
        setWorkers((wRes.value.data || []).map((w: any) => {
          let procs: string[] = [];
          try {
            if (typeof w.procs === 'string') procs = JSON.parse(w.procs);
            else if (Array.isArray(w.procs)) procs = w.procs;
          } catch { procs = []; }
          return { ...w, procs };
        }));
      }

      if (oRes.status === 'fulfilled' && !oRes.value.error) {
        setOrders((oRes.value.data || []).map((o: any) => {
          let path: string[] = [];
          try {
            if (typeof o.path === 'string') path = JSON.parse(o.path);
            else if (Array.isArray(o.path)) path = o.path;
          } catch { path = []; }
          return { ...o, path, history: o.history || {} };
        }));
      }

      if (cRes.status === 'fulfilled' && !cRes.value.error) setCrmOrders(cRes.value.data || []);
      if (tcRes.status === 'fulfilled' && !tcRes.value.error) setTelegramClients(tcRes.value.data || []);
      if (nhRes.status === 'fulfilled' && !nhRes.value.error) setNotificationHistory(nhRes.value.data || []);
      if (tgSetRes.status === 'fulfilled' && tgSetRes.value.data) setBotToken(tgSetRes.value.data.bot_token || '');
      if (actRes.status === 'fulfilled' && !actRes.value.error) setActivityLogs(actRes.value.data || []);
      if (pCatRes.status === 'fulfilled' && !pCatRes.value.error) setPaintCatalog(pCatRes.value.data || []);
      if (pRecRes.status === 'fulfilled' && !pRecRes.value.error) setPaintRecords(pRecRes.value.data || []);
      if (pOiRes.status === 'fulfilled' && !pOiRes.value.error) setPaintOrderItems(pOiRes.value.data || []);
      if (pLayRes.status === 'fulfilled' && !pLayRes.value.error) {
        const layersMap: Record<string, { layers: number; coats: number }> = {};
        (pLayRes.value.data || []).forEach((r: any) => {
          layersMap[r.order_id] = { layers: r.layers, coats: r.coats };
        });
        setPaintOrderLayers(layersMap);
      }
      if (sdItRes.status === 'fulfilled' && !sdItRes.value.error) setSandingItems(sdItRes.value.data || []);
      if (sdRecRes.status === 'fulfilled' && !sdRecRes.value.error) setSandingRecords(sdRecRes.value.data || []);
      if (sdMvRes.status === 'fulfilled' && !sdMvRes.value.error) setSandingMovements(sdMvRes.value.data || []);
      if (sClRes.status === 'fulfilled' && !sClRes.value.error) setSvcClients(sClRes.value.data || []);
      if (sTxRes.status === 'fulfilled' && !sTxRes.value.error) setSvcTransactions(sTxRes.value.data || []);
      if (sPrRes.status === 'fulfilled' && !sPrRes.value.error) setSvcPrices(sPrRes.value.data || []);
      if (omRes.status === 'fulfilled' && !omRes.value.error) setOrderMaterials(omRes.value.data || []);
      if (olRes.status === 'fulfilled' && !olRes.value.error) setOrderLabor(olRes.value.data || []);
      if (ocMetaRes.status === 'fulfilled' && !ocMetaRes.value.error) setOrderCalcMetas(ocMetaRes.value.data || []);
      if (lcRes.status === 'fulfilled' && !lcRes.value.error) setLaborCatalog(lcRes.value.data || []);
      if (whItRes.status === 'fulfilled' && !whItRes.value.error) setWarehouseItems(whItRes.value.data || []);
      if (whMvRes.status === 'fulfilled' && !whMvRes.value.error) setWarehouseMovements(whMvRes.value.data || []);
      if (whTxRes.status === 'fulfilled' && !whTxRes.value.error) setWarehouseTransactions(whTxRes.value.data || []);
      if (blItRes.status === 'fulfilled' && !blItRes.value.error) setBlankItems(blItRes.value.data || []);
      if (blMvRes.status === 'fulfilled' && !blMvRes.value.error) setBlankMovements(blMvRes.value.data || []);
      if (fnItRes.status === 'fulfilled' && !fnItRes.value.error) setFinishedItems(fnItRes.value.data || []);
      if (fnRcRes.status === 'fulfilled' && !fnRcRes.value.error) setFinishedRecipe(fnRcRes.value.data || []);
      if (fnMvRes.status === 'fulfilled' && !fnMvRes.value.error) setFinishedMovements(fnMvRes.value.data || []);
      if (expRes.status === 'fulfilled' && !expRes.value.error) setExpenses(expRes.value.data || []);

    } catch (e) {
      console.error('Data loading error:', e);
      showToast('Ошибка загрузки данных', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  const sendTelegramNotification = useCallback(async (clientName: string, orderId: string, processName: string, itemName = 'Не указано') => {
    if (!botToken) return false;
    const client = telegramClients.find(c => c.name === clientName && c.active);
    if (!client || !client.notify_processes?.includes(processName)) return false;

    const now = new Date();
    const message = `✅ *Уведомление о завершении процесса*\n\n` +
      `📦 Заказ: *#${orderId}*\n` +
      `🛋 Изделие: *${itemName}*\n` +
      `⚙️ Процесс: *${processName}*\n` +
      `✔️ Статус: *Завершен*\n\n` +
      `📅 Дата: ${now.toLocaleDateString('ru-RU')}\n` +
      `🕐 Время: ${now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}\n\n` +
      `_Производство мебели Aliya_`;

    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: client.telegram_id, text: message, parse_mode: 'Markdown' })
      });
      const data = await response.json();
      const status = data.ok ? 'sent' : 'failed';

      await supabase.from('notification_history').insert({
        client_name: clientName,
        telegram_id: client.telegram_id,
        order_id: orderId,
        process_name: processName,
        status,
        message,
        error: data.ok ? undefined : data.description
      });

      return data.ok;
    } catch (err: any) {
      console.error('Telegram notification error:', err);
      return false;
    }
  }, [botToken, telegramClients]);

  const login = async (username: string): Promise<boolean> => {
    const val = username.trim();
    if (!val) return false;

    if (val.toLowerCase() === 'kanban') {
      const user: CurrentUser = { name: 'kanban', role: 'kanban' };
      setCurrentUser(user);
      localStorage.setItem('erp_user', 'kanban');
      localStorage.setItem('erp_user_type', 'kanban');
      setCurrentView('kanban');
      showToast('Kanban доска загружена');
      return true;
    }

    if (val.toLowerCase() === 'admin939291') {
      const user: CurrentUser = { name: 'admin939291', role: 'admin' };
      setCurrentUser(user);
      localStorage.setItem('erp_user', 'admin939291');
      localStorage.setItem('erp_user_type', 'admin');
      setCurrentView('dashboard');
      showToast('Добро пожаловать, Администратор');
      return true;
    }

    const worker = workers.find(w => w.name.toLowerCase() === val.toLowerCase());
    if (worker) {
      const user: CurrentUser = { name: worker.name, role: 'worker', procs: worker.procs };
      setCurrentUser(user);
      localStorage.setItem('erp_user', worker.name);
      localStorage.setItem('erp_user_type', 'worker');
      setCurrentView('worker-terminal');
      await logActivity(worker.name, 'Вошел в систему', 'Рабочий терминал', 'login');
      showToast(`Здравствуйте, ${worker.name}`);
      return true;
    }

    showToast('Сотрудник с таким логином не найден', 'error');
    return false;
  };

  const logout = async () => {
    if (currentUser && currentUser.name !== 'admin939291' && currentUser.name !== 'kanban') {
      await logActivity(currentUser.name, 'Вышел из системы', '', 'logout');
    }
    localStorage.removeItem('erp_user');
    localStorage.removeItem('erp_user_type');
    setCurrentUser(null);
    setCurrentView('login');
    showToast('Вы вышли из системы');
  };

  const toggleTVMode = () => {
    setIsTVMode(prev => {
      const next = !prev;
      if (next) {
        localStorage.setItem('erp_tv_mode', '4k');
        showToast('TV 4K режим включен');
      } else {
        localStorage.removeItem('erp_tv_mode');
        showToast('TV режим выключен');
      }
      return next;
    });
  };

  const openSearchModal = (query: string) => {
    const q = query.trim();
    if (!q) return;

    let targetOrder = orders.find(o => o.id === q);
    if (!targetOrder) {
      const trimmed = q;
      const lastDash = trimmed.lastIndexOf('-');
      if (lastDash !== -1) {
        const orderId = trimmed.slice(0, lastDash);
        targetOrder = orders.find(o => o.id === orderId);
      }
    }

    if (targetOrder) {
      setSearchModalOrder(targetOrder);
      setSearchModalOpen(true);
      logActivity(currentUser?.name || 'Гость', 'Поиск заказа', `Заказ #${targetOrder.id}`, 'system');
    } else {
      showToast(`Заказ «${q}» не найден`, 'error');
    }
  };

  const closeSearchModal = () => {
    setSearchModalOpen(false);
    setSearchModalOrder(null);
  };

  // Initial load and restoration
  useEffect(() => {
    loadAllData().then(() => {
      const savedUser = localStorage.getItem('erp_user');
      const savedType = localStorage.getItem('erp_user_type');
      if (savedUser) {
        if (savedUser === 'kanban' || savedType === 'kanban') {
          setCurrentUser({ name: 'kanban', role: 'kanban' });
          setCurrentView('kanban');
        } else if (savedUser === 'admin939291' || savedType === 'admin') {
          setCurrentUser({ name: 'admin939291', role: 'admin' });
          setCurrentView('dashboard');
        } else {
          // Worker restoration
          supabase.from('workers').select('*').eq('name', savedUser).maybeSingle().then(({ data }) => {
            if (data) {
              let procs: string[] = [];
              try {
                if (typeof data.procs === 'string') procs = JSON.parse(data.procs);
                else if (Array.isArray(data.procs)) procs = data.procs;
              } catch { procs = []; }
              setCurrentUser({ name: data.name, role: 'worker', procs });
              setCurrentView('worker-terminal');
            } else {
              localStorage.removeItem('erp_user');
            }
          });
        }
      }
    });
  }, [loadAllData]);

  // Periodic polling for real-time responsiveness
  useEffect(() => {
    const interval = setInterval(() => {
      loadAllData();
    }, 45000);
    return () => clearInterval(interval);
  }, [loadAllData]);

  return (
    <AppContext.Provider
      value={{
        currentUser,
        currentView,
        setCurrentView,
        activeCalcOrderId,
        setActiveCalcOrderId,
        workers,
        orders,
        crmOrders,
        telegramClients,
        notificationHistory,
        botToken,
        activityLogs,
        paintCatalog,
        paintRecords,
        paintOrderItems,
        paintOrderLayers,
        sandingItems,
        sandingRecords,
        sandingMovements,
        svcClients,
        svcTransactions,
        svcPrices,
        orderMaterials,
        orderLabor,
        orderCalcMetas,
        laborCatalog,
        warehouseItems,
        warehouseMovements,
        warehouseTransactions,
        blankItems,
        blankMovements,
        finishedItems,
        finishedRecipe,
        finishedMovements,
        expenses,
        isLoading,
        toasts,
        showToast,
        removeToast,
        login,
        logout,
        loadAllData,
        logActivity,
        sendTelegramNotification,
        searchModalOpen,
        searchModalOrder,
        openSearchModal,
        closeSearchModal,
        isTVMode,
        toggleTVMode
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
