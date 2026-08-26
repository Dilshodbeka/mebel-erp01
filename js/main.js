
// --- CONFIG ---
const SUPABASE_URL = 'https://xknypljgfgkzgokogexz.supabase.co'; 
const SUPABASE_KEY = 'sb_publishable_96Ews89Vjt4la_07SQhf6A_WOmDGSSN'; 
var _supabase = null;
if (typeof supabase !== 'undefined' && supabase.createClient) {
    _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} else {
    console.error('Supabase library not loaded. Check your internet connection or open via HTTP server instead of file:// protocol.');
}

// ОБНОВЛЕНО: 11 процессов без "Установка"
const PROCS = ["Раскрой NESTING", "2 пильный", "кромка", "Присадка", "ФАСАД NESTING", "Ровер", "Фигурный кромка", "Пленка PVC", "Шлиповка", "Грунтовка", "краска", "OTK", "Упаковка", "Сборка"];
// PAINT_PROCS — отображаются у работника как спец-тип (с покрасочным UI)
const PAINT_PROCS = ["Шлиповка", "Грунтовка", "Краска"];
const ALL_WORKER_PROCS = [...new Set([...PROCS, ...PAINT_PROCS])];

// Kanban показывает 8 процессов (исключены: краска, Упаковка, Сборка, Пленка PVC, ФАСАД NESTING, Ровер)
const KANBAN_PROCS = PROCS.filter(p => !["краска", "Упаковка", "Сборка", "Пленка PVC", "ФАСАД NESTING", "Ровер"].includes(p));

let workers = [], orders = [], crm_orders = [], telegram_clients = [], notification_history = [];
let curUser = null, curProc = null, editWId = null, editTgId = null;
let botToken = '';

// --- PROCESS CODES (Заказ 1001 -> процессы 1001-01, 1001-02, ...) ---
// Код процесса = № заказа + порядковый номер процесса В ЭТОМ ЗАКАЗЕ (по составу маршрута order.path),
// а не позиция в общем списке PROCS. Если в заказе выбраны только 3 из 12 процессов,
// они получат коды 01, 02, 03 - именно в том порядке, в котором идут в order.path.
function pad2(n) { return String(n).padStart(2, '0'); }

// Безопасная экранирование строк для вставки в HTML-атрибуты onclick
// ' экранируется как \' (для JS-строк в одинарных кавычках), " как &quot; (для HTML-атрибутов в двойных кавычках)
const esc = (s) => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,"\\'");

// Форматирует сумму с разделителями тысяч: 975111335 -> "975 111 335"
function formatMoney(amount) {
    if (amount === undefined || amount === null || amount === '') return '-';
    const num = Number(amount);
    if (isNaN(num)) return '-';
    return num.toLocaleString('ru-RU');
}

// Единица измерения объёма для завершённого процесса (для лога и history[proc].unit)
function getPathProcUnit(procName) {
    return isPaintProc(procName) ? 'м²' : 'шт';
}

function getProcessCode(order, processName) {
    if (!order || !Array.isArray(order.path)) return '';
    const idx = order.path.indexOf(processName);
    if (idx === -1) return '';
    return `${order.id}-${pad2(idx + 1)}`;
}

// Находит заказ и процесс по коду вида "1001-02"
function findProcessByCode(code) {
    const trimmed = (code || '').trim();
    const lastDash = trimmed.lastIndexOf('-');
    if (lastDash === -1) return null;
    const orderId = trimmed.slice(0, lastDash);
    const num = parseInt(trimmed.slice(lastDash + 1), 10);
    if (!orderId || isNaN(num)) return null;
    const order = orders.find(o => o.id === orderId);
    if (!order || !Array.isArray(order.path)) return null;
    const process = order.path[num - 1];
    if (!process) return null;
    return { order, process, code: `${orderId}-${pad2(num)}` };
}

// --- PAINT SYSTEM ---

// Последовательность этапов покраски
const PAINT_STAGES_DEF = [
    { key: 'шлиф_1',  label: 'Шлиповка 1',  type: 'шлиповка' },
    { key: 'грунт_1', label: 'Грунтовка 1', type: 'грунтовка' },
    { key: 'шлиф_2',  label: 'Шлиповка 2',  type: 'шлиповка' },
    { key: 'грунт_2', label: 'Грунтовка 2', type: 'грунтовка' },
    { key: 'краска_1',label: 'Краска 1',    type: 'краска' },
    { key: 'краска_2',label: 'Краска 2',    type: 'краска' },
];

// Работник видит только этапы своего типа
const PAINT_WORKER_TYPES = {
    'Шлиповка':  ['шлиф_1', 'шлиф_2'],
    'Грунтовка': ['грунт_1', 'грунт_2'],
    'Краска':    ['краска_1', 'краска_2'],
    'краска':    ['шлиф_1','грунт_1','шлиф_2','грунт_2','краска_1','краска_2'], // полный доступ
};

let paint_catalog  = []; // [{id, category, name, area_m2}]
let paint_records  = []; // [{id, order_id, stage_key, category, item_name, qty_done, worker, created_at}]
let paint_order_items = []; // [{id, order_id, category, item_name, qty}]
let paint_order_layers = {}; // {order_id: {layers:2, coats:2}}

// Текущий выбор в воркер-терминале
let pwt = { orderId: null, stageKey: null, category: null, itemName: null, qty: 0 };

async function loadPaintData() {
    try {
        const [catRes, recRes, oiRes] = await Promise.all([
            _supabase.from('paint_catalog').select('*').order('category'),
            _supabase.from('paint_records').select('*').order('created_at', { ascending: false }),
            _supabase.from('paint_order_items').select('*')
        ]);

        // Проверяем ошибки — если таблицы не созданы, показываем подсказку
        const warning = document.getElementById('paint-tables-warning');
        if (catRes.error || recRes.error || oiRes.error) {
            console.error('Paint tables error:', catRes.error || recRes.error || oiRes.error);
            if (warning) warning.classList.remove('hidden');
            showPaintSection('settings');
            return;
        }
        if (warning) warning.classList.add('hidden');

        paint_catalog      = catRes.data  || [];
        paint_records      = recRes.data  || [];
        paint_order_items  = oiRes.data   || [];

        const lcRes = await _supabase.from('paint_layer_config').select('*');
        (lcRes.data || []).forEach(r => {
            paint_order_layers[r.order_id] = { layers: r.layers, coats: r.coats };
        });

        renderPaintCatalog();
        renderPaintAnalytics();
        renderPaintLog();
        updatePaintAdminSelects();
    } catch(e) {
        console.error('Paint load error:', e);
        const warning = document.getElementById('paint-tables-warning');
        if (warning) { warning.classList.remove('hidden'); showPaintSection('settings'); }
    }
}

// ── CATALOG ──────────────────────────────────────────────────
async function savePaintCatalogItem() {
    const category = document.getElementById('pc-category').value.trim();
    const name     = document.getElementById('pc-name').value.trim();
    const area_m2  = parseFloat(document.getElementById('pc-area').value) || 0;
    if (!category || !name) return showToast('Заполните категорию и название', 'error');

    try {
        const { data, error } = await _supabase.from('paint_catalog').insert({ category, name, area_m2 }).select();
        if (error) {
            console.error('paint_catalog insert error:', error);
            return showToast('Ошибка: ' + (error.message || error.code), 'error');
        }

        // Добавляем сразу в локальный кеш не дожидаясь запроса
        if (data && data[0]) paint_catalog.push(data[0]);
        else paint_catalog.push({ id: Date.now(), category, name, area_m2 });

        ['pc-category','pc-name','pc-area'].forEach(id => document.getElementById(id).value = '');

        // Рендерим каталог прямо здесь — секция Настройки уже открыта
        renderPaintCatalog();
        updatePaintAdminSelects();
        showToast('Изделие добавлено: ' + name);

    } catch(e) {
        console.error('savePaintCatalogItem exception:', e);
        showToast('Ошибка сети', 'error');
    }
}

async function deletePaintCatalogItem(id) {
    if (!confirm('Удалить?')) return;
    await _supabase.from('paint_catalog').delete().eq('id', id);
    await loadPaintData();
}

function renderPaintCatalog() {
    const el = document.getElementById('paint-catalog-list');
    if (!el) return;
    if (!paint_catalog.length) { el.innerHTML = '<div style="color:var(--text-muted); font-size:13px; padding:10px;">Каталог пуст. Добавьте изделия выше.</div>'; return; }

    const byCategory = {};
    paint_catalog.forEach(item => {
        if (!byCategory[item.category]) byCategory[item.category] = [];
        byCategory[item.category].push(item);
    });

    el.innerHTML = Object.entries(byCategory).map(([cat, items]) => `
        <div style="margin-bottom:12px;">
            <div class="wt-section-label">${cat}</div>
            ${items.map(item => `
                <div class="paint-item-row">
                    <div>
                        <div style="font-weight:700;">${item.name}</div>
                        <div style="font-size:12px; color:var(--text-secondary);">${item.area_m2} м² / шт</div>
                    </div>
                    <button class="btn-red" style="padding:4px 10px; font-size:12px;" onclick="deletePaintCatalogItem(${item.id})">✖</button>
                </div>`).join('')}
        </div>`).join('');
}

// ── ORDER ITEMS ───────────────────────────────────────────────
function updatePaintItemSelect() {
    const cat = document.getElementById('prod-poi-category')?.value;
    const sel = document.getElementById('prod-poi-item');
    if (!sel) return;
    const items = paint_catalog.filter(i => i.category === cat);
    sel.innerHTML = '<option value="">Выберите изделие...</option>' +
        items.map(i => `<option value="${i.name}">${i.name} (${i.area_m2} м²/шт)</option>`).join('');
}

function updatePaintAdminSelects() {
    updateProdPaintSelects();
}

async function deletePaintOrderItem(id, orderId) {
    if (!confirm('Удалить?')) return;
    await _supabase.from('paint_order_items').delete().eq('id', id);
    await loadPaintData();
}

// ── LAYER CONFIG ──────────────────────────────────────────────
async function savePaintLayers() {
    const order_id = document.getElementById('players-order').value.trim();
    const layers   = parseInt(document.getElementById('players-count').value);
    const coats    = parseInt(document.getElementById('pcoats-count').value);
    if (!order_id) return showToast('Введите № заказа', 'error');

    await _supabase.from('paint_layer_config').upsert({ order_id, layers, coats });
    paint_order_layers[order_id] = { layers, coats };
    showToast(`Слои для заказа #${order_id} сохранены`);
}

// ── ANALYTICS ─────────────────────────────────────────────────
function renderPaintAnalytics() {
    const el = document.getElementById('paint-analytics');
    if (!el) return;

    const totalRecords = paint_records.length;
    const totalQty = paint_records.reduce((s, r) => s + (r.qty_done || 0), 0);
    const totalArea = paint_records.reduce((s, r) => {
        const cat = paint_catalog.find(c => c.name === r.item_name);
        return s + (cat ? cat.area_m2 * (r.qty_done || 0) : 0);
    }, 0);

    const today = new Date().toISOString().slice(0,10);
    const todayQty = paint_records
        .filter(r => r.created_at && r.created_at.slice(0,10) === today)
        .reduce((s, r) => s + (r.qty_done || 0), 0);

    const uniquePainters = [...new Set(paint_records.map(r => r.worker).filter(Boolean))];
    const workerStats = uniquePainters.map(w => {
        const recs = paint_records.filter(r => r.worker === w);
        const qty  = recs.reduce((s, r) => s + (r.qty_done || 0), 0);
        const area = recs.reduce((s, r) => {
            const cat = paint_catalog.find(c => c.name === r.item_name);
            return s + (cat ? cat.area_m2 * (r.qty_done || 0) : 0);
        }, 0);
        return { w, qty, area };
    }).sort((a,b) => b.area - a.area);

    el.innerHTML = `
        <div class="paint-stat-card">
            <div class="paint-stat-val">${totalArea.toFixed(1)} м²</div>
            <div class="paint-stat-label">Всего окрашено</div>
        </div>
        <div class="paint-stat-card">
            <div class="paint-stat-val">${totalQty}</div>
            <div class="paint-stat-label">Всего изделий</div>
        </div>
        <div class="paint-stat-card">
            <div class="paint-stat-val" style="color:var(--success);">${todayQty}</div>
            <div class="paint-stat-label">Изделий сегодня</div>
        </div>
        <div class="paint-stat-card">
            <div class="paint-stat-val">${totalRecords}</div>
            <div class="paint-stat-label">Записей в журнале</div>
        </div>
        ${workerStats.slice(0,4).map(ws => `
        <div class="paint-stat-card">
            <div style="font-weight:700; font-size:13px; margin-bottom:4px;">${ws.w}</div>
            <div class="paint-stat-val" style="font-size:20px;">${ws.area.toFixed(1)} м²</div>
            <div class="paint-stat-label">${ws.qty} изделий</div>
        </div>`).join('')}`;
}

function renderPaintLog() {
    const el = document.getElementById('paint-log-table');
    if (!el) return;
    const q = (document.getElementById('paint-log-filter')?.value || '').toLowerCase();
    let rows = paint_records
        .filter(r => !q || (r.order_id||'').includes(q) || (r.item_name||'').toLowerCase().includes(q))
        .slice(0, 100);

    if (!rows.length) { el.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted);">Нет записей</td></tr>`; return; }

    el.innerHTML = rows.map(r => {
        const stage = PAINT_STAGES_DEF.find(s => s.key === r.stage_key) || {};
        const cat   = paint_catalog.find(c => c.name === r.item_name);
        const area  = cat ? (cat.area_m2 * (r.qty_done||0)).toFixed(2) : '—';
        const dt    = r.created_at ? new Date(r.created_at).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
        return `<tr>
            <td data-label="Заказ"><b>#${r.order_id}</b></td>
            <td data-label="Этап"><span class="state-badge active" style="font-size:10px;padding:2px 8px;">${stage.label||r.stage_key}</span></td>
            <td data-label="Категория">${r.category||'—'}</td>
            <td data-label="Изделие" style="font-weight:600;">${r.item_name}</td>
            <td data-label="Кол-во" style="font-weight:700;">${r.qty_done} шт</td>
            <td data-label="М²" style="color:var(--primary); font-weight:700;">${area} м²</td>
            <td data-label="Работник">${r.worker||'—'}</td>
            <td data-label="Время" style="font-size:11px; color:var(--text-secondary);">${dt}</td>
        </tr>`;
    }).join('');
}

// ── WORKER PAINT FLOW ──────────────────────────────────────────
// Проверяет, имеет ли воркер доступ к покраске
function workerHasPaintAccess(user) {
    if (!user || !Array.isArray(user.procs)) return false;
    return user.procs.some(p => PAINT_WORKER_TYPES[p]);
}

// Определяет, какие stage_key доступны этому воркеру
function getWorkerPaintStageKeys(user) {
    const allowed = new Set();
    (user.procs || []).forEach(p => {
        (PAINT_WORKER_TYPES[p] || []).forEach(k => allowed.add(k));
    });
    return [...allowed];
}

function showPaintWorkerTerminal() {
    document.querySelectorAll('.page, #page-worker-terminal, #page-login, #page-kanban, #page-paint-worker')
        .forEach(p => p.classList.add('hidden'));
    document.getElementById('page-paint-worker').classList.remove('hidden');
    pwt = { orderId: null, stageKey: null, category: null, itemName: null, qty: 0 };
    showPwtStep('order');
}

function resetPaintWorkerFlow() {
    document.getElementById('page-paint-worker').classList.add('hidden');
    document.getElementById('page-worker-terminal').classList.remove('hidden');
    renderWorkerTasks();
}

function showPwtStep(step) {
    ['order','stage','item','qty'].forEach(s => {
        const el = document.getElementById(`pwt-${s === 'order' ? 'order-list' : s === 'stage' ? 'stage-picker' : s === 'item' ? 'item-picker' : 'qty-input'}`);
        if (el) el.classList.add('hidden');
    });
    const map = { order: 'pwt-order-list', stage: 'pwt-stage-picker', item: 'pwt-item-picker', qty: 'pwt-qty-input' };
    document.getElementById(map[step])?.classList.remove('hidden');
    if (step === 'order') renderPwtOrders();
    if (step === 'stage') renderPwtStages();
    if (step === 'item')  renderPwtItems();
    if (step === 'qty')   renderPwtQty();
}

function renderPwtOrders() {
    const container = document.getElementById('pwt-orders-container');
    if (!container) return;
    const allowedStages = getWorkerPaintStageKeys(curUser);

    // Заказы у которых есть "краска" в пути и есть изделия для покраски
    const paintOrders = orders.filter(o =>
        o.path && o.path.some(p => isPaintProc(p)) &&
        paint_order_items.some(poi => poi.order_id === o.id)
    );

    if (!paintOrders.length) {
        container.innerHTML = '<div class="wt-empty">Нет активных заказов с покраской</div>';
        return;
    }

    container.innerHTML = paintOrders.map(o => {
        const crmData = crm_orders.find(c => c.oid === o.id);
        const items = paint_order_items.filter(i => i.order_id === o.id);
        const doneRecs = paint_records.filter(r => r.order_id === o.id && allowedStages.includes(r.stage_key));
        const myStages = allowedStages.filter(k => {
            // Пропускаем слои, которые не нужны для этого заказа
            const cfg = paint_order_layers[o.id] || { layers: 2, coats: 2 };
            return isStageActive(k, cfg);
        });
        const totalExpected = items.reduce((s,i) => s + i.qty, 0) * myStages.length;
        const doneSoFar     = doneRecs.reduce((s,r) => s + (r.qty_done||0), 0);
        const pct = totalExpected > 0 ? Math.min(100, Math.round(doneSoFar / totalExpected * 100)) : 0;

        return `<div class="wt-task-card" onclick="selectPwtOrder('${esc(o.id)}')">
            <div class="wt-task-main">
                <div class="wt-task-top">
                    <span class="wt-order-num">№ ${o.id}</span>
                </div>
                <div class="wt-task-proc">${crmData?.item || 'Заказ на покраску'}</div>
                <div class="wt-task-item">${items.length} вид изд. · ${items.reduce((s,i)=>s+i.qty,0)} шт</div>
                <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
                    <div style="flex:1;height:4px;background:var(--border-light);border-radius:2px;overflow:hidden;">
                        <div style="width:${pct}%;height:100%;background:var(--primary);"></div>
                    </div>
                    <span style="font-size:11px;font-weight:700;">${pct}%</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

function selectPwtOrder(orderId) {
    pwt.orderId = orderId;
    document.getElementById('pwt-cur-order').innerText = orderId;
    document.getElementById('pwt-subtitle').innerText = `Заказ #${orderId}`;
    showPwtStep('stage');
}

function isStageActive(stageKey, cfg) {
    const layers = cfg?.layers ?? 2;
    const coats  = cfg?.coats  ?? 2;
    if (stageKey === 'шлиф_2' || stageKey === 'грунт_2') return layers >= 2;
    if (stageKey === 'краска_2') return coats >= 2;
    return true;
}

function renderPwtStages() {
    const grid = document.getElementById('pwt-stages-grid');
    if (!grid) return;
    const cfg = paint_order_layers[pwt.orderId] || { layers: 2, coats: 2 };
    const allowedKeys = getWorkerPaintStageKeys(curUser);

    grid.innerHTML = PAINT_STAGES_DEF.filter(s => allowedKeys.includes(s.key)).map(s => {
        const active = isStageActive(s.key, cfg);
        if (!active) {
            return `<div class="paint-stage-btn skipped" title="Этот слой пропускается">${s.label}<br><small>пропущен</small></div>`;
        }
        const recs = paint_records.filter(r => r.order_id === pwt.orderId && r.stage_key === s.key);
        const doneQty = recs.reduce((sum,r) => sum + (r.qty_done||0), 0);
        const totalQty = paint_order_items.filter(i => i.order_id === pwt.orderId).reduce((s,i)=>s+i.qty,0);
        const isDone = doneQty >= totalQty && totalQty > 0;
        return `<div class="paint-stage-btn ${isDone?'done':''}" onclick="selectPwtStage('${s.key}', '${s.label}')">
            ${s.label}
            <div style="font-size:11px; margin-top:4px; font-weight:400; opacity:0.8;">${doneQty}/${totalQty} шт</div>
        </div>`;
    }).join('');
}

function selectPwtStage(key, label) {
    pwt.stageKey = key;
    document.getElementById('pwt-cur-stage-label').innerText = label;
    document.getElementById('pwt-stage-chip').innerText = label;
    showPwtStep('item');
}

function renderPwtItems() {
    const catGrid = document.getElementById('pwt-cat-grid');
    if (!catGrid) return;
    const orderItems = paint_order_items.filter(i => i.order_id === pwt.orderId);
    const categories = [...new Set(orderItems.map(i => i.category))];

    catGrid.innerHTML = categories.map(cat =>
        `<div class="paint-cat-btn ${pwt.category===cat?'selected':''}" onclick="selectPwtCategory('${esc(cat)}')">${cat}</div>`
    ).join('');

    if (pwt.category) renderPwtItemList();
}

function selectPwtCategory(cat) {
    pwt.category = cat;
    pwt.itemName = null;
    document.querySelectorAll('.paint-cat-btn').forEach(b => b.classList.toggle('selected', b.innerText === cat));
    document.getElementById('pwt-items-section').classList.remove('hidden');
    renderPwtItemList();
}

function renderPwtItemList() {
    const list = document.getElementById('pwt-item-list');
    if (!list) return;
    const orderItems = paint_order_items.filter(i => i.order_id === pwt.orderId && i.category === pwt.category);

    list.innerHTML = orderItems.map(oi => {
        const doneForStage = paint_records
            .filter(r => r.order_id === pwt.orderId && r.stage_key === pwt.stageKey && r.item_name === oi.item_name)
            .reduce((s,r) => s+(r.qty_done||0), 0);
        const remaining = oi.qty - doneForStage;
        const remText = remaining <= 0 ? '✔ Готово' : 'Осталось: ' + remaining + ' шт из ' + oi.qty;
        const remClass = remaining <= 0 ? 'paint-item-pick-rem zero' : 'paint-item-pick-rem';
        const remColor = remaining <= 0 ? 'var(--success)' : 'var(--primary)';
        const isSelected = pwt.itemName === oi.item_name ? 'selected' : '';
        return `<div class="paint-item-pick-row ${isSelected}" onclick="selectPwtItem('${esc(oi.item_name)}', ${oi.qty}, ${doneForStage})">
            <div>
                <div class="paint-item-pick-name">${oi.item_name}</div>
                <div class="${remClass}">${remText}</div>
            </div>
            <div style="font-size:22px; font-weight:900; color:${remColor};">${remaining}</div>
        </div>`;
    }).join('');
}

function selectPwtItem(itemName, totalQty, doneQty) {
    pwt.itemName = itemName;
    const remaining = Math.max(0, totalQty - doneQty);
    pwt.qty = remaining;
    pwt._totalQty = totalQty;
    pwt._doneQty  = doneQty;
    showPwtStep('qty');
}

function renderPwtQty() {
    document.getElementById('pwt-item-title').innerText = pwt.itemName;
    const remaining = Math.max(0, pwt._totalQty - pwt._doneQty);
    document.getElementById('pwt-remaining-text').innerText =
        `Осталось: ${remaining} из ${pwt._totalQty} шт`;
    document.getElementById('pwt-qty-val').innerText = pwt.qty;
    document.getElementById('pwt-done-msg').classList.add('hidden');
}

function adjustPaintQty(delta) {
    const remaining = Math.max(0, pwt._totalQty - pwt._doneQty);
    pwt.qty = Math.max(0, Math.min(remaining, pwt.qty + delta));
    document.getElementById('pwt-qty-val').innerText = pwt.qty;
}

async function submitPaintRecord() {
    if (!pwt.qty || pwt.qty < 1) return showToast('Введите количество', 'error');
    const cat = paint_catalog.find(c => c.name === pwt.itemName);
    try {
        await _supabase.from('paint_records').insert({
            order_id:  pwt.orderId,
            stage_key: pwt.stageKey,
            category:  pwt.category,
            item_name: pwt.itemName,
            qty_done:  pwt.qty,
            worker:    curUser.name,
            created_at: new Date().toISOString()
        });

        // Обновляем кеш
        paint_records.unshift({ order_id: pwt.orderId, stage_key: pwt.stageKey, category: pwt.category,
            item_name: pwt.itemName, qty_done: pwt.qty, worker: curUser.name, created_at: new Date().toISOString() });

        const area = cat ? (cat.area_m2 * pwt.qty).toFixed(2) : '?';
        document.getElementById('pwt-done-msg').innerText = `✅ Записано: ${pwt.qty} шт (${area} м²)`;
        document.getElementById('pwt-done-msg').classList.remove('hidden');

        // Проверяем завершён ли заказ (все изделия во всех этапах)
        await checkPaintOrderComplete(pwt.orderId);

        // Сбрасываем qty
        const newDone = pwt._doneQty + pwt.qty;
        pwt._doneQty = newDone;
        pwt.qty = Math.max(0, pwt._totalQty - newDone);
        document.getElementById('pwt-qty-val').innerText = pwt.qty;
        document.getElementById('pwt-remaining-text').innerText =
            `Осталось: ${Math.max(0, pwt._totalQty - newDone)} из ${pwt._totalQty} шт`;

    } catch(e) { showToast('Ошибка записи', 'error'); }
}

async function checkPaintOrderComplete(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order || !order.path || !order.path.some(p => isPaintProc(p))) return false;

    const cfg = paint_order_layers[orderId] || { layers: 2, coats: 2 };
    const activeStages = PAINT_STAGES_DEF.filter(s => isStageActive(s.key, cfg)).map(s => s.key);
    const items = paint_order_items.filter(i => i.order_id === orderId);
    if (!items.length) return false;

    const allDone = activeStages.every(stKey =>
        items.every(oi => {
            const done = paint_records
                .filter(r => r.order_id === orderId && r.stage_key === stKey && r.item_name === oi.item_name)
                .reduce((s, r) => s + (r.qty_done || 0), 0);
            return done >= oi.qty;
        })
    );

    if (allDone) {
        if (!order.history) order.history = {};
        const now = new Date().toISOString();
        // Отмечаем завершение у КАЖДОГО покрасочного процесса, который реально есть в маршруте заказа
        // (раньше отмечался только жёстко зашитый 'краска', и если в маршруте отдельно стояли
        // "Шлиповка"/"Грунтовка" — они навсегда оставались "ожидает" в Мониторинге/CRM/Дашборде)
        let changed = false;
        order.path.filter(p => isPaintProc(p)).forEach(procName => {
            if (!order.history[procName]) order.history[procName] = {};
            if (!order.history[procName].end) {
                if (!order.history[procName].start) {
                    order.history[procName].start = now;
                    order.history[procName].worker = curUser.name;
                }
                order.history[procName].end = now;
                order.history[procName].completed_by = curUser.name;
                changed = true;
            }
        });
        if (changed) {
            await _supabase.from('orders').upsert(order);
            const idx = orders.findIndex(o => o.id === orderId);
            if (idx !== -1) orders[idx] = order;
            renderWorkerTasks();
        }
        return true;
    }
    return false;
}


const PAINT_PROC_NAMES = ['краска', 'шлиповка', 'грунтовка', 'Краска', 'Шлиповка', 'Грунтовка'];
function isPaintProc(procName) {
    return PAINT_PROC_NAMES.some(p => p.toLowerCase() === (procName || '').toLowerCase());
}

// ── INLINE СБОРКА (встроен в worker-action-card) ────────────────
// Даёт работнику с доступом к процессу "Сборка" урезанный интерфейс: выбрать изделие из
// рецепта, указать количество и нажать "Собрать". Всё остальное (создание рецептов, отгрузка,
// удаление) доступно только администратору на странице Склад.
function isAssemblyProc(procName) {
    return (procName || '').trim().toLowerCase() === 'сборка';
}

let asm = { orderId: null, category: null, itemId: null, qty: 1 };
let _assemblyDataLoaded = false;

// Заготовки/готовые изделия/рецепты/справочник работ обычно грузятся только на админской
// странице Склад — работнику они не видны, поэтому подгружаем их отдельно по требованию.
async function ensureAssemblyDataLoaded() {
    if (_assemblyDataLoaded) return;
    try {
        const [biRes, fiRes, frRes, lcRes] = await Promise.all([
            _supabase.from('blank_items').select('*').order('category'),
            _supabase.from('finished_items').select('*').order('category'),
            _supabase.from('finished_recipe').select('*'),
            _supabase.from('labor_catalog').select('*')
        ]);
        if (!biRes.error) blank_items = biRes.data || [];
        if (!fiRes.error) finished_items = fiRes.data || [];
        if (!frRes.error) finished_recipe = frRes.data || [];
        if (!lcRes.error) labor_catalog = lcRes.data || [];
        _assemblyDataLoaded = true;
    } catch(e) { console.error('Assembly data load error:', e); }
}

function showInlineAssembly(orderId) {
    asm = { orderId, category: null, itemId: null, qty: 1 };
    document.getElementById('worker-controls')?.classList.add('hidden');
    document.getElementById('paint-inline-section')?.classList.add('hidden');
    document.getElementById('assembly-inline-section')?.classList.remove('hidden');
    document.getElementById('assembly-item-picker')?.classList.remove('hidden');
    document.getElementById('assembly-qty-wrap')?.classList.add('hidden');
    document.getElementById('assembly-done-msg')?.classList.add('hidden');
    const t = document.querySelector('.wt-manual-toggle');
    if (t) t.style.display = 'none';
    ensureAssemblyDataLoaded().then(renderAssemblyCatGrid);
}

function hideInlineAssembly() {
    document.getElementById('assembly-inline-section')?.classList.add('hidden');
    document.getElementById('worker-controls')?.classList.remove('hidden');
    const t = document.querySelector('.wt-manual-toggle');
    if (t) t.style.display = '';
}

// Только изделия, для которых администратор уже настроил рецепт (иначе собрать нечего)
function assemblableItems() {
    return finished_items.filter(i => finished_recipe.some(r => r.finished_item_id === i.id));
}

function renderAssemblyCatGrid() {
    const grid = document.getElementById('assembly-cat-grid');
    if (!grid) return;
    const items = assemblableItems();
    const categories = [...new Set(items.map(i => i.category || 'Без категории'))];
    if (!categories.length) {
        grid.innerHTML = '<div style="color:var(--text-muted); font-size:13px; padding:10px;">Нет изделий с настроенным рецептом. Обратитесь к администратору.</div>';
        document.getElementById('assembly-items-section')?.classList.add('hidden');
        return;
    }
    grid.innerHTML = categories.map(cat =>
        `<div class="paint-cat-btn ${asm.category===cat?'selected':''}" onclick="selectAssemblyCategory('${esc(cat)}')">${cat}</div>`
    ).join('');
    if (asm.category) { document.getElementById('assembly-items-section')?.classList.remove('hidden'); renderAssemblyItemList(); }
}

function selectAssemblyCategory(cat) {
    asm.category = cat;
    asm.itemId = null;
    document.querySelectorAll('#assembly-cat-grid .paint-cat-btn').forEach(b => b.classList.toggle('selected', b.innerText === cat));
    document.getElementById('assembly-items-section')?.classList.remove('hidden');
    renderAssemblyItemList();
}

function renderAssemblyItemList() {
    const list = document.getElementById('assembly-item-list');
    if (!list) return;
    const items = assemblableItems().filter(i => (i.category || 'Без категории') === asm.category);
    list.innerHTML = items.map(i => {
        const recipe = finished_recipe.filter(r => r.finished_item_id === i.id);
        const isSel = asm.itemId === i.id;
        return `<div class="paint-item-pick-row ${isSel?'selected':''}" onclick="selectAssemblyItem(${i.id})">
            <div>
                <div class="paint-item-pick-name">${i.name}</div>
                <div class="paint-item-pick-rem">${recipe.length} компонент${recipe.length===1?'':'ов'} · на складе: ${i.qty_in_stock||0} ${i.unit||'шт'}</div>
            </div>
        </div>`;
    }).join('');
}

function selectAssemblyItem(itemId) {
    asm.itemId = itemId;
    asm.qty = 1;
    document.getElementById('assembly-item-picker')?.classList.add('hidden');
    document.getElementById('assembly-qty-wrap')?.classList.remove('hidden');

    const item = finished_items.find(i => i.id === itemId);
    const recipe = finished_recipe.filter(r => r.finished_item_id === itemId);
    document.getElementById('assembly-item-title').innerText = item ? item.name : '';
    document.getElementById('assembly-recipe-preview').innerHTML = recipe.map(r =>
        `<div style="display:flex; justify-content:space-between; padding:4px 0; font-size:12px; border-bottom:1px dashed var(--border-light);"><span>${r.blank_item_name}</span><b>× ${r.qty_per_unit}</b></div>`
    ).join('');
    document.getElementById('assembly-qty-val').innerText = asm.qty;
    document.getElementById('assembly-done-msg')?.classList.add('hidden');
    updateAssemblyShortageWarning();
}

function backToAssemblyItems() {
    document.getElementById('assembly-qty-wrap')?.classList.add('hidden');
    document.getElementById('assembly-item-picker')?.classList.remove('hidden');
}

function adjustAssemblyQty(delta) {
    asm.qty = Math.max(1, asm.qty + delta);
    document.getElementById('assembly-qty-val').innerText = asm.qty;
    updateAssemblyShortageWarning();
}

function updateAssemblyShortageWarning() {
    const warnEl = document.getElementById('assembly-shortage-warning');
    if (!warnEl) return;
    const recipe = finished_recipe.filter(r => r.finished_item_id === asm.itemId);
    const shortages = [];
    recipe.forEach(r => {
        const blank = blank_items.find(b => b.id === r.blank_item_id);
        const needed = r.qty_per_unit * asm.qty;
        if (!blank || blank.qty_in_stock < needed) {
            shortages.push(`${r.blank_item_name}: нужно ${needed}, есть ${blank?.qty_in_stock || 0}`);
        }
    });
    if (shortages.length) {
        warnEl.innerHTML = '⚠️ Не хватает на складе:<br>' + shortages.join('<br>');
        warnEl.classList.remove('hidden');
    } else {
        warnEl.classList.add('hidden');
    }
}

async function submitInlineAssembly() {
    const item = finished_items.find(i => i.id === asm.itemId);
    if (!item) return showToast('Выберите изделие', 'error');
    const recipe = finished_recipe.filter(r => r.finished_item_id === asm.itemId);
    if (!recipe.length) return showToast('У изделия нет рецепта', 'error');
    const qty = asm.qty;
    const order = orders.find(o => o.id === asm.orderId);
    if (!order) return showToast('Заказ не найден', 'error');

    try {
        // Списываем заготовки со склада по рецепту
        for (const r of recipe) {
            const blank = blank_items.find(b => b.id === r.blank_item_id);
            if (blank) await logBlankMovement(blank.id, blankDisplayName(blank), 'out', r.qty_per_unit * qty, `Сборка: ${item.name} × ${qty} (заказ #${asm.orderId})`);
        }
        // Приходуем готовое изделие на склад
        await logFinishedMovement(item.id, item.name, 'in', qty, `Собрано по заказу #${asm.orderId}`, null, null);

        // Отмечаем процесс "Сборка" этого заказа завершённым от имени работника — дальше это
        // автоматически подхватывается общей системой учёта (Персонал / Моя статистика / Kanban / Мониторинг)
        if (!order.history) order.history = {};
        if (!order.history['Сборка']) order.history['Сборка'] = {};
        const now = new Date().toISOString();
        if (!order.history['Сборка'].start) {
            order.history['Сборка'].start = now;
            order.history['Сборка'].worker = curUser.name;
        }
        order.history['Сборка'].end = now;
        order.history['Сборка'].completed_by = curUser.name;
        order.history['Сборка'].qty_done = qty;
        order.history['Сборка'].unit = 'шт';
        order.history['Сборка'].assembled_item = item.name;
        await _supabase.from('orders').upsert(order);

        // Если в справочнике работ есть расценка на сборку — начисляем сумму работнику
        // (появится в его статистике вместе с обычными строками "Работа/монтаж" из калькуляции)
        const laborRate = labor_catalog.find(lc => (lc.name||'').toLowerCase().includes('сборк') || (lc.category||'').toLowerCase().includes('сборк'));
        if (laborRate) {
            await _supabase.from('order_labor').insert({
                order_id: asm.orderId, description: `Сборка: ${item.name}`, qty,
                unit_price: laborRate.price_ours || 0, worker: curUser.name, created_at: now
            });
            all_order_labor.push({ order_id: asm.orderId, description: `Сборка: ${item.name}`, qty, unit_price: laborRate.price_ours || 0, worker: curUser.name, created_at: now });
        }

        await logActivity(curUser.name, 'Собрал изделие', `Заказ #${asm.orderId}, ${item.name} × ${qty}`, 'process');

        const doneEl = document.getElementById('assembly-done-msg');
        if (doneEl) { doneEl.innerHTML = `✅ Собрано: ${item.name} × ${qty}`; doneEl.classList.remove('hidden'); }
        showToast(`✔ Собрано: ${item.name} × ${qty}`);

        await loadAllData();
        setTimeout(() => resetWorkerFlow(), 1800);
    } catch(e) {
        console.error(e);
        showToast('Ошибка при сборке', 'error');
    }
}

// ── INLINE PAINT (встроен в worker-action-card) ────────────────

let ipt = { orderId:null, stageKey:null, stageLabel:null, itemName:null, qty:0, totalQty:0, doneQty:0 };

function showInlinePaint(orderId) {
    ipt = { orderId, stageKey:null, stageLabel:null, itemName:null, qty:0, totalQty:0, doneQty:0 };
    var wc = document.getElementById('worker-controls');
    if (wc) wc.classList.add('hidden');
    var pis = document.getElementById('paint-inline-section');
    if (pis) pis.classList.remove('hidden');
    document.getElementById('paint-stage-selected')?.classList.add('hidden');
    document.getElementById('paint-inline-qty-wrap')?.classList.add('hidden');
    document.getElementById('paint-inline-done')?.classList.add('hidden');
    const t = document.querySelector('.wt-manual-toggle');
    if (t) t.style.display = 'none';
    if (!paint_catalog.length || !paint_order_items.length) {
        loadPaintData().then(() => renderInlinePaintStages(orderId));
    } else {
        renderInlinePaintStages(orderId);
    }
}

function hideInlinePaint() {
    var pis2 = document.getElementById('paint-inline-section');
    if (pis2) pis2.classList.add('hidden');
    var wc2 = document.getElementById('worker-controls');
    if (wc2) wc2.classList.remove('hidden');
    const t = document.querySelector('.wt-manual-toggle');
    if (t) t.style.display = '';
}

function stageDone(orderId, stageKey) {
    return paint_records
        .filter(r => r.order_id === orderId && r.stage_key === stageKey)
        .reduce((s, r) => s + (r.qty_done || 0), 0);
}

function renderInlinePaintStages(orderId) {
    const cfg     = paint_order_layers[orderId] || { layers:2, coats:2 };
    const myKeys  = getWorkerPaintStageKeys(curUser);
    const el      = document.getElementById('paint-inline-stages');
    if (!el) return;
    const items        = paint_order_items.filter(i => i.order_id === orderId);
    const totalPerStage = items.reduce((s, i) => s + i.qty, 0);
    const myStages     = PAINT_STAGES_DEF.filter(s => myKeys.includes(s.key) && isStageActive(s.key, cfg));

    if (!myStages.length) {
        el.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">Нет этапов для вашего типа работы</div>';
        return;
    }

    const draw = () => {
        el.innerHTML = myStages.map(s => {
            const done   = stageDone(orderId, s.key);
            const pct    = totalPerStage > 0 ? Math.min(100, Math.round(done/totalPerStage*100)) : 0;
            const isDone = done >= totalPerStage && totalPerStage > 0;
            const act    = s.key === ipt.stageKey;
            const bord   = act ? 'var(--primary)' : isDone ? '#16a34a' : '#e2e8f0';
            const bg     = act ? '#eef2ff' : isDone ? '#ecfdf5' : '#fff';
            const col    = act ? 'var(--primary)' : isDone ? '#16a34a' : '#64748b';
            return `<div onclick="selectInlineStage('${s.key}','${s.label}')" style="cursor:pointer;text-align:center;min-width:74px;padding:9px 7px;border-radius:11px;border:2px solid ${bord};background:${bg};transition:0.15s;flex:1;">
                <div style="font-size:11px;font-weight:800;color:${col};">${s.label}</div>
                <div style="height:4px;background:var(--border-light);border-radius:2px;margin:5px 0;overflow:hidden;">
                    <div style="width:${pct}%;height:100%;background:${isDone?'#16a34a':'var(--primary)'};"></div>
                </div>
                <div style="font-size:10px;font-weight:700;color:${isDone?'#16a34a':'#94a3b8'};">${done}/${totalPerStage} шт</div>
            </div>`;
        }).join('');
    };
    draw();
    window._refreshInlineStageChips = draw;

    if (!ipt.stageKey) {
        const next = myStages.find(s => stageDone(orderId, s.key) < totalPerStage);
        if (next) selectInlineStage(next.key, next.label);
        else {
            const cur = document.getElementById('paint-inline-cur-stage');
            if (cur) { cur.innerText = '✅ Все этапы завершены!'; }
            document.getElementById('paint-stage-selected')?.classList.remove('hidden');
        }
    }
}

function selectInlineStage(key, label) {
    ipt.stageKey   = key;
    ipt.stageLabel = label;
    ipt.itemName   = null;
    const cur = document.getElementById('paint-inline-cur-stage');
    if (cur) cur.innerText = '🎨 ' + label;
    document.getElementById('paint-stage-selected')?.classList.remove('hidden');
    document.getElementById('paint-inline-qty-wrap')?.classList.add('hidden');
    document.getElementById('paint-inline-done')?.classList.add('hidden');
    if (window._refreshInlineStageChips) window._refreshInlineStageChips();
    renderInlineAllItems();
}

function renderInlineAllItems() {
    const el = document.getElementById('paint-inline-items-all');
    if (!el) return;
    const orderItems    = paint_order_items.filter(i => i.order_id === ipt.orderId);
    const totalAll      = orderItems.reduce((s, i) => s + i.qty, 0);
    const doneAll       = stageDone(ipt.orderId, ipt.stageKey);
    const pctAll        = totalAll > 0 ? Math.round(doneAll/totalAll*100) : 0;
    const progEl        = document.getElementById('paint-stage-progress-text');
    if (progEl) progEl.innerHTML = `<b>${doneAll}</b> / ${totalAll} шт<br><span style="color:${pctAll===100?'var(--success)':'var(--primary)'};font-weight:800;">${pctAll}%</span>`;

    if (!orderItems.length) {
        el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:10px;">Изделия для заказа не добавлены</div>';
        return;
    }
    el.innerHTML = orderItems.map(oi => {
        const done      = paint_records
            .filter(r => r.order_id===ipt.orderId && r.stage_key===ipt.stageKey && r.item_name===oi.item_name)
            .reduce((s,r) => s+(r.qty_done||0), 0);
        const rem  = Math.max(0, oi.qty - done);
        const pct  = oi.qty > 0 ? Math.min(100, Math.round(done/oi.qty*100)) : 0;
        const isDone = rem === 0;
        const isSel  = oi.item_name === ipt.itemName;
        const cat    = paint_catalog.find(c => c.name === oi.item_name);
        return `<div onclick="${isDone ? '' : `selectInlineItem('${esc(oi.item_name)}',${oi.qty},${done})`}"
            style="border:2px solid ${isSel?'var(--primary)':isDone?'#16a34a':'#e2e8f0'};
                   background:${isSel?'#eef2ff':isDone?'#f0fdf4':'#fff'};
                   border-radius:12px;padding:14px;cursor:${isDone?'default':'pointer'};transition:0.15s;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <div>
                    <div style="font-weight:800;font-size:14px;">${oi.item_name}</div>
                    <div style="font-size:11px;color:var(--text-secondary);">${oi.category}${cat?' · '+cat.area_m2+' м²/шт':''}</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:22px;font-weight:900;color:${isDone?'#16a34a':'var(--primary)'};">${rem}</div>
                    <div style="font-size:10px;color:var(--text-muted);">осталось</div>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <div style="flex:1;height:6px;background:var(--border-light);border-radius:3px;overflow:hidden;">
                    <div style="width:${pct}%;height:100%;background:${isDone?'#16a34a':'var(--primary)'};"></div>
                </div>
                <span style="font-size:11px;font-weight:700;min-width:56px;text-align:right;color:${isDone?'#16a34a':'#64748b'};">
                    ${isDone ? '✔ Готово' : done+'/'+oi.qty+' шт'}
                </span>
            </div>
        </div>`;
    }).join('');
}

function selectInlineItem(itemName, totalQty, doneQty) {
    ipt.itemName = itemName;
    ipt.totalQty = totalQty;
    ipt.doneQty  = doneQty;
    ipt.qty      = Math.max(0, totalQty - doneQty);
    renderInlineAllItems();
    const rem  = Math.max(0, totalQty - doneQty);
    const pct  = totalQty > 0 ? Math.round(doneQty/totalQty*100) : 0;
    document.getElementById('paint-inline-qty-wrap')?.classList.remove('hidden');
    document.getElementById('paint-inline-item-label').innerText = itemName + ' — ' + ipt.stageLabel;
    document.getElementById('paint-inline-rem-label').innerText  = 'Нужно: '+totalQty+' шт  |  Сделано: '+doneQty+'  |  Осталось: '+rem;
    const bar = document.getElementById('paint-inline-prog-bar');
    if (bar) bar.style.width = pct+'%';
    document.getElementById('paint-inline-qty').innerText = ipt.qty;
    document.getElementById('paint-inline-done')?.classList.add('hidden');
}

function adjustInlineQty(delta) {
    const rem = Math.max(0, ipt.totalQty - ipt.doneQty);
    ipt.qty   = Math.max(0, Math.min(rem, ipt.qty + delta));
    document.getElementById('paint-inline-qty').innerText = ipt.qty;
}

async function submitInlinePaint() {
    if (ipt.qty < 1) return showToast('Введите количество больше 0', 'error');
    try {
        const cat = paint_order_items.find(i => i.item_name === ipt.itemName);
        const rec = { order_id:ipt.orderId, stage_key:ipt.stageKey, category:cat?.category||'',
            item_name:ipt.itemName, qty_done:ipt.qty, worker:curUser.name, created_at:new Date().toISOString() };
        await _supabase.from('paint_records').insert(rec);
        paint_records.push(rec);
        const catData = paint_catalog.find(c => c.name === ipt.itemName);
        const area    = catData ? (catData.area_m2*ipt.qty).toFixed(2) : '?';
        const doneEl  = document.getElementById('paint-inline-done');
        if (doneEl) { doneEl.innerHTML = '✅ Записано: '+ipt.qty+' шт ('+area+' м²)'; doneEl.classList.remove('hidden'); }
        ipt.doneQty += ipt.qty;
        const newRem = Math.max(0, ipt.totalQty - ipt.doneQty);
        ipt.qty = newRem;
        document.getElementById('paint-inline-qty').innerText = newRem;
        document.getElementById('paint-inline-rem-label').innerText = 'Нужно: '+ipt.totalQty+' шт  |  Сделано: '+ipt.doneQty+'  |  Осталось: '+newRem;
        const pct = ipt.totalQty > 0 ? Math.round(ipt.doneQty/ipt.totalQty*100) : 0;
        const bar = document.getElementById('paint-inline-prog-bar');
        if (bar) bar.style.width = pct+'%';
        renderInlineAllItems();
        if (window._refreshInlineStageChips) window._refreshInlineStageChips();
        const allDone = await checkPaintOrderComplete(ipt.orderId);
        if (allDone) { if(doneEl) doneEl.innerHTML='🎉 Покраска заказа #'+ipt.orderId+' завершена!'; setTimeout(()=>resetWorkerFlow(),2500); }
    } catch(e) { showToast('Ошибка записи','error'); console.error(e); }
}

// ── PAINT SUB-NAV ─────────────────────────────────────────────
function showPaintSection(name) {
    document.querySelectorAll('.paint-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.paint-subnav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('paint-sec-' + name)?.classList.add('active');
    document.querySelectorAll('.paint-subnav-btn').forEach(b => {
        if (b.textContent.toLowerCase().includes(
            name === 'analytics' ? 'аналитик' : name === 'settings' ? 'настройк' : 'журнал'
        )) b.classList.add('active');
    });
    if (name === 'analytics') renderPaintOrdersStatus();
    if (name === 'journal')   renderPaintLog();
    if (name === 'settings')  { renderPaintCatalog(); }
}

// ── PRODUCTION PAGE: paint block toggle ───────────────────────
function updateOrderCodePreview() {
    const id = document.getElementById('adm-o-id')?.value.trim() || '';
    const checked = Array.from(document.querySelectorAll('#adm-o-grid input:checked')).map(cb => cb.value);
    const box = document.getElementById('order-code-preview');
    const list = document.getElementById('order-code-preview-list');
    if (!box || !list) return;

    if (!id || checked.length === 0) {
        box.classList.add('hidden');
        list.innerHTML = '';
    } else {
        list.innerHTML = checked.map((p, i) =>
            `<div class="wt-code-preview-item"><span class="wt-code-chip">${id}-${pad2(i + 1)}</span><span>${p}</span></div>`
        ).join('');
        box.classList.remove('hidden');
    }

    // Показываем блок краски если чекбокс "краска" отмечен
    const hasPaint = checked.some(p => isPaintProc(p));
    const paintBlock = document.getElementById('prod-paint-block');
    if (paintBlock) {
        paintBlock.classList.toggle('hidden', !hasPaint);
        if (hasPaint) updateProdPaintSelects();
    }
}

// Показывает/скрывает строку количество + работник для каждого процесса в production grid
function toggleProdProc(checkbox, idx) {
    var card = checkbox.closest('.item-card');
    if (!card) return;
    var existingRow = document.getElementById('proc' + idx + '-row');
    if (checkbox.checked) {
        if (existingRow) { existingRow.style.display = 'flex'; return; }
        var p = PROCS[idx];
        var row = document.createElement('div');
        row.id = 'proc' + idx + '-row';
        row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px;padding-top:6px;border-top:1px dashed #e2e8f0;';
        row.innerHTML = '<input type="number" value="1" min="1" id="proc' + idx + '-qty" oninput="updateOrderCodePreview()" style="width:56px;padding:5px 4px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;font-weight:700;text-align:center;">'
            + '<span style="font-size:11px;font-weight:600;color:#64748b;">шт</span>'
            + '<select id="proc' + idx + '-worker" onchange="updateOrderCodePreview()" style="flex:1;padding:5px 4px;border:1px solid #e2e8f0;border-radius:8px;font-size:11px;"><option value="">— работник —</option></select>';
        card.appendChild(row);
        populateProdWorkerSelects();
    } else {
        if (existingRow) existingRow.style.display = 'none';
    }
    updateOrderCodePreview();
}

// Заполняет селекты работников в production grid
function populateProdWorkerSelects() {
    workers.forEach(function(w) {
        document.querySelectorAll('select[id^="proc"][id$="-worker"]').forEach(function(sel) {
            if (sel.value === w.name) return;
            var opt = document.createElement('option');
            opt.value = w.name;
            opt.innerText = w.name;
            sel.appendChild(opt);
        });
    });
}

// Заполняет категории в блоке краски производства
function updateProdPaintSelects() {
    const catSel = document.getElementById('prod-poi-category');
    if (!catSel) return;
    const categories = [...new Set(paint_catalog.map(i => i.category))];
    catSel.innerHTML = '<option value="">Выберите категорию...</option>' +
        categories.map(c => `<option value="${c}">${c}</option>`).join('');
    document.getElementById('prod-poi-item').innerHTML = '<option value="">Выберите изделие...</option>';
}

// БАГ-ФИКС: эта функция вызывалась кнопкой "Добавить в каталог" в блоке краски
// на странице Производство, но нигде не была определена — кнопка не работала.
async function addProdCatalogItem() {
    const category = document.getElementById('prod-pc-category')?.value.trim();
    const name     = document.getElementById('prod-pc-name')?.value.trim();
    const area_m2  = parseFloat(document.getElementById('prod-pc-area')?.value) || 0;
    if (!category || !name) return showToast('Заполните категорию и название', 'error');

    try {
        const { data, error } = await _supabase.from('paint_catalog').insert({ category, name, area_m2 }).select();
        if (error) return showToast('Ошибка: ' + error.message, 'error');

        if (data && data[0]) paint_catalog.push(data[0]);
        else paint_catalog.push({ id: Date.now(), category, name, area_m2 });

        ['prod-pc-category','prod-pc-name','prod-pc-area'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        updateProdPaintSelects();
        showToast('Изделие добавлено в каталог: ' + name);
    } catch(e) {
        console.error('addProdCatalogItem error:', e);
        showToast('Ошибка сети', 'error');
    }
}

function updateProdPaintItemSelect() {
    const cat = document.getElementById('prod-poi-category').value;
    const sel = document.getElementById('prod-poi-item');
    const items = paint_catalog.filter(i => i.category === cat);
    sel.innerHTML = '<option value="">Выберите изделие...</option>' +
        items.map(i => `<option value="${i.name}">${i.name} (${i.area_m2} м²/шт)</option>`).join('');
}

// Временный список изделий для нового заказа (до нажатия «Запустить»)
let prodPaintItems = [];

function addProdPaintItem() {
    const orderId  = document.getElementById('adm-o-id')?.value.trim();
    const category = document.getElementById('prod-poi-category').value;
    const itemName = document.getElementById('prod-poi-item').value;
    const qty      = parseInt(document.getElementById('prod-poi-qty').value) || 0;
    if (!category || !itemName || qty < 1) return showToast('Заполните категорию, изделие и кол-во', 'error');

    // Проверяем, нет ли уже такого изделия
    const existing = prodPaintItems.find(i => i.category === category && i.item_name === itemName);
    if (existing) { existing.qty += qty; }
    else { prodPaintItems.push({ category, item_name: itemName, qty }); }

    document.getElementById('prod-poi-qty').value = '';
    renderProdPaintItems();
}

function removeProdPaintItem(idx) {
    prodPaintItems.splice(idx, 1);
    renderProdPaintItems();
}

function renderProdPaintItems() {
    const list  = document.getElementById('prod-paint-items-list');
    const total = document.getElementById('prod-paint-total');
    if (!list) return;

    if (!prodPaintItems.length) { list.innerHTML = ''; total.innerHTML = ''; return; }

    let totalArea = 0;
    list.innerHTML = prodPaintItems.map((item, idx) => {
        const cat = paint_catalog.find(c => c.name === item.item_name);
        const area = cat ? cat.area_m2 * item.qty : 0;
        totalArea += area;
        return `<div class="paint-item-row" style="background:#fff;">
            <div>
                <div style="font-weight:700;">${item.item_name}</div>
                <div style="font-size:12px; color:var(--text-secondary);">${item.category} · ${item.qty} шт · ${area.toFixed(2)} м²</div>
            </div>
            <button class="btn-red" style="padding:4px 10px; font-size:12px;" onclick="removeProdPaintItem(${idx})">✖</button>
        </div>`;
    }).join('');

    total.innerHTML = `Итого: <b>${prodPaintItems.length}</b> вид изделий · <b>${prodPaintItems.reduce((s,i)=>s+i.qty,0)}</b> шт · <b>${totalArea.toFixed(2)} м²</b>`;
}

// ── ANALYTICS: orders status ──────────────────────────────────
function renderPaintOrdersStatus() {
    const el = document.getElementById('paint-orders-status');
    if (!el) return;

    const paintOrders = orders.filter(o =>
        o.path && o.path.some(p => isPaintProc(p)) &&
        paint_order_items.some(poi => poi.order_id === o.id)
    );

    if (!paintOrders.length) {
        el.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:20px; font-size:13px;">Нет заказов с покраской в производстве</div>';
        return;
    }

    el.innerHTML = paintOrders.map(o => {
        const crmData = crm_orders.find(c => c.oid === o.id);
        const cfg = paint_order_layers[o.id] || { layers: 2, coats: 2 };
        const activeStages = PAINT_STAGES_DEF.filter(s => isStageActive(s.key, cfg));
        const items = paint_order_items.filter(i => i.order_id === o.id);
        const totalQtyPerStage = items.reduce((s,i)=>s+i.qty, 0);

        const stagesHtml = activeStages.map(s => {
            const done = paint_records
                .filter(r => r.order_id === o.id && r.stage_key === s.key)
                .reduce((sum,r) => sum+(r.qty_done||0), 0);
            const pct = totalQtyPerStage > 0 ? Math.min(100, Math.round(done/totalQtyPerStage*100)) : 0;
            const isDone = pct >= 100;
            return `<div style="text-align:center; min-width:70px;">
                <div style="font-size:10px; font-weight:700; color:${isDone?'#16a34a':'#64748b'}; margin-bottom:3px;">${s.label}</div>
                <div style="height:5px; background:var(--border-light); border-radius:3px; overflow:hidden;">
                    <div style="width:${pct}%; height:100%; background:${isDone?'#16a34a':'var(--primary)'};"></div>
                </div>
                <div style="font-size:10px; margin-top:2px; font-weight:700;">${done}/${totalQtyPerStage}</div>
            </div>`;
        }).join('');

        const allArea = (() => {
            let a = 0;
            items.forEach(i => {
                const cat = paint_catalog.find(c => c.name === i.item_name);
                if (cat) a += cat.area_m2 * i.qty;
            });
            return a.toFixed(2);
        })();

        return `<div class="card" style="margin-bottom:10px; padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
                <div>
                    <span style="font-size:18px; font-weight:900; color:var(--primary);">№ ${o.id}</span>
                    ${crmData ? `<span style="font-size:13px; color:var(--text-secondary); margin-left:10px;">${crmData.client} · ${crmData.item||''}</span>` : ''}
                </div>
                <div style="font-size:12px; color:var(--text-secondary);">${items.length} вид · ${totalQtyPerStage} шт · ${allArea} м²</div>
            </div>
            <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">${stagesHtml}</div>
        </div>`;
    }).join('');
}

// ── PAINT PAGE SHOW ────────────────────────────────────────────
// Вызывается при переходе на страницу краски
function showPaintPage() {
    showPage('page-paint');
    showPaintSection('analytics');
    loadPaintData();
}

// ═══════════════════════════════════════════════════════
// SERVICES MODULE — Услуги
// ═══════════════════════════════════════════════════════
let svc_clients      = [];
let svc_transactions = [];
let svc_prices       = [];
let _svcModalClientId = null;

function showServicesPage() { showPage('page-services'); loadServicesData(); }

async function loadServicesData() {
    try {
        const [clRes, txRes, prRes] = await Promise.all([
            _supabase.from('svc_clients').select('*').order('name'),
            _supabase.from('svc_transactions').select('*').order('created_at', { ascending: false }),
            _supabase.from('svc_prices').select('*').order('service_type')
        ]);
        if (clRes.error || txRes.error || prRes.error) {
            // Обрабатываем каждую таблицу независимо
            if (!clRes.error) svc_clients = clRes.data || [];
            else console.warn('svc_clients load error:', clRes.error.message);
            if (!txRes.error) svc_transactions = txRes.data || [];
            else console.warn('svc_transactions load error:', txRes.error.message);
            if (!prRes.error) svc_prices = prRes.data || [];
            else console.warn('svc_prices load error:', prRes.error.message);
            if (!svc_clients.length && !svc_transactions.length) {
                const e = clRes.error || txRes.error;
                showToast('Ошибка загрузки: ' + (e ? e.message : 'нет данных'), 'error');
            }
            renderSvcClients(); renderSvcOperations(); renderSvcPrices(); updateSvcSelects();
            return;
        }
        svc_clients = clRes.data || []; svc_transactions = txRes.data || []; svc_prices = prRes.data || [];
        renderSvcClients(); renderSvcOperations(); renderSvcPrices(); updateSvcSelects();
    } catch(e) { console.error('SVC error:', e); }
}

function showSvcSection(name) {
    document.querySelectorAll('.svc-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.svc-subnav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('svc-sec-' + name)?.classList.add('active');
    const map = { clients:'клиент', operations:'операц', prices:'справоч', analytics:'аналитик' };
    document.querySelectorAll('.svc-subnav-btn').forEach(b => {
        if (b.textContent.toLowerCase().includes(map[name] || name)) b.classList.add('active');
    });
    if (name === 'analytics')  renderSvcAnalytics();
    if (name === 'operations') { updateSvcSelects(); renderSvcOperations(); autoFillSvcOrderNumber(); }
    if (name === 'clients')    renderSvcClients();
}

function updateSvcSelects() {
    ['svc-op-client','svc-filter-client'].forEach(id => {
        const el = document.getElementById(id); if (!el) return;
        const first = id === 'svc-filter-client' ? '<option value="">Все клиенты</option>' : '<option value="">Выберите клиента...</option>';
        el.innerHTML = first + svc_clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    });
    const dateEl = document.getElementById('svc-op-date');
    if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0,10);
    const mEl = document.getElementById('svc-analytics-month');
    if (mEl && !mEl.value) mEl.value = new Date().toISOString().slice(0,7);
    const wDisp = document.getElementById('svc-op-worker-display');
    if (wDisp && curUser) wDisp.innerText = curUser.name;
    if (!svcRows.length) svcRows.push({ service:'', material:'ours', qty:1, price:0 });
    renderSvcRows();
    renderSvcOrderSummary();
}

function updateSvcCRMOrders() {
    const list = document.getElementById('svc-op-crm-order-list');
    if (!list) return;
    const clientId = document.getElementById('svc-op-client')?.value;
    // Показываем сначала заказы уже привязанные к этому клиенту, потом остальные
    const sorted = [...crm_orders].sort((a, b) => {
        const aLinked = clientId && a.svc_client_id == clientId;
        const bLinked = clientId && b.svc_client_id == clientId;
        if (aLinked && !bLinked) return -1;
        if (!aLinked && bLinked) return 1;
        return 0;
    });
    list.innerHTML = sorted.map(c => `<option value="${c.oid}">#${c.oid} — ${c.client||''} (${c.item||''})</option>`).join('');
}

// ── МНОГОСТРОЧНЫЙ КОНСТРУКТОР ОПЕРАЦИИ ────────────────────
let svcRows = [{ service:'', material:'ours', qty:1, price:0 }];

function svcServiceOptionsList() {
    return [...new Set([...svc_prices.map(p => p.service_type), ...PROCS])].sort();
}

function renderSvcRows() {
    const tbody = document.getElementById('svc-order-rows');
    if (!tbody) return;
    const services = svcServiceOptionsList();

    tbody.innerHTML = svcRows.map((row, idx) => {
        const sum = (row.qty||0) * (row.price||0);
        const options = '<option value="">Выберите...</option>' +
            services.map(s => `<option value="${s}" ${s===row.service?'selected':''}>${s}</option>`).join('');
        return `<tr>
            <td><select onchange="updateSvcRow(${idx},'service',this.value)" style="min-width:160px;">${options}</select></td>
            <td>
                <div class="svc-mat-toggle">
                    <button class="${row.material==='ours'?'active ours':''}" onclick="updateSvcRow(${idx},'material','ours')">📦 НАШ</button>
                    <button class="${row.material==='client'?'active client':''}" onclick="updateSvcRow(${idx},'material','client')">🧑 КЛИЕНТ</button>
                </div>
            </td>
            <td><input type="number" value="${row.qty}" step="0.01" min="0" style="width:70px;" onchange="updateSvcRow(${idx},'qty',this.value)"></td>
            <td><input type="number" value="${row.price}" step="0.01" min="0" style="width:90px;" onchange="updateSvcRow(${idx},'price',this.value)"></td>
            <td class="svc-row-sum">${formatMoney(sum)}</td>
            <td><button class="btn-red" style="padding:4px 8px; font-size:11px;" onclick="removeSvcRowLine(${idx})">✖</button></td>
        </tr>`;
    }).join('');
}

function addSvcRowLine() {
    svcRows.push({ service:'', material:'ours', qty:1, price:0 });
    renderSvcRows();
    renderSvcOrderSummary();
}

function removeSvcRowLine(idx) {
    svcRows.splice(idx, 1);
    if (!svcRows.length) svcRows.push({ service:'', material:'ours', qty:1, price:0 });
    renderSvcRows();
    renderSvcOrderSummary();
}

function updateSvcRow(idx, field, value) {
    const row = svcRows[idx];
    if (!row) return;
    if (field === 'qty' || field === 'price') value = parseFloat(value) || 0;
    row[field] = value;

    // Автоподстановка цены из справочника при смене услуги или типа материала
    if (field === 'service' || field === 'material') {
        const pr = svc_prices.find(p => p.service_type === row.service);
        if (pr) row.price = row.material === 'ours' ? (pr.price_ours||0) : (pr.price_client||0);
    }
    renderSvcRows();
    renderSvcOrderSummary();
}

function renderSvcOrderSummary() {
    const orderSum = svcRows.reduce((s, r) => s + (r.qty||0)*(r.price||0), 0);
    const clientId = document.getElementById('svc-op-client')?.value;
    const paymentNow = parseFloat(document.getElementById('svc-op-payment-now')?.value) || 0;

    const prevBalance = clientId ? clientBalance(clientId) : 0; // положительный = переплата, отрицательный = долг
    const finalBalance = prevBalance - orderSum + paymentNow;

    const sumEl  = document.getElementById('svc-sum-order');
    const prevEl = document.getElementById('svc-sum-prevbalance');
    const payEl  = document.getElementById('svc-sum-paynow');
    const finEl  = document.getElementById('svc-sum-final');
    if (sumEl)  sumEl.innerText  = formatMoney(orderSum);
    if (payEl)  payEl.innerText  = formatMoney(paymentNow);
    if (prevEl) {
        prevEl.innerText = (prevBalance>=0?'+':'') + formatMoney(prevBalance);
        prevEl.style.color = prevBalance < 0 ? '#ef4444' : prevBalance > 0 ? '#16a34a' : '#64748b';
    }
    if (finEl) {
        finEl.innerText = (finalBalance>=0?'+':'') + formatMoney(finalBalance);
        finEl.style.color = finalBalance < 0 ? '#ef4444' : '#16a34a';
    }
}

// Переиспользуемое распределение оплаты по долгам клиента (от старых к новым)
async function distributeSvcPayment(clientId, amount) {
    if (amount <= 0) return;
    const unpaid = svc_transactions
        .filter(t => t.client_id == clientId && (t.paid_amount||0) < t.total_amount)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    let rem = amount;
    for (const tx of unpaid) {
        if (rem <= 0) break;
        const paying  = Math.min(tx.total_amount - (tx.paid_amount||0), rem);
        const newPaid = (tx.paid_amount||0) + paying;
        rem -= paying;
        await _supabase.from('svc_transactions').update({ paid_amount: newPaid }).eq('id', tx.id);
        tx.paid_amount = newPaid;
    }
}

async function saveServiceClient() {
    const name  = document.getElementById('svc-cl-name')?.value.trim();
    const phone = document.getElementById('svc-cl-phone')?.value.trim();
    const notes = document.getElementById('svc-cl-notes')?.value.trim();
    if (!name) return showToast('Введите имя', 'error');
    let { data, error } = await _supabase.from('svc_clients').insert({ name, phone, notes }).select();
    if (error && error.message?.includes('notes')) {
        // Колонки notes нет в БД — сохраняем без неё, чтобы не блокировать работу
        const retry = await _supabase.from('svc_clients').insert({ name, phone }).select();
        data = retry.data; error = retry.error;
        if (!error) showToast('Клиент добавлен (без примечания — выполните SQL из подсказки ниже)', 'error');
    }
    if (error) return showToast('Ошибка: ' + error.message, 'error');
    svc_clients.unshift(data[0]);
    ['svc-cl-name','svc-cl-phone','svc-cl-notes'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    renderSvcClients(); updateSvcSelects(); showToast('Клиент добавлен: ' + name);
}

async function deleteServiceClient(id) {
    if (!confirm('Удалить клиента?')) return;
    await _supabase.from('svc_clients').delete().eq('id', id);
    svc_clients = svc_clients.filter(c => c.id !== id);
    renderSvcClients(); updateSvcSelects();
}

function clientBalance(clientId) {
    const txs = svc_transactions.filter(t => t.client_id == clientId);
    return txs.reduce((s,t) => s + (t.paid_amount||0) - (t.total_amount||0), 0);
}

function renderSvcClients() {
    const el = document.getElementById('svc-clients-list'); if (!el) return;
    const q  = (document.getElementById('svc-cl-search')?.value || '').toLowerCase();
    let list = q ? svc_clients.filter(c => c.name.toLowerCase().includes(q) || (c.phone||'').includes(q)) : svc_clients;

    if (!list.length) { el.innerHTML = '<div class="card" style="color:var(--text-muted);text-align:center;padding:30px;">Нет клиентов</div>'; return; }

    el.innerHTML = list.map(c => {
        const bal      = clientBalance(c.id);
        const balCls   = bal > 0 ? 'svc-balance-positive' : bal < 0 ? 'svc-balance-negative' : 'svc-balance-zero';
        const balLbl   = bal > 0 ? 'переплата' : bal < 0 ? 'задолженность' : 'нет долга';
        const txCount  = svc_transactions.filter(t => t.client_id == c.id).length;
        const totalRev = svc_transactions.filter(t => t.client_id == c.id).reduce((s,t) => s+(t.total_amount||0), 0);
        return `<div class="svc-client-card">
            <div style="flex:1;cursor:pointer;" onclick="openSvcClientModal(${c.id})">
                <div class="svc-client-name">${c.name}</div>
                ${c.phone ? `<div class="svc-client-phone">📞 ${c.phone}</div>` : ''}
                ${c.notes ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${c.notes}</div>` : ''}
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${txCount} операц. · ${formatMoney(totalRev)}</div>
            </div>
            <div style="text-align:center;min-width:130px;">
                <div class="${balCls}">${bal<0 ? formatMoney(bal) : '+'+formatMoney(Math.abs(bal))}</div>
                <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">${balLbl}</div>
                <button onclick="recordSvcPayment(${c.id})" class="btn-green" style="margin-top:8px;padding:6px 12px;font-size:12px;width:100%;">💳 Оплата</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;">
                <button onclick="openSvcClientModal(${c.id})" class="btn-blue" style="padding:6px 10px;font-size:11px;">📋 Детали</button>
                <button class="btn-red" style="padding:6px 10px;font-size:11px;" onclick="deleteServiceClient(${c.id})">✖</button>
            </div>
        </div>`;
    }).join('');
}

function openSvcClientModal(clientId) {
    _svcModalClientId = clientId;
    const c   = svc_clients.find(x => x.id == clientId); if (!c) return;
    const txs = svc_transactions.filter(t => t.client_id == clientId);
    const total = txs.reduce((s,t) => s+(t.total_amount||0), 0);
    const paid  = txs.reduce((s,t) => s+(t.paid_amount||0), 0);
    const bal   = paid - total;
    document.getElementById('svc-modal-name').innerText  = c.name;
    document.getElementById('svc-modal-phone').innerText = c.phone ? '📞 ' + c.phone : '';
    document.getElementById('svc-modal-notes-h').innerText = c.notes || '';
    document.getElementById('svc-modal-total').innerText   = formatMoney(total);
    document.getElementById('svc-modal-paid').innerText    = formatMoney(paid);
    document.getElementById('svc-modal-balance').innerText = (bal<0?'':'+') + formatMoney(bal);
    document.getElementById('svc-modal-balance').style.color = bal < 0 ? '#f87171' : '#34d399';
    document.getElementById('svc-modal-balance-label').innerText = bal < 0 ? '🔴 Долг' : '🟢 Баланс';

    const ops = document.getElementById('svc-modal-operations');
    if (!txs.length) { ops.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:30px;">Нет операций</div>'; }
    else {
        const byMonth = {};
        txs.forEach(t => { const m=(t.created_at||'').slice(0,7)||'Без даты'; if(!byMonth[m])byMonth[m]=[]; byMonth[m].push(t); });
        ops.innerHTML = Object.entries(byMonth).sort((a,b)=>b[0].localeCompare(a[0])).map(([month, mtxs]) => {
            const mTotal = mtxs.reduce((s,t)=>s+(t.total_amount||0),0);
            const mPaid  = mtxs.reduce((s,t)=>s+(t.paid_amount||0),0);
            const lbl    = month==='Без даты' ? month : new Date(month+'-01').toLocaleString('ru-RU',{month:'long',year:'numeric'});
            return `<div style="margin-bottom:18px;">
                <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:2px solid #e2e8f0;margin-bottom:8px;">
                    <b style="color:var(--primary);">📅 ${lbl}</b>
                    <span style="font-size:13px;">Итого: <b>${formatMoney(mTotal)}</b>
                        <span style="color:#16a34a;margin-left:8px;">Опл.: ${formatMoney(mPaid)}</span>
                        ${mTotal-mPaid>0 ? `<span style="color:#ef4444;margin-left:8px;">Долг: ${formatMoney(mTotal-mPaid)}</span>` : ''}
                    </span>
                </div>
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead><tr style="color:var(--text-muted);font-size:11px;">
                        <th style="text-align:left;padding:4px 0;">Дата</th>
                        <th style="text-align:left;">Услуга</th>
                        <th style="text-align:center;">Кол-во</th>
                        <th style="text-align:right;">Цена</th>
                        <th style="text-align:right;">Итого</th>
                        <th style="text-align:right;">Оплач.</th>
                        <th style="text-align:center;">Ст.</th>
                        <th style="text-align:center;">Кто</th>
                    </tr></thead><tbody>
                    ${mtxs.map(t => {
                        const owed = (t.total_amount||0)-(t.paid_amount||0);
                        const badge = (t.paid_amount||0)>=t.total_amount ? '<span class="paid-badge">✔</span>'
                            : (t.paid_amount||0)>0 ? '<span class="partial-badge">⏳</span>'
                            : '<span class="unpaid-badge">✖</span>';
                        const mat = t.material_source==='ours'?'📦':'🧑';
                        const dt  = t.created_at ? new Date(t.created_at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}) : '—';
                        return `<tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:5px 0;color:var(--text-secondary);">${dt}</td>
                            <td style="padding:5px 4px;font-weight:600;">${mat} ${t.service_type}${t.crm_order_id?` <span style="font-size:10px;color:var(--primary);">#${t.crm_order_id}</span>`:''}</td>
                            <td style="text-align:center;">${t.qty}</td>
                            <td style="text-align:right;color:var(--text-secondary);">${formatMoney(t.unit_price)}</td>
                            <td style="text-align:right;font-weight:700;">${formatMoney(t.total_amount)}</td>
                            <td style="text-align:right;color:#16a34a;">${formatMoney(t.paid_amount||0)}</td>
                            <td style="text-align:center;">${badge}</td>
                            <td style="text-align:center;font-size:11px;color:var(--text-secondary);">${t.worker||'—'}</td>
                        </tr>`;
                    }).join('')}
                    </tbody></table></div>`;
        }).join('');
    }
    document.getElementById('svc-client-modal').classList.remove('hidden');
    document.getElementById('svc-client-modal').scrollTop = 0;
}

function closeSvcClientModal() { document.getElementById('svc-client-modal').classList.add('hidden'); _svcModalClientId = null; }
async function recordSvcPaymentForModal() { if(_svcModalClientId){ await recordSvcPayment(_svcModalClientId); openSvcClientModal(_svcModalClientId); } }

async function recordSvcPayment(clientId) {
    const c   = svc_clients.find(x => x.id == clientId);
    const bal = clientBalance(clientId);
    const inp = parseFloat(prompt(`Оплата от "${c?.name}"\nДолг: ${formatMoney(Math.abs(Math.min(0,bal)))}\nСумма оплаты:`));
    if (!inp || inp <= 0) return;
    await distributeSvcPayment(clientId, inp);
    renderSvcClients(); renderSvcOperations();
    if (_svcModalClientId==clientId) openSvcClientModal(clientId);
    if (document.getElementById('svc-op-client')?.value == clientId) renderSvcOrderSummary();
    showToast(`💳 Оплата ${formatMoney(inp)} принята от ${c?.name}`);
}

async function addServiceOperation() {
    const clientId    = document.getElementById('svc-op-client')?.value;
    const crmOrderId  = document.getElementById('svc-op-crm-order')?.value.trim() || null;
    const paymentNow  = parseFloat(document.getElementById('svc-op-payment-now')?.value) || 0;
    const notes       = document.getElementById('svc-op-notes')?.value || '';
    const date        = document.getElementById('svc-op-date')?.value || new Date().toISOString().slice(0,10);
    const worker      = curUser?.name || '';

    if (!clientId) return showToast('Выберите клиента', 'error');

    const validRows = svcRows.filter(r => r.service && r.qty > 0);
    if (!validRows.length) return showToast('Добавьте хотя бы одну строку с услугой и количеством', 'error');

    const client = svc_clients.find(c => c.id == clientId);
    const createdAt = new Date(date).toISOString();
    const orderSum = validRows.reduce((s, r) => s + r.qty * r.price, 0);

    try {
        let crmSyncMsg = '';

        // ── АВТОСВЯЗЬ С CRM: если указан номер заказа ──
        if (crmOrderId) {
            const existing = crm_orders.find(c => c.oid === crmOrderId);

            if (!existing) {
                // Заказа с таким номером ещё нет — создаём его автоматически в CRM
                const itemDesc = validRows.map(r => r.service).join(', ');
                const { data: newCrm, error: crmErr } = await _supabase.from('crm_orders').insert({
                    oid: crmOrderId, client: client?.name || '', phone: client?.phone || '',
                    item: itemDesc, price: orderSum, date: date,
                    svc_client_id: parseInt(clientId), svc_material: validRows[0].material || 'client'
                }).select();
                if (crmErr) {
                    showToast('Не удалось создать заказ в CRM: ' + crmErr.message, 'error');
                } else if (newCrm?.[0]) {
                    crm_orders.unshift(newCrm[0]);
                    crmSyncMsg = ` · создан заказ #${crmOrderId} в CRM`;
                }
            } else if (!existing.svc_client_id) {
                // Заказ уже есть, но не привязан к услугчику — привязываем
                await _supabase.from('crm_orders').update({ svc_client_id: parseInt(clientId) }).eq('oid', crmOrderId);
                existing.svc_client_id = parseInt(clientId);
                crmSyncMsg = ` · привязан к заказу #${crmOrderId} в CRM`;
            }
        }

        const inserts = validRows.map(r => ({
            client_id: parseInt(clientId), client_name: client?.name || '',
            service_type: r.service, material_source: r.material,
            qty: r.qty, unit_price: r.price, total_amount: r.qty * r.price, paid_amount: 0,
            worker, notes, crm_order_id: crmOrderId, created_at: createdAt
        }));

        const { data, error } = await _supabase.from('svc_transactions').insert(inserts).select();
        if (error) return showToast('Ошибка: ' + error.message, 'error');

        data.forEach(d => svc_transactions.unshift(d));

        if (paymentNow > 0) await distributeSvcPayment(clientId, paymentNow);

        // Сброс формы
        svcRows = [{ service:'', material:'ours', qty:1, price:0 }];
        document.getElementById('svc-op-payment-now').value = '';
        document.getElementById('svc-op-notes').value = '';
        document.getElementById('svc-op-crm-order').value = '';
        renderSvcRows();
        renderSvcOrderSummary();
        renderSvcClients(); renderSvcOperations();
        renderCRM();
        showToast(`Операция добавлена: ${validRows.length} поз. на сумму ${formatMoney(orderSum)}${crmSyncMsg}`);
    } catch(e) {
        console.error(e);
        showToast('Ошибка сети', 'error');
    }
}

async function deleteSvcTransaction(id) {
    if (!confirm('Удалить?')) return;
    await _supabase.from('svc_transactions').delete().eq('id',id);
    svc_transactions = svc_transactions.filter(t=>t.id!==id);
    renderSvcClients(); renderSvcOperations();
    if (_svcModalClientId) openSvcClientModal(_svcModalClientId);
}

function renderSvcOperations() {
    const el = document.getElementById('svc-operations-list'); if (!el) return;
    const cf = document.getElementById('svc-filter-client')?.value;
    const sf = document.getElementById('svc-filter-status')?.value;
    const mf = document.getElementById('svc-filter-month')?.value;
    let txs = [...svc_transactions];
    if (cf) txs = txs.filter(t=>t.client_id==cf);
    if (mf) txs = txs.filter(t=>(t.created_at||'').slice(0,7)===mf);
    if (sf) txs = txs.filter(t=>{
        const p=t.paid_amount||0;
        if(sf==='paid')    return p>=t.total_amount;
        if(sf==='unpaid')  return p<=0;
        if(sf==='partial') return p>0&&p<t.total_amount;
        return true;
    });
    if (!txs.length){el.innerHTML='<div style="color:var(--text-muted);text-align:center;padding:30px;font-size:13px;">Нет операций</div>';return;}
    el.innerHTML = txs.map(t=>{
        const paid=t.paid_amount||0; const owed=t.total_amount-paid;
        const mat = t.material_source==='ours'?'<span class="material-badge material-ours">📦 Наш</span>':'<span class="material-badge material-client">🧑 Клиента</span>';
        const payB = paid>=t.total_amount?'<span class="paid-badge">✔ Оплачено</span>'
            :paid>0?`<span class="partial-badge">⏳ Долг ${formatMoney(owed)}</span>`
            :`<span class="unpaid-badge">✖ ${formatMoney(owed)}</span>`;
        const dt=t.created_at?new Date(t.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
        const crm=t.crm_order_id?`<span class="wt-code-chip" style="margin-left:6px;">#${t.crm_order_id}</span>`:'';
        return `<div class="svc-tx-row">
            <div class="svc-tx-top">
                <div><div class="svc-tx-service">${t.service_type}${crm}</div>
                    <div style="font-weight:600;font-size:12px;color:var(--text-secondary);">${t.client_name}</div></div>
                <div style="text-align:right;"><div class="svc-tx-total">${formatMoney(t.total_amount)}</div>
                    <div style="font-size:11px;color:var(--text-muted);">${t.qty} × ${formatMoney(t.unit_price)}</div></div>
            </div>
            <div class="svc-tx-meta">${mat} ${payB}
                ${t.worker?`<span>👤 ${t.worker}</span>`:''}
                <span>🕐 ${dt}</span>
                ${t.notes?`<span>💬 ${t.notes}</span>`:''}
            </div>
            <div style="display:flex;gap:6px;margin-top:6px;">
                ${paid<t.total_amount?`<button onclick="quickPaySvcTx(${t.id},${t.total_amount},${paid})" class="btn-green" style="padding:4px 10px;font-size:11px;">💳 Оплатить</button>`:''}
                <button onclick="openSvcClientModal(${t.client_id})" class="btn-blue" style="padding:4px 10px;font-size:11px;">📋 Карточка</button>
                <button onclick="deleteSvcTransaction(${t.id})" class="btn-red" style="padding:4px 10px;font-size:11px;">✖</button>
            </div></div>`;
    }).join('');
}

async function quickPaySvcTx(txId,total,alreadyPaid){
    const rem=total-alreadyPaid;
    const inp=parseFloat(prompt(`Сумма (осталось ${formatMoney(rem)}):`));
    if(!inp||inp<=0)return;
    const newPaid=Math.min(total,alreadyPaid+inp);
    await _supabase.from('svc_transactions').update({paid_amount:newPaid}).eq('id',txId);
    const tx=svc_transactions.find(t=>t.id===txId); if(tx)tx.paid_amount=newPaid;
    renderSvcClients(); renderSvcOperations();
    if(_svcModalClientId)openSvcClientModal(_svcModalClientId);
    showToast(`Оплачено ${formatMoney(inp)}`);
}

async function saveSvcPrice(){
    const st=document.getElementById('svc-pr-service')?.value.trim();
    const po=parseFloat(document.getElementById('svc-pr-price-ours')?.value)||0;
    const pc=parseFloat(document.getElementById('svc-pr-price-client')?.value)||0;
    if(!st)return showToast('Введите название','error');
    const {data,error}=await _supabase.from('svc_prices').upsert({service_type:st,price_ours:po,price_client:pc},{onConflict:'service_type'}).select();
    if(error)return showToast('Ошибка: '+error.message,'error');
    const idx=svc_prices.findIndex(p=>p.service_type===st);
    if(idx!==-1)svc_prices[idx]=data[0];else svc_prices.push(data[0]);
    svc_prices.sort((a,b)=>a.service_type.localeCompare(b.service_type));
    ['svc-pr-service','svc-pr-price-ours','svc-pr-price-client'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    renderSvcPrices(); updateSvcSelects(); showToast('Цена сохранена: '+st);
}

async function deleteSvcPrice(id){
    await _supabase.from('svc_prices').delete().eq('id',id);
    svc_prices=svc_prices.filter(p=>p.id!==id); renderSvcPrices(); updateSvcSelects();
}

function renderSvcPrices(){
    const el=document.getElementById('svc-prices-list'); if(!el)return;
    if(!svc_prices.length){el.innerHTML='<div style="color:var(--text-muted);font-size:13px;padding:10px;">Справочник пуст</div>';return;}
    el.innerHTML=`<div class="table-wrapper"><table class="modern-table mobile-cards">
        <thead><tr><th>Услуга / Процесс</th><th>Наш материал</th><th>Материал клиента</th><th></th></tr></thead>
        <tbody>${svc_prices.map(p=>`<tr>
            <td data-label="Услуга" style="font-weight:700;">${p.service_type}</td>
            <td data-label="Наш материал">${formatMoney(p.price_ours)}</td>
            <td data-label="Материал клиента">${formatMoney(p.price_client)}</td>
            <td data-label="Действия"><button class="btn-red" style="padding:4px 8px;font-size:11px;" onclick="deleteSvcPrice(${p.id})">✖</button></td>
        </tr>`).join('')}</tbody></table></div>`;
}

function renderSvcAnalytics(){
    const month=document.getElementById('svc-analytics-month')?.value;
    let txs=svc_transactions;
    if(month)txs=txs.filter(t=>(t.created_at||'').slice(0,7)===month);
    const totalRev=txs.reduce((s,t)=>s+(t.total_amount||0),0);
    const totalPaid=txs.reduce((s,t)=>s+(t.paid_amount||0),0);
    const totalDebt=totalRev-totalPaid;
    const allDebt=svc_transactions.reduce((s,t)=>s+(t.total_amount||0)-(t.paid_amount||0),0);
    const sEl=document.getElementById('svc-stats');
    if(sEl)sEl.innerHTML=[
        {val:formatMoney(totalRev), label:month?'Выручка за месяц':'Всего выручки'},
        {val:formatMoney(totalPaid),label:'Получено',color:'var(--success)'},
        {val:formatMoney(totalDebt),label:'Долг за период',color:totalDebt>0?'#ef4444':'var(--success)'},
        {val:formatMoney(allDebt),  label:'Общий долг',color:allDebt>0?'#ef4444':'var(--success)'},
        {val:txs.length,label:'Операций'},{val:svc_clients.length,label:'Клиентов'},
    ].map(s=>`<div class="svc-stat-card"><div class="svc-stat-val" style="${s.color?'color:'+s.color:''}">${s.val}</div><div class="svc-stat-label">${s.label}</div></div>`).join('');

    // По месяцам
    const mEl=document.getElementById('svc-monthly-stats');
    if(mEl){
        const bm={};
        svc_transactions.forEach(t=>{const m=(t.created_at||'').slice(0,7)||'Без даты';if(!bm[m])bm[m]={rev:0,paid:0,count:0};bm[m].rev+=t.total_amount||0;bm[m].paid+=t.paid_amount||0;bm[m].count++;});
        const rows=Object.entries(bm).sort((a,b)=>b[0].localeCompare(a[0]));
        mEl.innerHTML=rows.length?`<div class="table-wrapper"><table class="modern-table mobile-cards">
            <thead><tr><th>Месяц</th><th>Операций</th><th>Выручка</th><th>Получено</th><th>Долг</th></tr></thead>
            <tbody>${rows.map(([m,d])=>{
                const lbl=m==='Без даты'?m:new Date(m+'-01').toLocaleString('ru-RU',{month:'long',year:'numeric'});
                const debt=d.rev-d.paid;
                return `<tr><td data-label="Месяц" style="font-weight:700;">${lbl}</td><td data-label="Операций">${d.count}</td>
                    <td data-label="Выручка" style="font-weight:700;">${formatMoney(d.rev)}</td>
                    <td data-label="Получено" style="color:var(--success);">${formatMoney(d.paid)}</td>
                    <td data-label="Долг" style="color:${debt>0?'#ef4444':'var(--success)'};font-weight:700;">${debt>0?'-':'+'}${formatMoney(Math.abs(debt))}</td></tr>`;
            }).join('')}</tbody></table></div>`:'<div style="color:var(--text-muted);padding:10px;">Нет данных</div>';
    }

    // По клиентам
    const cEl=document.getElementById('svc-client-stats');
    if(cEl){
        const bc=svc_clients.map(c=>{
            const ct=txs.filter(t=>t.client_id==c.id);
            const rv=ct.reduce((s,t)=>s+(t.total_amount||0),0);
            const pd=ct.reduce((s,t)=>s+(t.paid_amount||0),0);
            return{name:c.name,rev:rv,paid:pd,debt:rv-pd,count:ct.length,id:c.id};
        }).filter(c=>c.count>0).sort((a,b)=>b.rev-a.rev);
        cEl.innerHTML=bc.length?`<div class="table-wrapper"><table class="modern-table mobile-cards">
            <thead><tr><th>Клиент</th><th>Операций</th><th>Выручка</th><th>Оплачено</th><th>Долг</th><th></th></tr></thead>
            <tbody>${bc.map(c=>`<tr>
                <td data-label="Клиент" style="font-weight:700;cursor:pointer;color:var(--primary);" onclick="openSvcClientModal(${c.id})">${c.name}</td>
                <td data-label="Операций">${c.count}</td><td data-label="Выручка">${formatMoney(c.rev)}</td>
                <td data-label="Оплачено" style="color:var(--success);">${formatMoney(c.paid)}</td>
                <td data-label="Долг" style="color:${c.debt>0?'#ef4444':'var(--success)'};font-weight:700;">${c.debt>0?'-':'+'}${formatMoney(Math.abs(c.debt))}</td>
                <td data-label="Действия"><button onclick="openSvcClientModal(${c.id})" class="btn-ghost" style="padding:3px 8px;font-size:11px;">📋</button></td>
            </tr>`).join('')}</tbody></table></div>`:'<div style="color:var(--text-muted);padding:10px;">Нет данных</div>';
    }

    // По услугам
    const svEl=document.getElementById('svc-service-stats');
    if(svEl){
        const bs={};
        txs.forEach(t=>{if(!bs[t.service_type])bs[t.service_type]={count:0,qty:0,rev:0};bs[t.service_type].count++;bs[t.service_type].qty+=t.qty||0;bs[t.service_type].rev+=t.total_amount||0;});
        const rows=Object.entries(bs).sort((a,b)=>b[1].rev-a[1].rev);
        svEl.innerHTML=rows.length?`<div class="table-wrapper"><table class="modern-table mobile-cards">
            <thead><tr><th>Услуга</th><th>Операций</th><th>Кол-во</th><th>Выручка</th></tr></thead>
            <tbody>${rows.map(([sv,d])=>`<tr><td data-label="Услуга" style="font-weight:700;">${sv}</td><td data-label="Операций">${d.count}</td><td data-label="Кол-во">${d.qty.toFixed(2)}</td><td data-label="Выручка" style="font-weight:700;">${formatMoney(d.rev)}</td></tr>`).join('')}</tbody></table></div>`:'<div style="color:var(--text-muted);padding:10px;">Нет данных</div>';
    }
}

async function autoSvcTransaction(orderId,processName,workerName){
    const crmData=crm_orders.find(c=>c.oid===orderId);
    if(!crmData||!crmData.svc_client_id)return;
    const pr=svc_prices.find(p=>p.service_type.toLowerCase()===processName.toLowerCase());
    if(!pr)return;
    const client=svc_clients.find(c=>c.id==crmData.svc_client_id);
    if(!client)return;
    const price=((crmData.svc_material||'client')==='ours'?pr.price_ours:pr.price_client);
    const qty=parseFloat(crmData.svc_qty||1);
    const total=price*qty;
    const{data,error}=await _supabase.from('svc_transactions').insert({
        client_id:parseInt(crmData.svc_client_id),client_name:client.name,
        service_type:processName,material_source:crmData.svc_material||'client',
        qty,unit_price:price,total_amount:total,paid_amount:0,
        worker:workerName,crm_order_id:orderId,created_at:new Date().toISOString()
    }).select();
    if(!error&&data?.[0]){svc_transactions.unshift(data[0]);showToast(`📋 Записано в услуги: ${processName} для ${client.name}`);}
}


// ═══════════════════════════════════════════════════════
// ORDER CALCULATION — Калькуляция заказа
// ═══════════════════════════════════════════════════════
let oc_orderId    = null;
let oc_materials   = [];
let oc_labor       = [];
let oc_meta        = { delivery_cost: 0, sale_price: 0, notes: '' };

async function openOrderCalc(orderId, fromModal) {
    oc_orderId = orderId;
    // Если открыто из модалки мониторинга — запомнить для кнопки "Назад к заказу"
    if (fromModal && _monModalOrderId) {
        _monModalReturnToCalc = true;
    }
    showPage('page-order-calc');
    // Обновить кнопку "Назад" — показать "← Назад к заказу" вместо "← Назад"
    updateCalcBackButton();
    document.getElementById('oc-order-id').innerText = orderId;

    const crmData = crm_orders.find(c => c.oid === orderId);
    const cLine = document.getElementById('oc-client-line');
    if (cLine) cLine.innerText = crmData ? `${crmData.client || ''} — ${crmData.item || ''}` : 'Клиент не найден в CRM';

    await loadOcData(orderId);
    if (!warehouse_items.length) {
        try {
            const { data } = await _supabase.from('warehouse_items').select('*');
            warehouse_items = data || [];
        } catch(e) { /* таблица склада может быть не создана — не критично */ }
    }
    populateOcWarehousePicker();
    renderOcSteps();
    renderOcMaterials();
    renderOcLabor();
    updateOcSummary();
    showOcTab('progress');
    updateOcLaunchButton();
    document.getElementById('oc-launch-panel')?.classList.add('hidden');
}

// Обновляет кнопку «Назад» на странице калькуляции:
// если пришли из модалки мониторинга — показывает «← Назад к заказу №XXX»
function updateCalcBackButton() {
    const backBtn = document.querySelector('#page-order-calc .oc-back');
    if (!backBtn) return;
    if (_monModalReturnToCalc && _monModalOrderId) {
        backBtn.textContent = '← Назад к заказу №' + _monModalOrderId;
        backBtn.onclick = function() { returnToModalFromCalc(); };
    } else {
        backBtn.textContent = '← Назад';
        backBtn.onclick = function() { showPage('page-monitor'); };
    }
}

// Возврат из калькуляции обратно в модальное окно заказа
function returnToModalFromCalc() {
    _monModalReturnToCalc = false;
    showPage('page-monitor');
    // Небольшая задержка чтобы страница мониторинга отрисоалась
    setTimeout(() => {
        if (_monModalOrderId) {
            openMonitorOrderModal(_monModalOrderId);
            setMonModalTab('calc');
        }
    }, 100);
}

// Обновляет вид кнопки «В производство» в зависимости от того, запущен ли уже заказ
function updateOcLaunchButton() {
    const btn = document.getElementById('oc-launch-btn');
    if (!btn) return;
    const order = orders.find(o => o.id === oc_orderId);
    if (order && order.path && order.path.length) {
        btn.innerText = '🔄 Изменить маршрут';
    } else {
        btn.innerText = '🚀 В производство';
    }
}

function toggleOcLaunchPanel() {
    const panel = document.getElementById('oc-launch-panel');
    if (!panel) return;
    const willShow = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (willShow) renderOcLaunchGrid();
}

function renderOcLaunchGrid() {
    const grid = document.getElementById('oc-launch-grid');
    if (!grid) return;
    const order = orders.find(o => o.id === oc_orderId);
    const currentPath = order?.path || [];
    grid.innerHTML = PROCS.map(p =>
        `<label class="item-card"><input type="checkbox" value="${p}" ${currentPath.includes(p)?'checked':''}> ${p}</label>`
    ).join('');
}

// Запускает заказ в производство прямо из страницы Калькуляции
async function launchOrderFromCalc() {
    const path = Array.from(document.querySelectorAll('#oc-launch-grid input:checked')).map(cb => cb.value);
    if (!path.length) return showToast('Выберите хотя бы один процесс', 'error');

    try {
        const existing = orders.find(o => o.id === oc_orderId);
        const payload = { id: oc_orderId, path, history: existing?.history || {} };
        await _supabase.from('orders').upsert(payload);

        await logActivity(curUser.name, 'Запустил в производство (из Калькуляции)',
            `Заказ #${oc_orderId}, процессов: ${path.length}`, 'order');

        await loadAllData();
        renderOcSteps();
        updateOcLaunchButton();
        document.getElementById('oc-launch-panel')?.classList.add('hidden');
        showOcTab('progress');

        const linkedCrm = crm_orders.find(c => c.oid === oc_orderId);
        if (linkedCrm?.svc_client_id) {
            showToast('Заказ запущен · это заказ услугчика — печать фактуры в разделе Услуги');
        } else {
            printProductionSheet(oc_orderId, path);
        }
    } catch(e) {
        console.error(e);
        showToast('Ошибка запуска', 'error');
    }
}

async function loadOcData(orderId) {
    try {
        const [matRes, labRes, metaRes] = await Promise.all([
            _supabase.from('order_materials').select('*').eq('order_id', orderId).order('id'),
            _supabase.from('order_labor').select('*').eq('order_id', orderId).order('id'),
            _supabase.from('order_calc_meta').select('*').eq('order_id', orderId).maybeSingle()
        ]);
        oc_materials = matRes.data || [];
        oc_labor     = labRes.data || [];
        const crmData = crm_orders.find(c => c.oid === orderId);
        oc_meta = metaRes.data || { delivery_cost: 0, sale_price: crmData?.price || 0, notes: '' };

        document.getElementById('oc-delivery-cost').value = oc_meta.delivery_cost || '';
        document.getElementById('oc-sale-price').value    = oc_meta.sale_price || '';
        document.getElementById('oc-notes').value          = oc_meta.notes || '';
    } catch(e) {
        console.error('loadOcData error:', e);
        showToast('Таблицы калькуляции не найдены — см. подсказку SQL внизу страницы Краска', 'error');
    }
}

function showOcTab(name) {
    document.querySelectorAll('.oc-tab-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.oc-tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('oc-tab-' + name)?.classList.add('active');
    const map = { progress:'прогресс', materials:'материал', labor:'работа', summary:'итог' };
    document.querySelectorAll('.oc-tab-btn').forEach(b => {
        if (b.textContent.toLowerCase().includes(map[name])) b.classList.add('active');
    });
}

// ── ПРОГРЕСС ──────────────────────────────────────────────
function renderOcSteps() {
    const el = document.getElementById('oc-steps-list');
    if (!el) return;
    const order = orders.find(o => o.id === oc_orderId);
    if (!order || !order.path || !order.path.length) {
        el.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:20px;">Заказ ещё не запущен в производство</div>';
        return;
    }
    el.innerHTML = order.path.map((p, i) => {
        const h = order.history?.[p];
        const code = getProcessCode(order, p);
        const isDone = h && h.end;
        const isActive = h && h.start && !h.end;
        const cls = isDone ? 'done' : isActive ? 'active' : '';
        const statusText = isDone ? `✔ Завершил: ${h.completed_by || h.worker || '—'}` 
            : isActive ? `● В работе: ${h.worker || '—'}` : '⏳ Ожидает';
        const nextBadge = (!isDone && !isActive && i > 0 && order.history?.[order.path[i-1]]?.end) 
            ? '<span style="color:var(--primary); font-weight:700; font-size:11px;"> ← следующий этап</span>' : '';
        return `<div class="oc-step-row ${cls}">
            <div>
                <span class="wt-code-chip">${code}</span>
                <b style="margin-left:8px;">${p}</b>${nextBadge}
            </div>
            <div style="font-size:12px; color:var(--text-secondary);">${statusText}</div>
        </div>`;
    }).join('');
}

// ── МАТЕРИАЛЫ ─────────────────────────────────────────────
function renderOcMaterials() {
    const tbody = document.getElementById('oc-materials-rows');
    if (!tbody) return;
    if (!oc_materials.length) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:16px;">Нет материалов. Нажмите «+ Добавить материал»</td></tr>`;
        updateOcSummary();
        return;
    }
    tbody.innerHTML = oc_materials.map(m => `<tr>
        <td><input type="text" value="${m.name||''}" onchange="updateOcMaterial(${m.id},'name',this.value)"></td>
        <td><input type="text" value="${m.color||''}" onchange="updateOcMaterial(${m.id},'color',this.value)" style="width:70px;"></td>
        <td><input type="text" value="${m.package||''}" onchange="updateOcMaterial(${m.id},'package',this.value)" style="width:80px;"></td>
        <td><input type="number" value="${m.qty||0}" step="0.01" onchange="updateOcMaterial(${m.id},'qty',this.value)" style="width:60px;"></td>
        <td><input type="text" value="${m.unit||'шт'}" onchange="updateOcMaterial(${m.id},'unit',this.value)" style="width:50px;"></td>
        <td><input type="number" value="${m.unit_price||0}" step="0.01" onchange="updateOcMaterial(${m.id},'unit_price',this.value)" style="width:80px;"></td>
        <td style="font-weight:700; white-space:nowrap;">${formatMoney((m.qty||0)*(m.unit_price||0))}</td>
        <td style="white-space:nowrap;">
            <button class="btn-ghost" style="padding:3px 6px; font-size:10px;" title="Списать со склада" onclick="deductFromWarehouseByName('${esc(m.name||'')}', ${m.qty||0})">📦</button>
            <button class="btn-red" style="padding:3px 8px; font-size:11px;" onclick="deleteOcMaterial(${m.id})">✖</button>
        </td>
    </tr>`).join('');
    updateOcSummary();
}

async function addOcMaterialRow() {
    const { data, error } = await _supabase.from('order_materials')
        .insert({ order_id: oc_orderId, name: 'Новый материал', color: '', package: '', qty: 1, unit: 'шт', unit_price: 0 }).select();
    if (error) return showToast('Ошибка: ' + error.message, 'error');
    oc_materials.push(data[0]);
    renderOcMaterials();
}

// ═══════════════════════════════════════════════════════
// СПРАВОЧНИК РАБОТ / МОНТАЖ (labor_catalog)
// ═══════════════════════════════════════════════════════
function renderLaborCatalog() {
    var el = document.getElementById('labor-catalog-list');
    if (!el) return;
    if (!labor_catalog.length) {
        el.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px;">Нет работ в справочнике. Добавьте сборку, монтаж, доставку и т.д.</td></tr>';
        return;
    }
    el.innerHTML = labor_catalog.map(function(item) {
        return '<tr>'
            + '<td style="font-weight:700;">' + (item.name || '') + '</td>'
            + '<td style="color:var(--text-secondary);">' + (item.category || '') + '</td>'
            + '<td>' + formatMoney(item.price_ours || 0) + '</td>'
            + '<td>' + formatMoney(item.price_client || 0) + '</td>'
            + '<td><button class="btn-red" style="padding:3px 8px; font-size:11px;" onclick="deleteLaborCatalogItem(' + item.id + ')">✖</button></td>'
            + '</tr>';
    }).join('');
}

async function addLaborCatalogItem() {
    var name = document.getElementById('lb-name')?.value.trim();
    var category = document.getElementById('lb-category')?.value.trim();
    var priceOurs = parseFloat(document.getElementById('lb-price-ours')?.value) || 0;
    var priceClient = parseFloat(document.getElementById('lb-price-client')?.value) || 0;
    if (!name) return showToast('Введите название работы', 'error');
    try {
        var { data, error } = await _supabase.from('labor_catalog')
            .insert({ name: name, category: category, price_ours: priceOurs, price_client: priceClient }).select();
        if (error) throw error;
        if (data && data[0]) labor_catalog.push(data[0]);
        labor_catalog.sort(function(a, b) { return a.name.localeCompare(b.name); });
        renderLaborCatalog();
        var n = document.getElementById('lb-name'); if (n) n.value = '';
        var c = document.getElementById('lb-category'); if (c) c.value = '';
        var p1 = document.getElementById('lb-price-ours'); if (p1) p1.value = '';
        var p2 = document.getElementById('lb-price-client'); if (p2) p2.value = '';
        showToast('Работа добавлена в справочник');
    } catch(e) { showToast('Ошибка: ' + e.message, 'error'); }
}

async function deleteLaborCatalogItem(id) {
    if (!confirm('Удалить работу из справочника?')) return;
    try {
        await _supabase.from('labor_catalog').delete().eq('id', id);
        labor_catalog = labor_catalog.filter(function(i) { return i.id !== id; });
        renderLaborCatalog();
    } catch(e) { showToast('Ошибка', 'error'); }
}

// Заполняет выпадающий список товаров со склада на вкладку Материалы
function populateOcWarehousePicker() {
    const sel = document.getElementById('oc-warehouse-pick');
    if (!sel) return;
    sel.innerHTML = '<option value="">Выберите товар со склада...</option>' +
        warehouse_items.map(i => `<option value="${i.id}">${i.name} (остаток: ${i.qty_in_stock} ${i.unit})</option>`).join('');
}

// Добавляет материал в калькуляцию из выбранного товара склада (с ценой по умолчанию)
async function addOcMaterialFromWarehouse() {
    const itemId = document.getElementById('oc-warehouse-pick')?.value;
    if (!itemId) return showToast('Выберите товар', 'error');
    const item = warehouse_items.find(i => i.id == itemId);
    if (!item) return;

    const { data, error } = await _supabase.from('order_materials').insert({
        order_id: oc_orderId, name: item.name, color: '', package: '',
        qty: 1, unit: item.unit || 'шт', unit_price: item.unit_cost || 0
    }).select();
    if (error) return showToast('Ошибка: ' + error.message, 'error');
    oc_materials.push(data[0]);
    renderOcMaterials();
    document.getElementById('oc-warehouse-pick').value = '';
    showToast(`Добавлено из склада: ${item.name}`);
}

async function updateOcMaterial(id, field, value) {
    const m = oc_materials.find(x => x.id === id);
    if (!m) return;
    if (['qty','unit_price'].includes(field)) value = parseFloat(value) || 0;
    m[field] = value;
    await _supabase.from('order_materials').update({ [field]: value }).eq('id', id);
    renderOcMaterials();
}

async function deleteOcMaterial(id) {
    if (!confirm('Удалить материал?')) return;
    await _supabase.from('order_materials').delete().eq('id', id);
    oc_materials = oc_materials.filter(m => m.id !== id);
    renderOcMaterials();
}

// ── РАБОТА / МОНТАЖ ───────────────────────────────────────
function renderOcLabor() {
    var tbody = document.getElementById('oc-labor-rows');
    if (!tbody) return;
    if (!oc_labor.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:16px;">Нет работ. Нажмите «+ Добавить работу»</td></tr>';
        updateOcSummary();
        return;
    }
    var workerOptions = ['<option value="">— выбрать —</option>'];
    workers.forEach(function(w) { workerOptions.push('<option value="' + w.name + '">' + w.name + '</option>'); });
    var laborOpts = ['<option value="">— выбрать —</option>'];
    labor_catalog.forEach(function(lc) { laborOpts.push('<option value="' + lc.name + '" data-price="' + (lc.price_ours||0) + '">' + lc.name + '</option>'); });
    laborOpts.push('<option value="__custom">✏️ Своя работа</option>');

    tbody.innerHTML = oc_labor.map(function(l) {
        var descVal = l.description || '';
        var inCat = labor_catalog.some(function(lc) { return lc.name === descVal; });
        var descCell = inCat
            ? '<select data-lid="' + l.id + '" class="oc-labor-desc" onchange="onLaborDescChange(this,' + l.id + ')" style="min-width:140px;font-size:12px;">' + laborOpts.join('').replace('value="' + descVal + '"', 'value="' + descVal + '" selected') + '</select>'
            : '<input type="text" value="' + descVal + '" onchange="updateOcLabor(' + l.id + ',\'description\',this.value)" placeholder="Название..." style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:8px;font-size:12px;">';
        var wOpts = workerOptions.join('').replace('value="' + (l.worker||'') + '"', 'value="' + (l.worker||'') + '" selected');
        return '<tr>'
            + '<td>' + descCell + '</td>'
            + '<td><select onchange="updateOcLabor(' + l.id + ',\'worker\',this.value)" style="min-width:110px;font-size:12px;">' + wOpts + '</select></td>'
            + '<td><input type="number" value="' + (l.qty||1) + '" step="0.01" onchange="updateOcLabor(' + l.id + ',\'qty\',this.value)" style="width:60px;font-size:12px;"></td>'
            + '<td><input type="number" value="' + (l.unit_price||0) + '" step="0.01" onchange="updateOcLabor(' + l.id + ',\'unit_price\',this.value)" style="width:80px;font-size:12px;"></td>'
            + '<td style="font-weight:700; white-space:nowrap;">' + formatMoney((l.qty||1)*(l.unit_price||0)) + '</td>'
            + '<td><button class="btn-red" style="padding:3px 8px; font-size:11px;" onclick="deleteOcLabor(' + l.id + ')">✖</button></td>'
            + '</tr>';
    }).join('');
    updateOcSummary();
}

function onLaborDescChange(sel, lid) {
    if (sel.value === '__custom') {
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = 'Название работы...';
        inp.style.cssText = 'width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:8px;font-size:12px;';
        inp.onchange = function() { updateOcLabor(lid, 'description', this.value); };
        sel.parentNode.replaceChild(inp, sel);
        inp.focus();
    } else {
        updateOcLabor(lid, 'description', sel.value);
        var opt = sel.options[sel.selectedIndex];
        var price = parseFloat(opt.getAttribute('data-price')) || 0;
        if (price) updateOcLabor(lid, 'unit_price', price);
    }
}

async function addOcLaborRow() {
    // Если есть справочник работ — используем первую запись как default
    var desc = labor_catalog.length ? labor_catalog[0].name : 'Сборка/монтаж';
    var unitPrice = labor_catalog.length ? (labor_catalog[0].price_ours || 0) : 0;
    const { data, error } = await _supabase.from('order_labor')
        .insert({ order_id: oc_orderId, description: desc, qty: 1, unit_price: unitPrice, worker: curUser?.name || null, created_at: new Date().toISOString() }).select();
    if (error) return showToast('Ошибка: ' + error.message, 'error');
    oc_labor.push(data[0]);
    renderOcLabor();
}

async function updateOcLabor(id, field, value) {
    const l = oc_labor.find(x => x.id === id);
    if (!l) return;
    if (['qty','unit_price'].includes(field)) value = parseFloat(value) || 0;
    l[field] = value;
    await _supabase.from('order_labor').update({ [field]: value }).eq('id', id);
    renderOcLabor();
}

async function deleteOcLabor(id) {
    if (!confirm('Удалить?')) return;
    await _supabase.from('order_labor').delete().eq('id', id);
    oc_labor = oc_labor.filter(l => l.id !== id);
    renderOcLabor();
}

// ── МЕТА (доставка / цена продажи / примечание) ───────────
async function saveOcMeta() {
    oc_meta.delivery_cost = parseFloat(document.getElementById('oc-delivery-cost').value) || 0;
    oc_meta.sale_price    = parseFloat(document.getElementById('oc-sale-price').value) || 0;
    oc_meta.notes         = document.getElementById('oc-notes').value || '';
    await _supabase.from('order_calc_meta').upsert({ order_id: oc_orderId, ...oc_meta }, { onConflict: 'order_id' });
    updateOcSummary();
}

// ── ИТОГ ──────────────────────────────────────────────────
function updateOcSummary() {
    const matTotal   = oc_materials.reduce((s, m) => s + (m.qty||0)*(m.unit_price||0), 0);
    const laborTotal = oc_labor.reduce((s, l) => s + (l.qty||1)*(l.unit_price||0), 0);
    const delivery   = oc_meta.delivery_cost || 0;
    const cost       = matTotal + laborTotal + delivery;
    const sale       = oc_meta.sale_price || 0;
    const profit     = sale - cost;
    const margin     = sale > 0 ? (profit/sale*100) : 0;

    document.getElementById('oc-sum-materials').innerText = formatMoney(matTotal);
    document.getElementById('oc-sum-labor').innerText     = formatMoney(laborTotal);
    document.getElementById('oc-sum-delivery').innerText  = formatMoney(delivery);
    document.getElementById('oc-sum-cost').innerText      = formatMoney(cost);
    document.getElementById('oc-sum-sale').innerText      = formatMoney(sale);
    document.getElementById('oc-sum-profit').innerText    = (profit>=0?'':'') + formatMoney(profit);

    document.getElementById('oc-materials-total').innerText = formatMoney(matTotal);
    document.getElementById('oc-labor-total').innerText     = formatMoney(laborTotal);

    document.getElementById('oc-sum2-mat').innerText      = formatMoney(matTotal);
    document.getElementById('oc-sum2-labor').innerText    = formatMoney(laborTotal);
    document.getElementById('oc-sum2-delivery').innerText = formatMoney(delivery);
    document.getElementById('oc-sum2-cost').innerText     = formatMoney(cost);
    document.getElementById('oc-sum2-sale').innerText     = formatMoney(sale);
    const profitEl = document.getElementById('oc-sum2-profit');
    profitEl.innerText = formatMoney(profit);
    profitEl.className = profit >= 0 ? 'oc-profit-positive' : 'oc-profit-negative';
    document.getElementById('oc-sum2-margin').innerText = margin.toFixed(1) + '%';
}

// ── ПЕЧАТЬ / PDF ──────────────────────────────────────────
function openPrintWindow(title, bodyHtml, pageSize) {
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { showToast('Разрешите всплывающие окна для печати', 'error'); return; }
    const sizeCss = pageSize || 'A4';
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>
        @page { size: ${sizeCss}; margin: 12mm; }
        * { box-sizing:border-box; }
        body { font-family:'Segoe UI', Arial, sans-serif; color:#1e293b; margin:0; padding:20px; }
        h1,h2,h3 { margin:0 0 8px; }
        table { width:100%; border-collapse:collapse; margin:12px 0; font-size:13px; }
        th { text-align:left; background:var(--surface-container); padding:8px; font-size:11px; text-transform:uppercase; color:var(--text-secondary); }
        td { padding:8px; border-bottom:1px solid #e2e8f0; }
        .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #3b27c1; padding-bottom:14px; margin-bottom:18px; }
        .brand { font-size:20px; font-weight:900; color:#3b27c1; }
        .meta { font-size:12px; color:var(--text-secondary); text-align:right; }
        .total-row td { font-weight:900; font-size:15px; border-top:2px solid #1e293b; }
        .no-print { display:none; }
        @media screen { .no-print { display:block; margin-bottom:16px; } }
    </style></head><body>
    <div class="no-print"><button onclick="window.print()" style="padding:10px 20px; background:#3b27c1; color:#fff; border:none; border-radius:8px; font-weight:700; cursor:pointer;">🖨 Печать / Сохранить PDF</button></div>
    ${bodyHtml}
    </body></html>`);
    w.document.close();
}

// Полная калькуляция для цеха (с себестоимостью)
function printMaterialsWorkshop() {
    const order = orders.find(o => o.id === oc_orderId);
    const crmData = crm_orders.find(c => c.oid === oc_orderId);
    const matTotal   = oc_materials.reduce((s, m) => s + (m.qty||0)*(m.unit_price||0), 0);
    const laborTotal = oc_labor.reduce((s, l) => s + (l.qty||1)*(l.unit_price||0), 0);
    const delivery   = oc_meta.delivery_cost || 0;
    const cost       = matTotal + laborTotal + delivery;

    const matRows = oc_materials.map(m => `<tr>
        <td>${m.name||''}</td><td>${m.color||'-'}</td><td>${m.package||'-'}</td>
        <td>${m.qty} ${m.unit||'шт'}</td><td>${formatMoney(m.unit_price)}</td>
        <td style="font-weight:700;">${formatMoney((m.qty||0)*(m.unit_price||0))}</td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">Нет материалов</td></tr>';

    const laborRows = oc_labor.map(l => `<tr>
        <td>${l.description||''}</td><td>${l.qty}</td><td>${formatMoney(l.unit_price)}</td>
        <td style="font-weight:700;">${formatMoney((l.qty||1)*(l.unit_price||0))}</td>
    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Нет работ</td></tr>';

    const body = `
        <div class="header">
            <div><div class="brand">📋 Калькуляция заказа</div><div style="font-size:22px; font-weight:900; margin-top:4px;">№ ${oc_orderId}</div></div>
            <div class="meta">${crmData?.client||''}<br>${crmData?.item||''}<br>${new Date().toLocaleDateString('ru-RU')}</div>
        </div>
        <h3>📦 Материалы</h3>
        <table><thead><tr><th>Название</th><th>Цвет</th><th>Упаковка</th><th>Кол-во</th><th>Цена/ед</th><th>Сумма</th></tr></thead>
        <tbody>${matRows}</tbody>
        <tfoot><tr class="total-row"><td colspan="5">Итого материалы:</td><td>${formatMoney(matTotal)}</td></tr></tfoot></table>

        <h3>🔧 Работа / монтаж</h3>
        <table><thead><tr><th>Описание</th><th>Кол-во</th><th>Цена/ед</th><th>Сумма</th></tr></thead>
        <tbody>${laborRows}</tbody>
        <tfoot><tr class="total-row"><td colspan="3">Итого работа:</td><td>${formatMoney(laborTotal)}</td></tr></tfoot></table>

        <table>
        <tr><td>Доставка</td><td style="text-align:right; font-weight:700;">${formatMoney(delivery)}</td></tr>
        <tr class="total-row"><td>СЕБЕСТОИМОСТЬ ИТОГО</td><td style="text-align:right;">${formatMoney(cost)}</td></tr>
        </table>
        ${oc_meta.notes ? `<p style="margin-top:16px; font-size:13px; color:var(--text-secondary);"><b>Примечание:</b> ${oc_meta.notes}</p>` : ''}
    `;
    openPrintWindow(`Калькуляция #${oc_orderId}`, body);
}

// Счёт клиенту — только цена продажи, без себестоимости
function printClientInvoice() {
    const crmData = crm_orders.find(c => c.oid === oc_orderId);
    const sale = oc_meta.sale_price || 0;

    const itemsRows = oc_materials.map(m => `<tr><td>${m.name||''} ${m.color?'('+m.color+')':''}</td><td>${m.qty} ${m.unit||'шт'}</td></tr>`).join('');
    const laborRows = oc_labor.map(l => `<tr><td>${l.description||''}</td><td>${l.qty}</td></tr>`).join('');

    const body = `
        <div class="header">
            <div><div class="brand">🧾 Счёт на оплату</div><div style="font-size:22px; font-weight:900; margin-top:4px;">Заказ № ${oc_orderId}</div></div>
            <div class="meta">${crmData?.client||''}<br>${crmData?.phone||''}<br>${new Date().toLocaleDateString('ru-RU')}</div>
        </div>
        <h3>Изделие</h3>
        <p style="font-size:15px; font-weight:700;">${crmData?.item || 'Не указано'}</p>
        ${itemsRows ? `<h3>Состав заказа</h3><table><thead><tr><th>Материал</th><th>Кол-во</th></tr></thead><tbody>${itemsRows}</tbody></table>` : ''}
        ${laborRows ? `<h3>Выполненные работы</h3><table><thead><tr><th>Работа</th><th>Кол-во</th></tr></thead><tbody>${laborRows}</tbody></table>` : ''}
        <table>
        <tr class="total-row"><td>ИТОГО К ОПЛАТЕ</td><td style="text-align:right;">${formatMoney(sale)}</td></tr>
        </table>
        <p style="margin-top:24px; font-size:12px; color:var(--text-muted);">Спасибо за заказ!</p>
    `;
    openPrintWindow(`Счёт #${oc_orderId}`, body);
}

// Печать фактуры услугчику — компактный формат 1/3 листа А4 (примерно 99мм высотой)
function printSvcReceipt(clientId) {
    const c = svc_clients.find(x => x.id == clientId);
    if (!c) return showToast('Клиент не найден', 'error');
    const txs = svc_transactions.filter(t => t.client_id == clientId);
    const total = txs.reduce((s,t) => s+(t.total_amount||0), 0);
    const paid  = txs.reduce((s,t) => s+(t.paid_amount||0), 0);
    const debt  = total - paid;

    // Берём последние операции (не более 12 строк, чтобы влезло в 1/3 А4)
    const recentTxs = [...txs].sort((a,b) => new Date(b.created_at)-new Date(a.created_at)).slice(0, 12);

    const rows = recentTxs.map(t => `<tr>
        <td style="font-size:10px;">${t.created_at ? new Date(t.created_at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}) : ''}</td>
        <td style="font-size:10px;">${t.service_type}</td>
        <td style="font-size:10px; text-align:center;">${t.qty}</td>
        <td style="font-size:10px; text-align:right;">${formatMoney(t.total_amount)}</td>
    </tr>`).join('');

    const body = `
        <div style="border:1px solid #1e293b; padding:10px; font-size:11px; line-height:1.4;">
            <div style="display:flex; justify-content:space-between; border-bottom:2px solid #3b27c1; padding-bottom:6px; margin-bottom:8px;">
                <b style="font-size:14px; color:#3b27c1;">ФАКТУРА УСЛУГ</b>
                <span style="font-size:10px;">${new Date().toLocaleDateString('ru-RU')}</span>
            </div>
            <div style="margin-bottom:6px;"><b>Клиент:</b> ${c.name} ${c.phone?'· '+c.phone:''}</div>
            <table style="width:100%; border-collapse:collapse; margin-bottom:6px;">
                <thead><tr style="border-bottom:1px solid #cbd5e1;">
                    <th style="font-size:9px; text-align:left; padding:3px 2px;">Дата</th>
                    <th style="font-size:9px; text-align:left; padding:3px 2px;">Услуга</th>
                    <th style="font-size:9px; text-align:center; padding:3px 2px;">Кол</th>
                    <th style="font-size:9px; text-align:right; padding:3px 2px;">Сумма</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <table style="width:100%; border-top:1px solid #1e293b; padding-top:4px;">
                <tr><td style="font-size:10px;">Всего:</td><td style="text-align:right; font-size:11px; font-weight:700;">${formatMoney(total)}</td></tr>
                <tr><td style="font-size:10px; color:#16a34a;">Оплачено:</td><td style="text-align:right; font-size:11px; color:#16a34a; font-weight:700;">${formatMoney(paid)}</td></tr>
                <tr><td style="font-size:11px; font-weight:900;">${debt>0?'К ОПЛАТЕ:':'Баланс:'}</td><td style="text-align:right; font-size:13px; font-weight:900; color:${debt>0?'#ef4444':'#16a34a'};">${formatMoney(Math.abs(debt))}</td></tr>
            </table>
        </div>
    `;
    // Размер страницы — треть А4 (примерно 210 x 99мм, книжная ориентация урезанная по высоте)
    openPrintWindow(`Фактура — ${c.name}`, body, '210mm 99mm');
}


// ═══════════════════════════════════════════════════════
// FINANCE MODULE — Финансы (сводный P&L)
// ═══════════════════════════════════════════════════════
let expenses = [];
let all_order_materials = []; // все order_materials по всем заказам (для агрегации)
let all_order_labor = [];
let all_order_calc_meta = [];

function showFinancePage() { showPage('page-finance'); loadFinanceData(); }

async function loadFinanceData() {
    try {
        const [expRes, matRes, labRes, metaRes] = await Promise.all([
            _supabase.from('expenses').select('*').order('date', { ascending: false }),
            _supabase.from('order_materials').select('*'),
            _supabase.from('order_labor').select('*'),
            _supabase.from('order_calc_meta').select('*')
        ]);
        if (expRes.error) { showToast('Таблица expenses не найдена — см. SQL ниже', 'error'); }
        expenses = expRes.data || [];
        all_order_materials = matRes.data || [];
        all_order_labor = labRes.data || [];
        all_order_calc_meta = metaRes.data || [];

        const pEl = document.getElementById('fin-period');
        if (pEl && !pEl.value) pEl.value = new Date().toISOString().slice(0,7);
        const expDateEl = document.getElementById('exp-date');
        if (expDateEl && !expDateEl.value) expDateEl.value = new Date().toISOString().slice(0,10);

        renderFinanceSummary();
        renderExpenses();
        renderFinanceMonthly();
    } catch(e) { console.error('Finance load error:', e); }
}

function showFinSection(name) {
    document.querySelectorAll('.fin-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.fin-subnav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('fin-sec-' + name)?.classList.add('active');
    const map = { summary:'сводк', monthly:'месяц', expenses:'расход' };
    document.querySelectorAll('.fin-subnav-btn').forEach(b => {
        if (b.textContent.toLowerCase().includes(map[name])) b.classList.add('active');
    });
    if (name === 'monthly') renderFinanceMonthly();
    if (name === 'expenses') renderExpenses();
}

// Возвращает себестоимость (материалы+работа+доставка) заказа по его id
function orderCost(orderId) {
    const mat = all_order_materials.filter(m => m.order_id === orderId).reduce((s,m) => s+(m.qty||0)*(m.unit_price||0), 0);
    const lab = all_order_labor.filter(l => l.order_id === orderId).reduce((s,l) => s+(l.qty||1)*(l.unit_price||0), 0);
    const meta = all_order_calc_meta.find(m => m.order_id === orderId);
    const delivery = meta?.delivery_cost || 0;
    return mat + lab + delivery;
}

// Возвращает цену продажи заказа (из калькуляции, иначе из CRM)
function orderSalePrice(crmOrder) {
    const meta = all_order_calc_meta.find(m => m.order_id === crmOrder.oid);
    if (meta && meta.sale_price) return meta.sale_price;
    return parseFloat(crmOrder.price) || 0;
}

// Собирает финансовые данные за период (month = 'YYYY-MM' или null для всего времени)
function computeFinancePeriod(month) {
    const inPeriod = (dateStr) => {
        if (!month) return true;
        return (dateStr || '').slice(0,7) === month;
    };

    const ordersRevenue = crm_orders
        .filter(c => inPeriod(c.date))
        .reduce((s, c) => s + orderSalePrice(c), 0);

    const ordersCost = crm_orders
        .filter(c => inPeriod(c.date))
        .reduce((s, c) => s + orderCost(c.oid), 0);

    const servicesRevenue = svc_transactions
        .filter(t => inPeriod(t.created_at))
        .reduce((s, t) => s + (t.total_amount || 0), 0);

    const expensesTotal = expenses
        .filter(e => inPeriod(e.date))
        .reduce((s, e) => s + (e.amount || 0), 0);

    const totalRevenue = ordersRevenue + servicesRevenue;
    const totalCost     = ordersCost;
    const grossProfit   = totalRevenue - totalCost;
    const netProfit      = grossProfit - expensesTotal;

    return { ordersRevenue, ordersCost, servicesRevenue, expensesTotal, totalRevenue, totalCost, grossProfit, netProfit };
}

function renderFinanceSummary() {
    const month = document.getElementById('fin-period')?.value || null;
    const f = computeFinancePeriod(month);

    const statsEl = document.getElementById('fin-stats');
    if (statsEl) statsEl.innerHTML = [
        { val: formatMoney(f.totalRevenue),  label: 'Общая выручка' },
        { val: formatMoney(f.totalCost),     label: 'Себестоимость (заказы)', color:'#f59e0b' },
        { val: formatMoney(f.grossProfit),   label: 'Валовая прибыль', color: f.grossProfit>=0?'var(--success)':'#ef4444' },
        { val: formatMoney(f.expensesTotal), label: 'Прочие расходы', color:'#ef4444' },
        { val: formatMoney(f.netProfit),     label: 'Чистая прибыль', color: f.netProfit>=0?'var(--success)':'#ef4444' },
        { val: (f.totalRevenue>0 ? (f.netProfit/f.totalRevenue*100).toFixed(1) : '0') + '%', label: 'Маржа чистой прибыли' },
    ].map(s => `<div class="fin-stat-card"><div class="fin-stat-val" style="${s.color?'color:'+s.color:''}">${s.val}</div><div class="fin-stat-label">${s.label}</div></div>`).join('');

    // Столбчатые полоски: выручка заказов / выручка услуг / себестоимость / расходы
    const barsEl = document.getElementById('fin-bars');
    if (barsEl) {
        const maxVal = Math.max(f.ordersRevenue, f.servicesRevenue, f.totalCost, f.expensesTotal, 1);
        const bars = [
            { label: 'Выручка (заказы)', val: f.ordersRevenue, color: '#3b27c1' },
            { label: 'Выручка (услуги)', val: f.servicesRevenue, color: '#8b5cf6' },
            { label: 'Себестоимость', val: f.totalCost, color: '#f59e0b' },
            { label: 'Расходы', val: f.expensesTotal, color: '#ef4444' },
            { label: 'Чистая прибыль', val: Math.max(0,f.netProfit), color: '#16a34a' },
        ];
        barsEl.innerHTML = bars.map(b => `
            <div class="fin-bar-row">
                <div class="fin-bar-label">${b.label}</div>
                <div class="fin-bar-track"><div class="fin-bar-fill" style="width:${Math.min(100, b.val/maxVal*100)}%; background:${b.color};"></div></div>
                <div class="fin-bar-val">${formatMoney(b.val)}</div>
            </div>`).join('');
    }
}

function renderFinanceMonthly() {
    const tbody = document.getElementById('fin-monthly-table');
    if (!tbody) return;

    // Собираем все месяцы, встречающиеся в данных
    const months = new Set();
    crm_orders.forEach(c => { if (c.date) months.add(c.date.slice(0,7)); });
    svc_transactions.forEach(t => { if (t.created_at) months.add(t.created_at.slice(0,7)); });
    expenses.forEach(e => { if (e.date) months.add(e.date.slice(0,7)); });

    const sortedMonths = [...months].sort().reverse();
    if (!sortedMonths.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted);">Нет данных</td></tr>`;
        return;
    }

    tbody.innerHTML = sortedMonths.map(m => {
        const f = computeFinancePeriod(m);
        const label = new Date(m+'-01').toLocaleString('ru-RU', {month:'long', year:'numeric'});
        return `<tr>
            <td data-label="Месяц" style="font-weight:700;">${label}</td>
            <td data-label="Выручка (заказы)">${formatMoney(f.ordersRevenue)}</td>
            <td data-label="Выручка (услуги)">${formatMoney(f.servicesRevenue)}</td>
            <td data-label="Себестоимость" style="color:#f59e0b;">${formatMoney(f.totalCost)}</td>
            <td data-label="Расходы" style="color:#ef4444;">${formatMoney(f.expensesTotal)}</td>
            <td data-label="Чистая прибыль" style="font-weight:800; color:${f.netProfit>=0?'var(--success)':'#ef4444'};">${formatMoney(f.netProfit)}</td>
        </tr>`;
    }).join('');
}

// ── РАСХОДЫ ────────────────────────────────────────────────
async function addExpense() {
    const category = document.getElementById('exp-category')?.value.trim();
    const description = document.getElementById('exp-desc')?.value.trim();
    const amount = parseFloat(document.getElementById('exp-amount')?.value) || 0;
    const date = document.getElementById('exp-date')?.value || new Date().toISOString().slice(0,10);
    if (!category) return showToast('Введите категорию', 'error');
    if (amount <= 0) return showToast('Введите сумму', 'error');

    const { data, error } = await _supabase.from('expenses').insert({ category, description, amount, date }).select();
    if (error) return showToast('Ошибка: ' + error.message, 'error');
    expenses.unshift(data[0]);
    ['exp-category','exp-desc','exp-amount','exp-date'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    renderExpenses();
    renderFinanceSummary();
    renderFinanceMonthly();
    showToast(`Расход добавлен: ${category} — ${formatMoney(amount)}`);
}

async function deleteExpense(id) {
    if (!confirm('Удалить расход?')) return;
    await _supabase.from('expenses').delete().eq('id', id);
    expenses = expenses.filter(e => e.id !== id);
    renderExpenses(); renderFinanceSummary(); renderFinanceMonthly();
}

function renderExpenses() {
    const el = document.getElementById('expenses-list');
    if (!el) return;
    const monthFilter = document.getElementById('exp-filter-month')?.value;
    let list = expenses;
    if (monthFilter) list = list.filter(e => (e.date||'').slice(0,7) === monthFilter);

    if (!list.length) { el.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:20px;">Нет расходов</div>'; return; }

    const total = list.reduce((s,e) => s+(e.amount||0), 0);
    el.innerHTML = `
        <div style="text-align:right; font-weight:800; margin-bottom:10px; color:#ef4444;">Итого: ${formatMoney(total)}</div>
        ${list.map(e => `<div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid #f1f5f9;">
            <div>
                <b>${e.category}</b>
                ${e.description ? `<span style="color:var(--text-secondary); font-size:12px;"> — ${e.description}</span>` : ''}
                <div style="font-size:11px; color:var(--text-muted);">${e.date ? new Date(e.date).toLocaleDateString('ru-RU') : ''}</div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
                <b style="color:#ef4444;">${formatMoney(e.amount)}</b>
                <button class="btn-red" style="padding:4px 8px; font-size:11px;" onclick="deleteExpense(${e.id})">✖</button>
            </div>
        </div>`).join('')}
    `;
}

// ═══════════════════════════════════════════════════════
// WAREHOUSE MODULE — Склад / остатки материалов
// ═══════════════════════════════════════════════════════
let warehouse_items = [];
let warehouse_movements = [];
let labor_catalog = []; // [{id, name, category, price_ours, price_client}]

function showWarehousePage() {
    showPage('page-warehouse');
    loadWarehouseData();
    loadBlankData();
    loadFinishedData();
}

function showWhSection(name) {
    document.querySelectorAll('.wh-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.wh-subnav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('wh-sec-' + name)?.classList.add('active');
    const map = { materials:'материал', blanks:'заготов', finished:'готовые изд', analytics:'аналитик' };
    document.querySelectorAll('.wh-subnav-btn').forEach(b => {
        if (b.textContent.toLowerCase().includes(map[name])) b.classList.add('active');
    });
    if (name === 'analytics') renderWhAnalytics();
    if (name === 'finished') populateFnRecipeBlankPicker();
}

async function loadWarehouseData() {
    try {
        const [itRes, mvRes, lbRes] = await Promise.all([
            _supabase.from('warehouse_items').select('*').order('name'),
            _supabase.from('warehouse_movements').select('*').order('created_at', { ascending: false }).limit(200),
            _supabase.from('labor_catalog').select('*').order('name')
        ]);
        if (itRes.error) { showToast('Таблицы склада не найдены — см. SQL', 'error'); return; }
        warehouse_items = itRes.data || [];
        warehouse_movements = mvRes.data || [];
        labor_catalog = lbRes.data || [];
        renderWarehouseItems();
        renderWarehouseMovements();
        renderLaborCatalog();
    } catch(e) { console.error('Warehouse load error:', e); }
}

async function addWarehouseItem() {
    const name = document.getElementById('wh-name')?.value.trim();
    const category = document.getElementById('wh-category')?.value.trim();
    const unit = document.getElementById('wh-unit')?.value.trim() || 'шт';
    const qty = parseFloat(document.getElementById('wh-qty')?.value) || 0;
    const unit_cost = parseFloat(document.getElementById('wh-cost')?.value) || 0;
    const min_qty = parseFloat(document.getElementById('wh-min')?.value) || 0;
    const photo_url = document.getElementById('wh-photo')?.value.trim() || null;
    if (!name) return showToast('Введите название', 'error');

    const { data, error } = await _supabase.from('warehouse_items')
        .insert({ name, category, unit, qty_in_stock: qty, unit_cost, min_qty, photo_url }).select();
    if (error) return showToast('Ошибка: ' + error.message, 'error');
    warehouse_items.push(data[0]);

    if (qty > 0) {
        await logWarehouseMovement(data[0].id, name, 'in', qty, 'Начальный остаток');
    }

    ['wh-name','wh-category','wh-qty','wh-cost','wh-min','wh-photo'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    const whUnitEl = document.getElementById('wh-unit'); if (whUnitEl) whUnitEl.value = 'шт';
    renderWarehouseItems();
    showToast(`Товар добавлен: ${name}`);
}

async function deleteWarehouseItem(id) {
    if (!confirm('Удалить товар со склада?')) return;
    await _supabase.from('warehouse_items').delete().eq('id', id);
    warehouse_items = warehouse_items.filter(i => i.id !== id);
    renderWarehouseItems();
}

// Записывает движение и обновляет остаток
async function logWarehouseMovement(itemId, itemName, type, qty, reason) {
    const rec = {
        item_id: itemId, item_name: itemName, type, qty, reason,
        user_name: curUser?.name || 'Система', created_at: new Date().toISOString()
    };
    const { data, error } = await _supabase.from('warehouse_movements').insert(rec).select();
    if (!error && data?.[0]) warehouse_movements.unshift(data[0]);

    const item = warehouse_items.find(i => i.id === itemId);
    if (item) {
        const delta = type === 'in' ? qty : -qty;
        item.qty_in_stock = (item.qty_in_stock || 0) + delta;
        await _supabase.from('warehouse_items').update({ qty_in_stock: item.qty_in_stock }).eq('id', itemId);
    }
    renderWarehouseMovements();
}

async function warehouseStockIn(itemId) {
    const item = warehouse_items.find(i => i.id === itemId);
    if (!item) return;
    const qty = parseFloat(prompt(`Приход товара "${item.name}"\nТекущий остаток: ${item.qty_in_stock} ${item.unit}\nСколько поступило:`));
    if (!qty || qty <= 0) return;
    const reason = prompt('Причина/поставщик (необязательно):') || 'Приход';
    await logWarehouseMovement(itemId, item.name, 'in', qty, reason);
    renderWarehouseItems();
    showToast(`+${qty} ${item.unit} — ${item.name}`);
}

async function warehouseStockOut(itemId) {
    const item = warehouse_items.find(i => i.id === itemId);
    if (!item) return;
    const qty = parseFloat(prompt(`Списание товара "${item.name}"\nТекущий остаток: ${item.qty_in_stock} ${item.unit}\nСколько списать:`));
    if (!qty || qty <= 0) return;
    if (qty > item.qty_in_stock) { if (!confirm('Списываемое количество больше остатка. Продолжить (уйдёт в минус)?')) return; }
    const reason = prompt('Причина списания:') || 'Списание';
    await logWarehouseMovement(itemId, item.name, 'out', qty, reason);
    renderWarehouseItems();
    showToast(`-${qty} ${item.unit} — ${item.name}`);
}

function renderWarehouseItems() {
    const el = document.getElementById('warehouse-items-list');
    if (!el) return;
    const search = (document.getElementById('wh-search')?.value || '').toLowerCase();
    let list = search ? warehouse_items.filter(i => i.name.toLowerCase().includes(search) || (i.category||'').toLowerCase().includes(search)) : warehouse_items;

    if (!list.length) { el.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:30px;">Нет товаров на складе</div>'; return; }

    // Сортируем: сначала товары с низким остатком
    list = [...list].sort((a,b) => {
        const aLow = a.min_qty > 0 && a.qty_in_stock <= a.min_qty;
        const bLow = b.min_qty > 0 && b.qty_in_stock <= b.min_qty;
        if (aLow && !bLow) return -1;
        if (!aLow && bLow) return 1;
        return a.name.localeCompare(b.name);
    });

    el.innerHTML = list.map(i => {
        const isLow = i.min_qty > 0 && i.qty_in_stock <= i.min_qty;
        const photo = i.photo_url ? `<img src="${i.photo_url}" class="wh-photo-thumb" onerror="this.style.display='none'">` : '';
        return `<div class="wh-item-row ${isLow?'low-stock':''}">
            ${photo}
            <div style="flex:1;">
                <div class="wh-item-name">${isLow?'⚠️ ':''}${i.name}</div>
                <div class="wh-item-meta">
                    <span class="wh-tag">${i.category||'Без категории'}</span>
                    ${i.unit_cost ? `<span class="wh-tag">${formatMoney(i.unit_cost)} / ${i.unit}</span>` : ''}
                </div>
                ${i.min_qty>0 ? `<div><span class="wh-min-badge">⚠ Мин. остаток: ${i.min_qty} ${i.unit}</span></div>` : ''}
            </div>
            <div class="wh-qty-block">
                <div class="wh-qty-badge ${isLow?'wh-qty-low':'wh-qty-ok'}">${i.qty_in_stock}</div>
                <div class="wh-qty-unit">${i.unit}</div>
                <div class="wh-qty-caption">на складе</div>
            </div>
            <div style="display:flex; gap:6px;">
                <button class="btn-green" style="padding:6px 12px; font-size:12px;" onclick="warehouseStockIn(${i.id})">+ Приход</button>
                <button class="btn-red" style="padding:6px 12px; font-size:12px;" onclick="warehouseStockOut(${i.id})">− Расход</button>
                <button class="btn-ghost" style="padding:6px 10px; font-size:12px;" onclick="deleteWarehouseItem(${i.id})">✖</button>
            </div>
        </div>`;
    }).join('');
}

function renderWarehouseMovements() {
    const tbody = document.getElementById('warehouse-movements-table');
    if (!tbody) return;
    const search = (document.getElementById('wh-move-filter')?.value || '').toLowerCase();
    let list = search ? warehouse_movements.filter(m => (m.item_name||'').toLowerCase().includes(search)) : warehouse_movements;
    list = list.slice(0, 60);

    if (!list.length) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted);">Нет движений</td></tr>`; return; }

    tbody.innerHTML = list.map(m => {
        const dt = m.created_at ? new Date(m.created_at).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
        return `<tr>
            <td data-label="Дата" style="font-size:12px; white-space:nowrap;">${dt}</td>
            <td data-label="Товар" style="font-weight:700;">${m.item_name}</td>
            <td data-label="Тип">${m.type==='in' ? '<span class="wh-move-in">↓ Приход</span>' : '<span class="wh-move-out">↑ Расход</span>'}</td>
            <td data-label="Кол-во" class="${m.type==='in'?'wh-move-in':'wh-move-out'}">${m.type==='in'?'+':'-'}${m.qty}</td>
            <td data-label="Причина" style="font-size:12px; color:var(--text-secondary);">${m.reason||'—'}</td>
            <td data-label="Кто" style="font-size:12px; color:var(--text-secondary);">${m.user_name||'—'}</td>
        </tr>`;
    }).join('');
}

// Списать материал заказа со склада (вызывается из Order Calculation)
async function deductFromWarehouseByName(materialName, qty) {
    if (!warehouse_items.length) await loadWarehouseData();
    const item = warehouse_items.find(i => i.name.toLowerCase() === (materialName||'').toLowerCase());
    if (!item) {
        showToast(`«${materialName}» не найден на складе — списание пропущено`, 'error');
        return false;
    }
    await logWarehouseMovement(item.id, item.name, 'out', qty, `Списано в заказ #${oc_orderId}`);
    showToast(`Списано со склада: ${qty} ${item.unit} — ${item.name}`);
    return true;
}



// ═══════════════════════════════════════════════════════
// BLANKS MODULE — Заготовки (полуфабрикаты)
// ═══════════════════════════════════════════════════════
let blank_items = [];
let blank_movements = [];

async function loadBlankData() {
    try {
        const [itRes, mvRes] = await Promise.all([
            _supabase.from('blank_items').select('*').order('category'),
            _supabase.from('blank_movements').select('*').order('created_at', { ascending: false }).limit(200)
        ]);
        if (itRes.error) { return; } // таблица может быть не создана — молча пропускаем
        blank_items = itRes.data || [];
        blank_movements = mvRes.data || [];
        renderBlankItems();
        renderBlankMovements();
    } catch(e) { console.error('Blanks load error:', e); }
}

async function addBlankItem() {
    const category = document.getElementById('bl-category')?.value.trim();
    const type = document.getElementById('bl-type')?.value.trim();
    const name = document.getElementById('bl-name')?.value.trim();
    const finish = document.getElementById('bl-finish')?.value.trim();
    const unit = document.getElementById('bl-unit')?.value.trim() || 'шт';
    const qty = parseFloat(document.getElementById('bl-qty')?.value) || 0;
    const min_qty = parseFloat(document.getElementById('bl-min')?.value) || 0;
    const photo_url = document.getElementById('bl-photo')?.value.trim() || null;
    if (!name) return showToast('Введите название/цвет', 'error');

    const { data, error } = await _supabase.from('blank_items')
        .insert({ category, type, name, finish, unit, qty_in_stock: qty, min_qty, photo_url }).select();
    if (error) return showToast('Ошибка: ' + error.message + ' — см. SQL для создания таблиц', 'error');
    blank_items.push(data[0]);

    if (qty > 0) await logBlankMovement(data[0].id, blankDisplayName(data[0]), 'in', qty, 'Начальный остаток');

    ['bl-category','bl-type','bl-name','bl-finish','bl-qty','bl-min','bl-photo'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    const unitEl = document.getElementById('bl-unit'); if (unitEl) unitEl.value = 'шт';
    renderBlankItems();
    showToast(`Заготовка добавлена: ${name}`);
}

async function deleteBlankItem(id) {
    if (!confirm('Удалить заготовку?')) return;
    await _supabase.from('blank_items').delete().eq('id', id);
    blank_items = blank_items.filter(i => i.id !== id);
    renderBlankItems();
}

function blankDisplayName(item) {
    return [item.category, item.type, item.name, item.finish].filter(Boolean).join(' · ');
}

async function logBlankMovement(itemId, itemName, type, qty, reason) {
    const rec = { item_id: itemId, item_name: itemName, type, qty, reason,
        user_name: curUser?.name || 'Система', created_at: new Date().toISOString() };
    const { data, error } = await _supabase.from('blank_movements').insert(rec).select();
    if (!error && data?.[0]) blank_movements.unshift(data[0]);

    const item = blank_items.find(i => i.id === itemId);
    if (item) {
        const delta = type === 'in' ? qty : -qty;
        item.qty_in_stock = (item.qty_in_stock || 0) + delta;
        await _supabase.from('blank_items').update({ qty_in_stock: item.qty_in_stock }).eq('id', itemId);
    }
    renderBlankMovements();
}

async function blankStockIn(itemId) {
    const item = blank_items.find(i => i.id === itemId);
    if (!item) return;
    const qty = parseFloat(prompt(`Приход заготовки «${blankDisplayName(item)}»\nТекущий остаток: ${item.qty_in_stock} ${item.unit}\nСколько произведено:`));
    if (!qty || qty <= 0) return;
    const reason = prompt('Комментарий (необязательно):') || 'Приход';
    await logBlankMovement(itemId, blankDisplayName(item), 'in', qty, reason);
    renderBlankItems();
    showToast(`+${qty} ${item.unit} — ${blankDisplayName(item)}`);
}

async function blankStockOut(itemId) {
    const item = blank_items.find(i => i.id === itemId);
    if (!item) return;
    const qty = parseFloat(prompt(`Расход заготовки «${blankDisplayName(item)}»\nТекущий остаток: ${item.qty_in_stock} ${item.unit}\nСколько списать:`));
    if (!qty || qty <= 0) return;
    if (qty > item.qty_in_stock) { if (!confirm('Списываемое количество больше остатка. Продолжить?')) return; }
    const reason = prompt('Причина списания:') || 'Списание';
    await logBlankMovement(itemId, blankDisplayName(item), 'out', qty, reason);
    renderBlankItems();
    showToast(`-${qty} ${item.unit} — ${blankDisplayName(item)}`);
}

function renderBlankItems() {
    const el = document.getElementById('blank-items-list');
    if (!el) return;
    const search = (document.getElementById('bl-search')?.value || '').toLowerCase();
    let list = search ? blank_items.filter(i => blankDisplayName(i).toLowerCase().includes(search)) : blank_items;

    if (!list.length) { el.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:30px;">Нет заготовок на складе</div>'; return; }

    list = [...list].sort((a,b) => {
        const aLow = a.min_qty > 0 && a.qty_in_stock <= a.min_qty;
        const bLow = b.min_qty > 0 && b.qty_in_stock <= b.min_qty;
        if (aLow && !bLow) return -1;
        if (!aLow && bLow) return 1;
        return (a.category||'').localeCompare(b.category||'');
    });

    el.innerHTML = list.map(i => {
        const isLow = i.min_qty > 0 && i.qty_in_stock <= i.min_qty;
        const photo = i.photo_url ? `<img src="${i.photo_url}" class="wh-photo-thumb" onerror="this.style.display='none'">` : '';
        return `<div class="wh-item-row ${isLow?'low-stock':''}">
            ${photo}
            <div style="flex:1;">
                <div class="wh-item-name">${isLow?'⚠️ ':''}${i.name} ${i.finish ? '<span style="font-weight:400; color:var(--text-secondary);">('+i.finish+')</span>' : ''}</div>
                <div class="wh-item-meta">
                    <span class="wh-tag">${i.category||'Без категории'}</span>
                    ${i.type ? `<span class="wh-tag">${i.type}</span>` : ''}
                </div>
                ${i.min_qty>0 ? `<div><span class="wh-min-badge">⚠ Мин. остаток: ${i.min_qty} ${i.unit}</span></div>` : ''}
            </div>
            <div class="wh-qty-block">
                <div class="wh-qty-badge ${isLow?'wh-qty-low':'wh-qty-ok'}">${i.qty_in_stock}</div>
                <div class="wh-qty-unit">${i.unit}</div>
                <div class="wh-qty-caption">на складе</div>
            </div>
            <div style="display:flex; gap:6px;">
                <button class="btn-green" style="padding:6px 12px; font-size:12px;" onclick="blankStockIn(${i.id})">+ Приход</button>
                <button class="btn-red" style="padding:6px 12px; font-size:12px;" onclick="blankStockOut(${i.id})">− Расход</button>
                <button class="btn-ghost" style="padding:6px 10px; font-size:12px;" onclick="deleteBlankItem(${i.id})">✖</button>
            </div>
        </div>`;
    }).join('');
}

let blMovePeriod = 'day';

function setBlMovePeriod(period) {
    blMovePeriod = period;
    document.querySelectorAll('.bl-move-period-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'transparent'; b.style.color = '#64748b'; b.style.boxShadow = 'none';
    });
    const map = { day:'сегодня', week:'недел', month:'месяц', all:'всё время' };
    document.querySelectorAll('.bl-move-period-btn').forEach(b => {
        if (b.textContent.toLowerCase().includes(map[period])) {
            b.classList.add('active');
            b.style.background = '#fff'; b.style.color = 'var(--primary)'; b.style.boxShadow = '0 1px 4px rgba(0,0,0,0.08)';
        }
    });
    renderBlankMovements();
}

function isInBlMovePeriod(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr); const now = new Date();
    if (blMovePeriod === 'all') return true;
    if (blMovePeriod === 'day') return d.toDateString() === now.toDateString();
    if (blMovePeriod === 'week') { const wa = new Date(now); wa.setDate(now.getDate()-7); return d >= wa && d <= now; }
    if (blMovePeriod === 'month') return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth();
    return true;
}

function renderBlankMovements() {
    const el = document.getElementById('blank-movements-list');
    const summaryEl = document.getElementById('bl-move-summary');
    if (!el) return;
    const search = (document.getElementById('bl-move-filter')?.value || '').toLowerCase();

    let list = blank_movements.filter(m => isInBlMovePeriod(m.created_at));
    if (search) list = list.filter(m => (m.item_name||'').toLowerCase().includes(search));

    // Сводка за период
    const totalIn  = list.filter(m => m.type==='in').reduce((s,m)=>s+(m.qty||0),0);
    const totalOut = list.filter(m => m.type==='out').reduce((s,m)=>s+(m.qty||0),0);
    if (summaryEl) {
        summaryEl.innerHTML = `
            <div class="svc-stat-card" style="flex:1; min-width:120px;"><div class="svc-stat-val" style="color:var(--success);">+${totalIn.toFixed(0)}</div><div class="svc-stat-label">Приход за период</div></div>
            <div class="svc-stat-card" style="flex:1; min-width:120px;"><div class="svc-stat-val" style="color:#ef4444;">-${totalOut.toFixed(0)}</div><div class="svc-stat-label">Расход за период</div></div>
            <div class="svc-stat-card" style="flex:1; min-width:120px;"><div class="svc-stat-val">${list.length}</div><div class="svc-stat-label">Записей</div></div>
        `;
    }

    if (!list.length) { el.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:24px;">Нет движений за выбранный период</div>'; return; }

    // Группируем по дню
    const sorted = [...list].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    const byDate = {};
    sorted.forEach(m => {
        const d = (m.created_at || '').slice(0, 10);
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(m);
    });

    el.innerHTML = Object.entries(byDate).map(([date, recs]) => {
        const dayIn  = recs.filter(m=>m.type==='in').reduce((s,m)=>s+(m.qty||0),0);
        const dayOut = recs.filter(m=>m.type==='out').reduce((s,m)=>s+(m.qty||0),0);
        const dayLabel = new Date(date+'T00:00:00').toLocaleDateString('ru-RU', {day:'2-digit', month:'long', weekday:'short'});
        return `<div style="margin-bottom:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:2px solid #e2e8f0; margin-bottom:8px;">
                <b style="color:var(--primary); font-size:14px;">📅 ${dayLabel}</b>
                <span style="font-size:12px; font-weight:700;"><span style="color:var(--success);">+${dayIn.toFixed(0)}</span> <span style="color:#ef4444; margin-left:8px;">-${dayOut.toFixed(0)}</span></span>
            </div>
            ${recs.map(m => {
                const time = m.created_at ? new Date(m.created_at).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}) : '';
                return `<div style="display:flex; justify-content:space-between; align-items:center; padding:9px 12px; background:var(--surface); border-radius:10px; margin-bottom:6px;">
                    <div>
                        <div style="font-weight:700; font-size:13px;">${m.item_name}</div>
                        <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">${time} · ${m.user_name||'—'}${m.reason?' · '+m.reason:''}</div>
                    </div>
                    <div class="${m.type==='in'?'wh-move-in':'wh-move-out'}" style="font-size:15px; font-weight:900;">${m.type==='in'?'+':'-'}${m.qty}</div>
                </div>`;
            }).join('')}
        </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════
// FINISHED GOODS MODULE — Готовые изделия (со сборкой из заготовок)
// ═══════════════════════════════════════════════════════
let finished_items = [];
let finished_recipe = [];
let finished_movements = [];
let fn_recipe_item_id = null;

async function loadFinishedData() {
    try {
        const [itRes, rcRes, mvRes] = await Promise.all([
            _supabase.from('finished_items').select('*').order('category'),
            _supabase.from('finished_recipe').select('*'),
            _supabase.from('finished_movements').select('*').order('created_at', { ascending: false }).limit(200)
        ]);
        if (itRes.error) { return; }
        finished_items = itRes.data || [];
        finished_recipe = rcRes.data || [];
        finished_movements = mvRes.data || [];
        renderFinishedItems();
        renderFinishedMovements();
    } catch(e) { console.error('Finished goods load error:', e); }
}

async function addFinishedItem() {
    const category = document.getElementById('fn-category')?.value.trim();
    const name = document.getElementById('fn-name')?.value.trim();
    const unit = document.getElementById('fn-unit')?.value.trim() || 'шт';
    const photo_url = document.getElementById('fn-photo')?.value.trim() || null;
    if (!name) return showToast('Введите название', 'error');

    const { data, error } = await _supabase.from('finished_items')
        .insert({ category, name, unit, qty_in_stock: 0, photo_url }).select();
    if (error) return showToast('Ошибка: ' + error.message + ' — см. SQL для создания таблиц', 'error');
    finished_items.push(data[0]);

    ['fn-category','fn-name','fn-photo'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    const fnUnitEl = document.getElementById('fn-unit'); if (fnUnitEl) fnUnitEl.value = 'шт';
    renderFinishedItems();
    showToast(`Карточка изделия создана: ${name}. Теперь настройте рецепт →`);
}

async function deleteFinishedItem(id) {
    if (!confirm('Удалить готовое изделие? Рецепт тоже удалится.')) return;
    await _supabase.from('finished_items').delete().eq('id', id);
    await _supabase.from('finished_recipe').delete().eq('finished_item_id', id);
    finished_items = finished_items.filter(i => i.id !== id);
    finished_recipe = finished_recipe.filter(r => r.finished_item_id !== id);
    renderFinishedItems();
}

// ── РЕЦЕПТ ──
function populateFnRecipeBlankPicker() {
    const sel = document.getElementById('fn-recipe-blank-pick');
    if (!sel) return;
    sel.innerHTML = '<option value="">Выберите заготовку...</option>' +
        blank_items.map(b => `<option value="${b.id}">${blankDisplayName(b)}</option>`).join('');
}

function openFnRecipeModal(itemId) {
    fn_recipe_item_id = itemId;
    const item = finished_items.find(i => i.id === itemId);
    if (!item) return;
    document.getElementById('fn-recipe-name').innerText = item.name;
    populateFnRecipeBlankPicker();
    renderFnRecipeComponents();
    document.getElementById('fn-recipe-modal').classList.remove('hidden');
}

function closeFnRecipeModal() {
    document.getElementById('fn-recipe-modal').classList.add('hidden');
    fn_recipe_item_id = null;
    renderFinishedItems();
}

async function addFnRecipeComponent() {
    const blankId = document.getElementById('fn-recipe-blank-pick')?.value;
    const qtyPerUnit = parseFloat(document.getElementById('fn-recipe-qty')?.value) || 1;
    if (!blankId) return showToast('Выберите заготовку', 'error');
    const blank = blank_items.find(b => b.id == blankId);

    const existing = finished_recipe.find(r => r.finished_item_id === fn_recipe_item_id && r.blank_item_id == blankId);
    if (existing) {
        existing.qty_per_unit = qtyPerUnit;
        await _supabase.from('finished_recipe').update({ qty_per_unit: qtyPerUnit }).eq('id', existing.id);
    } else {
        const { data, error } = await _supabase.from('finished_recipe').insert({
            finished_item_id: fn_recipe_item_id, blank_item_id: parseInt(blankId),
            blank_item_name: blankDisplayName(blank), qty_per_unit: qtyPerUnit
        }).select();
        if (error) return showToast('Ошибка: ' + error.message, 'error');
        finished_recipe.push(data[0]);
    }
    document.getElementById('fn-recipe-qty').value = '';
    renderFnRecipeComponents();
    showToast('Компонент добавлен в рецепт');
}

async function removeFnRecipeComponent(id) {
    await _supabase.from('finished_recipe').delete().eq('id', id);
    finished_recipe = finished_recipe.filter(r => r.id !== id);
    renderFnRecipeComponents();
}

function renderFnRecipeComponents() {
    const el = document.getElementById('fn-recipe-components-list');
    if (!el) return;
    const components = finished_recipe.filter(r => r.finished_item_id === fn_recipe_item_id);
    if (!components.length) {
        el.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:16px;">Рецепт пуст. Добавьте заготовки выше.</div>';
        return;
    }
    el.innerHTML = components.map(c => `<div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:var(--surface); border-radius:10px; margin-bottom:6px;">
        <div style="font-weight:700; font-size:13px;">${c.blank_item_name}</div>
        <div style="display:flex; align-items:center; gap:10px;">
            <span class="wh-recipe-chip">× ${c.qty_per_unit}</span>
            <button class="btn-red" style="padding:3px 8px; font-size:11px;" onclick="removeFnRecipeComponent(${c.id})">✖</button>
        </div>
    </div>`).join('');
}

function getFnRecipeComponentCount(itemId) {
    return finished_recipe.filter(r => r.finished_item_id === itemId).length;
}

// ── СБОРКА ──
async function assembleFinishedItem(itemId) {
    const item = finished_items.find(i => i.id === itemId);
    if (!item) return;
    const recipe = finished_recipe.filter(r => r.finished_item_id === itemId);
    if (!recipe.length) return showToast('Сначала настройте рецепт для этого изделия', 'error');

    const qty = parseFloat(prompt(`Сборка «${item.name}»\nРецепт:\n${recipe.map(r => `— ${r.blank_item_name} × ${r.qty_per_unit}`).join('\n')}\n\nСколько штук собрать:`));
    if (!qty || qty <= 0) return;

    // Проверяем достаточность заготовок
    const shortages = [];
    const consumption = [];
    recipe.forEach(r => {
        const blank = blank_items.find(b => b.id === r.blank_item_id);
        const needed = r.qty_per_unit * qty;
        consumption.push(`${r.blank_item_name} × ${needed}`);
        if (!blank || blank.qty_in_stock < needed) {
            shortages.push(`${r.blank_item_name}: нужно ${needed}, есть ${blank?.qty_in_stock || 0}`);
        }
    });

    if (!confirm(`Подтвердите сборку «${item.name}» × ${qty}\n\nБудет списано:\n${consumption.join('\n')}${shortages.length ? '\n\n⚠️ НЕ ХВАТАЕТ:\n'+shortages.join('\n') : ''}`)) return;

    // Списываем заготовки
    for (const r of recipe) {
        const blank = blank_items.find(b => b.id === r.blank_item_id);
        if (blank) await logBlankMovement(blank.id, blankDisplayName(blank), 'out', r.qty_per_unit * qty, `Сборка: ${item.name} × ${qty}`);
    }

    // Приходуем готовое изделие — с детальным составом в примечании
    const composition = recipe.map(r => `${r.blank_item_name}×${r.qty_per_unit * qty}`).join(', ');
    await logFinishedMovement(itemId, item.name, 'in', qty, `Собрано из: ${composition}`, null, null);

    renderBlankItems();
    renderFinishedItems();
    showToast(`✔ Собрано: ${item.name} × ${qty}`);
}

// ── ОТГРУЗКА / ПРОДАЖА ──
async function shipFinishedItem(itemId) {
    const item = finished_items.find(i => i.id === itemId);
    if (!item) return;
    const qty = parseFloat(prompt(`Отгрузка «${item.name}»\nТекущий остаток: ${item.qty_in_stock} ${item.unit}\nСколько отгрузить/продать:`));
    if (!qty || qty <= 0) return;
    if (qty > item.qty_in_stock) { if (!confirm('Отгружаемое количество больше остатка. Продолжить?')) return; }

    const recipient = prompt('Кому / куда (необязательно):') || '';
    const photo_url = prompt('Ссылка на фото отгруженного (необязательно):') || null;

    await logFinishedMovement(itemId, item.name, 'out', qty, 'Отгружено', recipient, photo_url);
    renderFinishedItems();
    showToast(`📤 Отгружено: ${qty} ${item.unit} — ${item.name}`);
}

async function logFinishedMovement(itemId, itemName, type, qty, reason, recipient, photo_url) {
    const rec = { item_id: itemId, item_name: itemName, type, qty, reason, recipient, photo_url,
        user_name: curUser?.name || 'Система', created_at: new Date().toISOString() };
    const { data, error } = await _supabase.from('finished_movements').insert(rec).select();
    if (!error && data?.[0]) finished_movements.unshift(data[0]);

    const item = finished_items.find(i => i.id === itemId);
    if (item) {
        const delta = type === 'in' ? qty : -qty;
        item.qty_in_stock = (item.qty_in_stock || 0) + delta;
        await _supabase.from('finished_items').update({ qty_in_stock: item.qty_in_stock }).eq('id', itemId);
    }
    renderFinishedMovements();
}

async function deleteFinishedMovement(id) {
    if (!confirm('Удалить запись?')) return;
    await _supabase.from('finished_movements').delete().eq('id', id);
    finished_movements = finished_movements.filter(m => m.id !== id);
    renderFinishedMovements();
}

function renderFinishedItems() {
    const el = document.getElementById('finished-items-list');
    if (!el) return;
    const search = (document.getElementById('fn-search')?.value || '').toLowerCase();
    let list = search ? finished_items.filter(i => i.name.toLowerCase().includes(search) || (i.category||'').toLowerCase().includes(search)) : finished_items;

    if (!list.length) { el.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:30px;">Нет готовых изделий. Добавьте карточку выше.</div>'; return; }

    el.innerHTML = list.map(i => {
        const photo = i.photo_url ? `<img src="${i.photo_url}" class="wh-photo-thumb" onerror="this.style.display='none'">` : '';
        const recipeCount = getFnRecipeComponentCount(i.id);
        return `<div class="wh-item-row">
            ${photo}
            <div style="flex:1;">
                <div class="wh-item-name">${i.name}</div>
                <div class="wh-item-meta">
                    <span class="wh-tag">${i.category||'Без категории'}</span>
                    <span class="wh-recipe-chip">📋 ${recipeCount} компонент${recipeCount===1?'':'ов'} в рецепте</span>
                </div>
            </div>
            <div class="wh-qty-block">
                <div class="wh-qty-badge wh-qty-ok">${i.qty_in_stock}</div>
                <div class="wh-qty-unit">${i.unit}</div>
                <div class="wh-qty-caption">на складе</div>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; max-width:280px;">
                <button class="btn-ghost" style="padding:6px 10px; font-size:12px;" onclick="openFnRecipeModal(${i.id})">📋 Рецепт</button>
                <button class="btn-blue" style="padding:6px 10px; font-size:12px;" onclick="assembleFinishedItem(${i.id})">🔨 Собрать</button>
                <button class="btn-green" style="padding:6px 10px; font-size:12px;" onclick="shipFinishedItem(${i.id})">📤 Отгрузить</button>
                <button class="btn-red" style="padding:6px 10px; font-size:12px;" onclick="deleteFinishedItem(${i.id})">✖</button>
            </div>
        </div>`;
    }).join('');
}

function renderFinishedMovements() {
    const el = document.getElementById('finished-movements-list');
    if (!el) return;
    const search = (document.getElementById('fn-move-filter')?.value || '').toLowerCase();
    let list = search ? finished_movements.filter(m => (m.item_name||'').toLowerCase().includes(search)) : finished_movements;
    list = list.slice(0, 60);

    if (!list.length) { el.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:20px;">Нет записей</div>'; return; }

    el.innerHTML = list.map(m => {
        const dt = m.created_at ? new Date(m.created_at).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
        const photo = m.photo_url ? `<img src="${m.photo_url}" class="wh-photo-thumb" onerror="this.style.display='none'" style="cursor:pointer;" onclick="window.open('${esc(m.photo_url)}','_blank')">` : '';
        return `<div style="display:flex; align-items:center; gap:12px; padding:10px 12px; background:var(--surface); border-radius:10px; margin-bottom:6px;">
            ${photo}
            <div style="flex:1;">
                <div style="font-weight:700; font-size:13px;">
                    ${m.type==='in' ? '<span class="wh-move-in">🔨 Собрано</span>' : '<span class="wh-shipped-badge">📤 Отгружено</span>'}
                    &nbsp;${m.item_name} — ${m.qty} шт
                </div>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">
                    ${dt} · ${m.user_name || '—'}${m.recipient ? ' · Кому: ' + m.recipient : ''}${m.reason ? ' · ' + m.reason : ''}
                </div>
            </div>
            <button class="btn-red" style="padding:4px 8px; font-size:11px;" onclick="deleteFinishedMovement(${m.id})">✖</button>
        </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════
// АНАЛИТИКА СКЛАДОВ — период день/неделя/месяц/всё время
// ═══════════════════════════════════════════════════════
let whPeriod = 'day';

function setWhPeriod(period) {
    whPeriod = period;
    document.querySelectorAll('.wh-period-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'transparent';
        b.style.color = '#64748b';
        b.style.boxShadow = 'none';
    });
    const map = { day: 'сегодня', week: 'недел', month: 'месяц', all: 'всё время' };
    document.querySelectorAll('.wh-period-btn').forEach(b => {
        if (b.textContent.toLowerCase().includes(map[period])) {
            b.classList.add('active');
            b.style.background = '#fff';
            b.style.color = 'var(--primary)';
            b.style.boxShadow = '0 1px 4px rgba(0,0,0,0.08)';
        }
    });
    renderWhAnalytics();
}

function isInWhPeriod(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const now = new Date();
    if (whPeriod === 'all') return true;
    if (whPeriod === 'day') return d.toDateString() === now.toDateString();
    if (whPeriod === 'week') { const weekAgo = new Date(now); weekAgo.setDate(now.getDate()-7); return d >= weekAgo && d <= now; }
    if (whPeriod === 'month') return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth();
    return true;
}

function renderWhAnalytics() {
    const statsEl = document.getElementById('wh-analytics-stats');
    if (statsEl) {
        const blanksMade = blank_movements.filter(m => m.type==='in' && isInWhPeriod(m.created_at)).reduce((s,m)=>s+(m.qty||0),0);
        const assembled  = finished_movements.filter(m => m.type==='in' && isInWhPeriod(m.created_at)).reduce((s,m)=>s+(m.qty||0),0);
        const shipped    = finished_movements.filter(m => m.type==='out' && isInWhPeriod(m.created_at)).reduce((s,m)=>s+(m.qty||0),0);
        const totalMaterials = warehouse_items.length;
        const totalBlanks    = blank_items.reduce((s,i)=>s+(i.qty_in_stock||0),0);
        const totalFinished  = finished_items.reduce((s,i)=>s+(i.qty_in_stock||0),0);

        statsEl.innerHTML = [
            { val: blanksMade, label: 'Заготовок произведено' },
            { val: assembled,  label: 'Изделий собрано', color:'var(--primary)' },
            { val: shipped,    label: 'Изделий отгружено', color:'#f59e0b' },
            { val: totalMaterials, label: 'Видов материалов' },
            { val: totalBlanks.toFixed(0), label: 'Заготовок в наличии' },
            { val: totalFinished.toFixed(0), label: 'Готовых изделий в наличии', color:'var(--success)' },
        ].map(s => `<div class="svc-stat-card"><div class="svc-stat-val" style="${s.color?'color:'+s.color:''}">${s.val}</div><div class="svc-stat-label">${s.label}</div></div>`).join('');
    }

    // Кто сколько заготовок произвёл
    const blanksByWorkerEl = document.getElementById('wh-analytics-blanks-by-worker');
    if (blanksByWorkerEl) {
        const byWorker = {};
        blank_movements.filter(m => m.type==='in' && isInWhPeriod(m.created_at)).forEach(m => {
            const w = m.user_name || 'Неизвестно';
            byWorker[w] = (byWorker[w]||0) + (m.qty||0);
        });
        const rows = Object.entries(byWorker).sort((a,b)=>b[1]-a[1]);
        blanksByWorkerEl.innerHTML = rows.length ? rows.map(([w,qty]) => `
            <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #f1f5f9;">
                <b>${w}</b><span style="font-weight:800; color:var(--primary);">${qty} шт</span>
            </div>`).join('') : '<div style="color:var(--text-muted); padding:10px;">Нет данных за период</div>';
    }

    // Кто сколько собрал
    const assembledByWorkerEl = document.getElementById('wh-analytics-assembled-by-worker');
    if (assembledByWorkerEl) {
        const byWorker = {};
        finished_movements.filter(m => m.type==='in' && isInWhPeriod(m.created_at)).forEach(m => {
            const w = m.user_name || 'Неизвестно';
            byWorker[w] = (byWorker[w]||0) + (m.qty||0);
        });
        const rows = Object.entries(byWorker).sort((a,b)=>b[1]-a[1]);
        assembledByWorkerEl.innerHTML = rows.length ? rows.map(([w,qty]) => `
            <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #f1f5f9;">
                <b>${w}</b><span style="font-weight:800; color:var(--success);">${qty} шт</span>
            </div>`).join('') : '<div style="color:var(--text-muted); padding:10px;">Нет данных за период</div>';
    }

    // Недавно отгружено (галерея с фото)
    const shippedGalleryEl = document.getElementById('wh-analytics-shipped-gallery');
    if (shippedGalleryEl) {
        const shippedList = finished_movements.filter(m => m.type==='out' && isInWhPeriod(m.created_at)).slice(0, 20);
        if (!shippedList.length) {
            shippedGalleryEl.innerHTML = '<div style="color:var(--text-muted); padding:10px;">Нет отгрузок за период</div>';
        } else {
            shippedGalleryEl.innerHTML = `<div style="display:flex; flex-direction:column; gap:8px;">${shippedList.map(m => {
                const dt = m.created_at ? new Date(m.created_at).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
                const photo = m.photo_url ? `<img src="${m.photo_url}" class="wh-photo-thumb" style="width:60px; height:60px;" onerror="this.style.display='none'" onclick="window.open('${esc(m.photo_url)}','_blank')">` : '<div class="wh-photo-thumb" style="width:60px;height:60px;display:flex;align-items:center;justify-content:center;color:#cbd5e1;">📦</div>';
                return `<div style="display:flex; align-items:center; gap:12px; padding:10px; background:var(--surface); border-radius:12px;">
                    ${photo}
                    <div style="flex:1;">
                        <div style="font-weight:800;">${m.item_name} × ${m.qty}</div>
                        <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">${dt} · Сдал: ${m.user_name}${m.recipient?' · Кому: '+m.recipient:''}</div>
                    </div>
                </div>`;
            }).join('')}</div>`;
        }
    }
}


// --- TELEGRAM FUNCTIONS ---
async function loadTelegramData() {
    try {
        // Загружаем токен бота
        const { data: settings, error: settingsError } = await _supabase
            .from('telegram_settings')
            .select('*')
            .single();
        
        if (!settingsError && settings) {
            botToken = settings.bot_token || '';
            document.getElementById('telegram-bot-token').value = botToken;
        }

        // Загружаем клиентов
        const { data: clients, error: clientsError } = await _supabase
            .from('telegram_clients')
            .select('*');
        
        if (!clientsError) {
            telegram_clients = clients || [];
        }

        // Загружаем историю уведомлений
        const { data: history, error: historyError } = await _supabase
            .from('notification_history')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100);
        
        if (!historyError) {
            notification_history = history || [];
        }

        renderTelegramClients();
        renderNotificationHistory();
        updateClientDropdown();
    } catch (err) {
        console.error('Ошибка загрузки Telegram данных:', err);
    }
}

async function saveBotToken() {
    const token = document.getElementById('telegram-bot-token').value.trim();
    if (!token) {
        return showToast('Введите токен бота', 'error');
    }

    try {
        const { error } = await _supabase
            .from('telegram_settings')
            .upsert({ id: 1, bot_token: token });

        if (error) throw error;

        botToken = token;
        showToast('Токен бота сохранен');
        await logActivity(curUser.name, 'Обновил Telegram Bot токен', '', 'telegram');
    } catch (err) {
        console.error('Ошибка сохранения токена:', err);
        showToast('Ошибка сохранения токена', 'error');
    }
}

async function testBotConnection() {
    if (!botToken) {
        return showToast('Сначала сохраните токен бота', 'error');
    }

    try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const data = await response.json();

        if (data.ok) {
            showToast(`✅ Бот подключен: @${data.result.username}`, 'success');
        } else {
            showToast('❌ Ошибка подключения к боту', 'error');
        }
    } catch (err) {
        console.error('Ошибка проверки бота:', err);
        showToast('Ошибка проверки подключения', 'error');
    }
}

async function saveTelegramClient() {
    const name = document.getElementById('tg-client-name').value.trim();
    const telegramId = document.getElementById('tg-client-id').value.trim();
    const notifyProcs = Array.from(document.querySelectorAll('#tg-notification-procs input:checked')).map(c => c.value);

    if (!name) return showToast('Введите имя клиента', 'error');
    if (!telegramId) return showToast('Введите Telegram ID', 'error');
    if (notifyProcs.length === 0) return showToast('Выберите хотя бы один процесс для уведомлений', 'error');

    try {
        const clientData = {
            name: name,
            telegram_id: telegramId,
            notify_processes: notifyProcs,
            active: true
        };

        if (editTgId) {
            // Обновление существующего клиента
            const { error } = await _supabase
                .from('telegram_clients')
                .update(clientData)
                .eq('id', editTgId);

            if (error) throw error;
            await logActivity(curUser.name, 'Обновил Telegram клиента', `Клиент: ${name}`, 'telegram');
            showToast('Клиент обновлен');
        } else {
            // Создание нового клиента
            const { error } = await _supabase
                .from('telegram_clients')
                .insert(clientData);

            if (error) throw error;
            await logActivity(curUser.name, 'Добавил Telegram клиента', `Клиент: ${name}, ID: ${telegramId}`, 'telegram');
            showToast('Клиент добавлен');
        }

        resetTelegramForm();
        await loadTelegramData();
    } catch (err) {
        console.error('Ошибка сохранения клиента:', err);
        showToast('Ошибка сохранения', 'error');
    }
}

function editTelegramClient(id) {
    const client = telegram_clients.find(c => c.id === id);
    if (!client) return;

    editTgId = id;
    document.getElementById('tg-client-name').value = client.name;
    document.getElementById('tg-client-id').value = client.telegram_id;
    document.getElementById('telegram-form-title').innerText = `Редактирование: ${client.name}`;
    document.getElementById('telegram-client-form').classList.add('edit-mode-active');
    document.getElementById('btn-cancel-tg').classList.remove('hidden');

    document.querySelectorAll('#tg-notification-procs input').forEach(cb => {
        cb.checked = client.notify_processes && client.notify_processes.includes(cb.value);
    });
}

function resetTelegramForm() {
    editTgId = null;
    document.getElementById('tg-client-name').value = '';
    document.getElementById('tg-client-id').value = '';
    document.getElementById('telegram-form-title').innerText = 'Добавить клиента с Telegram';
    document.getElementById('telegram-client-form').classList.remove('edit-mode-active');
    document.getElementById('btn-cancel-tg').classList.add('hidden');
    document.querySelectorAll('#tg-notification-procs input').forEach(cb => cb.checked = false);
}

async function deleteTelegramClient(id) {
    if (!confirm('Удалить клиента из Telegram уведомлений?')) return;

    try {
        const { error } = await _supabase
            .from('telegram_clients')
            .delete()
            .eq('id', id);

        if (error) throw error;
        
        await logActivity(curUser.name, 'Удалил Telegram клиента', `ID: ${id}`, 'telegram');
        await loadTelegramData();
        showToast('Клиент удален');
    } catch (err) {
        console.error('Ошибка удаления клиента:', err);
        showToast('Ошибка удаления', 'error');
    }
}

async function sendTelegramNotification(clientName, orderId, processName, itemName) {
    if (!botToken) {
        console.warn('Telegram бот не настроен');
        return false;
    }

    try {
        // Находим клиента
        const client = telegram_clients.find(c => c.name === clientName && c.active);
        
        if (!client) {
            console.log(`Клиент ${clientName} не найден в Telegram или неактивен`);
            return false;
        }

        // Проверяем, нужно ли уведомлять об этом процессе
        if (!client.notify_processes || !client.notify_processes.includes(processName)) {
            console.log(`Процесс ${processName} не входит в список уведомлений для ${clientName}`);
            return false;
        }

        // Формируем сообщение
        const now = new Date();
        const dateStr = now.toLocaleDateString('ru-RU');
        const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        
        const message = `✅ *Уведомление о завершении процесса*\n\n` +
                       `📦 Заказ: *#${orderId}*\n` +
                       `🛋 Изделие: *${itemName || 'Не указано'}*\n` +
                       `⚙️ Процесс: *${processName}*\n` +
                       `✔️ Статус: *Завершен*\n\n` +
                       `📅 Дата: ${dateStr}\n` +
                       `🕐 Время: ${timeStr}\n\n` +
                       `_Производство мебели Aliya_`;

        // Отправляем сообщение
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: client.telegram_id,
                text: message,
                parse_mode: 'Markdown'
            })
        });

        const data = await response.json();

        if (data.ok) {
            // Сохраняем в историю уведомлений
            await _supabase.from('notification_history').insert({
                client_name: clientName,
                telegram_id: client.telegram_id,
                order_id: orderId,
                process_name: processName,
                status: 'sent',
                message: message
            });

            console.log(`✅ Уведомление отправлено ${clientName} (${client.telegram_id})`);
            return true;
        } else {
            console.error('Ошибка отправки Telegram:', data);
            
            // Сохраняем ошибку
            await _supabase.from('notification_history').insert({
                client_name: clientName,
                telegram_id: client.telegram_id,
                order_id: orderId,
                process_name: processName,
                status: 'failed',
                message: message,
                error: data.description || 'Unknown error'
            });

            return false;
        }
    } catch (err) {
        console.error('Ошибка отправки Telegram уведомления:', err);
        
        // Сохраняем ошибку
        try {
            await _supabase.from('notification_history').insert({
                client_name: clientName,
                order_id: orderId,
                process_name: processName,
                status: 'failed',
                error: err.message
            });
        } catch (e) {
            console.error('Не удалось сохранить ошибку:', e);
        }

        return false;
    }
}

function renderTelegramClients() {
    const tbody = document.getElementById('telegram-clients-table');
    if (!tbody) return;

    if (telegram_clients.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">Нет клиентов с Telegram</td></tr>';
        return;
    }

    tbody.innerHTML = telegram_clients.map(client => `
        <tr>
            <td data-label="Имя клиента">
                <b>${client.name}</b>
                ${client.active ? '<span class="telegram-badge">🟢 Активен</span>' : '<span style="color:var(--text-muted);">⚪ Неактивен</span>'}
            </td>
            <td data-label="Telegram ID">
                <code style="background:var(--surface-container); padding:4px 8px; border-radius:6px; font-size:12px;">${client.telegram_id}</code>
            </td>
            <td data-label="Уведомления">
                ${(client.notify_processes || []).map(p => 
                    `<span class="proc-badge" style="font-size:10px;">${p}</span>`
                ).join('')}
            </td>
            <td data-label="Действия">
                <button class="btn-ghost" style="padding:4px 8px; font-size:12px;" onclick="editTelegramClient(${client.id})">✏️</button>
                <button class="btn-red" style="padding:4px 8px; font-size:12px;" onclick="deleteTelegramClient(${client.id})">✖</button>
            </td>
        </tr>
    `).join('');
}

function renderNotificationHistory() {
    const tbody = document.getElementById('notification-history-table');
    if (!tbody) return;

    if (notification_history.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">Нет отправленных уведомлений</td></tr>';
        return;
    }

    tbody.innerHTML = notification_history.map(notif => {
        const dateStr = new Date(notif.created_at).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const statusClass = notif.status === 'sent' ? 'sent' : 'failed';
        const statusText = notif.status === 'sent' ? '✅ Отправлено' : '❌ Ошибка';

        return `
            <tr>
                <td data-label="Дата/Время" style="font-size:12px; white-space:nowrap;">${dateStr}</td>
                <td data-label="Клиент"><b>${notif.client_name}</b></td>
                <td data-label="Заказ"><code style="background:var(--surface-container); padding:2px 6px; border-radius:4px; font-size:11px;">#${notif.order_id}</code></td>
                <td data-label="Процесс"><span class="proc-badge" style="font-size:10px;">${notif.process_name}</span></td>
                <td data-label="Статус"><span class="notification-status ${statusClass}">${statusText}</span></td>
            </tr>
        `;
    }).join('');
}

function updateClientDropdown() {
    const select = document.getElementById('crm-client-select');
    if (!select) return;

    select.innerHTML = '<option value="">Выберите клиента...</option>' +
        telegram_clients.map(client => 
            `<option value="${client.name}">${client.name} ${client.active ? '📱' : ''}</option>`
        ).join('');
}

function filterNotifications() {
    const filter = document.getElementById('notification-filter').value.toLowerCase();
    if (!filter) return renderNotificationHistory();

    const filtered = notification_history.filter(n => 
        n.client_name.toLowerCase().includes(filter) ||
        n.order_id.toLowerCase().includes(filter) ||
        n.process_name.toLowerCase().includes(filter)
    );

    const tbody = document.getElementById('notification-history-table');
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">Ничего не найдено</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(notif => {
        const dateStr = new Date(notif.created_at).toLocaleString('ru-RU');
        const statusClass = notif.status === 'sent' ? 'sent' : 'failed';
        const statusText = notif.status === 'sent' ? '✅ Отправлено' : '❌ Ошибка';

        return `
            <tr>
                <td style="font-size:12px;">${dateStr}</td>
                <td><b>${notif.client_name}</b></td>
                <td>#${notif.order_id}</td>
                <td>${notif.process_name}</td>
                <td><span class="notification-status ${statusClass}">${statusText}</span></td>
            </tr>
        `;
    }).join('');
}

function clearNotificationFilter() {
    document.getElementById('notification-filter').value = '';
    renderNotificationHistory();
}

// --- UTILS: TOAST ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if(!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = type === 'success' ? `<span>✔</span> ${message}` : `<span>✖</span> ${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// --- LOG ACTIVITY FUNCTION ---
async function logActivity(userName, action, details = '', type = 'system') {
    try {
        if (userName === 'admin939291' || userName === 'Администратор') {
            console.log(`[ADMIN ACTION SKIPPED] ${action}`, details);
            return;
        }
        
        console.log(`[ACTIVITY] ${type.toUpperCase()}: ${userName} - ${action}`, details);
        
        const { error } = await _supabase
            .from('activity_logs')
            .insert({
                user_name: userName,
                action: action,
                details: details,
                type: type
            });
            
        if (error) {
            console.error('Ошибка записи активности в Supabase:', error);
        }
        
        renderActivityLog();
        
    } catch (err) {
        console.error('Ошибка записи активности:', err);
    }
}

// --- HELPER FUNCTIONS ---
function formatDuration(ms) {
    if (!ms || ms < 0) return '0м';
    
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / (3600 * 24));
    const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (days > 0) {
        return `${days}д ${hours}ч`;
    } else if (hours > 0) {
        return `${hours}ч ${minutes}м`;
    } else if (minutes > 0) {
        return `${minutes}м ${seconds}с`;
    } else {
        return `${seconds}с`;
    }
}

function calculateProcessDuration(history) {
    if (!history) return { duration: 0, formatted: '-', started: false, completed: false };
    
    const started = !!history.start;
    const completed = !!history.end;
    
    if (!started) {
        return { duration: 0, formatted: '-', started: false, completed: false };
    }
    
    const startTime = new Date(history.start);
    
    if (completed) {
        const endTime = new Date(history.end);
        const duration = endTime - startTime;
        return {
            duration: duration,
            formatted: formatDuration(duration),
            started: true,
            completed: true,
            startTime: startTime,
            endTime: endTime
        };
    } else {
        const now = new Date();
        const duration = now - startTime;
        return {
            duration: duration,
            formatted: formatDuration(duration),
            started: true,
            completed: false,
            startTime: startTime,
            endTime: null
        };
    }
}

function calculateOrderProgress(order) {
    if (!order || !order.path || order.path.length === 0) return 0;
    
    let completed = 0;
    for (const process of order.path) {
        const history = order.history?.[process];
        if (history && history.end) {
            completed++;
        }
    }
    
    return Math.round((completed / order.path.length) * 100);
}

function renderProcessesTable() {
    const tableBody = document.getElementById('processes-table');
    if (!tableBody) return;
    
    const orderFilter = document.getElementById('process-filter-order')?.value.trim().toLowerCase() || '';
    const statusFilter = document.getElementById('process-filter-status')?.value || 'all';
    
    let processCount = 0;
    let rowsHTML = '';
    
    const sortedOrders = [...orders].sort((a, b) => {
        return b.id.localeCompare(a.id);
    });
    
    sortedOrders.forEach(order => {
        if (!order || !order.id) return;
        
        const crmData = crm_orders.find(c => c && c.oid === order.id) || {};
        const orderProgress = calculateOrderProgress(order);
        
        if (!order.path || !Array.isArray(order.path)) {
            return;
        }
        
        order.path.forEach((process, index) => {
            if (!process) return;
            
            const history = order.history?.[process];
            const durationInfo = calculateProcessDuration(history);
            const processNumber = index + 1;
            const totalProcesses = order.path.length;
            const processCode = `${order.id}-${pad2(processNumber)}`;
            
            // Поиск: по № заказа, по коду процесса (1001-02) или по названию процесса
            if (orderFilter) {
                const matchesOrder = order.id.toLowerCase().includes(orderFilter);
                const matchesCode = processCode.toLowerCase().includes(orderFilter);
                const matchesProcess = process.toLowerCase().includes(orderFilter);
                if (!matchesOrder && !matchesCode && !matchesProcess) return;
            }
            
            let status = 'pending';
            let statusText = 'Ожидает';
            let statusClass = 'pending';
            
            if (durationInfo.started && !durationInfo.completed) {
                status = 'in-progress';
                statusText = 'В работе';
                statusClass = 'active';
            } else if (durationInfo.completed) {
                status = 'completed';
                statusText = 'Завершён';
                statusClass = 'done';
            }
            
            if (statusFilter !== 'all' && statusFilter !== status) {
                return;
            }
            
            const startTime = durationInfo.startTime ? 
                durationInfo.startTime.toLocaleString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }) : '-';
                
            const endTime = durationInfo.endTime ? 
                durationInfo.endTime.toLocaleString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }) : '-';
            
            const actionCell = status === 'completed'
                ? `<span class="wt-done-check" title="Завершено">✔</span>`
                : `<button class="btn-admin-complete" onclick="adminCompleteProcess('${esc(order.id)}', '${esc(process)}')">✔ Завершить</button>`;
            
            rowsHTML += `
                <tr>
                    <td data-label="№ Заказа">
                        <div style="font-weight: 800; color: var(--primary);">#${order.id}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${processNumber}/${totalProcesses}</div>
                    </td>
                    <td data-label="Клиент">
                        <div style="font-weight: 600;">${crmData.client || '-'}</div>
                        <div style="font-size: 12px; color: var(--text-secondary);">${crmData.item || '-'}</div>
                    </td>
                    <td data-label="Процесс / Код">
                        <div style="font-weight: 600;">${process}</div>
                        <div class="wt-code-chip" style="margin-top: 4px;">${processCode}</div>
                    </td>
                    <td data-label="Статус">
                        <span class="state-badge ${statusClass}" style="font-size: 11px; padding: 4px 8px;">
                            ${statusText}
                        </span>
                    </td>
                    <td data-label="Кто начал">${history?.worker || '-'}</td>
                    <td data-label="Кто завершил">${history?.completed_by || '-'}</td>
                    <td data-label="Время начала" style="font-size: 12px; white-space: nowrap;">${startTime}</td>
                    <td data-label="Время конца" style="font-size: 12px; white-space: nowrap;">${endTime}</td>
                    <td data-label="Длительность">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <div style="font-weight: 600; color: ${status === 'completed' ? 'var(--success)' : 'var(--primary)'}">
                                ${durationInfo.formatted || '-'}
                            </div>
                            ${status === 'in-progress' ? 
                                '<div class="blink" style="width: 8px; height: 8px; border-radius: 50%; background: var(--primary);"></div>' : 
                                ''}
                        </div>
                    </td>
                    <td data-label="Прогресс заказа">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div style="width: 60px; height: 6px; background: var(--border-light); border-radius: 3px; overflow: hidden;">
                                <div style="width: ${orderProgress}%; height: 100%; background: var(--primary);"></div>
                            </div>
                            <span style="font-size: 12px; font-weight: 700;">${orderProgress}%</span>
                        </div>
                    </td>
                    <td data-label="Упр.">${actionCell}</td>
                </tr>
            `;
            
            processCount++;
        });
    });
    
    if (processCount === 0) {
        rowsHTML = `
            <tr>
                <td colspan="11" style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <div style="font-size: 24px; margin-bottom: 10px;">📭</div>
                    <div>Нет данных для отображения</div>
                    <div style="font-size: 12px; margin-top: 5px;">Измените фильтры или создайте заказы</div>
                </td>
            </tr>
        `;
    }
    
    tableBody.innerHTML = rowsHTML;
    document.getElementById('process-count').textContent = processCount;
}

function resetProcessFilters() {
    document.getElementById('process-filter-order').value = '';
    document.getElementById('process-filter-status').value = 'all';
    renderProcessesTable();
}

function exportProcessesToCSV() {
    const headers = [
        '№ Заказа', 'Код процесса', 'Клиент', 'Изделие', 'Процесс', 'Номер процесса', 'Всего процессов',
        'Статус', 'Кто начал', 'Кто завершил', 'Время начала', 'Время конца', 'Длительность', 'Прогресс заказа'
    ];
    
    let csvContent = headers.join(';') + '\n';
    
    orders.forEach(order => {
        const crmData = crm_orders.find(c => c && c.oid === order.id) || {};
        const orderProgress = calculateOrderProgress(order);
        
        if (!order.path || !Array.isArray(order.path)) return;
        
        order.path.forEach((process, index) => {
            const history = order.history?.[process];
            const durationInfo = calculateProcessDuration(history);
            
            let status = 'Ожидает';
            if (durationInfo.started && !durationInfo.completed) {
                status = 'В работе';
            } else if (durationInfo.completed) {
                status = 'Завершён';
            }
            
            const row = [
                order.id,
                `${order.id}-${pad2(index + 1)}`,
                crmData.client || '',
                crmData.item || '',
                process,
                index + 1,
                order.path.length,
                status,
                history?.worker || '',
                history?.completed_by || '',
                durationInfo.startTime ? durationInfo.startTime.toLocaleString('ru-RU') : '',
                durationInfo.endTime ? durationInfo.endTime.toLocaleString('ru-RU') : '',
                durationInfo.formatted || '0м',
                `${orderProgress}%`
            ].map(cell => `"${cell}"`).join(';');
            
            csvContent += row + '\n';
        });
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `процессы_заказов_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('Данные экспортированы в CSV');
}

const style = document.createElement('style');
style.textContent = `
    @keyframes blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
    }
    .blink {
        animation: blink 1s infinite;
    }
`;
document.head.appendChild(style);

function getOrderStatus(order, processName) {
    if (!order || !order.history) {
        return { 
            status: 'pending', 
            time: '-',
            text: 'Ожидает'
        };
    }
    
    const history = order.history || {};
    const stepHistory = history[processName];
    
    if (stepHistory) {
        if (stepHistory.end) {
            const start = new Date(stepHistory.start);
            const end = new Date(stepHistory.end);
            const diff = end - start;
            return { 
                status: 'done', 
                time: formatDuration(diff),
                text: 'Завершено'
            };
        } else if (stepHistory.start) {
            const start = new Date(stepHistory.start);
            const now = new Date();
            const diff = now - start;
            return { 
                status: 'active', 
                time: formatDuration(diff),
                text: 'В работе'
            };
        }
    }
    return { 
        status: 'pending', 
        time: '-',
        text: 'Ожидает'
    };
}

// --- DATA LOADING ---
async function loadAllData() {
    try {
        const [wRes, oRes, cRes, svcClRes, svcTxRes, whRes] = await Promise.all([
            _supabase.from('workers').select('*'),
            _supabase.from('orders').select('*'),
            _supabase.from('crm_orders').select('*'),
            _supabase.from('svc_clients').select('*'),
            _supabase.from('svc_transactions').select('*'),
            _supabase.from('warehouse_items').select('*')
        ]);

        // Обновляем кеш услугчиков для дашборда/алертов, даже если раздел Услуги ещё не открывали
        if (!svcClRes.error) svc_clients = svcClRes.data || [];
        if (!svcTxRes.error) svc_transactions = svcTxRes.data || [];
        if (!whRes.error) warehouse_items = whRes.data || [];

        workers = (wRes.data || []).map(w => {
            let cleanProcs = [];
            try {
                if (typeof w.procs === 'string') cleanProcs = JSON.parse(w.procs);
                else if (Array.isArray(w.procs)) cleanProcs = w.procs;
            } catch (e) { console.warn(e); }
            return { ...w, procs: cleanProcs };
        });

        orders = (oRes.data || []).map(o => {
            let cleanPath = [];
            try {
                if (typeof o.path === 'string') cleanPath = JSON.parse(o.path);
                else if (Array.isArray(o.path)) cleanPath = o.path;
            } catch (e) { console.warn(e); }
            return { ...o, path: cleanPath };
        });

        crm_orders = cRes.data || [];
        
        await loadTelegramData();
        
        // Обновляем список услугчиков в CRM-форме
        const crmSvcSel = document.getElementById('crm-svc-client');
        if (crmSvcSel) {
            crmSvcSel.innerHTML = '<option value="">— обычный заказ —</option>' +
                svc_clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        }
        
        renderDashboard(); 
        renderWorkers(); 
        renderMonitor(); 
        renderCRM(); 
        renderActivityLog(); 
        renderProcessesTable();
        
        if(curUser && curUser.name !== 'admin939291' && curUser.name !== 'kanban') renderWorkerTasks();
        
    } catch (e) { 
        console.error("CRASH:", e); 
        showToast("Ошибка загрузки данных", "error"); 
    }
}

// --- ACTIVITY LOG RENDER ---
async function renderActivityLog(filters = {}) {
    try {
        let logs = [];
        
        try {
            let query = _supabase.from('activity_logs').select('*');
            
            query = query.neq('user_name', 'admin939291');
            query = query.neq('user_name', 'Администратор');
            
            if (filters.user_name && filters.user_name.trim() !== '') {
                query = query.ilike('user_name', `%${filters.user_name.trim()}%`);
            }
            if (filters.type && filters.type !== 'all') {
                query = query.eq('type', filters.type);
            }
            if (filters.date_from && filters.date_from.trim() !== '') {
                query = query.gte('created_at', `${filters.date_from}T00:00:00Z`);
            }
            if (filters.date_to && filters.date_to.trim() !== '') {
                query = query.lte('created_at', `${filters.date_to}T23:59:59Z`);
            }
            
            const { data, error } = await query.order('created_at', { ascending: false }).limit(100);
            
            if (error) {
                console.warn('Не удалось загрузить логи из Supabase:', error);
                const localLogs = JSON.parse(localStorage.getItem('erp_activity_logs') || '[]');
                logs = localLogs.filter(log => 
                    log.user_name !== 'admin939291' && 
                    log.user_name !== 'Администратор'
                );
            } else {
                logs = data || [];
            }
        } catch (err) {
            console.warn('Ошибка подключения к Supabase:', err);
            const localLogs = JSON.parse(localStorage.getItem('erp_activity_logs') || '[]');
            logs = localLogs.filter(log => 
                log.user_name !== 'admin939291' && 
                log.user_name !== 'Администратор'
            );
        }
        
        if (!logs || logs.length === 0) {
            const container = document.getElementById('dashboard-activity-log');
            const historyContainer = document.getElementById('history-log');
            
            if (container) {
                container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">Нет активности работников</div>';
            }
            if (historyContainer) {
                historyContainer.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">Нет активности работников</td></tr>';
            }
            return;
        }
        
        const dashboardContainer = document.getElementById('dashboard-activity-log');
        if (dashboardContainer) {
            const dashboardHtml = logs.slice(0, 10).map(l => {
                const dateStr = new Date(l.created_at).toLocaleString('ru-RU', { 
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' 
                });
                
                let actionClass = 'activity-system';
                if (l.type === 'login') actionClass = 'activity-login';
                else if (l.type === 'logout') actionClass = 'activity-logout';
                else if (l.type === 'process') actionClass = 'activity-process';
                else if (l.type === 'telegram') actionClass = 'activity-telegram';
                
                return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid #f1f5f9;">
                    <div style="flex:1; display:flex; align-items:center; gap:10px;">
                        <div style="font-size:16px;">${l.type === 'telegram' ? '📱' : '👤'}</div>
                        <div style="flex:1;">
                            <div style="font-weight:600; font-size:14px; margin-bottom:2px;">${l.user_name}</div>
                            <div style="font-size:13px; color:var(--text-secondary);">${l.action}</div>
                            ${l.details ? `<div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${l.details}</div>` : ''}
                        </div>
                    </div>
                    <div style="font-size:12px; color:var(--text-muted);">${dateStr}</div>
                </div>`;
            }).join('');
            
            dashboardContainer.innerHTML = dashboardHtml;
        }
        
        const historyContainer = document.getElementById('history-log');
        if (historyContainer) {
            const historyHtml = logs.map(l => {
                const dateStr = new Date(l.created_at).toLocaleString('ru-RU', { 
                    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' 
                });
                
                let actionClass = 'activity-system';
                if (l.type === 'login') actionClass = 'activity-login';
                else if (l.type === 'logout') actionClass = 'activity-logout';
                else if (l.type === 'process') actionClass = 'activity-process';
                else if (l.type === 'telegram') actionClass = 'activity-telegram';
                
                let badgeColor = 'background:var(--surface); color:var(--text-secondary);';
                if (l.type === 'login') badgeColor = 'background:#dcfce7; color:#166534;';
                else if (l.type === 'logout') badgeColor = 'background:#fef3c7; color:#92400e;';
                else if (l.type === 'process') badgeColor = 'background:#e0f2fe; color:#0369a1;';
                else if (l.type === 'telegram') badgeColor = 'background:#dbeafe; color:#0088cc;';
                
                return `
                <tr>
                    <td data-label="Дата" style="font-size:12px; color:var(--text-secondary); white-space:nowrap;">${dateStr}</td>
                    <td data-label="Работник"><b>${l.user_name}</b></td>
                    <td data-label="Действие" class="${actionClass}">${l.action}</td>
                    <td data-label="Детали" style="max-width:200px; word-wrap:break-word;">${l.details || '-'}</td>
                    <td data-label="Тип"><span class="proc-badge" style="${badgeColor}">${l.type}</span></td>
                </tr>`;
            }).join('');
            
            historyContainer.innerHTML = historyHtml;
        }
        
    } catch (err) {
        console.error("Activity Log Error:", err);
    }
}

function applyActivityFilters() {
    const filters = {
        user_name: document.getElementById('filter-user')?.value.trim() || '',
        type: document.getElementById('filter-type')?.value || 'all',
        date_from: document.getElementById('filter-date-from')?.value || '',
        date_to: document.getElementById('filter-date-to')?.value || ''
    };
    
    renderActivityLog(filters);
}

function resetActivityFilters() {
    document.getElementById('filter-user').value = '';
    document.getElementById('filter-type').value = 'all';
    document.getElementById('filter-date-from').value = '';
    document.getElementById('filter-date-to').value = '';
    
    renderActivityLog();
}

// --- AUTH ---
async function handleLogin(forceLogin = false) {
    const input = document.getElementById('login-input');
    const val = input.value.trim();
    if(!val) return showToast("Введите имя", "error");
    
    document.getElementById('admin-nav').style.display = 'none';
    document.getElementById('admin-nav').classList.remove('mobile-active');
    
    if(val.toLowerCase() === 'kanban') {
        curUser = { name: 'kanban' };
        
        document.getElementById('page-login').classList.add('hidden');
        document.getElementById('admin-nav').style.display = 'none';
        document.getElementById('page-kanban').classList.remove('hidden');
        document.getElementById('logout-btn').classList.remove('hidden');
        
        localStorage.setItem('erp_user', 'kanban');
        localStorage.setItem('erp_user_type', 'kanban');
        
        await loadKanbanData();
        showToast("Kanban доска загружена");
        return;
    }

    if(val.toLowerCase() === 'admin939291') {
        curUser = { name: 'admin939291' };
        
        document.getElementById('page-login').classList.add('hidden');
        document.getElementById('admin-nav').style.display = 'flex';
        document.getElementById('logout-btn').classList.remove('hidden');
        showPage('page-dashboard');
        
        localStorage.setItem('erp_user', 'admin939291');
        localStorage.setItem('erp_user_type', 'admin');
        
        showToast("Добро пожаловать, Администратор");
        return;
    } else {
        if(!forceLogin && workers.length === 0) {
            setTimeout(() => handleLogin(true), 200);
            return;
        }

        const worker = workers.find(w => w.name.toLowerCase() === val.toLowerCase());
        if(worker) {
            curUser = worker;
            
            document.getElementById('page-login').classList.add('hidden');
            document.getElementById('admin-nav').style.display = 'none';
            document.getElementById('page-worker-terminal').classList.remove('hidden');
            document.getElementById('logout-btn').classList.remove('hidden');
            document.getElementById('worker-title').innerText = worker.name;
            
            // Показываем кнопку Краска если у работника есть доступ
            if (workerHasPaintAccess(worker)) {
                document.getElementById('paint-access-btn').classList.remove('hidden');
                loadPaintData();
            }
            
            localStorage.setItem('erp_user', worker.name);
            localStorage.setItem('erp_user_type', 'worker');
            
            await logActivity(worker.name, 'Вошел в систему', 'Рабочий терминал', 'login');
            renderWorkerTasks();
            showToast(`Здравствуйте, ${worker.name}`);
        } else {
            if(forceLogin) {
                 handleLogout();
            } else {
                showToast("Неверный логин или пароль", "error");
            }
        }
    }
}

async function handleLogout() {
    if (curUser && curUser.name !== 'admin939291' && curUser.name !== 'kanban') {
        await logActivity(curUser.name, 'Вышел из системы', '', 'logout');
    }
    
    localStorage.removeItem('erp_user');
    localStorage.removeItem('erp_user_type');
    
    location.reload();
}

// --- WORKER LOGIC ---
function resetWorkerFlow() {
    curProc = null;
    var ac = document.getElementById('worker-action-card');
    if (ac) ac.classList.add('hidden');
    var tc = document.getElementById('worker-tasks-card');
    if (tc) tc.classList.remove('hidden');
    var oi = document.getElementById('worker-order-input');
    if (oi) oi.value = '';
    var mb = document.getElementById('wt-manual-box');
    if (mb) mb.classList.add('hidden');
    var wc = document.getElementById('worker-controls');
    if (wc) wc.classList.add('hidden');
    var fs = document.getElementById('finish-section');
    if (fs) fs.classList.add('hidden');
    var qtyEl = document.getElementById('wt-finish-qty');
    if (qtyEl) { qtyEl.value = '1'; delete qtyEl.dataset.touched; }
    var targetEl = document.getElementById('wt-target-qty');
    if (targetEl) targetEl.innerText = '';
    var pis = document.getElementById('paint-inline-section');
    if (pis) pis.classList.add('hidden');
    var ais = document.getElementById('assembly-inline-section');
    if (ais) ais.classList.add('hidden');
    renderWorkerTasks();
}

function toggleManualEntry() {
    document.getElementById('wt-manual-box')?.classList.toggle('hidden');
}

// Заполняет карточку активного процесса: № заказа, код (1001-02), изделие из CRM
function updateActiveOrderInfo(order, processName) {
    const crmData = crm_orders.find(c => c.oid === order.id);
    const code = getProcessCode(order, processName);
    const orderEl = document.getElementById('active-order-num');
    const codeEl = document.getElementById('active-proc-code');
    const itemEl = document.getElementById('active-item-name');
    if (orderEl) orderEl.innerText = `№ ${order.id}`;
    if (codeEl) codeEl.innerText = code || '—';
    if (itemEl) itemEl.innerText = crmData?.item ? crmData.item : '';
}

function renderWorkerTasks() {
    const list = document.getElementById('worker-tasks-list');
    if (!list) return; list.innerHTML = '';

    const myProcs = curUser.procs || [];
    let myTasks = [];

    myProcs.forEach(proc => {
        if (isPaintProc(proc)) {
            const stageKeys = PAINT_WORKER_TYPES[proc] || [];
            if (!stageKeys.length) return;

            orders.forEach(o => {
                if (!o.path) return;

                // Заказ должен содержать ЭТОТ процесс в маршруте
                // (Шлиповка → Шлиповка, Грунтовка → Грунтовка, краска → краска)
                const procInPath = o.path.some(p => p.toLowerCase() === proc.toLowerCase());
                if (!procInPath) return;

                // anyPaintInPath проверка не нужна — procInPath уже подтверждает наличие процесса в маршруте

                const items = paint_order_items.filter(i => i.order_id === o.id);
                if (!items.length) return;

                const totalPerStage = items.reduce((s, i) => s + i.qty, 0);
                const cfg = paint_order_layers[o.id] || { layers: 2, coats: 2 };

                // Проверяем есть ли незавершённые этапы для этого воркера
                const hasWork = stageKeys.some(k => {
                    if (!isStageActive(k, cfg)) return false;
                    const done = paint_records
                        .filter(r => r.order_id === o.id && r.stage_key === k)
                        .reduce((s, r) => s + (r.qty_done || 0), 0);
                    return done < totalPerStage;
                });
                if (!hasWork) return;

                const anyActive = stageKeys.some(k => {
                    if (!isStageActive(k, cfg)) return false;
                    const done = paint_records
                        .filter(r => r.order_id === o.id && r.stage_key === k)
                        .reduce((s, r) => s + (r.qty_done || 0), 0);
                    return done > 0 && done < totalPerStage;
                });

                const totalExpected = totalPerStage * stageKeys.filter(k => isStageActive(k, cfg)).length;
                const totalDone = stageKeys
                    .filter(k => isStageActive(k, cfg))
                    .reduce((s, k) => s + paint_records
                        .filter(r => r.order_id === o.id && r.stage_key === k)
                        .reduce((ss, r) => ss + (r.qty_done || 0), 0), 0);
                const pct = totalExpected > 0 ? Math.round(totalDone / totalExpected * 100) : 0;

                // Не дублируем если уже добавлено
                const exists = myTasks.some(t => t.order.id === o.id && t.proc === proc);
                if (!exists) {
                    myTasks.push({ order: o, proc, status: anyActive ? 'active' : 'pending', isPaint: true, pct });
                }
            });
        } else {
            orders.forEach(o => {
                if (o.path && o.path.includes(proc)) {
                    const h = o.history && o.history[proc];
                    // ВАЖНО: history[proc] теперь может существовать заранее (planned_qty/
                    // assigned_worker пишутся при запуске заказа в saveOrder), поэтому нельзя
                    // судить "процесс начат" по одной лишь истинности h — проверяем h.start/h.end явно.
                    const isDone = !!(h && h.end);
                    const isStarted = !!(h && h.start);
                    if (!isDone) {
                        myTasks.push({ order: o, proc, status: isStarted ? 'active' : 'pending', isPaint: false });
                    }
                }
            });
        }
    });

    // Активные сначала
    myTasks.sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1));

    const countBadge = document.getElementById('task-count-badge');
    if (countBadge) countBadge.innerText = myTasks.length;

    if (myTasks.length === 0) {
        list.innerHTML = '<div class="wt-empty">🎉 Нет активных задач — всё сделано!</div>';
        return;
    }

    myTasks.forEach(task => {
        const crmData = crm_orders.find(c => c.oid === task.order.id);
        const code = getProcessCode(task.order,
            task.isPaint
                ? (task.order.path.find(p => p.toLowerCase() === task.proc.toLowerCase()) ||
                   task.order.path.find(p => isPaintProc(p)) || task.proc)
                : task.proc
        );
        const isActive   = task.status === 'active';
        const statusText = isActive ? '● В работе' : 'Ожидает';

        const el = document.createElement('div');
        el.className = 'wt-task-card' + (isActive ? ' active' : '');
        el.innerHTML = `
            <div class="wt-task-main">
                <div class="wt-task-top">
                    <span class="wt-order-num">№ ${task.order.id}</span>
                    <span class="wt-code-chip">${code}</span>
                </div>
                <div class="wt-task-proc">${task.isPaint ? '🎨 ' : ''}${task.proc}</div>
                ${crmData?.item ? `<div class="wt-task-item">${crmData.item}</div>` : ''}
                ${task.isPaint ? `
                <div style="display:flex; align-items:center; gap:8px; margin-top:6px;">
                    <div style="flex:1; height:4px; background:var(--border-light); border-radius:2px; overflow:hidden;">
                        <div style="width:${task.pct}%; height:100%; background:var(--primary);"></div>
                    </div>
                    <span style="font-size:10px; font-weight:700;">${task.pct}%</span>
                </div>` : ''}
            </div>
            <div class="wt-task-status ${task.status}">${statusText}</div>
        `;
        el.onclick = () => {
            document.getElementById('worker-order-input').value = task.order.id;
            selectWorkerProc(task.proc);
        };
        list.appendChild(el);
    });
}

function selectWorkerProc(p) {
    curProc = p;

    var tc = document.getElementById('worker-tasks-card');
    if (tc) tc.classList.add('hidden');
    var ac = document.getElementById('worker-action-card');
    if (ac) ac.classList.remove('hidden');
    var apn = document.getElementById('active-proc-name');
    if (apn) apn.innerText = p;

    var pis = document.getElementById('paint-inline-section');
    if (pis) pis.classList.add('hidden');
    var ais = document.getElementById('assembly-inline-section');
    if (ais) ais.classList.add('hidden');
    var wc = document.getElementById('worker-controls');
    if (wc) wc.classList.add('hidden');
    var mb = document.getElementById('wt-manual-box');
    if (mb) mb.classList.add('hidden');

    var orderInput = document.getElementById('worker-order-input');
    var oid = orderInput ? orderInput.value.trim() : '';

    if (oid) {
        var o = orders.find(function(x) { return x.id === oid; });
        if (o && o.path && o.path.indexOf(p) !== -1) {
            updateActiveOrderInfo(o, p);
            if (mb) mb.classList.add('hidden');

            if (isPaintProc(p)) {
                showInlinePaint(o.id);
            } else if (isAssemblyProc(p)) {
                showInlineAssembly(o.id);
            } else {
                if (wc) wc.classList.remove('hidden');
                var h = o.history && o.history[p];
                var started = !!(h && h.start);
                var finished = !!(h && h.start && h.end);

                var btnS = document.getElementById('btn-start');
                if (btnS) btnS.classList.toggle('hidden', started);

                var finS = document.getElementById('finish-section');
                if (finS) finS.classList.toggle('hidden', !(started && !finished));

                var doneM = document.getElementById('done-msg');
                if (doneM) doneM.classList.toggle('hidden', !finished);

                updateWorkerFinishQtyDefaults(h);
            }
            return;
        }
    }

    // Если заказ не найден — показать manual input
    if (mb) mb.classList.remove('hidden');
    if (orderInput) orderInput.value = '';
}

// Заполняет плановое количество (wt-target-qty) и подставляет его по умолчанию в поле объёма
function updateWorkerFinishQtyDefaults(h) {
    const targetEl = document.getElementById('wt-target-qty');
    const qtyEl = document.getElementById('wt-finish-qty');
    const unitEl = document.getElementById('wt-finish-unit');
    const unit = getPathProcUnit(curProc);
    if (unitEl) unitEl.innerText = unit;
    if (h && h.planned_qty) {
        if (targetEl) targetEl.innerText = `План: ${h.planned_qty} ${unit}`;
        if (qtyEl && !qtyEl.dataset.touched) qtyEl.value = h.planned_qty;
    } else if (targetEl) {
        targetEl.innerText = '';
    }
}

function workerFindOrder() {
    var oidEl = document.getElementById('worker-order-input');
    if (!oidEl) return;
    var oid = oidEl.value.trim();
    var o = orders.find(function(x) { return x.id === oid; });
    if (!o || !o.path || o.path.indexOf(curProc) === -1) return showToast('Заказ не найден', 'error');

    updateActiveOrderInfo(o, curProc);
    var mb = document.getElementById('wt-manual-box');
    if (mb) mb.classList.add('hidden');

    if (isPaintProc(curProc)) {
        showInlinePaint(o.id);
    } else if (isAssemblyProc(curProc)) {
        showInlineAssembly(o.id);
    } else {
        var wc = document.getElementById('worker-controls');
        if (wc) wc.classList.remove('hidden');
        var h = o.history && o.history[curProc];
        var started = !!(h && h.start);
        var finished = !!(h && h.start && h.end);

        var btnS = document.getElementById('btn-start');
        if (btnS) btnS.classList.toggle('hidden', started);

        var finS = document.getElementById('finish-section');
        if (finS) finS.classList.toggle('hidden', !(started && !finished));

        var doneM = document.getElementById('done-msg');
        if (doneM) doneM.classList.toggle('hidden', !finished);

        updateWorkerFinishQtyDefaults(h);
    }
}

async function processAction(type) {
    const oid = document.getElementById('worker-order-input').value.trim();
    const o = orders.find(x => x.id === oid);
    if(!o) return;

    if(!o.history) o.history = {};
    if(!o.history[curProc]) o.history[curProc] = {};

    try {
        const timestamp = new Date().toISOString();
        if(type === 'start') {
            if(o.history[curProc].start) return showToast("Уже начато", "error");
            o.history[curProc] = { start: timestamp, worker: curUser.name };
            
            await logActivity(curUser.name, 'Начал процесс', 
                `Заказ #${oid}, процесс: ${curProc}`, 'process');
        } else {
            if(!o.history[curProc].start) return showToast("Сначала начайте", "error");
            if(o.history[curProc].end) return showToast("Уже завершено", "error");
            var finishQty = parseInt(document.getElementById('wt-finish-qty')?.value) || 1;
            o.history[curProc].end = timestamp;
            o.history[curProc].completed_by = curUser.name;
            o.history[curProc].qty_done = finishQty;
            o.history[curProc].unit = getPathProcUnit(curProc);
            
            await logActivity(curUser.name, 'Завершил процесс', 
                `Заказ #${oid}, процесс: ${curProc}, объём: ${finishQty} ${getPathProcUnit(curProc)}`, 'process');

            // TELEGRAM УВЕДОМЛЕНИЕ при завершении процесса
            const crmData = crm_orders.find(c => c.oid === oid);
            if (crmData && crmData.client) {
                const itemName = crmData.item || 'Не указано';
                const sent = await sendTelegramNotification(crmData.client, oid, curProc, itemName);
                if (sent) {
                    showToast(`📱 Уведомление отправлено клиенту: ${crmData.client}`, 'success');
                    await logActivity('System', 'Отправлено Telegram уведомление', 
                        `Клиент: ${crmData.client}, Заказ: #${oid}, Процесс: ${curProc}`, 'telegram');
                }
            }
            // АВТОЗАПИСЬ В УСЛУГИ — если заказ привязан к услугчику
            await autoSvcTransaction(oid, curProc, curUser.name);
        }
        const { error } = await _supabase.from('orders').upsert(o);
        if(error) throw error;
        await loadAllData();
        workerFindOrder();
        showToast(type === 'start' ? "Работа начата" : "Работа завершена");
    } catch (err) {
        showToast("Ошибка сети", "error");
    }
}

// --- ADMIN LOGIC ---
function renderDashboard() {
    const total = orders.length;
    const active = orders.filter(o => !isOrderFinished(o)).length;
    const finished = orders.filter(o => {
        if(!isOrderFinished(o)) return false;
        const lastStep = o.path[o.path.length-1];
        const h = o.history[lastStep];
        return h && new Date(h.end).toDateString() === new Date().toDateString();
    }).length;

    const notificationCount = notification_history.filter(n => 
        n.status === 'sent' && 
        new Date(n.created_at).toDateString() === new Date().toDateString()
    ).length;

    document.getElementById('stat-total').innerText = total;
    document.getElementById('stat-active').innerText = active;
    document.getElementById('stat-finished').innerText = finished;
    document.getElementById('stat-notifications').innerText = notificationCount;

    renderDashAlerts();
    renderDashRecentOrders();
    renderDashTopDebtors();
    renderDashAttendanceToday();
}

// ── DASHBOARD: 🔔 Алерты (просроченные заказы + большие долги) ──
function renderDashAlerts() {
    const el = document.getElementById('dash-alerts');
    if (!el) return;

    const alerts = [];
    const now = new Date();
    const STALE_DAYS = 7; // если заказ не завершён N+ дней — считаем просроченным

    // Просроченные заказы: приоритет — реальная дата сдачи (due_date), иначе эвристика по дате заказа
    crm_orders.forEach(c => {
        const order = orders.find(o => o.id === c.oid);
        if (order && isOrderFinished(order)) return;

        if (c.due_date) {
            const due = new Date(c.due_date); due.setHours(0,0,0,0);
            const daysOverdue = Math.floor((now - due) / 86400000);
            if (daysOverdue >= 0) {
                alerts.push({
                    type: 'stale',
                    text: `Заказ #${c.oid} (${c.client || ''}) просрочен на ${daysOverdue} дн. (сдача была ${new Date(c.due_date).toLocaleDateString('ru-RU')})`,
                    action: () => openOrderCalc(c.oid)
                });
            }
        } else if (order && c.date) {
            const orderDate = new Date(c.date);
            const daysAgo = Math.floor((now - orderDate) / 86400000);
            if (daysAgo >= STALE_DAYS) {
                alerts.push({
                    type: 'stale',
                    text: `Заказ #${c.oid} (${c.client || ''}) не завершён уже ${daysAgo} дн.`,
                    action: () => openOrderCalc(c.oid)
                });
            }
        }
    });

    // Крупные долги услугчиков (порог: любой долг > 0, показываем топ-5)
    const debtors = svc_clients
        .map(c => ({ c, debt: -clientBalance(c.id) }))
        .filter(x => x.debt > 0)
        .sort((a, b) => b.debt - a.debt)
        .slice(0, 5);

    debtors.forEach(({ c, debt }) => {
        alerts.push({
            type: 'debt',
            text: `Долг ${formatMoney(debt)} — ${c.name}`,
            action: () => { showServicesPage(); setTimeout(() => openSvcClientModal(c.id), 300); }
        });
    });

    // Товары на складе с низким остатком
    const lowStock = warehouse_items.filter(i => i.min_qty > 0 && i.qty_in_stock <= i.min_qty).slice(0, 5);
    lowStock.forEach(i => {
        alerts.push({
            type: 'stock',
            text: `Мало на складе: ${i.name} — осталось ${i.qty_in_stock} ${i.unit} (мин. ${i.min_qty})`,
            action: () => showWarehousePage()
        });
    });

    if (!alerts.length) {
        el.innerHTML = '<div style="color:#16a34a; font-weight:700; padding:8px 0;">✅ Всё в порядке — нет просроченных заказов и крупных долгов</div>';
        document.getElementById('dash-alerts-card').style.borderColor = '#16a34a';
        document.getElementById('dash-alerts-card').style.background = '#f0fdf4';
        return;
    }

    document.getElementById('dash-alerts-card').style.borderColor = '#fbbf24';
    document.getElementById('dash-alerts-card').style.background = '#fffbeb';

    el.innerHTML = alerts.map((a, i) => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; ${i>0?'border-top:1px solid #fde68a;':''}">
            <div style="font-size:13px; color:#92400e;">
                ${a.type === 'stale' ? '⏰' : a.type === 'stock' ? '📦' : '💸'} ${a.text}
            </div>
            <button onclick="window._dashAlertActions[${i}]()" class="btn-ghost" style="padding:4px 10px; font-size:11px;">Открыть →</button>
        </div>
    `).join('');
    window._dashAlertActions = alerts.map(a => a.action);
}

// ── DASHBOARD: последние заказы ──
function renderDashRecentOrders() {
    const el = document.getElementById('dash-recent-orders');
    if (!el) return;
    const sorted = [...crm_orders].sort((a, b) => new Date(b.created_at||0) - new Date(a.created_at||0)).slice(0, 5);
    if (!sorted.length) { el.innerHTML = '<div style="color:var(--text-muted); padding:10px;">Нет заказов</div>'; return; }
    el.innerHTML = sorted.map(c => {
        const order = orders.find(o => o.id === c.oid);
        const pct = order ? calculateOrderProgress(order) : 0;
        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f1f5f9; cursor:pointer;" onclick="openOrderCalc('${esc(c.oid)}')">
            <div>
                <b>#${c.oid}</b> <span style="font-size:12px; color:var(--text-secondary);">${c.client||''}</span>
                <div style="font-size:11px; color:var(--text-muted);">${c.item||''}</div>
            </div>
            <div style="text-align:right;">
                <div style="font-size:12px; font-weight:700; color:var(--primary);">${pct}%</div>
                <div style="font-size:11px; color:var(--text-muted);">${formatMoney(c.price)}</div>
            </div>
        </div>`;
    }).join('');
}

// ── DASHBOARD: топ должников ──
function renderDashTopDebtors() {
    const el = document.getElementById('dash-top-debtors');
    if (!el) return;
    const debtors = svc_clients
        .map(c => ({ c, debt: -clientBalance(c.id) }))
        .filter(x => x.debt > 0)
        .sort((a, b) => b.debt - a.debt)
        .slice(0, 5);
    if (!debtors.length) { el.innerHTML = '<div style="color:#16a34a; padding:10px;">✅ Нет должников</div>'; return; }
    el.innerHTML = debtors.map(({c, debt}) => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f1f5f9; cursor:pointer;" onclick="showServicesPage(); setTimeout(()=>openSvcClientModal(${c.id}),300);">
            <b>${c.name}</b>
            <span style="color:#ef4444; font-weight:700;">${formatMoney(debt)}</span>
        </div>`).join('');
}

// ── DASHBOARD: кто сегодня работает (краткая версия) ──
async function renderDashAttendanceToday() {
    const el = document.getElementById('dash-attendance-today');
    if (!el) return;
    const today = new Date().toISOString().slice(0, 10);
    try {
        const { data, error } = await _supabase
            .from('activity_logs')
            .select('*')
            .in('type', ['login', 'logout'])
            .gte('created_at', `${today}T00:00:00Z`)
            .lte('created_at', `${today}T23:59:59Z`)
            .order('created_at', { ascending: true });
        if (error) { el.innerHTML = '<div style="color:var(--text-muted);">Нет данных</div>'; return; }

        const events = (data || []).filter(e => e.user_name !== 'admin939291' && e.user_name !== 'Администратор');
        const sessions = {};
        events.forEach(e => {
            if (!sessions[e.user_name]) sessions[e.user_name] = [];
            if (e.type === 'login') sessions[e.user_name].push({ login: new Date(e.created_at), logout: null });
            else {
                const open = [...sessions[e.user_name]].reverse().find(s => s.logout === null);
                if (open) open.logout = new Date(e.created_at);
            }
        });

        const names = Object.keys(sessions);
        if (!names.length) { el.innerHTML = '<div style="color:var(--text-muted); padding:10px;">Сегодня ещё никто не заходил</div>'; return; }

        const working = names.filter(n => sessions[n][sessions[n].length-1]?.logout === null);
        const left    = names.filter(n => !working.includes(n));

        el.innerHTML = `
            <div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:10px;">
                <div><span style="color:var(--success); font-weight:900; font-size:20px;">${working.length}</span> <span style="color:var(--text-secondary); font-size:12px;">на работе</span></div>
                <div><span style="color:var(--text-secondary); font-weight:900; font-size:20px;">${left.length}</span> <span style="color:var(--text-secondary); font-size:12px;">ушли</span></div>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                ${working.map(n => `<span class="attend-badge attend-working">🟢 ${n}</span>`).join('')}
                ${left.map(n => `<span class="attend-badge attend-left">⚪ ${n}</span>`).join('')}
            </div>
        `;
    } catch(e) { el.innerHTML = '<div style="color:var(--text-muted);">Ошибка загрузки</div>'; }
}

function isOrderFinished(o) {
    if(!o.path || !o.history) return false;
    const lastStep = o.path[o.path.length-1];
    return !!o.history[lastStep]?.end;
}

function lookupCRMOrder(orderId) {
    const inputVal = orderId.trim();
    const resultCard = document.getElementById('crm-lookup-card');
    
    if(!inputVal) {
        resultCard.classList.add('hidden');
        return;
    }

    const orderData = crm_orders.find(c => c.oid === inputVal);

    if(orderData) {
        document.getElementById('lookup-client').innerText = orderData.client || '-';
        document.getElementById('lookup-phone').innerText = orderData.phone || '-';
        document.getElementById('lookup-item').innerText = orderData.item || '-';
        document.getElementById('lookup-price').innerText = formatMoney(orderData.price);
        document.getElementById('lookup-loc').innerText = orderData.loc || '-';
        document.getElementById('lookup-date').innerText = orderData.date || 'Нет даты';
        document.getElementById('lookup-due-date').innerText = orderData.due_date || '—';
        
        resultCard.classList.remove('hidden');
    } else {
        resultCard.classList.add('hidden');
    }
}

function closeCRMLookup() {
    document.getElementById('crm-lookup-card').classList.add('hidden');
    document.getElementById('adm-o-id').value = '';
    updateOrderCodePreview();
}

// Показывает живой предпросмотр кодов процессов (1001-01, 1001-02, ...) при создании заказа
async function saveWorker() {
    const name = document.getElementById('adm-w-name').value.trim();
    const procs = Array.from(document.querySelectorAll('#adm-w-grid input:checked')).map(c => c.value);
    if(!name) return showToast("Введите имя", "error");
    if(procs.length === 0) return showToast("Выберите процессы", "error");

    try {
        const isRenaming = editWId && editWId !== name;
        if (isRenaming) {
            await _supabase.from('workers').delete().eq('name', editWId);
            await _supabase.from('workers').insert({ name, procs });
            await logActivity(curUser.name, 'Обновил сотрудника', 
                `Сотрудник: ${name}, доступы: ${procs.length} процессов`, 'worker');
            showToast(`Сотрудник переименован в '${name}'`);
        } else {
            await _supabase.from('workers').upsert({ name, procs: JSON.stringify(procs) });
            await logActivity(curUser.name, 'Создал нового сотрудника', 
                `Сотрудник: ${name}, доступы: ${procs.length} процессов`, 'worker');
            showToast("Доступы обновлены");
        }
        resetWorkerForm();
        await loadAllData();
    } catch (err) {
        showToast("Ошибка: " + err.message, "error");
    }
}

function editWorker(name) {
    const w = workers.find(x => x.name === name);
    if(!w) return;
    editWId = name;
    document.getElementById('adm-w-name').value = w.name;
    document.getElementById('worker-form-title').innerText = "Редактирование: " + name;
    document.getElementById('worker-form-container').classList.add('edit-mode-active');
    document.getElementById('btn-cancel-w').classList.remove('hidden');
    document.querySelectorAll('#adm-w-grid input').forEach(cb => {
        cb.checked = w.procs && w.procs.includes(cb.value);
    });
}

function resetWorkerForm() {
    editWId = null;
    document.getElementById('adm-w-name').value = '';
    document.getElementById('worker-form-title').innerText = "Добавить сотрудника";
    document.getElementById('worker-form-container').classList.remove('edit-mode-active');
    document.getElementById('btn-cancel-w').classList.add('hidden');
    document.querySelectorAll('#adm-w-grid input').forEach(cb => cb.checked = false);
}

function renderWorkers() {
    const tableBody = document.getElementById('w-table');
    if(!tableBody) return;
    tableBody.innerHTML = '';

    if(workers.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 20px;">Нет сотрудников</td></tr>';
        return;
    }

    tableBody.innerHTML = workers.map(w => {
        const procsList = Array.isArray(w.procs) ? w.procs : [];
        return `
        <tr>
            <td data-label="Сотрудник"><b>${w.name || 'Без имени'}</b></td>
            <td data-label="Доступы">${procsList.map(p => `<span class="proc-badge">${p}</span>`).join('')}</td>
            <td data-label="Действия">
                <button class="btn-ghost" onclick="editWorker('${esc(w.name)}')">✏️</button>
                <button class="btn-red" onclick="delW('${esc(w.name)}')">✖</button>
            </td>
        </tr>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════
// ОБЪЁМ ВЫПОЛНЕННЫХ РАБОТ — сколько сделал каждый работник
// Сейчас считает: Шлиповка / Грунтовка / Краска (paint_records).
// Позже сюда добавятся другие процессы (раскрой, кромка и т.д.)
// ═══════════════════════════════════════════════════════
let wvPeriod = 'day';

function setWvPeriod(period) {
    wvPeriod = period;
    document.querySelectorAll('.wv-period-btn').forEach(b => b.classList.remove('active'));
    const map = { day: 'сегодня', week: 'недел', month: 'месяц', all: 'всё время' };
    document.querySelectorAll('.wv-period-btn').forEach(b => {
        if (b.textContent.toLowerCase().includes(map[period])) b.classList.add('active');
    });
    renderWorkerVolumeStats();
}

// Определяет тип этапа покраски по его ключу (шлиф_1 -> шлиповка, и т.д.)
function paintStageType(stageKey) {
    const stage = PAINT_STAGES_DEF.find(s => s.key === stageKey);
    return stage ? stage.type : 'другое';
}

function isInWvPeriod(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const now = new Date();
    if (wvPeriod === 'all') return true;
    if (wvPeriod === 'day') {
        return d.toDateString() === now.toDateString();
    }
    if (wvPeriod === 'week') {
        const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
        return d >= weekAgo && d <= now;
    }
    if (wvPeriod === 'month') {
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }
    return true;
}

async function renderWorkerVolumeStats() {
    const el = document.getElementById('worker-volume-stats');
    if (!el) return;

    // Подгружаем записи покраски, если их ещё нет в кеше
    if (!paint_records.length) {
        try {
            const { data } = await _supabase.from('paint_records').select('*');
            paint_records = data || [];
        } catch(e) { /* таблица может быть не создана — просто покажем пусто */ }
    }

    const filtered = paint_records.filter(r => isInWvPeriod(r.created_at));

    if (!filtered.length) {
        el.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:24px;">Нет данных за выбранный период</div>';
        return;
    }

    // Группируем по работнику, внутри — по типу этапа + считаем м²
    const byWorker = {};
    filtered.forEach(r => {
        const w = r.worker || 'Неизвестно';
        if (!byWorker[w]) byWorker[w] = { 'шлиповка': 0, 'грунтовка': 0, 'краска': 0, total: 0, area: 0 };
        const type = paintStageType(r.stage_key);
        if (byWorker[w][type] !== undefined) byWorker[w][type] += (r.qty_done || 0);
        byWorker[w].total += (r.qty_done || 0);

        const cat = paint_catalog.find(c => c.name === r.item_name);
        if (cat) byWorker[w].area += (cat.area_m2 || 0) * (r.qty_done || 0);
    });

    const sortedWorkers = Object.entries(byWorker).sort((a, b) => b[1].total - a[1].total);

    el.innerHTML = sortedWorkers.map(([name, stats]) => `
        <div class="wv-worker-card" style="cursor:pointer;" onclick="openWvWorkerModal('${esc(name)}')">
            <div class="wv-worker-name">
                <span>${name}</span>
                <div style="display:flex; gap:8px; align-items:center;">
                    <span class="wv-total-badge" style="background:#ecfdf5; color:#16a34a;">${stats.area.toFixed(1)} м²</span>
                    <span class="wv-total-badge">${stats.total} шт</span>
                </div>
            </div>
            <div class="wv-stage-grid">
                <div class="wv-stage-item"><div class="wv-stage-val">${stats['шлиповка']}</div><div class="wv-stage-label">Шлиповка</div></div>
                <div class="wv-stage-item"><div class="wv-stage-val">${stats['грунтовка']}</div><div class="wv-stage-label">Грунтовка</div></div>
                <div class="wv-stage-item"><div class="wv-stage-val">${stats['краска']}</div><div class="wv-stage-label">Краска</div></div>
            </div>
            <div style="text-align:center; font-size:11px; color:var(--primary); font-weight:700; margin-top:8px;">👁 Нажмите для подробностей →</div>
        </div>`).join('');
}

// ── МОДАЛЬ: ПОДРОБНОСТИ ПО РАБОТНИКУ ──
function openWvWorkerModal(workerName) {
    const filtered = paint_records.filter(r => r.worker === workerName && isInWvPeriod(r.created_at));

    const periodLabels = { day: 'Сегодня', week: 'За неделю', month: 'За месяц', all: 'За всё время' };
    document.getElementById('wv-modal-name').innerText = workerName;
    document.getElementById('wv-modal-period').innerText = periodLabels[wvPeriod] || '';

    let totalArea = 0, totalQty = 0;
    const orderSet = new Set();
    filtered.forEach(r => {
        totalQty += (r.qty_done || 0);
        orderSet.add(r.order_id);
        const cat = paint_catalog.find(c => c.name === r.item_name);
        if (cat) totalArea += (cat.area_m2 || 0) * (r.qty_done || 0);
    });

    document.getElementById('wv-modal-total-m2').innerText = totalArea.toFixed(1) + ' м²';
    document.getElementById('wv-modal-total-qty').innerText = totalQty + ' шт';
    document.getElementById('wv-modal-orders-count').innerText = orderSet.size;
    document.getElementById('wv-modal-records-count').innerText = filtered.length;

    const body = document.getElementById('wv-modal-body');
    if (!filtered.length) {
        body.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:24px;">Нет записей за этот период</div>';
    } else {
        const sorted = [...filtered].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const byDate = {};
        sorted.forEach(r => {
            const d = (r.created_at || '').slice(0, 10);
            if (!byDate[d]) byDate[d] = [];
            byDate[d].push(r);
        });

        body.innerHTML = Object.entries(byDate).map(([date, recs]) => {
            const dayArea = recs.reduce((s, r) => {
                const cat = paint_catalog.find(c => c.name === r.item_name);
                return s + (cat ? cat.area_m2 * (r.qty_done||0) : 0);
            }, 0);
            const dayLabel = new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', { day:'2-digit', month:'long', weekday:'short' });

            return `<div style="margin-bottom:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:2px solid #e2e8f0; margin-bottom:8px;">
                    <b style="color:var(--primary); font-size:14px;">📅 ${dayLabel}</b>
                    <span style="font-size:13px; font-weight:700; color:#16a34a;">${dayArea.toFixed(1)} м²</span>
                </div>
                ${recs.map(r => {
                    const cat = paint_catalog.find(c => c.name === r.item_name);
                    const area = cat ? (cat.area_m2 * (r.qty_done||0)).toFixed(2) : '—';
                    const time = r.created_at ? new Date(r.created_at).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}) : '';
                    const stageLabel = PAINT_STAGES_DEF.find(s => s.key === r.stage_key)?.label || r.stage_key;
                    return `<div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:var(--surface); border-radius:10px; margin-bottom:6px;">
                        <div>
                            <div style="font-weight:700; font-size:13px;">${r.item_name || 'Без названия'}</div>
                            <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">
                                <span class="wt-code-chip" style="margin-right:6px;">#${r.order_id}</span>
                                ${stageLabel} · ${time}
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-weight:800; font-size:14px; color:var(--primary);">${r.qty_done} шт</div>
                            <div style="font-size:11px; color:#16a34a; font-weight:700;">${area} м²</div>
                        </div>
                    </div>`;
                }).join('')}
            </div>`;
        }).join('');
    }

    document.getElementById('wv-worker-modal').classList.remove('hidden');
    document.getElementById('wv-worker-modal').scrollTop = 0;
}

function closeWvWorkerModal() {
    document.getElementById('wv-worker-modal').classList.add('hidden');
}

// ═══════════════════════════════════════════════════════
// МОЯ СТАТИСТИКА — личная статистика для работника
// Показывает: заказы, процессы, объём, старт, финиш, длительность
// ═══════════════════════════════════════════════════════
let myStatsPeriod = 'month';

function setMyStatsPeriod(p) {
    myStatsPeriod = p;
    document.querySelectorAll('.my-stats-period').forEach(function(btn) {
        btn.style.background = btn.textContent.trim() ===
            ({day:'Сегодня',week:'Неделя',month:'Месяц',all:'Всё время'})[p] ? '#f1f5f9' : '#fff';
    });
    renderMyWorkerStats();
}

function isInMyStatsPeriod(dateStr) {
    if (!dateStr || myStatsPeriod === 'all') return true;
    var d = new Date(dateStr);
    var now = new Date();
    if (myStatsPeriod === 'day') {
        return d.toISOString().slice(0,10) === now.toISOString().slice(0,10);
    }
    var ago = new Date();
    if (myStatsPeriod === 'week') ago.setDate(ago.getDate() - 7);
    else if (myStatsPeriod === 'month') ago.setDate(ago.getDate() - 30);
    else ago.setMonth(ago.getMonth() - 1);
    return d >= ago;
}

function openMyWorkerStats() {
    if (!curUser) return;
    var m = document.getElementById('my-stats-modal');
    if (m) m.classList.remove('hidden');
    document.getElementById('my-stats-name').innerText = curUser.name;
    renderMyWorkerStats();
}

function closeMyWorkerStats() {
    var m = document.getElementById('my-stats-modal');
    if (m) m.classList.add('hidden');
}

async function renderMyWorkerStats() {
    if (!curUser) return;
    var body = document.getElementById('my-stats-body');
    if (!body) return;
    body.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Загрузка...</div>';

    var workerName = curUser.name;
    var records = [];

    // Собираем завершённые процессы из orders[].history[]
    orders.forEach(function(o) {
        if (!o.history) return;
        var procs = Object.keys(o.history);
        procs.forEach(function(procName) {
            var h = o.history[procName];
            if (!h || !h.end) return;
            if (h.completed_by !== workerName && h.worker !== workerName) return;
            var startT = h.start ? new Date(h.start) : null;
            var endT = h.end ? new Date(h.end) : null;
            if (!isInMyStatsPeriod(h.end)) return;
            var dur = 0;
            if (startT && endT) dur = Math.round((endT - startT) / 60000);
            var crmData = crm_orders.find(function(c) { return c.oid === o.id; });
            records.push({
                orderId: o.id,
                proc: procName,
                qty: h.qty_done || 1,
                unit: h.unit || 'шт',
                startTime: startT,
                endTime: endT,
                duration: dur,
                item: crmData ? crmData.item : '',
                client: crmData ? crmData.client : '',
                sum: 0
            });
        });
    });

    // Собираем записи покраски
    if (paint_records.length) {
        paint_records.forEach(function(r) {
            if (r.worker !== workerName) return;
            if (!isInMyStatsPeriod(r.created_at)) return;
            var cat = paint_catalog.find(function(c) { return c.name === r.item_name; });
            var crmData2 = crm_orders.find(function(c) { return c.oid === r.order_id; });
            records.push({
                orderId: r.order_id,
                proc: (PAINT_STAGES_DEF.find(function(s) { return s.key === r.stage_key; }) || {}).label || r.stage_key,
                qty: r.qty_done || 0,
                unit: cat ? 'м²' : 'шт',
                startTime: r.created_at ? new Date(r.created_at) : null,
                endTime: r.created_at ? new Date(r.created_at) : null,
                duration: 0,
                item: r.item_name || '',
                client: crmData2 ? crmData2.client : '',
                sum: 0,
                isPaint: true
            });
        });
    }

    // Собираем строки "Работа/монтаж" из калькуляции заказа (order_labor), назначенные на этого
    // работника — раньше эти суммы нигде не были видны самому работнику
    try {
        const { data: laborData } = await _supabase.from('order_labor').select('*').eq('worker', workerName);
        (laborData || []).forEach(function(lab) {
            if (!isInMyStatsPeriod(lab.created_at)) return;
            var crmDataL = crm_orders.find(function(c) { return c.oid === lab.order_id; });
            records.push({
                orderId: lab.order_id,
                proc: lab.description || 'Работа/монтаж',
                qty: lab.qty || 1,
                unit: 'шт',
                startTime: lab.created_at ? new Date(lab.created_at) : null,
                endTime: lab.created_at ? new Date(lab.created_at) : null,
                duration: 0,
                item: crmDataL ? crmDataL.item : '',
                client: crmDataL ? crmDataL.client : '',
                sum: (lab.qty || 1) * (lab.unit_price || 0),
                isLabor: true
            });
        });
    } catch(e) { console.warn('order_labor load error (my stats):', e); }

    // Сортировка по дате (новые сверху)
    records.sort(function(a, b) {
        var ta = a.endTime || a.startTime;
        var tb = b.endTime || b.startTime;
        return (tb ? tb.getTime() : 0) - (ta ? ta.getTime() : 0);
    });

    // Считаем итоги
    var totalProcs = records.length;
    var totalQty = 0;
    var totalMinutes = 0;
    var totalSum = 0;
    var orderSet = {};
    records.forEach(function(r) {
        totalQty += r.qty;
        totalMinutes += r.duration;
        totalSum += (r.sum || 0);
        orderSet[r.orderId] = true;
    });

    var totalH = Math.floor(totalMinutes / 60);
    var totalM = totalMinutes % 60;
    var totalHoursStr = totalH > 0 ? totalH + 'ч ' + totalM + 'м' : totalM + 'м';

    document.getElementById('my-stats-total-procs').innerText = totalProcs;
    document.getElementById('my-stats-total-qty').innerText = totalQty;
    document.getElementById('my-stats-total-orders').innerText = Object.keys(orderSet).length;
    document.getElementById('my-stats-total-hours').innerText = totalHoursStr;
    var sumEl = document.getElementById('my-stats-total-sum');
    if (sumEl) sumEl.innerText = formatMoney(totalSum);

    if (!records.length) {
        body.innerHTML = '<div style="text-align:center; padding:24px; color:var(--text-muted);">Нет завершённых работ за этот период</div>';
        return;
    }

    // Группируем по дате
    var byDate = {};
    records.forEach(function(r) {
        var d = r.endTime ? r.endTime.toISOString().slice(0,10) : (r.startTime ? r.startTime.toISOString().slice(0,10) : 'unknown');
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(r);
    });

    var html = '<table class="modern-table" style="font-size:13px; width:100%;">'
        + '<thead><tr>'
        + '<th>Дата</th><th>Заказ</th><th>Процесс</th><th>Изделие</th><th>Объём</th><th>Старт</th><th>Финиш</th><th>Длительность</th><th>Сумма</th>'
        + '</tr></thead><tbody>';

    var sortedDates = Object.keys(byDate).sort().reverse();
    sortedDates.forEach(function(date) {
        var dayRecs = byDate[date];
        var dayLabel = new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit', weekday:'short'});
        var dayQty = 0;
        dayRecs.forEach(function(r) { dayQty += r.qty; });

        dayRecs.forEach(function(r, ri) {
            var startStr = r.startTime ? r.startTime.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}) : '—';
            var endStr = r.endTime ? r.endTime.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}) : '—';
            var durStr = r.duration > 0 ? (Math.floor(r.duration/60) > 0 ? Math.floor(r.duration/60) + 'ч ' : '') + (r.duration%60) + 'м' : '—';
            if (ri === 0) {
                html += '<tr style="background:#f8fafc;">'
                    + '<td rowspan="' + dayRecs.length + '" style="font-weight:700; color:var(--primary); vertical-align:top; border-bottom:2px solid #e2e8f0;">'
                    + '📅 ' + dayLabel + '<br><span style="font-size:10px; color:var(--text-muted);">∑ ' + dayQty + '</span></td>';
            } else {
                html += '<tr>';
            }
            html += '<td><span class="wt-code-chip">#' + r.orderId + '</span></td>'
                + '<td style="font-weight:600;">' + r.proc + '</td>'
                + '<td style="font-size:12px; color:var(--text-secondary);">' + (r.item || '—') + '</td>'
                + '<td style="font-weight:800; color:var(--primary);">' + r.qty + ' ' + r.unit + '</td>'
                + '<td style="font-size:12px;">' + startStr + '</td>'
                + '<td style="font-size:12px;">' + endStr + '</td>'
                + '<td style="font-size:12px; font-weight:700;">' + durStr + '</td>'
                + '<td style="font-size:12px; font-weight:700; color:#8b5cf6;">' + (r.sum ? formatMoney(r.sum) : '—') + '</td>'
                + '</tr>';
        });
    });

    html += '</tbody></table>';
    body.innerHTML = html;
}

// ═══════════════════════════════════════════════════════
// ПЕРЕКЛЮЧЕНИЕ СЕКЦИЙ ПЕРСОНАЛА (Сотрудники / Аналитика)
// ═══════════════════════════════════════════════════════
function showPersonnelSection(name) {
    // Hide all sections
    var sections = document.querySelectorAll('#page-workers .wh-section');
    for (var i = 0; i < sections.length; i++) {
        sections[i].style.display = 'none';
        sections[i].classList.remove('active');
    }
    // Show target
    var target = document.getElementById(name === 'analytics' ? 'ps-sec-analytics' : 'ps-sec-workers');
    if (target) {
        target.style.display = 'block';
        target.classList.add('active');
    }
    // Update subnav buttons
    var btns = document.querySelectorAll('#page-workers .wh-subnav-btn');
    for (var i = 0; i < btns.length; i++) {
        btns[i].classList.remove('active');
    }
    // Find matching button
    var allBtns = document.querySelectorAll('#page-workers .wh-subnav-btn');
    for (var i = 0; i < allBtns.length; i++) {
        var txt = allBtns[i].textContent || '';
        if (name === 'analytics' && txt.indexOf('Аналитика') !== -1) allBtns[i].classList.add('active');
        if (name === 'workers' && txt.indexOf('Сотрудники') !== -1) allBtns[i].classList.add('active');
    }
    // Trigger render on section switch
    if (name === 'analytics') {
        renderDetailedActivity();
    } else {
        renderPersonnelStats();
    }
}

// ═══════════════════════════════════════════════════════
// КОНТРОЛЬ ПЕРСОНАЛА — объединённый модуль
// ═══════════════════════════════════════════════════════
var psPeriod = 'month';

function setPsPeriod(p) {
    psPeriod = p;
    var tabs = document.querySelectorAll('.ps-period-btn');
    for (var i = 0; i < tabs.length; i++) {
        tabs[i].style.background = '#f1f5f9';
        tabs[i].style.color = 'var(--text-secondary)';
    }
    var map = {day:'Сегодня',week:'Неделя',month:'Месяц',all:'Всё время'};
    for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].innerText.trim() === map[p]) {
            tabs[i].style.background = 'var(--primary)';
            tabs[i].style.color = '#fff';
        }
    }
    renderPersonnelStats();
}

function isInPsPeriod(dateStr) {
    if (!dateStr) return false;
    var d = new Date(dateStr);
    var now = new Date();
    if (psPeriod === 'all') return true;
    if (psPeriod === 'day') return d.toDateString() === now.toDateString();
    if (psPeriod === 'week') { var wa = new Date(now); wa.setDate(now.getDate()-7); return d >= wa && d <= now; }
    if (psPeriod === 'month') return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth();
    return true;
}

function _psFormatDuration(minutes) {
    if (!minutes || minutes <= 0) return '0м';
    var h = Math.floor(minutes / 60);
    var m = Math.round(minutes % 60);
    return (h > 0 ? h + 'ч ' : '') + m + 'м';
}

function _psCollectRecords() {
    var records = [];
    // 1) Completed processes from orders[].history[]
    for (var oi = 0; oi < orders.length; oi++) {
        var o = orders[oi];
        if (!o.history) continue;
        var keys = Object.keys(o.history);
        for (var ki = 0; ki < keys.length; ki++) {
            var procName = keys[ki];
            var h = o.history[procName];
            if (!h || !h.end) continue;
            if (!isInPsPeriod(h.end)) continue;
            var startT = h.start ? new Date(h.start) : null;
            var endT = h.end ? new Date(h.end) : null;
            var dur = 0;
            if (startT && endT) dur = Math.round((endT - startT) / 60000);
            var crmData = null;
            for (var ci = 0; ci < crm_orders.length; ci++) {
                if (crm_orders[ci].oid === o.id) { crmData = crm_orders[ci]; break; }
            }
            records.push({
                date: (h.end || '').slice(0,10),
                worker: h.completed_by || h.worker || '?',
                orderId: o.id,
                proc: procName,
                qty: h.qty_done || 1,
                unit: h.unit || 'шт',
                startTime: startT,
                endTime: endT,
                duration: dur,
                item: crmData ? crmData.item : '',
                client: crmData ? crmData.client : '',
                sum: 0,
                source: 'process'
            });
        }
    }
    // 2) Paint records
    for (var pi = 0; pi < paint_records.length; pi++) {
        var pr = paint_records[pi];
        if (!pr.created_at) continue;
        if (!isInPsPeriod(pr.created_at)) continue;
        var crmData2 = null;
        for (var ci2 = 0; ci2 < crm_orders.length; ci2++) {
            if (crm_orders[ci2].oid === pr.order_id) { crmData2 = crm_orders[ci2]; break; }
        }
        records.push({
            date: (pr.created_at || '').slice(0,10),
            worker: pr.worker || '?',
            orderId: pr.order_id,
            proc: 'Краска — ' + (pr.item_name || ''),
            qty: pr.qty_done || 1,
            unit: pr.unit || 'шт',
            startTime: pr.created_at ? new Date(pr.created_at) : null,
            endTime: pr.created_at ? new Date(pr.created_at) : null,
            duration: 0,
            item: crmData2 ? crmData2.item : '',
            client: crmData2 ? crmData2.client : '',
            sum: 0,
            source: 'paint'
        });
    }
    // 3) Работа/монтаж из калькуляции заказа (order_labor) — раньше эти строки нигде не
    // засчитывались работнику, даже если админ явно указал кол-во, цену и исполнителя
    for (var lai = 0; lai < all_order_labor.length; lai++) {
        var lab = all_order_labor[lai];
        if (!lab.worker || !lab.created_at) continue;
        if (!isInPsPeriod(lab.created_at)) continue;
        var crmData3 = null;
        for (var ci3 = 0; ci3 < crm_orders.length; ci3++) {
            if (crm_orders[ci3].oid === lab.order_id) { crmData3 = crm_orders[ci3]; break; }
        }
        records.push({
            date: (lab.created_at || '').slice(0,10),
            worker: lab.worker,
            orderId: lab.order_id,
            proc: lab.description || 'Работа/монтаж',
            qty: lab.qty || 1,
            unit: 'шт',
            startTime: lab.created_at ? new Date(lab.created_at) : null,
            endTime: lab.created_at ? new Date(lab.created_at) : null,
            duration: 0,
            item: crmData3 ? crmData3.item : '',
            client: crmData3 ? crmData3.client : '',
            sum: (lab.qty || 1) * (lab.unit_price || 0),
            source: 'labor'
        });
    }
    return records;
}

async function renderPersonnelStats() {
    var kpiEl = document.getElementById('ps-kpi-summary');
    var listEl = document.getElementById('ps-worker-list');

    // order_labor раньше грузился только при открытии страницы Финансы — если админ туда не
    // заходил, all_order_labor оставался пустым и суммы работникам никогда не начислялись
    if (!all_order_labor.length) {
        try {
            const { data } = await _supabase.from('order_labor').select('*');
            all_order_labor = data || [];
        } catch(e) { console.warn('order_labor load error:', e); }
    }

    var records = _psCollectRecords();

    // KPI
    var workerSet = {};
    var totalProc = records.length;
    var totalQty = 0;
    var totalMin = 0;
    var laborSum = 0;

    // labor sum from all_order_labor
    for (var li = 0; li < all_order_labor.length; li++) {
        var lab = all_order_labor[li];
        if (!lab.created_at || !lab.worker) continue;
        if (!isInPsPeriod(lab.created_at)) continue;
        laborSum += (lab.qty || 1) * (lab.unit_price || 0);
    }

    // Group by worker
    var byWorker = {};
    for (var ri = 0; ri < records.length; ri++) {
        var r = records[ri];
        var wName = r.worker || '?';
        workerSet[wName] = true;
        totalQty += (r.qty || 0);
        totalMin += (r.duration || 0);
        if (!byWorker[wName]) byWorker[wName] = { count: 0, qty: 0, minutes: 0, sum: 0, orders: {}, records: [] };
        byWorker[wName].count++;
        byWorker[wName].qty += (r.qty || 0);
        byWorker[wName].minutes += (r.duration || 0);
        byWorker[wName].sum += (r.sum || 0);
        byWorker[wName].orders[r.orderId] = true;
        byWorker[wName].records.push(r);
    }

    var uniqueWorkers = Object.keys(workerSet);
    var totalH = Math.floor(totalMin / 60);
    var totalM = totalMin % 60;

    if (kpiEl) {
        kpiEl.innerHTML =
            '<div class="svc-stat-card" style="flex:1; min-width:120px;"><div class="svc-stat-val">' + uniqueWorkers.length + '</div><div class="svc-stat-label">Активных людей</div></div>' +
            '<div class="svc-stat-card" style="flex:1; min-width:120px;"><div class="svc-stat-val" style="color:var(--primary);">' + totalProc + '</div><div class="svc-stat-label">Процессов завершено</div></div>' +
            '<div class="svc-stat-card" style="flex:1; min-width:120px;"><div class="svc-stat-val" style="color:#f59e0b;">' + totalQty + '</div><div class="svc-stat-label">Общий объём</div></div>' +
            '<div class="svc-stat-card" style="flex:1; min-width:120px;"><div class="svc-stat-val" style="color:var(--success);">' + (totalH > 0 ? totalH + 'ч ' : '') + totalM + 'м</div><div class="svc-stat-label">Общее время</div></div>' +
            '<div class="svc-stat-card" style="flex:1; min-width:120px;"><div class="svc-stat-val" style="color:#8b5cf6;">' + formatMoney(laborSum) + '</div><div class="svc-stat-label">Сумма работ</div></div>';
    }

    // Worker cards
    if (listEl) {
        var workerNames = Object.keys(byWorker).sort();
        if (workerNames.length === 0) {
            listEl.innerHTML = '<div style="text-align:center; padding:24px; color:var(--text-muted);">Нет данных за выбранный период</div>';
            return;
        }
        var html = '';
        for (var wi = 0; wi < workerNames.length; wi++) {
            var wn = workerNames[wi];
            var wd = byWorker[wn];
            var orderCount = Object.keys(wd.orders).length;
            var durStr = _psFormatDuration(wd.minutes);
            var wnSafe = wn.replace(/'/g, "\\u0027");
            var sumLine = wd.sum > 0 ? ' · <span style="color:#8b5cf6; font-weight:700;">' + formatMoney(wd.sum) + '</span>' : '';
            html += '<div class="card" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding:16px;" onclick="openWorkerDetail(\'' + wnSafe + '\')">' +
                '<div>' +
                    '<div style="font-size:16px; font-weight:800; color:var(--text-primary);">👤 ' + wn + '</div>' +
                    '<div style="font-size:12px; color:var(--text-muted); margin-top:4px;">' +
                        wd.count + ' процессов · ' + wd.qty + ' ' + wd.records[0].unit + ' · ' + durStr + ' · ' + orderCount + ' заказов' + sumLine +
                    '</div>' +
                '</div>' +
                '<button class="btn-blue" style="padding:8px 16px; font-size:13px;" onclick="event.stopPropagation(); openWorkerDetail(\'' + wnSafe + '\')">👁 Подробнее</button>' +
            '</div>';
        }
        listEl.innerHTML = html;
    }
}

function openWorkerDetail(workerName) {
    var modal = document.getElementById('worker-detail-modal');
    if (modal) modal.classList.remove('hidden');

    var nameEl = document.getElementById('wd-worker-name');
    var periodEl = document.getElementById('wd-period-label');
    var statProcEl = document.getElementById('wd-stat-procs');
    var statQtyEl = document.getElementById('wd-stat-qty');
    var statOrdersEl = document.getElementById('wd-stat-orders');
    var statTimeEl = document.getElementById('wd-stat-time');
    var statSumEl = document.getElementById('wd-stat-sum');
    var bodyEl = document.getElementById('wd-body');

    var periodLabels = {day:'Сегодня', week:'Неделя', month:'Месяц', all:'Всё время'};

    if (nameEl) nameEl.innerText = workerName;
    if (periodEl) periodEl.innerText = periodLabels[psPeriod] || psPeriod;

    var records = _psCollectRecords().filter(function(r) { return r.worker === workerName; });

    // Stats
    var procCount = records.length;
    var qtyTotal = 0;
    var minTotal = 0;
    var sumTotal = 0;
    var orderSet = {};
    for (var i = 0; i < records.length; i++) {
        qtyTotal += (records[i].qty || 0);
        minTotal += (records[i].duration || 0);
        sumTotal += (records[i].sum || 0);
        orderSet[records[i].orderId] = true;
    }
    var orderCount = Object.keys(orderSet).length;

    if (statProcEl) statProcEl.innerText = procCount;
    if (statQtyEl) statQtyEl.innerText = qtyTotal;
    if (statOrdersEl) statOrdersEl.innerText = orderCount;
    if (statTimeEl) statTimeEl.innerText = _psFormatDuration(minTotal);
    if (statSumEl) statSumEl.innerText = formatMoney(sumTotal);

    // Group by order
    var byOrder = {};
    for (var j = 0; j < records.length; j++) {
        var r = records[j];
        if (!byOrder[r.orderId]) {
            byOrder[r.orderId] = { client: r.client, item: r.item, qty: 0, records: [] };
        }
        byOrder[r.orderId].qty += (r.qty || 0);
        byOrder[r.orderId].records.push(r);
    }

    if (bodyEl) {
        var orderIds = Object.keys(byOrder).sort();
        if (orderIds.length === 0) {
            bodyEl.innerHTML = '<div style="text-align:center; padding:24px; color:var(--text-muted);">Нет записей</div>';
            return;
        }
        var html = '';
        for (var oi = 0; oi < orderIds.length; oi++) {
            var oid = orderIds[oi];
            var od = byOrder[oid];
            html += '<div class="card" style="margin-bottom:10px; padding:0; overflow:hidden;">' +
                '<div style="display:flex; justify-content:space-between; align-items:center; padding:14px 16px; cursor:pointer; background:var(--surface);" onclick="var tbl=document.getElementById(\x27wd-tbl-' + oid + '\x27); if(tbl) tbl.classList.toggle(\x27hidden\x27);">' +
                    '<div>' +
                        '<div style="font-weight:800; font-size:15px; color:var(--primary);">Заказ #' + oid + '</div>' +
                        '<div style="font-size:12px; color:var(--text-muted); margin-top:3px;">' + (od.client || '—') + (od.item ? ' · ' + od.item : '') + '</div>' +
                    '</div>' +
                    '<div style="text-align:right;">' +
                        '<div style="font-weight:800; font-size:15px;">' + od.qty + '</div>' +
                        '<div style="font-size:11px; color:var(--text-muted);">объём</div>' +
                    '</div>' +
                '</div>' +
                '<div id="wd-tbl-' + oid + '" class="hidden">' +
                    '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
                    '<thead><tr style="background:#f1f5f9;">' +
                        '<th style="padding:8px 12px; text-align:left;">Процесс</th>' +
                        '<th style="padding:8px 12px; text-align:center;">Объём</th>' +
                        '<th style="padding:8px 12px; text-align:center;">Старт</th>' +
                        '<th style="padding:8px 12px; text-align:center;">Финиш</th>' +
                        '<th style="padding:8px 12px; text-align:center;">Длительность</th>' +
                        '<th style="padding:8px 12px; text-align:right;">Сумма</th>' +
                    '</tr></thead><tbody>';

            var recs = od.records;
            for (var ri = 0; ri < recs.length; ri++) {
                var rc = recs[ri];
                var startStr = rc.startTime ? ('0' + rc.startTime.getHours()).slice(-2) + ':' + ('0' + rc.startTime.getMinutes()).slice(-2) : '—';
                var endStr = rc.endTime ? ('0' + rc.endTime.getHours()).slice(-2) + ':' + ('0' + rc.endTime.getMinutes()).slice(-2) : '—';
                html += '<tr style="border-bottom:1px solid #e2e8f0;">' +
                    '<td style="padding:8px 12px;"><span class="wt-code-chip">' + rc.proc + '</span></td>' +
                    '<td style="padding:8px 12px; text-align:center; font-weight:700;">' + rc.qty + ' ' + rc.unit + '</td>' +
                    '<td style="padding:8px 12px; text-align:center; color:var(--text-secondary);">' + startStr + '</td>' +
                    '<td style="padding:8px 12px; text-align:center; color:var(--text-secondary);">' + endStr + '</td>' +
                    '<td style="padding:8px 12px; text-align:center; font-weight:700; color:var(--success);">' + _psFormatDuration(rc.duration) + '</td>' +
                    '<td style="padding:8px 12px; text-align:right; font-weight:700; color:#8b5cf6;">' + (rc.sum ? formatMoney(rc.sum) : '—') + '</td>' +
                '</tr>';
            }

            html += '</tbody></table>' +
                '<div style="padding:10px 16px; border-top:1px solid var(--border); text-align:right;">' +
                    '<button class="btn-blue" style="font-size:12px; padding:6px 14px;" onclick="document.getElementById(\x27global-search-input\x27).value=\x27' + oid + '\x27; openGlobalSearch(); closeWorkerDetail();">🔍 Открыть заказ</button>' +
                '</div>' +
                '</div>' +
            '</div>';
        }
        bodyEl.innerHTML = html;
    }
}

function closeWorkerDetail() {
    var modal = document.getElementById('worker-detail-modal');
    if (modal) modal.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════
// ДЕТАЛЬНАЯ АКТИВНОСТЬ — кто что сделал по дням (Персонал)
// Объединяет: вход/выход, завершённые процессы, покраску,
// и работы из Калькуляции заказов (order_labor с привязкой к работнику)
// ═══════════════════════════════════════════════════════
let daPeriod = 'day';
let _daActivityCache = [];
let _daLaborCache = [];

function setDaPeriod(period) {
    daPeriod = period;
    document.querySelectorAll('.da-period-btn').forEach(b => b.classList.remove('active'));
    const map = { day:'сегодня', week:'недел', month:'месяц', all:'всё время' };
    document.querySelectorAll('.da-period-btn').forEach(b => {
        if (b.textContent.toLowerCase().includes(map[period])) b.classList.add('active');
    });
    renderDetailedActivity();
}

function isInDaPeriod(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr); const now = new Date();
    if (daPeriod === 'all') return true;
    if (daPeriod === 'day') return d.toDateString() === now.toDateString();
    if (daPeriod === 'week') { const wa = new Date(now); wa.setDate(now.getDate()-7); return d >= wa && d <= now; }
    if (daPeriod === 'month') return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth();
    return true;
}

async function renderDetailedActivity() {
    const el = document.getElementById('detailed-activity-list');
    const summaryEl = document.getElementById('da-summary');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Загрузка...</div>';

    try {
        // Активность (вход/выход/процессы) — берём с запасом за 60 дней, дальше фильтруем на клиенте
        const sinceDate = new Date(); sinceDate.setDate(sinceDate.getDate() - 60);
        const { data: actData, error: actErr } = await _supabase
            .from('activity_logs')
            .select('*')
            .gte('created_at', sinceDate.toISOString())
            .order('created_at', { ascending: false });
        _daActivityCache = actErr ? [] : (actData || []);

        // Работы из калькуляции заказов (order_labor), с привязкой к работнику
        if (!all_order_labor.length) {
            const { data: labData } = await _supabase.from('order_labor').select('*');
            all_order_labor = labData || [];
        }
        _daLaborCache = all_order_labor;
    } catch(e) { console.error('Detailed activity load error:', e); }

    const activity = _daActivityCache.filter(a => isInDaPeriod(a.created_at) && a.user_name !== 'System');
    const labor = _daLaborCache.filter(l => isInDaPeriod(l.created_at) && l.worker);

    // ── Собираем завершённые процессы из orders[].history[] (с объёмом) ──
    var daProcessRecords = [];
    orders.forEach(function(o) {
        if (!o.history) return;
        Object.keys(o.history).forEach(function(procName) {
            var h = o.history[procName];
            if (!h || !h.end) return;
            if (!isInDaPeriod(h.end)) return;
            var startT = h.start ? new Date(h.start) : null;
            var endT = h.end ? new Date(h.end) : null;
            var dur = 0;
            if (startT && endT) dur = Math.round((endT - startT) / 60000);
            var crmData = crm_orders.find(function(c) { return c.oid === o.id; });
            daProcessRecords.push({
                date: (h.end || '').slice(0,10),
                worker: h.completed_by || h.worker || '?',
                orderId: o.id,
                proc: procName,
                qty: h.qty_done || 1,
                unit: h.unit || 'шт',
                startTime: startT,
                endTime: endT,
                duration: dur,
                item: crmData ? crmData.item : '',
                client: crmData ? crmData.client : ''
            });
        });
    });

    // ── Сводка ──
    if (summaryEl) {
        const uniqueWorkers = new Set([...activity.map(a=>a.user_name), ...labor.map(l=>l.worker), ...daProcessRecords.map(r=>r.worker)]);
        const processCount = activity.filter(a => a.type === 'process').length + daProcessRecords.length;
        const totalQty = daProcessRecords.reduce(function(s,r){ return s + r.qty; }, 0);
        const totalMinutes = daProcessRecords.reduce(function(s,r){ return s + r.duration; }, 0);
        const totalH = Math.floor(totalMinutes / 60);
        const totalM = totalMinutes % 60;
        const laborSum = labor.reduce((s,l) => s + (l.qty||1)*(l.unit_price||0), 0);
        summaryEl.innerHTML = `
            <div class="svc-stat-card" style="flex:1; min-width:110px;"><div class="svc-stat-val">${uniqueWorkers.size}</div><div class="svc-stat-label">Активных людей</div></div>
            <div class="svc-stat-card" style="flex:1; min-width:110px;"><div class="svc-stat-val" style="color:var(--primary);">${processCount}</div><div class="svc-stat-label">Процессов завершено</div></div>
            <div class="svc-stat-card" style="flex:1; min-width:110px;"><div class="svc-stat-val" style="color:#f59e0b;">${totalQty}</div><div class="svc-stat-label">Общий объём</div></div>
            <div class="svc-stat-card" style="flex:1; min-width:110px;"><div class="svc-stat-val" style="color:var(--success);">${totalH > 0 ? totalH + 'ч ' : ''}${totalM}м</div><div class="svc-stat-label">Общее время</div></div>
            <div class="svc-stat-card" style="flex:1; min-width:110px;"><div class="svc-stat-val" style="color:#8b5cf6;">${formatMoney(laborSum)}</div><div class="svc-stat-label">Сумма (калькуляция)</div></div>
        `;
    }

    if (!activity.length && !labor.length && !daProcessRecords.length) {
        el.innerHTML = '<div style="text-align:center; padding:24px; color:var(--text-muted);">Нет активности за выбранный период</div>';
        return;
    }

    // ── Группируем по дню ──
    const byDate = {};
    activity.forEach(a => {
        const d = (a.created_at || '').slice(0, 10);
        if (!byDate[d]) byDate[d] = { activity: [], labor: [], processes: [] };
        byDate[d].activity.push(a);
    });
    labor.forEach(l => {
        const d = (l.created_at || '').slice(0, 10);
        if (!byDate[d]) byDate[d] = { activity: [], labor: [], processes: [] };
        byDate[d].labor.push(l);
    });
    daProcessRecords.forEach(r => {
        const d = r.date;
        if (!byDate[d]) byDate[d] = { activity: [], labor: [], processes: [] };
        byDate[d].processes.push(r);
    });

    const sortedDates = Object.keys(byDate).sort().reverse();

    el.innerHTML = sortedDates.map(date => {
        const dayData = byDate[date];
        const dayLabel = new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', { day:'2-digit', month:'long', weekday:'short' });

        // Группируем активность дня по работнику
        const byWorker = {};
        dayData.activity.forEach(a => {
            const w = a.user_name || 'Неизвестно';
            if (!byWorker[w]) byWorker[w] = { logins:0, logouts:0, processes:[], other:[], procRecords:[] };
            if (a.type === 'login') byWorker[w].logins++;
            else if (a.type === 'logout') byWorker[w].logouts++;
            else if (a.type === 'process') byWorker[w].processes.push(a);
            else byWorker[w].other.push(a);
        });
        dayData.labor.forEach(l => {
            const w = l.worker || 'Неизвестно';
            if (!byWorker[w]) byWorker[w] = { logins:0, logouts:0, processes:[], other:[], labor:[], procRecords:[] };
            if (!byWorker[w].labor) byWorker[w].labor = [];
            byWorker[w].labor.push(l);
        });
        dayData.processes.forEach(r => {
            const w = r.worker || 'Неизвестно';
            if (!byWorker[w]) byWorker[w] = { logins:0, logouts:0, processes:[], other:[], procRecords:[] };
            if (!byWorker[w].procRecords) byWorker[w].procRecords = [];
            byWorker[w].procRecords.push(r);
        });

        const workerNames = Object.keys(byWorker).sort();

        return `<div style="margin-bottom:18px;">
            <div style="display:flex; align-items:center; padding:8px 0; border-bottom:2px solid #e2e8f0; margin-bottom:10px;">
                <b style="color:var(--primary); font-size:15px;">📅 ${dayLabel}</b>
                <span style="margin-left:10px; font-size:12px; color:var(--text-muted);">${workerNames.length} чел.</span>
            </div>
            ${workerNames.map(w => {
                const d = byWorker[w];
                const processCount = d.processes.length;
                const laborItems = d.labor || [];
                const laborSum = laborItems.reduce((s,l) => s + (l.qty||1)*(l.unit_price||0), 0);
                const procRecs = d.procRecords || [];
                const procQtyTotal = procRecs.reduce((s,r) => s + r.qty, 0);
                const procDurTotal = procRecs.reduce((s,r) => s + r.duration, 0);
                const procDurStr = procDurTotal > 0 ? (Math.floor(procDurTotal/60) > 0 ? Math.floor(procDurTotal/60) + 'ч ' : '') + (procDurTotal%60) + 'м' : '';

                // Таблица процессов с объёмом
                var procTableHtml = '';
                if (procRecs.length > 0) {
                    procTableHtml = '<div style="margin-top:8px; border-top:1px dashed #e2e8f0; padding-top:8px;">'
                        + '<div style="font-size:11px; font-weight:700; color:var(--text-secondary); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px;">📊 Выполненные работы (объём)</div>'
                        + '<table style="width:100%; font-size:12px; border-collapse:collapse;">'
                        + '<thead><tr style="background:#f1f5f9;">'
                        + '<th style="text-align:left; padding:6px 8px; border-radius:6px 0 0 0;">Заказ</th>'
                        + '<th style="text-align:left; padding:6px 8px;">Процесс</th>'
                        + '<th style="text-align:center; padding:6px 8px;">Объём</th>'
                        + '<th style="text-align:left; padding:6px 8px;">Старт</th>'
                        + '<th style="text-align:left; padding:6px 8px;">Финиш</th>'
                        + '<th style="text-align:right; padding:6px 8px; border-radius:0 6px 0 0;">Длительность</th>'
                        + '</tr></thead><tbody>';
                    procRecs.forEach(function(r) {
                        var sStr = r.startTime ? r.startTime.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}) : '—';
                        var eStr = r.endTime ? r.endTime.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}) : '—';
                        var dStr = r.duration > 0 ? (Math.floor(r.duration/60) > 0 ? Math.floor(r.duration/60) + 'ч ' : '') + (r.duration%60) + 'м' : '—';
                        procTableHtml += '<tr style="border-bottom:1px solid #f1f5f9;">'
                            + '<td style="padding:5px 8px;"><span class="wt-code-chip">#' + r.orderId + '</span></td>'
                            + '<td style="padding:5px 8px; font-weight:600;">' + r.proc + '</td>'
                            + '<td style="padding:5px 8px; text-align:center; font-weight:800; color:var(--primary);">' + r.qty + ' ' + r.unit + '</td>'
                            + '<td style="padding:5px 8px; color:var(--text-secondary);">' + sStr + '</td>'
                            + '<td style="padding:5px 8px; color:var(--text-secondary);">' + eStr + '</td>'
                            + '<td style="padding:5px 8px; text-align:right; font-weight:700;">' + dStr + '</td>'
                            + '</tr>';
                    });
                    procTableHtml += '<tr style="background:#f0fdf4; font-weight:800;"><td colspan="2" style="padding:6px 8px; border-radius:6px 0 0 0;">Итого за день</td>'
                        + '<td style="padding:6px 8px; text-align:center; color:var(--primary);">' + procQtyTotal + '</td>'
                        + '<td colspan="2" style="padding:6px 8px;"></td>'
                        + '<td style="padding:6px 8px; text-align:right; color:var(--success); border-radius:0 6px 0 0;">' + procDurStr + '</td>'
                        + '</tr></tbody></table></div>';
                }

                return `<div style="background:var(--surface); border-radius:12px; padding:12px 14px; margin-bottom:8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <b style="font-size:14px;">${w}</b>
                        <div style="display:flex; gap:8px; font-size:11px;">
                            ${d.logins ? `<span style="color:var(--success); font-weight:700;">🟢 ${d.logins} вход${d.logins>1?'а':''}</span>` : ''}
                            ${processCount ? `<span style="color:var(--primary); font-weight:700;">✔ ${processCount} процесс${processCount>1?'ов':''}</span>` : ''}
                            ${laborItems.length ? `<span style="color:#8b5cf6; font-weight:700;">🧮 ${laborItems.length} из калькуляции</span>` : ''}
                        </div>
                    </div>
                    ${processCount ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
                        ${d.processes.slice(0,5).map(p => `<div style="padding:3px 0;">• ${p.details || p.action || ''} <span style="color:#cbd5e1;">${new Date(p.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span></div>`).join('')}
                        ${processCount > 5 ? `<div style="color:var(--text-muted);">...и ещё ${processCount-5}</div>` : ''}
                    </div>` : ''}
                    ${laborItems.length ? `<div style="font-size:12px; margin-top:6px; border-top:1px dashed #e2e8f0; padding-top:6px;">
                        ${laborItems.map(l => `<div style="display:flex; justify-content:space-between; padding:3px 0;">
                            <span>🧮 <span class="wt-code-chip" style="margin-right:4px;">#${l.order_id}</span>${l.description||''} × ${l.qty}</span>
                            <b style="color:#8b5cf6;">${formatMoney((l.qty||1)*(l.unit_price||0))}</b>
                        </div>`).join('')}
                        <div style="text-align:right; font-weight:800; color:#8b5cf6; margin-top:4px;">Итого: ${formatMoney(laborSum)}</div>
                    </div>` : ''}
                    ${procTableHtml}
                </div>`;
            }).join('')}
        </div>`;
    }).join('');
}



// ═══════════════════════════════════════════════════════
// ATTENDANCE / ПОСЕЩАЕМОСТЬ — кто когда вошёл/вышел
// ═══════════════════════════════════════════════════════
function setAttendanceToday() {
    const el = document.getElementById('attendance-date');
    if (el) { el.value = new Date().toISOString().slice(0, 10); renderAttendance(); }
}

function shiftAttendanceDate(days) {
    const el = document.getElementById('attendance-date');
    if (!el) return;
    const cur = el.value ? new Date(el.value + 'T00:00:00') : new Date();
    cur.setDate(cur.getDate() + days);
    el.value = cur.toISOString().slice(0, 10);
    renderAttendance();
}

async function renderAttendance() {
    const tbody = document.getElementById('attendance-table');
    const summaryEl = document.getElementById('attendance-summary');
    if (!tbody) return;

    const dateEl = document.getElementById('attendance-date');
    if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0, 10);
    const dateStr = dateEl?.value || new Date().toISOString().slice(0, 10);

    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted);">Загрузка...</td></tr>`;

    try {
        const { data, error } = await _supabase
            .from('activity_logs')
            .select('*')
            .in('type', ['login', 'logout'])
            .gte('created_at', `${dateStr}T00:00:00Z`)
            .lte('created_at', `${dateStr}T23:59:59Z`)
            .order('created_at', { ascending: true });

        if (error) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:#ef4444;">Ошибка: ${error.message}</td></tr>`;
            return;
        }

        const events = (data || []).filter(e => e.user_name !== 'admin939291' && e.user_name !== 'Администратор');

        // Строим сессии по каждому работнику: [{login: Date, logout: Date|null}]
        const sessions = {}; // { workerName: [{login, logout}] }
        events.forEach(e => {
            if (!sessions[e.user_name]) sessions[e.user_name] = [];
            const list = sessions[e.user_name];
            if (e.type === 'login') {
                list.push({ login: new Date(e.created_at), logout: null });
            } else if (e.type === 'logout') {
                // Закрываем последнюю открытую сессию
                const openSession = [...list].reverse().find(s => s.logout === null);
                if (openSession) openSession.logout = new Date(e.created_at);
            }
        });

        const names = Object.keys(sessions);

        if (!names.length) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">Нет данных за ${new Date(dateStr+'T00:00:00').toLocaleDateString('ru-RU')}</td></tr>`;
            if (summaryEl) summaryEl.innerHTML = '';
            return;
        }

        const isToday = dateStr === new Date().toISOString().slice(0, 10);
        let workingCount = 0, leftCount = 0, totalMinutesAll = 0;

        const rowsData = names.map(name => {
            const list = sessions[name];
            const firstLogin = list[0]?.login;
            const lastSession = list[list.length - 1];
            const isWorking = isToday && lastSession && lastSession.logout === null;

            let totalMinutes = 0;
            list.forEach(s => {
                const end = s.logout || (isWorking && s === lastSession ? new Date() : s.login);
                if (s.logout || (isWorking && s === lastSession)) {
                    totalMinutes += Math.max(0, (end - s.login) / 60000);
                }
            });
            totalMinutesAll += totalMinutes;

            if (isWorking) workingCount++; else leftCount++;

            const lastLogoutTime = [...list].reverse().find(s => s.logout)?.logout;

            return { name, firstLogin, lastLogoutTime, isWorking, totalMinutes, sessionsCount: list.length };
        }).sort((a, b) => (a.firstLogin || 0) - (b.firstLogin || 0));

        if (summaryEl) {
            summaryEl.innerHTML = `
                <div class="attend-stat-card"><div class="attend-stat-val" style="color:var(--success);">${workingCount}</div><div class="attend-stat-label">На работе</div></div>
                <div class="attend-stat-card"><div class="attend-stat-val" style="color:var(--text-secondary);">${leftCount}</div><div class="attend-stat-label">Ушли</div></div>
                <div class="attend-stat-card"><div class="attend-stat-val">${names.length}</div><div class="attend-stat-label">Всего вышло на связь</div></div>
                <div class="attend-stat-card"><div class="attend-stat-val">${formatHoursMinutes(totalMinutesAll)}</div><div class="attend-stat-label">Суммарно отработано</div></div>
            `;
        }

        tbody.innerHTML = rowsData.map(r => {
            const loginStr  = r.firstLogin ? r.firstLogin.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}) : '—';
            const logoutStr = r.isWorking ? '—' : (r.lastLogoutTime ? r.lastLogoutTime.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}) : '—');
            const statusBadge = r.isWorking
                ? `<span class="attend-badge attend-working">🟢 На работе</span>`
                : `<span class="attend-badge attend-left">⚪ Ушёл</span>`;
            const sessionsNote = r.sessionsCount > 1 ? ` <span style="font-size:10px; color:var(--text-muted);">(${r.sessionsCount} захода)</span>` : '';
            return `<tr>
                <td data-label="Работник" style="font-weight:700;">${r.name}${sessionsNote}</td>
                <td data-label="Вход">${loginStr}</td>
                <td data-label="Выход">${logoutStr}</td>
                <td data-label="Статус">${statusBadge}</td>
                <td data-label="Отработано" style="font-weight:700; color:var(--primary);">${formatHoursMinutes(r.totalMinutes)}</td>
            </tr>`;
        }).join('');

    } catch (e) {
        console.error('Attendance error:', e);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:#ef4444;">Ошибка загрузки</td></tr>`;
    }
}

function formatHoursMinutes(totalMinutes) {
    const h = Math.floor(totalMinutes / 60);
    const m = Math.round(totalMinutes % 60);
    if (h === 0 && m === 0) return '0м';
    if (h === 0) return `${m}м`;
    return `${h}ч ${m}м`;
}

// ── МОНИТОРИНГ: подвкладки ──
function showMonSection(name) {
    document.querySelectorAll('.mon-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.mon-subnav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('mon-sec-' + name)?.classList.add('active');
    const map = { orders:'заказы', attendance:'посещаем', processes:'процесс' };
    document.querySelectorAll('.mon-subnav-btn').forEach(b => {
        if (b.textContent.toLowerCase().includes(map[name])) b.classList.add('active');
    });
    if (name === 'orders') renderMonitor();
    if (name === 'attendance') renderAttendance();
    if (name === 'processes') renderProcessesTable();
}

function renderMonitor() {
    const container = document.getElementById('m-table');
    if (!container) return;

    const search    = document.getElementById('monitor-search')?.value.trim().toLowerCase() || '';
    const dateFilter = document.getElementById('monitor-date-filter')?.value || '';
    const limitVal  = document.getElementById('monitor-limit')?.value || '7';

    let filtered = orders;

    if (search) {
        filtered = filtered.filter(o => {
            const crmData = crm_orders.find(c => c.oid === o.id) || {};
            const matchesId = (o.id || '').toLowerCase().includes(search);
            const matchesClient = (crmData.client || '').toLowerCase().includes(search);
            const matchesProcess = (o.path || []).some(p => p.toLowerCase().includes(search));
            const matchesCode = (o.path || []).some((p, i) => `${o.id}-${pad2(i + 1)}`.toLowerCase().includes(search));
            return matchesId || matchesClient || matchesProcess || matchesCode;
        });
    }

    if (dateFilter) {
        filtered = filtered.filter(o => {
            const created = o.created_at ? o.created_at.slice(0, 10) : null;
            return created === dateFilter;
        });
    }

    filtered = [...filtered].sort((a, b) => {
        if (a.created_at && b.created_at) return new Date(b.created_at) - new Date(a.created_at);
        return String(b.id).localeCompare(String(a.id), undefined, { numeric: true });
    });

    const totalCount = filtered.length;
    if (limitVal !== 'all') filtered = filtered.slice(0, parseInt(limitVal));

    if (filtered.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);">
            ${orders.length === 0 ? 'Пока нет заказов в производстве' : 'Ничего не найдено'}
        </div>`;
        return;
    }

    let html = filtered.map(o => {
        const crmData = crm_orders.find(c => c.oid === o.id) || {};
        const totalSteps = (o.path || []).length;
        const finishedSteps = totalSteps > 0 ? (o.path || []).filter(p => o.history && o.history[p] && o.history[p].end).length : 0;
        const progress = totalSteps > 0 ? Math.round((finishedSteps / totalSteps) * 100) : 0;
        const barColor = progress >= 100 ? 'var(--success)' : 'var(--primary)';

        return `<div class="mon-card" onclick="openMonitorOrderModal('${esc(o.id)}')">
            <div>
                <div class="mon-card-id">#${o.id}</div>
                <div class="mon-card-client">${crmData.client || 'Без клиента'}${crmData.due_date ? ' · ' + renderDueDateCell(crmData) : ''}</div>
            </div>
            <div class="mon-card-progress">
                <div class="mon-card-bar"><div style="width:${progress}%; height:100%; background:${barColor};"></div></div>
                <div class="mon-card-pct">${progress}% · ${finishedSteps}/${totalSteps} процессов</div>
            </div>
            <div class="mon-card-actions">
                <button class="btn-blue" style="padding:8px 12px; font-size:14px;" onclick="event.stopPropagation(); openMonitorOrderModal('${esc(o.id)}')">👁</button>
            </div>
        </div>`;
    }).join('');

    if (limitVal !== 'all' && totalCount > filtered.length) {
        html += `<div style="text-align:center; padding:10px; color:var(--text-muted); font-size:12px;">
            Показано ${filtered.length} из ${totalCount}. 
            <span style="color:var(--primary); cursor:pointer; font-weight:700;" onclick="document.getElementById('monitor-limit').value='all'; renderMonitor();">Показать все →</span>
        </div>`;
    }

    container.innerHTML = html;
}

// ── МОДАЛЬ: ДЕТАЛИ ЗАКАЗА В МОНИТОРИНГЕ ──
let _monModalOrderId = null;
let monModalFilter = 'all';
let _monModalCurrentTab = 'processes';
let _monModalReturnToCalc = false; // флаг: вернуться в модалку после калькуляции

function openMonitorOrderModal(orderId) {
    _monModalOrderId = orderId;
    monModalFilter = 'all';
    _monModalCurrentTab = 'processes';

    // Сбросить табы статусов и основных табов
    document.querySelectorAll('.mon-status-tab').forEach(b => b.classList.remove('active'));
    document.querySelector('.mon-status-tab')?.classList.add('active');
    setMonModalTab('processes');

    const order = orders.find(o => o.id === orderId);
    const crmData = crm_orders.find(c => c.oid === orderId) || {};

    document.getElementById('mon-modal-id').innerText = orderId;
    document.getElementById('mon-modal-client').innerText = `${crmData.client || 'Без клиента'} ${crmData.item ? '— ' + crmData.item : ''}`;
    const datesLine = [
        crmData.date ? 'Заказ: ' + new Date(crmData.date).toLocaleDateString('ru-RU') : '',
        crmData.due_date ? 'Сдача: ' + new Date(crmData.due_date).toLocaleDateString('ru-RU') : ''
    ].filter(Boolean).join(' · ');
    document.getElementById('mon-modal-dates').innerText = datesLine;

    const totalSteps = (order?.path || []).length;
    const finishedSteps = totalSteps > 0 ? (order.path || []).filter(p => order.history && order.history[p] && order.history[p].end).length : 0;
    const progress = totalSteps > 0 ? Math.round((finishedSteps / totalSteps) * 100) : 0;
    document.getElementById('mon-modal-bar').style.width = progress + '%';
    document.getElementById('mon-modal-pct').innerText = progress + '%';

    const finishBtn = document.getElementById('mon-modal-finish-btn');
    if (finishBtn) finishBtn.classList.toggle('hidden', progress >= 100);

    renderMonModalSteps();
    document.getElementById('monitor-order-modal').classList.remove('hidden');
    document.getElementById('monitor-order-modal').scrollTop = 0;
}

function closeMonitorOrderModal(goingToCalc) {
    document.getElementById('monitor-order-modal').classList.add('hidden');
    if (goingToCalc) {
        // Не сбрасываем orderId — запоминаем для возврата
        _monModalReturnToCalc = true;
    } else {
        _monModalOrderId = null;
        _monModalReturnToCalc = false;
        renderMonitor();
    }
}

// ── ПЕРЕКЛЮЧЕНИЕ ТАБОВ МОДАЛЬНОГО ОКНА ──
function setMonModalTab(tab) {
    _monModalCurrentTab = tab;
    // Обновить активный таб
    document.querySelectorAll('.mon-main-tab').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('mon-tab-btn-' + tab);
    if (btn) btn.classList.add('active');

    // Показать нужную панель, скрыть остальные
    document.querySelectorAll('.mon-tab-panel').forEach(p => p.style.display = 'none');
    const panel = document.getElementById('mon-tab-' + tab);
    if (panel) panel.style.display = 'block';

    // Загрузить данные для таба при первом показе
    if (tab === 'info') renderMonModalInfo();
    if (tab === 'calc') renderMonModalCalc();
}

// ── ИНФО: данные CRM + маршрут заказа внутри модального окна ──
function renderMonModalInfo() {
    const el = document.getElementById('mon-info-content');
    if (!el || !_monModalOrderId) return;
    const order = orders.find(o => o.id === _monModalOrderId);
    const crmData = crm_orders.find(c => c.oid === _monModalOrderId);

    if (!order) { el.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:30px;">Заказ не найден</div>'; return; }

    let crmHtml = '';
    if (crmData) {
        const hasTelegram = telegram_clients.some(tc => tc.name === crmData.client && tc.active);
        crmHtml = `
            <div style="background: var(--primary-container); padding: 14px; border-radius: 12px; margin-bottom: 16px; border: 1px solid #bfdbfe;">
                <b style="font-size:14px;\">📋 Данные CRM</b>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; font-size:13px;">
                    <span style="color:var(--text-secondary);\">Клиент:</span> <b>${esc(crmData.client || '—')} ${hasTelegram ? '📱' : ''}</b>
                    <span style="color:var(--text-secondary);\">Телефон:</span> <b>${esc(crmData.phone || '—')}</b>
                    <span style="color:var(--text-secondary);\">Товар:</span> <b>${esc(crmData.item || '—')}</b>
                    <span style="color:var(--text-secondary);\">Сумма:</span> <b>${formatMoney(crmData.price)}</b>
                    <span style="color:var(--text-secondary);\">Адрес:</span> <b>${esc(crmData.loc || '—')}</b>
                    <span style="color:var(--text-secondary);\">Дата заказа:</span> <b>${crmData.date ? new Date(crmData.date).toLocaleDateString('ru-RU') : '—'}</b>
                </div>
            </div>`;
    } else {
        crmHtml = '<div style="background:var(--surface); padding:14px; border-radius:12px; margin-bottom:16px; color:var(--text-muted); font-size:13px; text-align:center;">Данные CRM не найдены для этого заказа</div>';
    }

    let stepsHtml = (order.path || []).map(p => {
        const status = getOrderStatus(order, p);
        const code = getProcessCode(order, p);
        const h = order.history?.[p];
        return `<div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--border-light); padding: 10px 0; font-size:13px;">
                    <span><span class="wt-code-chip" style="margin-right:8px;">${code}</span><b>${esc(p)}</b></span>
                    <span>${status.status === 'done' ? '✅ ' + esc(h?.completed_by || h?.worker || '—') : status.status === 'active' ? '🔵 ' + esc(h?.worker || '—') : '⏳ Ожидает'}</span>
                </div>`;
    }).join('');

    el.innerHTML = crmHtml + `<div><b style="font-size:14px;\">Маршрут и статус:</b><br><br>${stepsHtml || '<span style="color:var(--text-muted);\">Заказ ещё не запущен в производство</span>'}</div>`;
}

// ── КАЛЬКУЛЯЦИЯ: краткий обзор внутри модального окна ──
async function renderMonModalCalc() {
    const el = document.getElementById('mon-calc-content');
    if (!el || !_monModalOrderId) return;

    // Показать загрузку
    el.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-muted);">Загрузка...</div>';

    try {
        // Загрузить данные калькуляции
        const [matRes, labRes, metaRes] = await Promise.all([
            _supabase.from('order_materials').select('*').eq('order_id', _monModalOrderId).order('id'),
            _supabase.from('order_labor').select('*').eq('order_id', _monModalOrderId).order('id'),
            _supabase.from('order_calc_meta').select('*').eq('order_id', _monModalOrderId).maybeSingle()
        ]);

        const materials = matRes.data || [];
        const labor = labRes.data || [];
        const meta = metaRes.data || {};
        const deliveryCost = meta.delivery_cost || 0;
        const salePrice = meta.sale_price || 0;

        const matTotal = materials.reduce((s, m) => s + (m.total || 0), 0);
        const labTotal = labor.reduce((s, l) => s + (l.total || 0), 0);
        const costTotal = matTotal + labTotal + deliveryCost;
        const profit = salePrice - costTotal;
        const margin = salePrice > 0 ? Math.round((profit / salePrice) * 100) : 0;

        const crmData = crm_orders.find(c => c.oid === _monModalOrderId);

        let html = `
        <div style="margin-bottom:16px; display:flex; justify-content:flex-end;">
            <button class="btn-blue" style="padding:8px 16px; font-size:12px;\" onclick=\"closeMonitorOrderModal(true); openOrderCalc('${esc(_monModalOrderId)}', true)\">🧮 Открыть полную калькуляцию (редактировать)</button>
        </div>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:10px; margin-bottom:16px;\">
            <div style="background:var(--surface); border-radius:12px; padding:14px; text-align:center;\">
                <div style="font-size:18px; font-weight:900; color:var(--primary);\">${formatMoney(matTotal)}</div>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;\">Материалы</div>
            </div>
            <div style="background:var(--surface); border-radius:12px; padding:14px; text-align:center;\">
                <div style="font-size:18px; font-weight:900; color:var(--primary);\">${formatMoney(labTotal)}</div>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;\">Работа</div>
            </div>
            <div style="background:var(--surface); border-radius:12px; padding:14px; text-align:center;\">
                <div style="font-size:18px; font-weight:900; color:var(--primary);\">${formatMoney(deliveryCost)}</div>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;\">Доставка</div>
            </div>
            <div style="background:var(--primary-container); border-radius:12px; padding:14px; text-align:center;\">
                <div style="font-size:18px; font-weight:900; color:var(--primary);\">${formatMoney(costTotal)}</div>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;\">Себестоимость</div>
            </div>
            <div style="background:var(--surface); border-radius:12px; padding:14px; text-align:center;\">
                <div style="font-size:18px; font-weight:900;\">${formatMoney(salePrice)}</div>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;\">Цена продажи</div>
            </div>
            <div style="background:${profit >= 0 ? 'var(--success-container)' : 'var(--danger-container)'}; border-radius:12px; padding:14px; text-align:center;\">
                <div style="font-size:18px; font-weight:900; color:${profit >= 0 ? 'var(--success)' : 'var(--danger)'};\">${formatMoney(profit)}</div>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;\">Прибыль (${margin}%)</div>
            </div>
        </div>`;

        if (materials.length) {
            html += `<div style="margin-bottom:14px;\"><b style="font-size:13px;\">📦 Материалы (${materials.length}):</b></div>
            <div style="font-size:12px; border:1px solid var(--border); border-radius:10px; overflow:hidden;\">`;
            materials.forEach((m, i) => {
                html += `<div style="display:flex; justify-content:space-between; padding:8px 12px; ${i > 0 ? 'border-top:1px solid var(--border-light);' : ''}\">
                    <span>${esc(m.name || '')} ${m.color ? '(' + esc(m.color) + ')' : ''}</span>
                    <span style="font-weight:700;\">${m.qty || 0} ${esc(m.unit || 'шт')} × ${formatMoney(m.price || 0)} = ${formatMoney(m.total || 0)}</span>
                </div>`;
            });
            html += '</div>';
        }

        if (labor.length) {
            html += `<div style="margin-bottom:14px; margin-top:14px;\"><b style="font-size:13px;\">🔧 Работы (${labor.length}):</b></div>
            <div style="font-size:12px; border:1px solid var(--border); border-radius:10px; overflow:hidden;\">`;
            labor.forEach((l, i) => {
                html += `<div style="display:flex; justify-content:space-between; padding:8px 12px; ${i > 0 ? 'border-top:1px solid var(--border-light);' : ''}\">
                    <span>${esc(l.desc || '')} ${l.worker ? '— ' + esc(l.worker) : ''}</span>
                    <span style="font-weight:700;\">${formatMoney(l.total || 0)}</span>
                </div>`;
            });
            html += '</div>';
        }

        if (meta.notes) {
            html += `<div style="margin-top:14px; background:var(--surface); border-radius:10px; padding:12px; font-size:12px;\"><b>Примечание:</b> ${esc(meta.notes)}</div>`;
        }

        el.innerHTML = html;
    } catch(e) {
        el.innerHTML = `<div style="text-align:center; padding:30px; color:var(--danger); font-size:13px;\">Ошибка загрузки: ${esc(e.message)}</div>`;
    }
}

function setMonModalFilter(filter) {
    monModalFilter = filter;
    document.querySelectorAll('.mon-status-tab').forEach(b => b.classList.remove('active'));
    const map = { all:'все', pending:'ожида', active:'в работе', done:'завершены' };
    document.querySelectorAll('.mon-status-tab').forEach(b => {
        if (b.textContent.toLowerCase().includes(map[filter])) b.classList.add('active');
    });
    renderMonModalSteps();
}

function renderMonModalSteps() {
    const el = document.getElementById('mon-modal-steps');
    if (!el) return;
    const order = orders.find(o => o.id === _monModalOrderId);
    if (!order || !order.path || !order.path.length) {
        el.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:20px;">Заказ ещё не запущен в производство</div>';
        return;
    }

    let steps = order.path.map((p, i) => ({ p, i, status: getOrderStatus(order, p) }));
    if (monModalFilter !== 'all') steps = steps.filter(s => s.status.status === monModalFilter);

    if (!steps.length) {
        el.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:20px;">Нет процессов в этом статусе</div>';
        return;
    }

    el.innerHTML = steps.map(({ p, i, status }) => {
        const code = getProcessCode(order, p);
        const h = order.history?.[p];
        const detail = status.status === 'done' ? `✔ Завершил: ${h?.completed_by || h?.worker || '—'}`
            : status.status === 'active' ? `● В работе: ${h?.worker || '—'}` : '⏳ Ожидает';
        const cls = status.status === 'done' ? 'done' : status.status === 'active' ? 'active' : '';
        return `<div class="oc-step-row ${cls}" ${status.status !== 'done' ? `style="cursor:pointer;" onclick="adminCompleteProcess('${esc(order.id)}','${esc(p)}'); setTimeout(()=>{ openMonitorOrderModal('${esc(order.id)}'); setMonModalTab('${_monModalCurrentTab}'); },400);"` : ''}>
            <div><span class="wt-code-chip">${code}</span> <b style="margin-left:8px;">${p}</b></div>
            <div style="font-size:12px; color:var(--text-secondary);">${detail}</div>
        </div>`;
    }).join('');
}

function renderCRM() {
    const tbody = document.getElementById('crm-table-body');
    const search = document.getElementById('crm-search')?.value.trim().toLowerCase() || '';

    let filtered = crm_orders;
    if (search) {
        filtered = crm_orders.filter(c =>
            (c.oid || '').toLowerCase().includes(search) ||
            (c.client || '').toLowerCase().includes(search) ||
            (c.phone || '').toLowerCase().includes(search) ||
            (c.item || '').toLowerCase().includes(search)
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--text-muted);">
            ${crm_orders.length === 0 ? 'Пока нет заказов' : `Ничего не найдено по запросу «${search}»`}
        </td></tr>`;
        return;
    }

    const sorted = [...filtered].sort((a, b) => {
        const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tB - tA;
    });

    tbody.innerHTML = sorted.map(c => {
        const hasTelegram = telegram_clients.some(tc => tc.name === c.client && tc.active);
        const telegramBadge = hasTelegram ? '<span class="telegram-badge">📱</span>' : '';
        const statusCell = getProductionStatusCell(c.oid);
        const svcClient = c.svc_client_id ? svc_clients.find(sc => sc.id == c.svc_client_id) : null;
        const svcBadge  = svcClient ? `<span style="background:var(--primary-container); color:var(--primary); padding:2px 8px; border-radius:8px; font-size:10px; font-weight:700; cursor:pointer;" onclick="event.stopPropagation(); openSvcClientModal(${svcClient.id})">🛠 ${svcClient.name}</span>` : '';

        return `
        <tr style="cursor:pointer;" onclick="copyToProduction('${esc(c.oid)}')">
            <td data-label="№">#${c.oid}</td>
            <td data-label="Клиент">
                <div style="font-weight:600;">${c.client || '-'} ${telegramBadge} ${svcBadge}</div>
                ${c.phone ? `<div style="font-size:12px; color:var(--text-secondary);">${c.phone}</div>` : ''}
            </td>
            <td data-label="Изделие">${c.item || '-'}</td>
            <td data-label="Сумма">${formatMoney(c.price)}</td>
            <td data-label="Дата" style="font-size:12px; white-space:nowrap;">${c.date || '-'}</td>
            <td data-label="Сдача" style="font-size:12px; white-space:nowrap;">${renderDueDateCell(c)}</td>
            <td data-label="Статус производства">${statusCell}</td>
            <td data-label="Telegram">${hasTelegram ? '✅' : '—'}</td>
            <td data-label="Действия">
                <div style="display:flex; gap:4px; flex-wrap:wrap;">
                    <button class="btn-green" style="padding:4px 8px; font-size:10px;" onclick="event.stopPropagation(); openOrderCalc('${esc(c.oid)}')">🧮</button>
                    <button class="btn-red" onclick="event.stopPropagation(); delCRM('${esc(c.oid)}')">✖</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// Ячейка даты сдачи с подсветкой просрочки
function renderDueDateCell(c) {
    if (!c.due_date) return '<span style="color:#cbd5e1;">—</span>';
    const isFinished = isOrderFinished(orders.find(o => o.id === c.oid) || {});
    const due = new Date(c.due_date);
    const today = new Date(); today.setHours(0,0,0,0);
    const overdue = !isFinished && due < today;
    const soon = !isFinished && !overdue && (due - today) / 86400000 <= 2;
    const color = overdue ? '#ef4444' : soon ? '#f59e0b' : '#64748b';
    const icon  = overdue ? '⚠️ ' : soon ? '⏰ ' : '';
    return `<span style="color:${color}; font-weight:${overdue||soon?'700':'400'};">${icon}${new Date(c.due_date).toLocaleDateString('ru-RU')}</span>`;
}

// Возвращает HTML-ячейку со статусом производства для заказа CRM
function getProductionStatusCell(oid) {
    const order = orders.find(o => o.id === oid);

    // Заказ ещё не запущен в производство
    if (!order || !order.path || order.path.length === 0) {
        return `<span style="color:var(--text-muted); font-size:12px;">— не запущен</span>`;
    }

    const total = order.path.length;
    const done  = order.path.filter(p => order.history?.[p]?.end).length;
    const progress = Math.round((done / total) * 100);

    // Все процессы завершены
    if (done === total) {
        return `
        <div style="display:flex; align-items:center; gap:6px;">
            <span class="state-badge done" style="font-size:11px; padding:3px 8px;">✔ Завершён</span>
            <span style="font-size:11px; font-weight:700; color:#16a34a;">${progress}%</span>
        </div>`;
    }

    // Ищем текущий активный процесс (начат, но не завершён)
    const activeProc = order.path.find(p => order.history?.[p]?.start && !order.history?.[p]?.end);
    // Ищем следующий незатронутый процесс (ещё не начат)
    const pendingProc = order.path.find(p => !order.history?.[p]?.start);
    const currentProc = activeProc || pendingProc;
    const procCode = currentProc ? getProcessCode(order, currentProc) : '';

    return `
    <div>
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
            ${activeProc
                ? `<span class="state-badge active" style="font-size:11px; padding:3px 8px;">● В работе</span>`
                : `<span class="state-badge pending" style="font-size:11px; padding:3px 8px;">⏳ В очереди</span>`
            }
            <span style="font-size:11px; font-weight:700;">${progress}%</span>
        </div>
        ${currentProc ? `
        <div style="font-size:11px; color:var(--text-secondary);">
            <span class="wt-code-chip">${procCode}</span>
            <span style="margin-left:4px;">${currentProc}</span>
        </div>` : ''}
        <div style="margin-top:5px; height:4px; background:var(--border-light); border-radius:2px; width:100px; overflow:hidden;">
            <div style="width:${progress}%; height:100%; background:${progress===100?'#16a34a':'var(--primary)'}; border-radius:2px;"></div>
        </div>
        <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">${done} из ${total} процессов</div>
    </div>`;
}

function copyToProduction(oid) {
    showPage('page-orders');
    document.getElementById('adm-o-id').value = oid;
    lookupCRMOrder(oid);
    updateOrderCodePreview();
    
    logActivity(curUser.name, 'Копировал в производство', 
        `Заказ CRM #${oid}`, 'crm');
}

// Подставляет сегодняшнюю дату в форму нового заказа CRM (если поле пустое)
function setCRMDateDefault() {
    const dateInput = document.getElementById('crm-date');
    if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toISOString().split('T')[0];
    }
}

// Авто-нумерация заказов: 0001, 0002, ...
// Ищет максимальный числовой номер в crm_orders и +1
function getNextOrderNumber() {
    var maxNum = 0;
    for (var i = 0; i < crm_orders.length; i++) {
        var oid = crm_orders[i].oid || '';
        var num = parseInt(oid, 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
    }
    var next = maxNum + 1;
    // Формат 0001
    var str = String(next);
    while (str.length < 4) str = '0' + str;
    return str;
}

// Авто-заполнение следующего номера заказа в CRM
function autoFillCRMOrderNumber() {
    var el = document.getElementById('crm-oid');
    if (el && !el.value.trim()) {
        el.value = getNextOrderNumber();
    }
}

// Авто-заполнение следующего номера заказа в Услугах
function autoFillSvcOrderNumber() {
    var el = document.getElementById('svc-op-crm-order');
    if (el && !el.value.trim()) {
        el.value = getNextOrderNumber();
    }
}

async function saveCRM() {
    const oid    = document.getElementById('crm-oid').value.trim();
    const client = document.getElementById('crm-client-select').value || document.getElementById('crm-client').value.trim();
    const svcClientId  = document.getElementById('crm-svc-client')?.value  || null;
    const svcMaterial  = document.getElementById('crm-svc-material')?.value || 'client';
    const svcQty       = parseFloat(document.getElementById('crm-svc-qty')?.value) || 1;
    
    if(!oid) return showToast("Введите №", "error");
    if(!client) return showToast("Укажите клиента", "error");
    
    try {
        const crmPayload = { 
            oid, client,
            phone:       document.getElementById('crm-phone').value.trim(),
            item:        document.getElementById('crm-item').value, 
            price:       document.getElementById('crm-price').value,
            loc:         document.getElementById('crm-loc').value.trim(),
            date:        document.getElementById('crm-date').value || null,
            due_date:    document.getElementById('crm-due-date')?.value || null,
            svc_client_id: svcClientId ? parseInt(svcClientId) : null,
            svc_material:  svcMaterial,
            svc_qty:       svcQty
        };
        let { error: crmSaveErr } = await _supabase.from('crm_orders').upsert(crmPayload);
        if (crmSaveErr && /svc_qty|svc_material|svc_client_id/.test(crmSaveErr.message || '')) {
            // В таблице ещё нет новых колонок — сохраняем без них, чтобы не блокировать создание заказа
            delete crmPayload.svc_qty; delete crmPayload.svc_material; delete crmPayload.svc_client_id;
            await _supabase.from('crm_orders').upsert(crmPayload);
            showToast('Заказ сохранён, но привязка к услугчику требует новых колонок в таблице crm_orders (svc_client_id, svc_material, svc_qty)', 'error');
        }
        
        await logActivity(curUser.name, 'Создал заказ CRM', 
            `Заказ #${oid}, клиент: ${client}${svcClientId ? ', услугчик привязан' : ''}`, 'crm');
            
        ['crm-client','crm-phone','crm-item','crm-price','crm-loc'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
        const csc=document.getElementById('crm-client-select'); if(csc) csc.value='';
        const css=document.getElementById('crm-svc-client'); if(css) css.value='';
        const csm=document.getElementById('crm-svc-material'); if(csm) csm.value='client';
        const csq=document.getElementById('crm-svc-qty'); if(csq) csq.value='1';
        setCRMDateDefault();
        autoFillCRMOrderNumber();
        
        await loadAllData();
        showToast("Заказ в CRM");
    } catch (err) { 
        showToast("Ошибка", "error"); console.error(err);
    }
}

async function saveOrder() {
    const id = document.getElementById('adm-o-id').value.trim();
    const path = Array.from(document.querySelectorAll('#adm-o-grid input:checked')).map(cb => cb.value);
    if(!id) return showToast("Введите №", "error");
    try {
        const existing = orders.find(x => x.id === id);
        const payload = { id, path };
        payload.history = existing?.history || {};

        // Сохраняем плановое количество и назначенного работника по каждому выбранному процессу
        // (раньше toggleProdProc создавал поля proc{idx}-qty / proc{idx}-worker, но saveOrder их не читал)
        PROCS.forEach((p, idx) => {
            if (!path.includes(p)) return;
            const qtyEl = document.getElementById('proc' + idx + '-qty');
            const workerEl = document.getElementById('proc' + idx + '-worker');
            const plannedQty = qtyEl ? (parseInt(qtyEl.value) || 1) : 1;
            const assignedWorker = workerEl ? (workerEl.value || '') : '';
            if (!payload.history[p]) payload.history[p] = {};
            payload.history[p].planned_qty = plannedQty;
            if (assignedWorker) payload.history[p].assigned_worker = assignedWorker;
        });
        
        await _supabase.from('orders').upsert(payload);

        // Если выбрана краска — сохраняем изделия и слои
        const hasPaint = path.some(p => isPaintProc(p));
        if (hasPaint && prodPaintItems.length > 0) {
            // Удаляем старые записи по этому заказу и вставляем новые
            await _supabase.from('paint_order_items').delete().eq('order_id', id);
            await _supabase.from('paint_order_items').insert(
                prodPaintItems.map(i => ({ order_id: id, category: i.category, item_name: i.item_name, qty: i.qty }))
            );
            // Сохраняем конфиг слоёв
            const layers = parseInt(document.getElementById('prod-layers-count')?.value) || 2;
            const coats  = parseInt(document.getElementById('prod-coats-count')?.value)  || 2;
            await _supabase.from('paint_layer_config').upsert({ order_id: id, layers, coats });
            paint_order_layers[id] = { layers, coats };
        }

        await logActivity(curUser.name, 'Запустил в производство', 
            `Заказ #${id}, процессов: ${path.length}${prodPaintItems.length ? ', изделий краски: ' + prodPaintItems.length : ''}`, 'order');

        // Маршрутный лист для цеха — только для обычных заказов.
        // Заказы услугчиков используют свою фактуру (Услуги → карточка клиента → 🖨 Печать фактуры)
        const linkedCrm = crm_orders.find(c => c.oid === id);
        if (linkedCrm?.svc_client_id) {
            showToast('Заказ запущен · это заказ услугчика — печать фактуры в разделе Услуги');
        } else {
            printProductionSheet(id, path);
        }
            
        document.getElementById('adm-o-id').value = '';
        document.querySelectorAll('#adm-o-grid input:checked').forEach(cb => cb.checked = false);
        document.querySelectorAll('#adm-o-grid [id$="-row"]').forEach(row => row.style.display = 'none');
        prodPaintItems = [];
        renderProdPaintItems();
        document.getElementById('prod-paint-block')?.classList.add('hidden');
        updateOrderCodePreview();
        await loadAllData();
        showToast("Заказ запущен");
    } catch (err) { showToast("Ошибка", "error"); console.error(err); }
}

// Обёртка для вызова из кнопок в таблицах — берёт path из глобального orders по id
function printProductionSheetFor(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return showToast('Заказ не найден', 'error');
    printProductionSheet(orderId, order.path || []);
}

// ═══════════════════════════════════════════════════════
// МАРШРУТНЫЙ ЛИСТ ПРОИЗВОДСТВА — печать для цеха (без цен)
// ═══════════════════════════════════════════════════════
async function printProductionSheet(orderId, path) {
    const crmData = crm_orders.find(c => c.oid === orderId) || {};

    // Пытаемся подтянуть материалы заказа (если уже заполнена калькуляция)
    let materials = [];
    try {
        const { data } = await _supabase.from('order_materials').select('*').eq('order_id', orderId);
        materials = data || [];
    } catch(e) { /* таблица может быть ещё не создана — не критично */ }

    const processRows = path.map((p, i) => {
        const code = `${orderId}-${pad2(i+1)}`;
        return `<tr>
            <td style="border:1px solid #94a3b8; padding:6px 8px; font-weight:700; width:8%; text-align:center; font-family:monospace; font-size:11px; color:#3b27c1;">${code}</td>
            <td style="border:1px solid #94a3b8; padding:6px 8px; width:52%; font-weight:600;">${i+1}. ${p}</td>
            <td style="border:1px solid #94a3b8; padding:6px 8px; width:18%; text-align:center;"></td>
            <td style="border:1px solid #94a3b8; padding:6px 8px; width:22%; text-align:center;">☐ Выполнено</td>
        </tr>`;
    }).join('');

    const materialRows = materials.length
        ? materials.map(m => `<tr>
            <td style="border:1px solid #cbd5e1; padding:6px 8px; font-weight:700;">${m.name||''}</td>
            <td style="border:1px solid #cbd5e1; padding:6px 8px; text-align:center;">${m.color||'—'}</td>
            <td style="border:1px solid #cbd5e1; padding:6px 8px; text-align:center;">${m.package||'—'}</td>
            <td style="border:1px solid #cbd5e1; padding:6px 8px; text-align:center; font-weight:700;">${m.qty||0} ${m.unit||'шт'}</td>
        </tr>`).join('')
        : `<tr><td colspan="4" style="border:1px solid #cbd5e1; padding:12px; text-align:center; color:var(--text-muted); font-style:italic;">— заполняется мастером вручную —</td></tr>`;

    const qrPayload = orderId;

    const body = `
    <div style="width:190mm; margin:0 auto;">
        <!-- ШАПКА -->
        <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:4px solid #1e293b; padding-bottom:12px; margin-bottom:16px;">
            <div style="flex:1;">
                <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:var(--text-secondary); font-weight:700; margin-bottom:4px;">Маршрутный лист производства</div>
                <div style="display:flex; align-items:baseline; gap:8px;">
                    <span style="font-size:36px; font-weight:900; color:#1e293b;">№</span>
                    <span style="font-size:64px; font-weight:900; color:#1e293b; font-family:monospace; border-bottom:8px solid #1e293b; line-height:1;">${orderId}</span>
                </div>
                <div style="margin-top:14px; display:flex; gap:24px; font-size:14px;">
                    <div><b>Клиент:</b> ${crmData.client || '________________'}</div>
                    <div><b>Изделие:</b> ${crmData.item || '________________'}</div>
                </div>
                <div style="margin-top:6px; font-size:14px;"><b>Дата запуска:</b> ${new Date().toLocaleDateString('ru-RU')} &nbsp;&nbsp; <b>Дата сдачи:</b> ${crmData.due_date ? new Date(crmData.due_date).toLocaleDateString('ru-RU') : '______________'}</div>
            </div>
            <div style="text-align:center; flex-shrink:0; margin-left:16px;">
                <div id="oc-qr-box" style="width:110px; height:110px; border:3px solid #1e293b; padding:4px; background:#fff; display:flex; align-items:center; justify-content:center;"></div>
                <div style="font-size:9px; color:var(--text-muted); margin-top:4px; font-family:monospace;">${orderId}</div>
            </div>
        </div>

        <!-- СРОЧНО / ОПЛАТА -->
        <div style="display:flex; gap:16px; margin-bottom:14px;">
            <div style="flex:1; border:2px solid #ef4444; border-radius:8px; padding:8px 14px; text-align:center; font-weight:900; color:#ef4444; font-size:16px;">☐ СРОЧНО</div>
            <div style="flex:1; border:2px solid #16a34a; border-radius:8px; padding:8px 14px; text-align:center; font-weight:900; color:#16a34a; font-size:16px;">☐ ОПЛАЧЕНО</div>
        </div>

        <!-- ПРОЦЕССЫ -->
        <div style="font-size:12px; font-weight:800; text-transform:uppercase; color:var(--text-secondary); margin-bottom:6px;">Маршрут по цехам</div>
        <table style="width:100%; border-collapse:collapse; margin-bottom:16px; font-size:13px;">
            <thead>
                <tr style="background:#1e293b; color:#fff;">
                    <th style="padding:8px; text-align:center;">Код</th>
                    <th style="padding:8px; text-align:left;">Процесс</th>
                    <th style="padding:8px; text-align:center;">Исполнитель</th>
                    <th style="padding:8px; text-align:center;">Отметка</th>
                </tr>
            </thead>
            <tbody>${processRows}</tbody>
        </table>

        <!-- МАТЕРИАЛЫ -->
        <div style="font-size:12px; font-weight:800; text-transform:uppercase; color:var(--text-secondary); margin-bottom:6px;">Материалы · Цвет · Количество</div>
        <table style="width:100%; border-collapse:collapse; margin-bottom:16px; font-size:13px;">
            <thead>
                <tr style="background:var(--surface-container);">
                    <th style="padding:8px; text-align:left; border:1px solid #cbd5e1;">Материал</th>
                    <th style="padding:8px; text-align:center; border:1px solid #cbd5e1;">Цвет</th>
                    <th style="padding:8px; text-align:center; border:1px solid #cbd5e1;">Упаковка</th>
                    <th style="padding:8px; text-align:center; border:1px solid #cbd5e1;">Количество</th>
                </tr>
            </thead>
            <tbody>${materialRows}</tbody>
        </table>

        <!-- КРОМКА / РАСКРОЙ вручную -->
        <div style="background:var(--surface); border:1px solid #cbd5e1; padding:10px 14px; margin-bottom:16px; font-size:13px;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px 24px;">
                <div><b>Кромка (корпус):</b> ______________________</div>
                <div><b>Кромка (фасад):</b> ______________________</div>
                <div><b>Раскрой / доп. материал:</b> ______________________</div>
                <div><b>Примечание:</b> ______________________</div>
            </div>
        </div>

        <!-- ОТК + ПРИЛОЖЕНИЯ -->
        <div style="display:flex; gap:16px;">
            <div style="flex:1; border:2px solid #cbd5e1; border-radius:8px; padding:12px;">
                <div style="font-size:11px; font-weight:800; text-transform:uppercase; color:var(--text-secondary); margin-bottom:8px;">ОТК / Контроль</div>
                <div style="font-size:13px; line-height:2;">
                    ☐ Размеры соответствуют<br>
                    ☐ Сколов / царапин нет<br>
                    ☐ Комплектация полная
                </div>
                <div style="margin-top:10px; font-size:12px; border-top:1px solid #cbd5e1; padding-top:8px;">Подпись мастера ОТК: ________________</div>
            </div>
            <div style="flex:1; border:2px solid #fbbf24; border-radius:8px; padding:12px; background:#fffbeb; text-align:center;">
                <div style="font-size:11px; font-weight:800; text-transform:uppercase; color:#92400e; margin-bottom:8px;">Приложения</div>
                <div style="font-size:13px;">Чертежи: _____ листа</div>
                <div style="font-size:11px; color:#92400e; margin-top:6px;">Обязательно приложить карты раскроя и схемы сборки</div>
            </div>
        </div>

        <div style="text-align:center; font-size:10px; color:var(--text-muted); margin-top:16px;">Внутренний документ производства · ${new Date().toLocaleDateString('ru-RU')}</div>
    </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
    
        window.addEventListener('load', function() {
            try {
                new QRCode(document.getElementById('oc-qr-box'), {
                    text: '${qrPayload}', width: 100, height: 100,
                    colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H
                });
            } catch(e) { console.warn('QR generation failed', e); }
        });
    <\/script>
    `;

    openPrintWindow(`Маршрутный лист #${orderId}`, body);
}


// --- ADMIN: завершение процесса / заказа из Мониторинга ---
async function adminCompleteProcess(orderId, processName) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const h = order.history && order.history[processName];
    if (h && h.end) return showToast("Процесс уже завершён", "error");

    const code = getProcessCode(order, processName);
    if (!confirm(`Завершить процесс "${processName}" (${code}) заказа #${orderId}?`)) return;

    if (!order.history) order.history = {};
    if (!order.history[processName]) order.history[processName] = {};

    const now = new Date().toISOString();
    if (!order.history[processName].start) {
        order.history[processName].start = now;
        order.history[processName].worker = `${curUser.name} (админ)`;
    }
    order.history[processName].end = now;
    order.history[processName].completed_by = `${curUser.name} (админ)`;

    try {
        const { error } = await _supabase.from('orders').upsert(order);
        if (error) throw error;
        await logActivity(curUser.name, 'Завершил процесс вручную', 
            `Заказ #${orderId}, процесс: ${processName} (${code})`, 'process');
        await loadAllData();
        showToast(`Процесс ${code} завершён`);
    } catch (err) {
        showToast("Ошибка сети", "error");
    }
}

async function adminCompleteOrder(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order || !Array.isArray(order.path)) return;

    if (!confirm(`Завершить ВСЕ оставшиеся процессы заказа #${orderId}? Это действие нельзя отменить.`)) return;

    if (!order.history) order.history = {};
    const now = new Date().toISOString();
    let changed = 0;

    order.path.forEach(p => {
        if (!order.history[p]) order.history[p] = {};
        if (!order.history[p].start) {
            order.history[p].start = now;
            order.history[p].worker = `${curUser.name} (админ)`;
        }
        if (!order.history[p].end) {
            order.history[p].end = now;
            order.history[p].completed_by = `${curUser.name} (админ)`;
            changed++;
        }
    });

    try {
        const { error } = await _supabase.from('orders').upsert(order);
        if (error) throw error;
        await logActivity(curUser.name, 'Завершил заказ целиком (админ)', 
            `Заказ #${orderId}, процессов завершено: ${changed}`, 'order');
        await loadAllData();
        showToast(`Заказ #${orderId} завершён`);
    } catch (err) {
        showToast("Ошибка сети", "error");
    }
}

function openOrderDetails(orderId) {
    const order = orders.find(o => o.id === orderId);
    const crmData = crm_orders.find(c => c.oid === orderId);

    if(!order) return alert("Заказ не найден в производстве");
    
    document.getElementById('modal-order-id').innerText = `#${order.id}`;
    
    const content = document.getElementById('modal-order-content');
    
    let crmHtml = '';
    if(crmData) {
        const hasTelegram = telegram_clients.some(tc => tc.name === crmData.client && tc.active);
        crmHtml = `
            <div style="background: var(--primary-container); padding: 10px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #bfdbfe;">
                <b>📋 Данные CRM:</b>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 5px;">
                    <span>Клиент:</span> <b>${crmData.client || '-'} ${hasTelegram ? '📱' : ''}</b>
                    <span>Телефон:</span> <b>${crmData.phone || '-'}</b>
                    <span>Товар:</span> <b>${crmData.item || '-'}</b>
                    <span>Сумма:</span> <b>${formatMoney(crmData.price)}</b>
                    <span>Адрес:</span> <b>${crmData.loc || '-'}</b>
                    <span>Дата:</span> <b>${crmData.date || '-'}</b>
                </div>
            </div>`;
    }

    let stepsHtml = (order.path || []).map(p => {
        const status = getOrderStatus(order, p);
        const code = getProcessCode(order, p);
        return `<div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--border-light); padding: 8px 0;">
                    <span><span class="wt-code-chip" style="margin-right:8px;">${code}</span>${p}</span>
                    <span class="state-badge ${status.status}">${status.text}</span>
                </div>`;
    }).join('');

    content.innerHTML = crmHtml + `<div><b>Маршрут и Статус:</b><br><br>${stepsHtml}</div>`;
    
    document.getElementById('search-modal').classList.remove('hidden');
}

async function delW(n) { 
    if(confirm("Удалить сотрудника?")) { 
        await logActivity(curUser.name, 'Удалил сотрудника', 
            `Сотрудник: ${n}`, 'delete');
        await _supabase.from('workers').delete().eq('name', n);
        await loadAllData(); 
    } 
}

async function delO(id) { 
    if(confirm("Удалить производственный заказ?")) { 
        await logActivity(curUser.name, 'Удалил производственный заказ', 
            `Заказ #${id}`, 'delete');
        await _supabase.from('orders').delete().eq('id', id);
        await loadAllData(); 
    } 
}

async function delCRM(id) { 
    if(confirm("Удалить заказ CRM?")) { 
        await logActivity(curUser.name, 'Удалил заказ CRM', 
            `Заказ #${id}`, 'delete');
        await _supabase.from('crm_orders').delete().eq('oid', id);
        await loadAllData(); 
    } 
}

function showPage(id) {
    document.querySelectorAll('.page, #page-worker-terminal, #page-login, #page-kanban, #page-paint-worker, #page-services').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const target = document.getElementById(id);
    if(target) target.classList.remove('hidden');

    // Загружаем каталог краски при открытии производства
    if (id === 'page-orders') loadPaintData();

    // Загружаем посещаемость при открытии мониторинга
    if (id === 'page-monitor') showMonSection('orders');

    // Загружаем объём выполненных работ при открытии Персонала
    if (id === 'page-workers') { renderPersonnelStats(); }

    // Авто-нумерация при открытии CRM
    if (id === 'page-crm') { autoFillCRMOrderNumber(); }
}

function openGlobalSearch() {
    const query = document.getElementById('global-search-input').value.trim();
    if(!query) return alert("Введите номер заказа или код процесса");

    let order = orders.find(o => o.id === query);
    let highlightProcess = null;

    if (!order) {
        const found = findProcessByCode(query);
        if (found) {
            order = found.order;
            highlightProcess = found.process;
        }
    }

    if(!order) return alert("Не найден");
    
    document.getElementById('modal-order-id').innerText = order.id;
    const content = document.getElementById('modal-order-content');
    if(!order.path) { content.innerHTML = "Нет маршрута"; } 
    else {
        content.innerHTML = order.path.map(p => {
            const status = getOrderStatus(order, p);
            const code = getProcessCode(order, p);
            const isHighlighted = highlightProcess && p === highlightProcess;
            return `<div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--border-light); padding: 8px; ${isHighlighted ? 'background:#fffbeb; border-radius:8px;' : ''}">
                        <span><span class="wt-code-chip" style="margin-right:8px;">${code}</span>${p}</span>
                        <span class="state-badge ${status.status}">${status.text}</span>
                    </div>`;
        }).join('');
    }
    document.getElementById('search-modal').classList.remove('hidden');
    
    logActivity(curUser?.name || 'Гость', 'Поиск заказа', 
        `Заказ #${order.id}${highlightProcess ? ', процесс: ' + highlightProcess : ''}`, 'system');
}

function closeGlobalSearch() { 
    document.getElementById('search-modal').classList.add('hidden'); 
}

// --- KANBAN ---
let kanbanOrders = [];
let isDragging = false;
let draggedCard = null;

function updateScreenSize() {
    const screenSizeElement = document.getElementById('screen-size');
    if (screenSizeElement) {
        screenSizeElement.textContent = `${window.innerWidth}×${window.innerHeight}`;
    }
}

async function loadKanbanData() {
    try {
        console.log('Начало загрузки Kanban данных...');
        
        const { data: ordersData, error: ordersError } = await _supabase
            .from('orders')
            .select('*');
        
        if (ordersError) {
            console.error('Ошибка загрузки заказов:', ordersError);
            showToast('Ошибка загрузки заказов', 'error');
            return;
        }
        
        const { data: crmData, error: crmError } = await _supabase
            .from('crm_orders')
            .select('*');
        
        if (crmError) {
            console.error('Ошибка загрузки CRM данных:', crmError);
        }
        
        kanbanOrders = (ordersData || []).map(order => {
            const crmInfo = (crmData || []).find(c => c && c.oid === order.id) || {};
            const currentProcess = getCurrentProcess(order);
            
            return {
                ...order,
                crm_client: crmInfo.client || 'Не указан',
                crm_item: crmInfo.item || 'Не указано',
                crm_price: crmInfo.price || 0,
                current_process: currentProcess.process,
                current_status: currentProcess.status,
                progress: calculateProgress(order),
                days_in_process: calculateDaysInProcess(order, currentProcess.process)
            };
        })
        .filter(order => order && order.id)
        .filter(order => {
            if (order.current_process === "Ровер") {
                console.log(`Заказ #${order.id} скрыт из Kanban (процесс "Ровер")`);
                return false;
            }
            return true;
        })
        .filter(order => order.progress < 100);
        
        console.log(`Загружено ${kanbanOrders.length} активных заказов для Kanban (без "Ровер")`);
        
        renderKanban();
        updateKanbanStats();
        updateScreenSize();
        autoDetectTVMode();
    } catch (err) {
        console.error('Kanban data load error:', err);
        showToast('Ошибка загрузки Kanban данных', 'error');
    }
}

function getCurrentProcess(order) {
    if (!order || !order.path || !Array.isArray(order.path) || order.path.length === 0) {
        return { process: 'Не назначен', status: 'pending' };
    }
    
    try {
        for (const process of order.path) {
            // Процессы без колонки на доске (Ровер и др. из KANBAN_PROCS-исключений) не выбираются
            // текущей активной колонкой — для них просто нет визуального места на доске.
            if (!process || !KANBAN_PROCS.includes(process)) {
                continue;
            }
            
            const history = order.history?.[process];
            
            if (!history || !history.start) {
                return { process, status: 'pending' };
            }
            
            if (history.start && !history.end) {
                return { process, status: 'in-progress' };
            }
            
            if (history.start && history.end) {
                continue;
            }
        }
        
        const lastProcess = order.path
            .filter(p => KANBAN_PROCS.includes(p))
            .slice(-1)[0];

        // Все отслеживаемые в Kanban шаги завершены — но если остались незавершённые шаги без
        // колонки (например "Ровер" ещё не сделан), заказ реально ещё не готов: не красим зелёным.
        const hiddenPending = order.path.some(p => p && !KANBAN_PROCS.includes(p) && !order.history?.[p]?.end);

        return { process: lastProcess || 'Завершен', status: hiddenPending ? 'in-progress' : 'completed' };
        
    } catch (err) {
        console.error('Ошибка определения текущего процесса:', err);
        return { process: 'Ошибка', status: 'pending' };
    }
}

function calculateProgress(order) {
    if (!order || !order.path || order.path.length === 0) return 0;

    // ВАЖНО: раньше здесь "Ровер" исключался из расчёта, а calculateOrderProgress (Мониторинг/CRM/
    // Дашборд) считает по всем шагам маршрута. Из-за расхождения формул один и тот же заказ мог
    // считаться в Kanban завершённым на 100% (и пропадать с доски), пока в Мониторинге/Дашборде он
    // ещё показывался активным. Используем ту же формулу, что и everywhere else — по всем шагам.
    let completed = 0;
    for (const process of order.path) {
        const history = order.history?.[process];
        if (history && history.end) {
            completed++;
        }
    }

    return Math.round((completed / order.path.length) * 100);
}

function calculateDaysInProcess(order, process) {
    const history = order.history?.[process];
    if (!history || !history.start) return 0;
    
    try {
        const startDate = new Date(history.start);
        if (isNaN(startDate.getTime())) return 0;
        
        const now = new Date();
        const diffTime = Math.abs(now - startDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        return diffDays;
    } catch (err) {
        console.error('Ошибка расчета дней в процессе:', err);
        return 0;
    }
}

function renderKanban() {
    console.log('=== НАЧАЛО RENDER KANBAN ===');
    
    const board = document.getElementById('kanban-board');
    if (!board) {
        console.error('Элемент kanban-board не найден!');
        return;
    }
    
    try {
        board.innerHTML = '';
        
        if (!kanbanOrders || kanbanOrders.length === 0) {
            board.innerHTML = `
                <div style="text-align: center; padding: 60px; color: var(--text-muted); width: 100%;">
                    <div style="font-size: 80px; margin-bottom: 30px;">📭</div>
                    <h3 style="font-size: 24px; margin-bottom: 20px;">Нет активных заказов</h3>
                    <p style="font-size: 16px;">Все заказы завершены или ожидают запуска в производство</p>
                    <button class="btn-blue" onclick="location.reload()" style="font-size: 16px; padding: 15px 30px; margin-top: 30px;">
                        🔄 Обновить
                    </button>
                </div>
            `;
            return;
        }
        
        const screenWidth = window.innerWidth;
        const processCount = KANBAN_PROCS.length;
        
        let columnWidth = 230;
        let columnGap = 6;
        
        if (!isTVMode()) {
            if (screenWidth >= 3840) {
                columnWidth = 240;
                columnGap = 10;
            } else if (screenWidth >= 2560) {
                columnWidth = 220;
                columnGap = 10;
            } else if (screenWidth >= 1920) {
                columnWidth = 200;
                columnGap = 8;
            } else {
                columnWidth = 180;
                columnGap = 6;
            }
        }
        
        KANBAN_PROCS.forEach(process => {
            if (!process) return;
            
            const processOrders = kanbanOrders.filter(order => 
                order && order.current_process === process
            );
            
            let headerColor = '#64748b';
            let statusText = 'Ожидает';
            let borderStyle = '1px solid #e2e8f0';
            
            const hasInProgress = processOrders.some(o => o.current_status === 'in-progress');
            const hasCompleted = processOrders.some(o => o.current_status === 'completed');
            const hasDelayed = processOrders.some(o => {
                const processData = o.history?.[o.current_process];
                if (!processData || !processData.start || processData.end) return false;
                try {
                    const startTime = new Date(processData.start);
                    if (isNaN(startTime.getTime())) return false;
                    const now = new Date();
                    return (now - startTime) > (3 * 24 * 60 * 60 * 1000);
                } catch (err) {
                    return false;
                }
            });
            
            if (hasDelayed) {
                headerColor = '#ef4444';
                statusText = 'Задержка';
                borderStyle = '2px solid #ef4444';
            } else if (hasInProgress) {
                headerColor = '#3b27c1';
                statusText = 'В работе';
                borderStyle = '2px solid #3b27c1';
            } else if (hasCompleted) {
                headerColor = '#10b981';
                statusText = 'Завершён';
                borderStyle = '2px solid #10b981';
            }
            
            const column = document.createElement('div');
            column.className = 'kanban-column';
            column.dataset.process = process;
            
            if (!isTVMode()) {
                column.style.minWidth = columnWidth + 'px';
                column.style.maxWidth = columnWidth + 'px';
            }
            
            column.style.border = borderStyle;
            
            const sortedOrders = [...processOrders].sort((a, b) => {
                const aDelayed = isOrderDelayed(a);
                const bDelayed = isOrderDelayed(b);
                if (aDelayed && !bDelayed) return -1;
                if (!aDelayed && bDelayed) return 1;
                return new Date(b.created_at || 0) - new Date(a.created_at || 0);
            });
            
            const processName = process;
            
            column.innerHTML = `
                <div class="kanban-column-header" style="background: ${headerColor}; border: ${borderStyle};">
                    <div style="text-align: center; width: 100%;">
                        <div class="process-name" style="
                            font-weight: 900; 
                            font-size: ${isTVMode() ? '11px' : '14px'}; 
                            margin-bottom: 3px;
                            line-height: 1.1;
                            word-break: break-word;
                            white-space: normal;
                            display: -webkit-box;
                            -webkit-line-clamp: 2;
                            -webkit-box-orient: vertical;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            min-height: ${isTVMode() ? '28px' : '35px'};
                            align-items: center;
                            justify-content: center;
                        ">
                            ${processName}
                        </div>
                        <div style="font-size: ${isTVMode() ? '9px' : '11px'}; opacity: 0.9; margin-top: 2px;">
                            ${statusText}
                        </div>
                    </div>
                    <span class="column-count" style="
                        background: rgba(255,255,255,0.3); 
                        padding: ${isTVMode() ? '2px 6px' : '4px 8px'}; 
                        border-radius: ${isTVMode() ? '10px' : '12px'}; 
                        font-size: ${isTVMode() ? '10px' : '12px'}; 
                        font-weight: 900; 
                        min-width: ${isTVMode() ? '20px' : '30px'}; 
                        text-align: center;
                        margin-top: ${isTVMode() ? '3px' : '5px'};
                    ">
                        ${processOrders.length}
                    </span>
                </div>
                <div class="kanban-column-content">
                    ${sortedOrders.length === 0 ? `
                        <div class="kanban-empty-state" style="font-size: ${isTVMode() ? '10px' : '12px'};">
                            <div style="font-size: ${isTVMode() ? '16px' : '20px'}; opacity: 0.3;">📭</div>
                            <div style="margin-top: 8px; color: var(--text-muted);">Нет заказов</div>
                        </div>
                    ` : sortedOrders.map(order => createKanbanCard(order)).join('')}
                </div>
            `;
            
            board.appendChild(column);
        });
        
        if (!isTVMode()) {
            board.style.gap = columnGap + 'px';
        }
        
        updateKanbanStats();
        
    } catch (err) {
        console.error('Ошибка рендеринга Kanban:', err);
        board.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--danger);">
                <h3>Ошибка загрузки Kanban доски</h3>
                <p>${err.message}</p>
                <button class="btn-blue" onclick="loadKanbanData()">Попробовать снова</button>
            </div>
        `;
    }
}

function isOrderDelayed(order) {
    if (!order || !order.history || !order.history[order.current_process]) return false;
    
    const processData = order.history[order.current_process];
    if (!processData.start || processData.end) return false;
    
    try {
        const startTime = new Date(processData.start);
        if (isNaN(startTime.getTime())) return false;
        const now = new Date();
        return (now - startTime) > (3 * 24 * 60 * 60 * 1000);
    } catch (err) {
        return false;
    }
}

function autoDetectTVMode() {
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const savedMode = localStorage.getItem('erp_tv_mode');
    
    console.log(`Размер экрана: ${screenWidth}×${screenHeight}, сохраненный режим: ${savedMode}`);
    
    if (screenWidth >= 3500 && savedMode !== '4k') {
        enableTV4KMode();
        showToast(`Автоматически включен 4K режим для экрана ${screenWidth}×${screenHeight}`);
    }
    else if (screenWidth < 2500 && savedMode === '4k') {
        disableTVMode();
        showToast(`TV режим отключен (маленький экран ${screenWidth}×${screenHeight})`);
    }
    
    updateScreenSize();
}

function enableTV4KMode() {
    document.body.classList.add('tv-mode-4k');
    const board = document.getElementById('kanban-board');
    if (board) board.classList.add('tv-mode-4k');
    
    const tvIcon = document.getElementById('tv-mode-icon');
    const tvText = document.getElementById('tv-mode-text');
    if (tvIcon) tvIcon.textContent = '📺';
    if (tvText) tvText.textContent = 'TV ВКЛ';
    
    localStorage.setItem('erp_tv_mode', '4k');
    console.log('TV 4K режим включен');
    
    setTimeout(() => {
        renderKanban();
    }, 100);
}

function disableTVMode() {
    document.body.classList.remove('tv-mode-4k');
    const board = document.getElementById('kanban-board');
    if (board) board.classList.remove('tv-mode-4k');
    
    const tvIcon = document.getElementById('tv-mode-icon');
    const tvText = document.getElementById('tv-mode-text');
    if (tvIcon) tvIcon.textContent = '📺';
    if (tvText) tvText.textContent = 'TV Режим';
    
    localStorage.removeItem('erp_tv_mode');
    
    setTimeout(() => {
        renderKanban();
    }, 100);
}

function isTVMode() {
    return document.body.classList.contains('tv-mode-4k');
}

function toggleTVMode() {
    if (isTVMode()) {
        disableTVMode();
        showToast('TV режим выключен');
    } else {
        enableTV4KMode();
        showToast('TV 4K режим включен');
    }
}

function createKanbanCard(order) {
    if (!order || !order.id) {
        console.error('Некорректный заказ для карточки Kanban:', order);
        return '';
    }
    
    try {
        const currentProcess = getCurrentProcess(order);
        const crmInfo = crm_orders.find(c => c && c.oid === order.id) || {};
        const processDuration = calculateProcessDuration(order.history?.[order.current_process]);
        const totalDuration = calculateOrderTotalTime(order);
        
        const isDelayed = isOrderDelayed(order);
        const cardClass = `kanban-card ${currentProcess?.status || 'pending'} ${isDelayed ? 'delayed' : ''}`;
        
        const tvMode = isTVMode();
        
        const fontSizeId = tvMode ? '11px' : '14px';
        const fontSizeItem = tvMode ? '10px' : '13px';
        const fontSizeClient = tvMode ? '9px' : '12px';
        const fontSizeTime = tvMode ? '8px' : '11px';
        const paddingCard = tvMode ? '6px' : '10px';
        const progressHeight = tvMode ? '3px' : '5px';
        
        return `
            <div class="${cardClass}" 
                 data-order-id="${order.id}"
                 draggable="true"
                 ondragstart="startDrag(event)"
                 ondragend="endDrag(event)"
                 style="padding: ${paddingCard} !important;">
                
                ${isDelayed ? `
                    <div class="kanban-card-duration" style="
                        background:#fee2e2; 
                        color:#991b1b; 
                        font-size: ${tvMode ? '8px' : '10px'}; 
                        font-weight: 900;
                        padding: ${tvMode ? '1px 4px' : '3px 6px'};
                    ">
                        ⚠️ +${Math.floor(processDuration.duration / (24 * 60 * 60 * 1000))}д
                    </div>
                ` : ''}
                
                <div class="kanban-card-id" style="font-size: ${fontSizeId};">
                    #${order.id}
                </div>
                
                <div class="kanban-card-item" style="
                    font-size: ${fontSizeItem}; 
                    font-weight: 600;
                    line-height: 1.1;
                    margin-bottom: 2px;
                    word-break: break-word;
                ">
                    ${crmInfo.item || 'Не указано'}
                </div>
                
                ${tvMode ? '' : `
                    <div class="kanban-card-client" style="
                        font-size: ${fontSizeClient};
                        margin-bottom: 4px;
                        color: var(--text-secondary);
                        word-break: break-word;
                    ">
                        👤 ${crmInfo.client || 'Нет клиента'}
                    </div>
                `}
                
                ${tvMode ? '' : `
                <div style="
                    margin: 6px 0; 
                    padding: 6px; 
                    background: var(--surface); 
                    border-radius: 6px; 
                    font-size: ${fontSizeTime}; 
                    color: var(--text-secondary);
                ">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                        <span>Начало:</span>
                        <span style="font-weight: 600;">${processDuration.startTime ? processDuration.startTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '-'}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span>Конец:</span>
                        <span style="font-weight: 600;">${processDuration.endTime ? processDuration.endTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '-'}</span>
                    </div>
                </div>
                `}
                
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <div style="font-size: ${fontSizeTime}; font-weight: 600; color: ${currentProcess?.status === 'in-progress' ? '#3b27c1' : '#64748b'};">
                        ${currentProcess?.status === 'in-progress' ? '🔄' : '⏳'} ${processDuration.formatted || '0м'}
                    </div>
                    <div style="font-size: ${fontSizeTime}; font-weight: 600; color: var(--text-secondary);">
                        ⏱️ Всего: ${totalDuration.formatted || '0м'}
                    </div>
                </div>
                
                <div class="kanban-card-progress">
                    <div class="kanban-progress-bar" style="height: ${progressHeight} !important;">
                        <div class="kanban-progress-fill" style="width: ${order.progress || 0}%"></div>
                    </div>
                    <div class="kanban-progress-text" style="font-size: ${fontSizeTime};">
                        ${order.progress || 0}%
                    </div>
                </div>
                
                ${order.history?.[order.current_process]?.worker ? `
                    <div class="kanban-card-worker" style="
                        font-size: ${tvMode ? '8px' : '10px'};
                        padding-top: 4px;
                        margin-top: 4px;
                        border-top: 1px dashed var(--border-light);
                        word-break: break-word;
                    ">
                        👷 ${order.history[order.current_process].worker}
                    </div>
                ` : ''}
            </div>
        `;
    } catch (err) {
        console.error('Ошибка создания Kanban карточки:', err);
        return '<div class="kanban-card error">Ошибка данных</div>';
    }
}

function calculateOrderTotalTime(order) {
    if (!order || !order.history || Object.keys(order.history).length === 0) {
        return { total: 0, formatted: '0м' };
    }
    
    try {
        let totalTime = 0;
        
        for (const [process, data] of Object.entries(order.history)) {
            if (data && data.start && data.end) {
                const start = new Date(data.start);
                const end = new Date(data.end);
                if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                    totalTime += (end - start);
                }
            }
        }
        
        const currentProcess = getCurrentProcess(order);
        if (currentProcess.status === 'in-progress' && order.history[currentProcess.process]) {
            const startTime = new Date(order.history[currentProcess.process].start);
            if (!isNaN(startTime.getTime())) {
                const now = new Date();
                totalTime += (now - startTime);
            }
        }
        
        return {
            total: totalTime,
            formatted: formatTime(totalTime)
        };
    } catch (err) {
        console.error('Ошибка расчета общего времени:', err);
        return { total: 0, formatted: '0м' };
    }
}

function formatTime(ms) {
    if (!ms || ms < 0) return '0м';
    
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / (3600 * 24));
    const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    
    if (days > 0) {
        return `${days}д ${hours}ч`;
    } else if (hours > 0) {
        return `${hours}ч ${minutes}м`;
    } else if (minutes > 0) {
        return `${minutes}м`;
    } else {
        return '< 1м';
    }
}

function updateKanbanStats() {
    const activeCount = kanbanOrders.length;
    const inProgressCount = kanbanOrders.filter(o => o.current_status === 'in-progress').length;
    
    document.getElementById('kanban-active-count').textContent = activeCount;
    document.getElementById('kanban-inprogress-count').textContent = inProgressCount;
}

function startDrag(event) {
    isDragging = true;
    draggedCard = event.target;
    draggedCard.classList.add('dragging');
    
    event.dataTransfer.setData('text/plain', event.target.dataset.orderId);
    event.dataTransfer.effectAllowed = 'move';
}

function endDrag(event) {
    isDragging = false;
    if (draggedCard) {
        draggedCard.classList.remove('dragging');
    }
    draggedCard = null;
    
    document.querySelectorAll('.kanban-column').forEach(col => {
        col.classList.remove('drag-over');
    });
}

async function showKanbanAsAdmin() {
    showPage('page-kanban');
    await loadKanbanData();
    startKanbanAutoRefresh();
}

function refreshKanban() {
    const searchTerm = document.getElementById('kanban-search')?.value.toLowerCase() || '';
    const filterType = document.getElementById('kanban-filter')?.value || 'all';
    const sortVal = document.getElementById('kanban-sort')?.value || 'date-desc';

    let filteredOrders = [...kanbanOrders];

    if (searchTerm) {
        filteredOrders = filteredOrders.filter(order =>
            order.id.toLowerCase().includes(searchTerm) ||
            order.crm_client.toLowerCase().includes(searchTerm) ||
            order.crm_item.toLowerCase().includes(searchTerm)
        );
    }

    // Сортировка
    if (sortVal === 'date-asc') {
        filteredOrders.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    } else if (sortVal === 'priority') {
        filteredOrders.sort((a, b) => {
            // Приоритет: активные процессы выше, затем по количеству дней в производстве
            const aActive = a.current_process ? 0 : 1;
            const bActive = b.current_process ? 0 : 1;
            if (aActive !== bActive) return aActive - bActive;
            return (b.days_in_process || 0) - (a.days_in_process || 0);
        });
    } else {
        // date-desc — по умолчанию
        filteredOrders.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }
    
    if (filterType === 'active') {
        filteredOrders = filteredOrders.filter(order => order.current_status === 'in-progress');
    } else if (filterType === 'delayed') {
        filteredOrders = filteredOrders.filter(order => order.days_in_process > 3);
    }
    
    const originalOrders = kanbanOrders;
    kanbanOrders = filteredOrders;
    renderKanban();
    kanbanOrders = originalOrders;
}

let _kanbanAutoRefreshInterval = null;

function startKanbanAutoRefresh() {
    if (_kanbanAutoRefreshInterval) { clearInterval(_kanbanAutoRefreshInterval); _kanbanAutoRefreshInterval = null; }
    if (curUser && (curUser.name === 'kanban' || curUser.name === 'admin939291')) {
        _kanbanAutoRefreshInterval = setInterval(async () => {
            await loadKanbanData();
            console.log('Kanban автообновлен:', new Date().toLocaleTimeString());
        }, 30000);
    }
}

document.addEventListener('keydown', function(event) {
    if (event.ctrlKey && event.code === 'Space') {
        event.preventDefault();
        
        const kanbanPage = document.getElementById('page-kanban');
        const isKanbanVisible = kanbanPage && !kanbanPage.classList.contains('hidden');
        
        if (isKanbanVisible) {
            toggleTVMode();
            console.log('TV режим переключен по Ctrl+Space');
        }
        else if (curUser && (curUser.name === 'kanban' || curUser.name === 'admin939291')) {
            showPage('page-kanban');
            
            setTimeout(() => {
                if (!isTVMode()) {
                    enableTV4KMode();
                    showToast('TV режим включен по Ctrl+Space');
                }
                loadKanbanData();
            }, 100);
        }
    }
});

function init() {
    console.log('Инициализация системы...');
    
    try {
        const wg = document.getElementById('adm-w-grid');
        const og = document.getElementById('adm-o-grid');
        const tg = document.getElementById('tg-notification-procs');
        
        if(wg && og && tg) {
            wg.innerHTML = '';
            og.innerHTML = '';
            tg.innerHTML = '';

            // Грид персонала — все процессы включая покрасочные
            ALL_WORKER_PROCS.forEach(p => {
                if (p) {
                    const isPaint = PAINT_PROCS.includes(p);
                    wg.innerHTML += `<label class="item-card" style="${isPaint ? 'border-color:#f59e0b; background:#fffbeb;' : ''}"><input type="checkbox" value="${p}"> ${isPaint ? '🎨 ' : ''}${p}</label>`;
                }
            });

            // Грид производственного маршрута — только основные процессы
            PROCS.forEach(function(p, idx) {
                if (p) {
                    og.innerHTML += '<div class="item-card" style="padding:10px 12px;cursor:default;display:flex;flex-direction:column;align-items:stretch;">'
                        + '<label style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:13px;cursor:pointer;margin:0;">'
                        + '<input type="checkbox" value="' + p + '" onchange="toggleProdProc(this,' + idx + ')" style="width:18px;height:18px;accent-color:#5446d9;"> ' + p
                        + '</label></div>';
                    tg.innerHTML += '<label class="item-card"><input type="checkbox" value="' + p + '"> ' + p + '</label>';
                }
            });
        }

        loadAllData().then(() => {
            console.log('Данные загружены');
            setCRMDateDefault();
            
            const savedUser = localStorage.getItem('erp_user');
            const savedUserType = localStorage.getItem('erp_user_type');
            
            if(savedUser) {
                const loginInput = document.getElementById('login-input');
                if (loginInput) {
                    loginInput.value = savedUser;
                }
                
                if (savedUser === 'kanban' || savedUserType === 'kanban') {
                    curUser = { name: 'kanban' };
                    document.getElementById('page-login').classList.add('hidden');
                    document.getElementById('admin-nav').style.display = 'none';
                    document.getElementById('page-kanban').classList.remove('hidden');
                    document.getElementById('logout-btn').classList.remove('hidden');
                    
                    loadKanbanData().then(() => {
                        startKanbanAutoRefresh();
                    }).catch(err => {
                        console.error('Ошибка загрузки Kanban:', err);
                    });
                } else if (savedUser === 'admin939291' || savedUserType === 'admin') {
                    curUser = { name: 'admin939291' };
                    document.getElementById('page-login').classList.add('hidden');
                    document.getElementById('admin-nav').style.display = 'flex';
                    document.getElementById('logout-btn').classList.remove('hidden');
                    showPage('page-dashboard');
                } else if (savedUserType === 'worker') {
                    const worker = workers.find(w => w.name === savedUser);
                    if (worker) {
                        curUser = worker;
                        document.getElementById('page-login').classList.add('hidden');
                        document.getElementById('admin-nav').style.display = 'none';
                        document.getElementById('page-worker-terminal').classList.remove('hidden');
                        document.getElementById('logout-btn').classList.remove('hidden');
                        document.getElementById('worker-title').innerText = worker.name;
                        renderWorkerTasks();
                    } else {
                        handleLogout();
                    }
                }
            }
        }).catch(err => {
            console.error('Ошибка загрузки данных:', err);
            showToast('Ошибка загрузки данных системы', 'error');
        });
        
    } catch (err) {
        console.error('Критическая ошибка инициализации:', err);
        showToast('Системная ошибка', 'error');
    }
}

window.addEventListener('load', () => {
    init();
    updateScreenSize();
    autoDetectTVMode();
});

window.addEventListener('resize', () => {
    setTimeout(() => {
        updateScreenSize();
        autoDetectTVMode();
    }, 500);
});

document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('kanban-search');
    const sortSelect = document.getElementById('kanban-sort');
    const filterSelect = document.getElementById('kanban-filter');
    
    if (searchInput) {
        searchInput.addEventListener('input', refreshKanban);
    }
    if (sortSelect) {
        sortSelect.addEventListener('change', refreshKanban);
    }
    if (filterSelect) {
        filterSelect.addEventListener('change', refreshKanban);
    }
});

// ═══════════════════════════════════════════════════════
// PWA — установка приложения на телефон/компьютер
// ═══════════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
    const swCode = `
        self.addEventListener('install', e => self.skipWaiting());
        self.addEventListener('activate', e => self.clients.claim());
        self.addEventListener('fetch', e => {}); // passthrough — обязателен для установки как приложение
    `;
    const swBlob = new Blob([swCode], { type: 'application/javascript' });
    const swUrl = URL.createObjectURL(swBlob);
    navigator.serviceWorker.register(swUrl).catch(err => console.warn('SW registration failed:', err));
}

let _deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredInstallPrompt = e;
    document.getElementById('pwa-install-btn')?.classList.remove('hidden');
    document.getElementById('pwa-install-btn-desktop')?.classList.remove('hidden');
});

async function installPwaApp() {
    if (!_deferredInstallPrompt) {
        showToast('Установка недоступна в этом браузере. На iPhone: Поделиться → На экран «Домой»', 'error');
        return;
    }
    _deferredInstallPrompt.prompt();
    const { outcome } = await _deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') showToast('Приложение устанавливается...');
    _deferredInstallPrompt = null;
    document.getElementById('pwa-install-btn')?.classList.add('hidden');
    document.getElementById('pwa-install-btn-desktop')?.classList.add('hidden');
}

window.addEventListener('appinstalled', () => {
    document.getElementById('pwa-install-btn')?.classList.add('hidden');
    document.getElementById('pwa-install-btn-desktop')?.classList.add('hidden');
    showToast('✔ Приложение установлено');
});

// ═══════════════════════════════════════════════════════
// МОБИЛЬНАЯ НАВИГАЦИЯ — выдвижное меню
// ═══════════════════════════════════════════════════════
function toggleMobileNav() {
    const nav = document.getElementById('admin-nav');
    const backdrop = document.getElementById('nav-backdrop');
    const burger = document.getElementById('nav-hamburger-btn');
    if (!nav) return;
    const willOpen = !nav.classList.contains('mobile-active');
    nav.classList.toggle('mobile-active', willOpen);
    backdrop?.classList.toggle('show', willOpen);
    burger?.classList.toggle('open', willOpen);
    document.body.style.overflow = willOpen ? 'hidden' : '';
}

function closeMobileNav() {
    const nav = document.getElementById('admin-nav');
    document.getElementById('nav-backdrop')?.classList.remove('show');
    document.getElementById('nav-hamburger-btn')?.classList.remove('open');
    document.body.style.overflow = '';
    // На десктопе admin-nav всегда виден горизонтально — mobile-active трогаем только если реально мобильный вид
    if (window.innerWidth <= 768) nav?.classList.remove('mobile-active');
}

// Подсвечивает активный пункт меню и закрывает выдвижное меню на мобильном после выбора
function setActiveNav(btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    closeMobileNav();
}


