export type UserRole = 'admin' | 'worker' | 'kanban' | 'guest';

export interface CurrentUser {
  name: string;
  role?: UserRole;
  procs?: string[];
}

export interface WorkerItem {
  id?: number;
  name: string;
  procs: string[];
}

export interface ProcessHistoryItem {
  start?: string;
  end?: string;
  worker?: string;
  completed_by?: string;
  planned_qty?: number;
  qty_done?: number;
  unit?: string;
  assigned_worker?: string;
  assembled_item?: string;
}

export interface OrderItem {
  id: string;
  path: string[];
  history?: Record<string, ProcessHistoryItem>;
  created_at?: string;
}

export interface CRMOrderItem {
  id?: number;
  oid: string;
  client: string;
  phone?: string;
  item?: string;
  price?: number | string;
  loc?: string;
  date?: string;
  due_date?: string;
  svc_client_id?: number | null;
  svc_material?: 'ours' | 'client';
  svc_qty?: number;
  created_at?: string;
}

export interface TelegramClientItem {
  id: number;
  name: string;
  telegram_id: string;
  notify_processes: string[];
  active: boolean;
}

export interface TelegramNotificationItem {
  id?: number;
  created_at: string;
  client_name: string;
  telegram_id: string;
  order_id: string;
  process_name: string;
  status: 'sent' | 'failed';
  message?: string;
  error?: string;
}

export interface TelegramSettings {
  id?: number;
  bot_token: string;
}

export interface ActivityLogItem {
  id?: number;
  created_at: string;
  user_name: string;
  action: string;
  details?: string;
  type: 'login' | 'logout' | 'process' | 'telegram' | 'order' | 'crm' | 'worker' | 'delete' | 'system';
}

// Paint system
export interface PaintStageDef {
  key: string;
  label: string;
  type: 'шлиповка' | 'грунтовка' | 'краска';
}

export interface PaintCatalogItem {
  id: number;
  category: string;
  name: string;
  area_m2: number;
}

// ── ШЛИПОВКА ──────────────────────────────────────────────
// Каталог шлифуемых деталей = одновременно склад готовых (отшлифованных) деталей
export interface SandingItem {
  id: number;
  category?: string;
  name: string;
  unit: string;
  area_m2: number;
  qty_in_stock: number;
  min_qty: number;
  photo_url?: string | null;
  created_at?: string;
}

// Запись выработки: кто, какую деталь и сколько отшлифовал
export interface SandingRecordItem {
  id?: number;
  item_id?: number | null;
  item_name: string;
  category?: string;
  qty_done: number;
  area_m2: number;
  worker: string;
  order_id?: string | null;
  notes?: string;
  created_at: string;
}

export interface SandingMovementItem {
  id?: number;
  item_id?: number | null;
  item_name: string;
  type: 'in' | 'out';
  qty: number;
  reason?: string;
  order_id?: string | null;
  user_name?: string;
  created_at: string;
}

export interface PaintOrderItem {
  id?: number;
  order_id: string;
  category: string;
  item_name: string;
  qty: number;
}

export interface PaintLayerConfig {
  order_id: string;
  layers: number;
  coats: number;
}

export interface PaintRecordItem {
  id?: number;
  order_id: string;
  stage_key: string;
  category: string;
  item_name: string;
  qty_done: number;
  worker: string;
  created_at: string;
}

// Services (Услуги)
export interface SvcClientItem {
  id: number;
  name: string;
  phone?: string;
  notes?: string;
  created_at?: string;
}

export interface SvcTransactionItem {
  id: number;
  client_id: number;
  client_name: string;
  service_type: string;
  material_source: 'ours' | 'client';
  qty: number;
  unit_price: number;
  total_amount: number;
  paid_amount: number;
  worker?: string;
  notes?: string;
  crm_order_id?: string | null;
  created_at: string;
}

export interface SvcPriceItem {
  id: number;
  service_type: string;
  price_ours: number;
  price_client: number;
}

// Order Calculation / Labor / Materials
export interface OrderMaterialItem {
  id: number;
  order_id: string;
  name: string;
  color?: string;
  package?: string;
  qty: number;
  unit: string;
  unit_price: number;
  created_at?: string;
}

export interface OrderLaborItem {
  id: number;
  order_id: string;
  description: string;
  qty: number;
  unit_price: number;
  worker?: string;
  created_at: string;
}

export interface OrderCalcMeta {
  order_id: string;
  delivery_cost: number;
  sale_price: number;
  notes?: string;
}

export interface LaborCatalogItem {
  id: number;
  name: string;
  category: string;
  price_ours: number;
  price_client: number;
}

// Warehouse / Blanks / Finished
export interface WarehouseItem {
  id: number;
  name: string;
  category?: string;
  unit: string;
  qty_in_stock: number;
  unit_cost?: number;
  min_qty: number;
  photo_url?: string | null;
}

export interface WarehouseMovementItem {
  id: number;
  item_id: number;
  item_name: string;
  type: 'in' | 'out';
  qty: number;
  reason?: string;
  user_name?: string;
  created_at: string;
}

export interface WarehouseTransactionItem {
  id: number;
  item_id: number;
  type: 'income' | 'expense';
  qty: number;
  unit_cost?: number;
  supplier?: string;
  order_id?: string;
  notes?: string;
  created_at?: string;
}

export interface BlankItem {
  id: number;
  category?: string;
  type?: string;
  name: string;
  finish?: string;
  unit: string;
  qty_in_stock: number;
  min_qty: number;
  photo_url?: string | null;
}

export interface BlankMovementItem {
  id: number;
  item_id: number;
  item_name: string;
  type: 'in' | 'out';
  qty: number;
  reason?: string;
  user_name?: string;
  created_at: string;
}

export interface FinishedItem {
  id: number;
  category?: string;
  name: string;
  unit: string;
  qty_in_stock: number;
  photo_url?: string | null;
}

export interface FinishedRecipeItem {
  id: number;
  finished_item_id: number;
  blank_item_id: number;
  blank_item_name: string;
  qty_per_unit: number;
}

export interface FinishedMovementItem {
  id: number;
  item_id: number;
  item_name: string;
  type: 'in' | 'out';
  qty: number;
  reason?: string;
  recipient?: string;
  photo_url?: string | null;
  user_name?: string;
  created_at: string;
}

export interface ExpenseItem {
  id: number;
  category: string;
  description?: string;
  amount: number;
  date: string;
}

export interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}
