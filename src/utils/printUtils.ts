import QRCode from 'qrcode';
import { formatMoney, pad2 } from './formatters';
import { CRMOrderItem, OrderItem, OrderLaborItem, OrderMaterialItem, SvcClientItem, SvcTransactionItem } from '../types';

export function openPrintWindow(title: string, bodyHtml: string, pageSize = 'A4') {
  const w = window.open('', '_blank', 'width=840,height=900');
  if (!w) {
    alert('Разрешите всплывающие окна в браузере для печати');
    return;
  }
  w.document.write(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    @page { size: ${pageSize}; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; padding: 20px; font-size: 13px; }
    h1, h2, h3 { margin: 0 0 8px; font-weight: 800; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12px; }
    th { text-align: left; background: #f1f5f9; padding: 8px; font-size: 11px; text-transform: uppercase; color: #475569; }
    td { padding: 8px; border-bottom: 1px solid #e2e8f0; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #3b27c1; padding-bottom: 12px; margin-bottom: 16px; }
    .brand { font-size: 20px; font-weight: 900; color: #3b27c1; }
    .meta { font-size: 12px; color: #64748b; text-align: right; }
    .total-row td { font-weight: 900; font-size: 14px; border-top: 2px solid #0f172a; }
    .no-print { display: none; }
    @media screen {
      .no-print { display: block; margin-bottom: 16px; }
      body { background: #f8fafc; }
      .print-card { background: #ffffff; padding: 24px; border-radius: 12px; max-width: 800px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    }
  </style>
</head>
<body>
  <div class="no-print" style="text-align: center;">
    <button onclick="window.print()" style="padding: 10px 24px; background: #3b27c1; color: #ffffff; border: none; border-radius: 8px; font-weight: 700; font-size: 14px; cursor: pointer;">
      🖨 Печать / Сохранить в PDF
    </button>
  </div>
  <div class="print-card">
    ${bodyHtml}
  </div>
</body>
</html>`);
  w.document.close();
}

export async function printProductionSheet(orderId: string, path: string[] = [], crmData?: CRMOrderItem, materials: OrderMaterialItem[] = []) {
  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL(orderId, { width: 100, margin: 1 });
  } catch (e) {
    console.warn('QR generation failed', e);
  }

  const safePath = Array.isArray(path) ? path : [];
  const safeMaterials = Array.isArray(materials) ? materials : [];

  const processRows = safePath.map((p, i) => {
    const code = `${orderId}-${pad2(i + 1)}`;
    return `<tr>
      <td style="border: 1px solid #94a3b8; padding: 6px 8px; font-weight: 700; width: 12%; text-align: center; font-family: monospace; font-size: 12px; color: #3b27c1;">${code}</td>
      <td style="border: 1px solid #94a3b8; padding: 6px 8px; width: 48%; font-weight: 600;">${i + 1}. ${p}</td>
      <td style="border: 1px solid #94a3b8; padding: 6px 8px; width: 20%; text-align: center;"></td>
      <td style="border: 1px solid #94a3b8; padding: 6px 8px; width: 20%; text-align: center;">☐ Выполнено</td>
    </tr>`;
  }).join('');

  const materialRows = safeMaterials.length
    ? safeMaterials.map(m => `<tr>
        <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-weight: 700;">${m.name || ''}</td>
        <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: center;">${m.color || '—'}</td>
        <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: center;">${m.package || '—'}</td>
        <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: center; font-weight: 700;">${m.qty || 0} ${m.unit || 'шт'}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" style="border: 1px solid #cbd5e1; padding: 12px; text-align: center; color: #94a3b8; font-style: italic;">— заполняется мастером вручную —</td></tr>`;

  const body = `
    <div style="width: 100%;">
      <!-- ШАПКА -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 4px solid #1e293b; padding-bottom: 12px; margin-bottom: 16px;">
        <div style="flex: 1;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; font-weight: 700; margin-bottom: 4px;">Маршрутный лист производства</div>
          <div style="display: flex; align-items: baseline; gap: 8px;">
            <span style="font-size: 32px; font-weight: 900; color: #1e293b;">№</span>
            <span style="font-size: 54px; font-weight: 900; color: #1e293b; font-family: monospace; border-bottom: 6px solid #1e293b; line-height: 1;">${orderId}</span>
          </div>
          <div style="margin-top: 12px; display: flex; gap: 24px; font-size: 13px;">
            <div><b>Клиент:</b> ${crmData?.client || '________________'}</div>
            <div><b>Изделие:</b> ${crmData?.item || '________________'}</div>
          </div>
          <div style="margin-top: 6px; font-size: 13px;">
            <b>Дата запуска:</b> ${new Date().toLocaleDateString('ru-RU')} &nbsp;&nbsp;
            <b>Дата сдачи:</b> ${crmData?.due_date ? new Date(crmData.due_date).toLocaleDateString('ru-RU') : '______________'}
          </div>
        </div>
        <div style="text-align: center; flex-shrink: 0; margin-left: 16px;">
          ${qrDataUrl ? `<img src="${qrDataUrl}" style="width: 100px; height: 100px; border: 2px solid #1e293b; padding: 2px; background: #fff;" />` : ''}
          <div style="font-size: 10px; color: #64748b; margin-top: 4px; font-family: monospace;">#${orderId}</div>
        </div>
      </div>

      <!-- СРОЧНО / ОПЛАТА -->
      <div style="display: flex; gap: 16px; margin-bottom: 14px;">
        <div style="flex: 1; border: 2px solid #ef4444; border-radius: 8px; padding: 6px 12px; text-align: center; font-weight: 900; color: #ef4444; font-size: 14px;">☐ СРОЧНО</div>
        <div style="flex: 1; border: 2px solid #16a34a; border-radius: 8px; padding: 6px 12px; text-align: center; font-weight: 900; color: #16a34a; font-size: 14px;">☐ ОПЛАЧЕНО</div>
      </div>

      <!-- ПРОЦЕССЫ -->
      <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: #475569; margin-bottom: 6px;">Маршрут по цехам</div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 14px;">
        <thead>
          <tr style="background: #1e293b; color: #fff;">
            <th style="padding: 6px; text-align: center; color: #fff;">Код</th>
            <th style="padding: 6px; text-align: left; color: #fff;">Процесс</th>
            <th style="padding: 6px; text-align: center; color: #fff;">Исполнитель</th>
            <th style="padding: 6px; text-align: center; color: #fff;">Отметка</th>
          </tr>
        </thead>
        <tbody>${processRows}</tbody>
      </table>

      <!-- МАТЕРИАЛЫ -->
      <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: #475569; margin-bottom: 6px;">Материалы · Цвет · Количество</div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 14px;">
        <thead>
          <tr style="background: #f1f5f9;">
            <th style="padding: 6px; text-align: left; border: 1px solid #cbd5e1;">Материал</th>
            <th style="padding: 6px; text-align: center; border: 1px solid #cbd5e1;">Цвет</th>
            <th style="padding: 6px; text-align: center; border: 1px solid #cbd5e1;">Упаковка</th>
            <th style="padding: 6px; text-align: center; border: 1px solid #cbd5e1;">Количество</th>
          </tr>
        </thead>
        <tbody>${materialRows}</tbody>
      </table>

      <!-- КРОМКА / РАСКРОЙ вручную -->
      <div style="background: #f8fafc; border: 1px solid #cbd5e1; padding: 10px 14px; margin-bottom: 14px; font-size: 12px; border-radius: 8px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px;">
          <div><b>Кромка (корпус):</b> ______________________</div>
          <div><b>Кромка (фасад):</b> ______________________</div>
          <div><b>Раскрой / доп. материал:</b> ______________________</div>
          <div><b>Примечание:</b> ______________________</div>
        </div>
      </div>

      <!-- ОТК + ПРИЛОЖЕНИЯ -->
      <div style="display: flex; gap: 14px;">
        <div style="flex: 1; border: 2px solid #cbd5e1; border-radius: 8px; padding: 10px;">
          <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: #475569; margin-bottom: 6px;">ОТК / Контроль</div>
          <div style="font-size: 12px; line-height: 1.8;">
            ☐ Размеры соответствуют<br>
            ☐ Сколов / царапин нет<br>
            ☐ Комплектация полная
          </div>
          <div style="margin-top: 8px; font-size: 11px; border-top: 1px solid #cbd5e1; padding-top: 6px;">Подпись мастера ОТК: ________________</div>
        </div>
        <div style="flex: 1; border: 2px solid #fbbf24; border-radius: 8px; padding: 10px; background: #fffbeb; text-align: center;">
          <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: #92400e; margin-bottom: 6px;">Приложения</div>
          <div style="font-size: 12px;">Чертежи: _____ листа</div>
          <div style="font-size: 11px; color: #92400e; margin-top: 6px;">Обязательно приложить карты раскроя и схемы сборки</div>
        </div>
      </div>

      <div style="text-align: center; font-size: 10px; color: #94a3b8; margin-top: 12px;">
        Внутренний документ производства Mebel Aliya · ${new Date().toLocaleDateString('ru-RU')}
      </div>
    </div>
  `;

  openPrintWindow(`Маршрутный лист #${orderId}`, body);
}

export function printMaterialsWorkshop(orderId: string, crmData: CRMOrderItem | undefined, materials: OrderMaterialItem[], labor: OrderLaborItem[], deliveryCost: number, notes = '') {
  const matTotal = materials.reduce((s, m) => s + (m.qty || 0) * (m.unit_price || 0), 0);
  const laborTotal = labor.reduce((s, l) => s + (l.qty || 1) * (l.unit_price || 0), 0);
  const cost = matTotal + laborTotal + deliveryCost;

  const matRows = materials.map(m => `<tr>
    <td>${m.name || ''}</td><td>${m.color || '-'}</td><td>${m.package || '-'}</td>
    <td>${m.qty} ${m.unit || 'шт'}</td><td>${formatMoney(m.unit_price)}</td>
    <td style="font-weight: 700;">${formatMoney((m.qty || 0) * (m.unit_price || 0))}</td>
  </tr>`).join('') || '<tr><td colspan="6" style="text-align: center; color: #94a3b8;">Нет материалов</td></tr>';

  const laborRows = labor.map(l => `<tr>
    <td>${l.description || ''}</td><td>${l.qty}</td><td>${formatMoney(l.unit_price)}</td>
    <td style="font-weight: 700;">${formatMoney((l.qty || 1) * (l.unit_price || 0))}</td>
  </tr>`).join('') || '<tr><td colspan="4" style="text-align: center; color: #94a3b8;">Нет работ</td></tr>';

  const body = `
    <div class="header">
      <div>
        <div class="brand">📋 Калькуляция заказа</div>
        <div style="font-size: 24px; font-weight: 900; margin-top: 4px;">№ ${orderId}</div>
      </div>
      <div class="meta">
        ${crmData?.client || ''}<br>${crmData?.item || ''}<br>${new Date().toLocaleDateString('ru-RU')}
      </div>
    </div>

    <h3>📦 Материалы</h3>
    <table>
      <thead>
        <tr><th>Название</th><th>Цвет</th><th>Упаковка</th><th>Кол-во</th><th>Цена/ед</th><th>Сумма</th></tr>
      </thead>
      <tbody>${matRows}</tbody>
      <tfoot>
        <tr class="total-row"><td colspan="5">Итого материалы:</td><td>${formatMoney(matTotal)}</td></tr>
      </tfoot>
    </table>

    <h3>🔧 Работа / монтаж</h3>
    <table>
      <thead>
        <tr><th>Описание</th><th>Кол-во</th><th>Цена/ед</th><th>Сумма</th></tr>
      </thead>
      <tbody>${laborRows}</tbody>
      <tfoot>
        <tr class="total-row"><td colspan="3">Итого работа:</td><td>${formatMoney(laborTotal)}</td></tr>
      </tfoot>
    </table>

    <table>
      <tr><td>Доставка</td><td style="text-align: right; font-weight: 700;">${formatMoney(deliveryCost)}</td></tr>
      <tr class="total-row"><td>СЕБЕСТОИМОСТЬ ИТОГО</td><td style="text-align: right;">${formatMoney(cost)}</td></tr>
    </table>

    ${notes ? `<p style="margin-top: 16px; font-size: 12px; color: #475569;"><b>Примечание:</b> ${notes}</p>` : ''}
  `;
  openPrintWindow(`Калькуляция #${orderId}`, body);
}

export function printClientInvoice(orderId: string, crmData: CRMOrderItem | undefined, salePrice: number, materials: OrderMaterialItem[], labor: OrderLaborItem[]) {
  const itemsRows = materials.map(m => `<tr><td>${m.name || ''} ${m.color ? '(' + m.color + ')' : ''}</td><td>${m.qty} ${m.unit || 'шт'}</td></tr>`).join('');
  const laborRows = labor.map(l => `<tr><td>${l.description || ''}</td><td>${l.qty}</td></tr>`).join('');

  const body = `
    <div class="header">
      <div>
        <div class="brand">🧾 Счёт на оплату</div>
        <div style="font-size: 24px; font-weight: 900; margin-top: 4px;">Заказ № ${orderId}</div>
      </div>
      <div class="meta">
        ${crmData?.client || ''}<br>${crmData?.phone || ''}<br>${new Date().toLocaleDateString('ru-RU')}
      </div>
    </div>

    <h3>Изделие</h3>
    <p style="font-size: 15px; font-weight: 700; margin-bottom: 16px;">${crmData?.item || 'Не указано'}</p>

    ${itemsRows ? `<h3>Состав заказа</h3><table><thead><tr><th>Материал</th><th>Кол-во</th></tr></thead><tbody>${itemsRows}</tbody></table>` : ''}
    ${laborRows ? `<h3>Выполненные работы</h3><table><thead><tr><th>Работа</th><th>Кол-во</th></tr></thead><tbody>${laborRows}</tbody></table>` : ''}

    <table>
      <tr class="total-row"><td>ИТОГО К ОПЛАТЕ</td><td style="text-align: right; font-size: 18px; color: #3b27c1;">${formatMoney(salePrice)}</td></tr>
    </table>
    <p style="margin-top: 24px; font-size: 12px; color: #94a3b8; text-align: center;">Спасибо за выбор Mebel Aliya!</p>
  `;
  openPrintWindow(`Счёт #${orderId}`, body);
}

export function printSvcReceipt(client: SvcClientItem, transactions: SvcTransactionItem[]) {
  const total = transactions.reduce((s, t) => s + (t.total_amount || 0), 0);
  const paid = transactions.reduce((s, t) => s + (t.paid_amount || 0), 0);
  const debt = total - paid;

  const recentTxs = [...transactions].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 12);

  const rows = recentTxs.map(t => `<tr>
    <td style="font-size: 10px;">${t.created_at ? new Date(t.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : ''}</td>
    <td style="font-size: 10px;">${t.service_type}${t.crm_order_id ? ` (#${t.crm_order_id})` : ''}</td>
    <td style="font-size: 10px; text-align: center;">${t.qty}</td>
    <td style="font-size: 10px; text-align: right;">${formatMoney(t.total_amount)}</td>
  </tr>`).join('');

  const body = `
    <div style="border: 1px solid #1e293b; padding: 12px; font-size: 11px; line-height: 1.4; border-radius: 8px;">
      <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #3b27c1; padding-bottom: 6px; margin-bottom: 8px;">
        <b style="font-size: 14px; color: #3b27c1;">ФАКТУРА УСЛУГ</b>
        <span style="font-size: 10px;">${new Date().toLocaleDateString('ru-RU')}</span>
      </div>
      <div style="margin-bottom: 6px;"><b>Клиент:</b> ${client.name} ${client.phone ? '· ' + client.phone : ''}</div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 6px;">
        <thead>
          <tr style="border-bottom: 1px solid #cbd5e1;">
            <th style="font-size: 9px; text-align: left; padding: 3px 2px;">Дата</th>
            <th style="font-size: 9px; text-align: left; padding: 3px 2px;">Услуга</th>
            <th style="font-size: 9px; text-align: center; padding: 3px 2px;">Кол</th>
            <th style="font-size: 9px; text-align: right; padding: 3px 2px;">Сумма</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <table style="width: 100%; border-top: 1px solid #1e293b; padding-top: 4px;">
        <tr><td style="font-size: 10px;">Всего выставлено:</td><td style="text-align: right; font-size: 11px; font-weight: 700;">${formatMoney(total)}</td></tr>
        <tr><td style="font-size: 10px; color: #16a34a;">Оплачено:</td><td style="text-align: right; font-size: 11px; color: #16a34a; font-weight: 700;">${formatMoney(paid)}</td></tr>
        <tr>
          <td style="font-size: 11px; font-weight: 900;">${debt > 0 ? 'К ОПЛАТЕ (ДОЛГ):' : 'Баланс (переплата):'}</td>
          <td style="text-align: right; font-size: 13px; font-weight: 900; color: ${debt > 0 ? '#ef4444' : '#16a34a'};">${formatMoney(Math.abs(debt))}</td>
        </tr>
      </table>
    </div>
  `;

  openPrintWindow(`Фактура — ${client.name}`, body, '210mm 110mm');
}
