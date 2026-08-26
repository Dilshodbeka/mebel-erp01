/**
 * Главный файл модулей Mebel Aliya ERP
 * 
 * Этот файл экспортирует все доступные модули для использования в приложении
 */

// Конфигурация
export { 
    SUPABASE_URL, 
    SUPABASE_KEY, 
    PROCS, 
    PAINT_PROCS, 
    ALL_WORKER_PROCS, 
    KANBAN_PROCS 
} from '../config.js';

// Утилиты
export {
    formatDate,
    formatOrderNumber,
    generateId,
    isEmpty,
    safeGet,
    debounce,
    throttle,
    isValidEmail,
    isValidPhoneKZ,
    parseNumber,
    stripHtml,
    copyToClipboard,
    storage
} from './modules/utils.js';

// QR-коды
export {
    isQRCodeLoaded,
    generateQRCode,
    createOrderQRPayload,
    initQRCodeOnLoad
} from './modules/qr-module.js';

// Заказы
export {
    ORDER_STATUS,
    PROCESSES,
    PAINT_PROCESSES,
    createOrder,
    updateOrderStatus,
    addProcessToOrder,
    completeProcess,
    getOrderProgress,
    isOrderCompleted,
    filterOrdersByStatus,
    searchOrders,
    sortOrders,
    groupOrdersByProcess,
    exportOrdersToCSV,
    importOrdersFromCSV
} from './modules/orders.js';
