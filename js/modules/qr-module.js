/**
 * Модуль QR-кодов для Mebel Aliya ERP
 */

// Проверяем, загружена ли библиотека QRCode
export function isQRCodeLoaded() {
    return typeof QRCode !== 'undefined';
}

// Генерирует QR-код в указанном элементе
export function generateQRCode(elementId, text, options = {}) {
    const element = document.getElementById(elementId);
    if (!element) {
        console.error(`Элемент с id "${elementId}" не найден`);
        return false;
    }

    if (!isQRCodeLoaded()) {
        console.error('Библиотека QRCode.js не загружена');
        return false;
    }

    try {
        const defaultOptions = {
            width: 100,
            height: 100,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        };

        const finalOptions = { ...defaultOptions, ...options, text };
        new QRCode(element, finalOptions);
        return true;
    } catch (error) {
        console.error('Ошибка генерации QR-кода:', error);
        return false;
    }
}

// Создает payload для QR-кода заказа
export function createOrderQRPayload(orderId, orderData = {}) {
    const payload = {
        id: orderId,
        number: orderData.number || '',
        customer: orderData.customer || '',
        timestamp: new Date().toISOString()
    };
    return JSON.stringify(payload);
}

// Инициализирует QR-код после загрузки страницы
export function initQRCodeOnLoad(elementId, text, options) {
    window.addEventListener('load', function() {
        generateQRCode(elementId, text, options);
    });
}
