# Архитектура Mebel Aliya ERP

## Структура проекта

```
/workspace/
├── index.html              # Главный HTML файл (требует разделения)
├── js/
│   ├── config.js           # Конфигурация приложения
│   ├── main-modules.js     # Точка входа для ES6 модулей
│   ├── main.js             # Основной код (монолит, требует рефакторинга)
│   └── modules/
│       ├── utils.js        # Утилиты и вспомогательные функции
│       ├── qr-module.js    # Модуль работы с QR-кодами
│       └── orders.js       # Модуль работы с заказами
└── css/
    └── styles.css          # Стили приложения
```

## Исправленные ошибки

### 1. Критическая ошибка с QRCode.js
**Проблема:** Библиотека подключалась внутри JavaScript template literal
**Решение:** Перемещено в `<head>` секцию HTML

```html
<!-- Было (неправильно) -->
<script src="...qrcode.min.js"><\/script>  <!-- Внутри template string -->

<!-- Стало (правильно) -->
<head>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
</head>
```

### 2. Несбалансированные теги script
**Проблема:** 5 открывающих и только 3 закрывающих тегов
**Решение:** Удалены дублирующиеся подключения внутри template strings

### 3. Экранирование </script>
**Проблема:** Использование `<\/script>` внутри complex structures
**Решение:** Заменено на правильное закрытие тегов

## Модульная архитектура

### utils.js
- Форматирование дат и чисел
- Валидация данных
- Работа с localStorage
- Debounce/throttle функции
- Копирование в буфер обмена

### qr-module.js
- Генерация QR-кодов
- Создание payload для заказов
- Проверка загрузки библиотеки

### orders.js
- CRUD операции с заказами
- Управление процессами
- Фильтрация и сортировка
- Экспорт/импорт CSV

### config.js
- Supabase конфигурация
- Список процессов
- Настройки приложения

## Как использовать модули

### В HTML (через ES6 modules):
```html
<script type="module">
    import { 
        formatDate, 
        createOrder, 
        generateQRCode 
    } from './js/main-modules.js';
    
    // Использование функций
</script>
```

### Пример создания заказа:
```javascript
import { createOrder, addProcessToOrder } from './js/main-modules.js';

const order = createOrder({
    number: '12345',
    customer: 'Клиент ООО'
});

const orderWithProcess = addProcessToOrder(order, 'Раскрой NESTING', {
    worker: 'Иванов И.И.'
});
```

### Пример генерации QR-кода:
```javascript
import { generateQRCode, createOrderQRPayload } from './js/main-modules.js';

const payload = createOrderQRPayload(orderId, orderData);
generateQRCode('qr-container', payload);
```

## Рекомендации по дальнейшему рефакторингу

1. **Разделить index.html**
   - Вынести CSS в отдельный файл
   - Разбить JavaScript на логические модули
   - Создать компоненты для каждого экрана

2. **Создать дополнительные модули:**
   - `auth.js` - Аутентификация и авторизация
   - `api.js` - Работа с Supabase API
   - `ui.js` - UI компоненты и модальные окна
   - `kanban.js` - Логика Kanban доски
   - `reports.js` - Отчёты и аналитика

3. **Внедрить сборку:**
   - Использовать Vite или Webpack
   - Добавить минификацию
   - Настроить hot-reload для разработки

4. **Добавить тесты:**
   - Unit тесты для утилит
   - Integration тесты для API
   - E2E тесты для критических путей

## Текущий статус

✅ QR-код библиотека подключена правильно
✅ Теги script сбалансированы
✅ Создана модульная структура
✅ Базовые модули реализованы

⏳ Ожидает рефакторинга основной код в main.js
⏳ Ожидает разделения index.html на компоненты
