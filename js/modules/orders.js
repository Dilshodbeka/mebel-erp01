/**
 * Модуль работы с заказами для Mebel Aliya ERP
 */

import { generateId, formatDate } from './utils.js';

// Статусы заказов
export const ORDER_STATUS = {
    NEW: 'new',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
};

// Процессы производства
export const PROCESSES = [
    "Раскрой NESTING",
    "2 пильный",
    "кромка",
    "Присадка",
    "ФАСАД NESTING",
    "Ровер",
    "Фигурный кромка",
    "Пленка PVC",
    "Шлиповка",
    "Грунтовка",
    "Краска",
    "OTK",
    "Упаковка",
    "Сборка"
];

// Покрасочные процессы
export const PAINT_PROCESSES = ["Шлиповка", "Грунтовка", "Краска"];

// Создание нового заказа
export function createOrder(orderData) {
    return {
        id: generateId(),
        number: orderData.number || '',
        customer: orderData.customer || '',
        status: ORDER_STATUS.NEW,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        processes: {},
        history: [],
        ...orderData
    };
}

// Обновление статуса заказа
export function updateOrderStatus(order, status) {
    return {
        ...order,
        status,
        updatedAt: new Date().toISOString()
    };
}

// Добавление процесса к заказу
export function addProcessToOrder(order, processName, data = {}) {
    const now = new Date().toISOString();
    return {
        ...order,
        processes: {
            ...order.processes,
            [processName]: {
                startedAt: now,
                status: 'in_progress',
                worker: data.worker || null,
                notes: data.notes || '',
                ...data
            }
        },
        updatedAt: now
    };
}

// Завершение процесса
export function completeProcess(order, processName, data = {}) {
    const now = new Date().toISOString();
    const process = order.processes[processName];
    if (!process) return order;
    
    return {
        ...order,
        processes: {
            ...order.processes,
            [processName]: {
                ...process,
                completedAt: now,
                status: 'completed',
                ...data
            }
        },
        history: [
            ...order.history,
            {
                process: processName,
                action: 'completed',
                timestamp: now,
                worker: data.worker || null
            }
        ],
        updatedAt: now
    };
}

// Получение прогресса заказа (сколько процессов завершено)
export function getOrderProgress(order) {
    const totalProcesses = PROCESSES.length;
    const completedProcesses = Object.values(order.processes || {}).filter(
        p => p.status === 'completed'
    ).length;
    
    return {
        total: totalProcesses,
        completed: completedProcesses,
        percentage: Math.round((completedProcesses / totalProcesses) * 100)
    };
}

// Проверка, завершен ли заказ
export function isOrderCompleted(order) {
    return PROCESSES.every(processName => {
        const process = order.processes?.[processName];
        return process && process.status === 'completed';
    });
}

// Фильтрация заказов по статусу
export function filterOrdersByStatus(orders, status) {
    return orders.filter(order => order.status === status);
}

// Поиск заказов
export function searchOrders(orders, query) {
    const lowerQuery = query.toLowerCase();
    return orders.filter(order => 
        order.number?.toLowerCase().includes(lowerQuery) ||
        order.customer?.toLowerCase().includes(lowerQuery)
    );
}

// Сортировка заказов
export function sortOrders(orders, field = 'createdAt', direction = 'desc') {
    return [...orders].sort((a, b) => {
        const aVal = a[field];
        const bVal = b[field];
        
        if (aVal < bVal) return direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return direction === 'asc' ? 1 : -1;
        return 0;
    });
}

// Группировка заказов по процессам (для Kanban)
export function groupOrdersByProcess(orders, processName) {
    return orders.filter(order => {
        const process = order.processes?.[processName];
        return process && process.status !== 'completed';
    });
}

// Экспорт в CSV
export function exportOrdersToCSV(orders) {
    const headers = ['ID', 'Номер', 'Клиент', 'Статус', 'Создан', 'Обновлен'];
    const rows = orders.map(order => [
        order.id,
        order.number,
        order.customer,
        order.status,
        formatDate(order.createdAt),
        formatDate(order.updatedAt)
    ]);
    
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.join(','))
    ].join('\n');
    
    return csvContent;
}

// Импорт из CSV
export function importOrdersFromCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',');
    const orders = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const order = {};
        
        headers.forEach((header, index) => {
            order[header.trim()] = values[index]?.trim() || '';
        });
        
        orders.push(order);
    }
    
    return orders;
}
