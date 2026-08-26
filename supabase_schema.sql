-- Таблицы для мебельной ERP (Supabase)

-- 1. Сотрудники и заказы
CREATE TABLE IF NOT EXISTS workers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'worker',
  procs JSONB DEFAULT '[]'::jsonb,
  pin TEXT,
  hourly_rate NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  client TEXT,
  item TEXT,
  phone TEXT,
  path JSONB DEFAULT '[]'::jsonb,
  history JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deadline TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS crm_orders (
  id BIGSERIAL PRIMARY KEY,
  oid TEXT UNIQUE NOT NULL,
  client TEXT,
  item TEXT,
  phone TEXT,
  price NUMERIC DEFAULT 0,
  prepay NUMERIC DEFAULT 0,
  deadline TIMESTAMPTZ,
  notes TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGSERIAL PRIMARY KEY,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  type TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Склад материалов и фурнитуры
CREATE TABLE IF NOT EXISTS warehouse_items (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT DEFAULT 'шт',
  qty_in_stock NUMERIC DEFAULT 0,
  min_qty_alert NUMERIC DEFAULT 5,
  unit_cost NUMERIC DEFAULT 0,
  supplier TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warehouse_movements (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT REFERENCES warehouse_items(id) ON DELETE CASCADE,
  item_name TEXT,
  type TEXT NOT NULL,
  qty NUMERIC NOT NULL,
  unit_cost NUMERIC DEFAULT 0,
  order_id TEXT,
  reason TEXT,
  user_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Калькуляция и себестоимость
CREATE TABLE IF NOT EXISTS order_materials (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  package TEXT,
  qty NUMERIC DEFAULT 1,
  unit TEXT DEFAULT 'шт',
  unit_price NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_labor (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,
  description TEXT NOT NULL,
  qty NUMERIC DEFAULT 1,
  unit_price NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_calc_meta (
  order_id TEXT PRIMARY KEY,
  delivery_cost NUMERIC DEFAULT 0,
  sale_price NUMERIC DEFAULT 0,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Заготовки и готовая продукция
CREATE TABLE IF NOT EXISTS blank_items (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT DEFAULT 'шт',
  qty_in_stock NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blank_movements (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT REFERENCES blank_items(id) ON DELETE CASCADE,
  item_name TEXT,
  type TEXT NOT NULL,
  qty NUMERIC NOT NULL,
  reason TEXT,
  user_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finished_items (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT DEFAULT 'шт',
  qty_in_stock NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finished_recipe (
  id BIGSERIAL PRIMARY KEY,
  finished_item_id BIGINT REFERENCES finished_items(id) ON DELETE CASCADE,
  blank_item_id BIGINT REFERENCES blank_items(id) ON DELETE CASCADE,
  blank_item_name TEXT,
  qty_per_unit NUMERIC DEFAULT 1
);

CREATE TABLE IF NOT EXISTS finished_movements (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT REFERENCES finished_items(id) ON DELETE CASCADE,
  item_name TEXT,
  type TEXT NOT NULL,
  qty NUMERIC NOT NULL,
  reason TEXT,
  user_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Услуги цеха и субподряд
CREATE TABLE IF NOT EXISTS svc_clients (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS svc_transactions (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT REFERENCES svc_clients(id) ON DELETE CASCADE,
  service_type TEXT NOT NULL,
  qty NUMERIC DEFAULT 1,
  unit_price NUMERIC DEFAULT 0,
  total_amount NUMERIC DEFAULT 0,
  paid_amount NUMERIC DEFAULT 0,
  crm_order_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS svc_prices (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT DEFAULT 'м.п.',
  price NUMERIC DEFAULT 0
);

-- 6. Малярный цех
-- ВАЖНО: имена колонок должны совпадать с кодом (src/components/PaintCatalogView.tsx,
-- WorkerInlinePaint.tsx). Ранее здесь были item_type/formula/description и worker_name,
-- которых код не использует — из-за этого малярка не работала.
CREATE TABLE IF NOT EXISTS paint_catalog (
  id BIGSERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  area_m2 NUMERIC DEFAULT 0
);

CREATE TABLE IF NOT EXISTS paint_order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,
  category TEXT,
  item_name TEXT NOT NULL,
  qty NUMERIC DEFAULT 1,
  color TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paint_records (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,
  stage_key TEXT NOT NULL,
  category TEXT,
  item_name TEXT,
  qty_done NUMERIC DEFAULT 0,
  worker TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Код обращается к paint_layer_config (ранее в схеме называлась paint_order_layers)
CREATE TABLE IF NOT EXISTS paint_layer_config (
  order_id TEXT PRIMARY KEY,
  layers INT DEFAULT 2,
  coats INT DEFAULT 2
);

-- 6.1 ШЛИПОВКА — отдельный склад шлифованных деталей и журнал выработки
-- Работник шлиповки выбирает деталь из каталога, указывает сколько отшлифовал,
-- готовые детали приходуются на склад шлиповки (sanding_items.qty_in_stock).
CREATE TABLE IF NOT EXISTS sanding_items (
  id BIGSERIAL PRIMARY KEY,
  category TEXT,
  name TEXT NOT NULL,
  unit TEXT DEFAULT 'шт',
  area_m2 NUMERIC DEFAULT 0,
  qty_in_stock NUMERIC DEFAULT 0,
  min_qty NUMERIC DEFAULT 0,
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sanding_records (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT,
  item_name TEXT NOT NULL,
  category TEXT,
  qty_done NUMERIC DEFAULT 0,
  area_m2 NUMERIC DEFAULT 0,
  worker TEXT,
  order_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sanding_movements (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT,
  item_name TEXT,
  type TEXT,
  qty NUMERIC DEFAULT 0,
  reason TEXT,
  order_id TEXT,
  user_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6.2 Справочник работ / монтажа (использует src/components/LaborCatalogView.tsx)
CREATE TABLE IF NOT EXISTS labor_catalog (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  price_ours NUMERIC DEFAULT 0,
  price_client NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6.3 Кассовые операции склада (использует AppContext: warehouse_transactions)
CREATE TABLE IF NOT EXISTS warehouse_transactions (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT,
  item_name TEXT,
  type TEXT,
  qty NUMERIC DEFAULT 0,
  unit_price NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  order_id TEXT,
  user_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6.4 Заказы услугчиков (использует ServicesView: svc_orders)
CREATE TABLE IF NOT EXISTS svc_orders (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT,
  order_id TEXT,
  total_amount NUMERIC DEFAULT 0,
  paid_amount NUMERIC DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Финансы и Telegram
CREATE TABLE IF NOT EXISTS expenses (
  id BIGSERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  description TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telegram_clients (
  id BIGSERIAL PRIMARY KEY,
  client_name TEXT NOT NULL,
  phone TEXT,
  telegram_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telegram_settings (
  id INT PRIMARY KEY DEFAULT 1,
  bot_token TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_history (
  id BIGSERIAL PRIMARY KEY,
  client_name TEXT,
  telegram_id TEXT,
  order_id TEXT,
  process_name TEXT,
  status TEXT,
  message TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- ДОСТУП (RLS)
-- ═══════════════════════════════════════════════════════════════
-- Приложение работает с публичным (anon) ключом, поэтому для новых таблиц
-- RLS отключается — так же, как для остальных таблиц проекта.
--
-- ⚠ ВНИМАНИЕ ПО БЕЗОПАСНОСТИ: с отключённым RLS и публичным ключом в коде
-- любой, кто откроет приложение, может читать и изменять все данные напрямую
-- через Supabase REST API. Для рабочего внедрения стоит включить RLS
-- и настроить политики по ролям.
ALTER TABLE sanding_items         DISABLE ROW LEVEL SECURITY;
ALTER TABLE sanding_records       DISABLE ROW LEVEL SECURITY;
ALTER TABLE sanding_movements     DISABLE ROW LEVEL SECURITY;
ALTER TABLE labor_catalog         DISABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE svc_orders            DISABLE ROW LEVEL SECURITY;
ALTER TABLE paint_layer_config    DISABLE ROW LEVEL SECURITY;
ALTER TABLE order_calc_meta       DISABLE ROW LEVEL SECURITY;

-- Ускорение частых выборок
CREATE INDEX IF NOT EXISTS idx_sanding_records_worker  ON sanding_records (worker);
CREATE INDEX IF NOT EXISTS idx_sanding_records_created ON sanding_records (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sanding_records_order   ON sanding_records (order_id);
CREATE INDEX IF NOT EXISTS idx_paint_records_order     ON paint_records (order_id);
