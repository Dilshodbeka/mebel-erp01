import { OrderItem } from '../types';

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatMoney(amount: number | string | undefined | null): string {
  if (amount === undefined || amount === null || amount === '') return '-';
  const num = Number(amount);
  if (isNaN(num)) return '-';
  return num.toLocaleString('ru-RU');
}

export function formatDuration(ms: number | undefined | null): string {
  if (!ms || ms < 0) return '0м';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / (3600 * 24));
  const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}д ${hours}ч`;
  if (hours > 0) return `${hours}ч ${minutes}м`;
  if (minutes > 0) return `${minutes}м ${seconds}с`;
  return `${seconds}с`;
}

export function formatHoursMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h === 0 && m === 0) return '0м';
  if (h === 0) return `${m}м`;
  return `${h}ч ${m}м`;
}

export function getProcessCode(order: OrderItem | undefined | null, processName: string): string {
  if (!order || !Array.isArray(order.path)) return '';
  const idx = order.path.indexOf(processName);
  if (idx === -1) return '';
  return `${order.id}-${pad2(idx + 1)}`;
}

export function findProcessByCode(orders: OrderItem[], code: string) {
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

export function isPaintProc(procName: string): boolean {
  const paintNames = ['краска', 'шлиповка', 'грунтовка', 'Краска', 'Шлиповка', 'Грунтовка'];
  return paintNames.some(p => p.toLowerCase() === (procName || '').toLowerCase());
}

export function isAssemblyProc(procName: string): boolean {
  return (procName || '').trim().toLowerCase().includes('сборк');
}

export function getPathProcUnit(procName: string): string {
  const p = (procName || '').trim().toLowerCase();
  if (p.includes('кромк')) return 'п.м.';
  if (p.includes('раскрой') || p.includes('nesting') || p.includes('нестинг') || p.includes('пильн') || p.includes('фасад') || p.includes('пленка')) return 'м²';
  if (p.includes('краск') || p.includes('шлип') || p.includes('шлиф') || p.includes('грунт')) return 'м²';
  if (p.includes('присад') || p.includes('ровер')) return 'шт';
  if (p.includes('сборк')) return 'изд';
  if (p.includes('упаковк')) return 'мест';
  return 'шт';
}

export function calculateOrderProgress(order: OrderItem | undefined | null): number {
  if (!order || !Array.isArray(order.path) || order.path.length === 0) return 0;
  let completed = 0;
  for (const process of order.path) {
    const history = order.history?.[process];
    if (history && history.end) {
      completed++;
    }
  }
  return Math.round((completed / order.path.length) * 100);
}

export function isOrderFinished(order: OrderItem | undefined | null): boolean {
  if (!order || !Array.isArray(order.path) || order.path.length === 0 || !order.history) return false;
  const lastStep = order.path[order.path.length - 1];
  return !!order.history[lastStep]?.end;
}
