/**
 * Модуль утилит для Mebel Aliya ERP
 */

// Форматирование даты
export function formatDate(date, format = 'DD.MM.YYYY') {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    
    return format
        .replace('DD', day)
        .replace('MM', month)
        .replace('YYYY', year);
}

// Форматирование номера заказа
export function formatOrderNumber(number) {
    return number ? String(number).padStart(5, '0') : '';
}

// Генерация уникального ID
export function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Проверка на пустое значение
export function isEmpty(value) {
    return value === null || value === undefined || value === '';
}

// Безопасное получение свойства из объекта
export function safeGet(obj, path, defaultValue = '') {
    try {
        return path.split('.').reduce((current, key) => current[key], obj) ?? defaultValue;
    } catch (e) {
        return defaultValue;
    }
}

// Дебаунс функции
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Троттл функции
export function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Валидация email
export function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

// Валидация телефона (Казахстан)
export function isValidPhoneKZ(phone) {
    const re = /^\+7\d{10}$/;
    return re.test(phone.replace(/\D/g, ''));
}

// Конвертация строки в число с обработкой ошибок
export function parseNumber(value, defaultValue = 0) {
    const num = parseFloat(value);
    return isNaN(num) ? defaultValue : num;
}

// Очистка строки от HTML тегов
export function stripHtml(html) {
    const tmp = document.createElement('DIV');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

// Копирование в буфер обмена
export async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        console.error('Failed to copy:', err);
        return false;
    }
}

// LocalStorage wrapper
export const storage = {
    get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (e) {
            return defaultValue;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            return false;
        }
    },
    remove(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            return false;
        }
    },
    clear() {
        try {
            localStorage.clear();
            return true;
        } catch (e) {
            return false;
        }
    }
};
