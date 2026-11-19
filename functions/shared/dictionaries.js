// Справочники: значения полей в базе → подписи на сайте.
// Модуль без зависимостей от браузера: его импортирует и скрипт заполнения базы (Node.js)

export const PURPOSES = {
  field: 'Для полей',
  garden: 'Для дачи и сада',
  general: 'Общие сельхозработы',
};

export const TYPES = {
  heavy: 'Крупное оборудование',
  mini: 'Мини-инструмент',
};

export const ORIGINS = {
  china: 'Китай',
  europe: 'Европа',
};

// Градация цен из ТЗ (таблица 2). Границы в тенге: from включительно, to не включительно
export const PRICE_RANGES = [
  { id: 'upTo20k', label: 'до 20 000 ₸', from: 0, to: 20_000 },
  { id: '20kTo100k', label: '20 000 – 100 000 ₸', from: 20_000, to: 100_000 },
  { id: '100kTo500k', label: '100 000 – 500 000 ₸', from: 100_000, to: 500_000 },
  { id: 'over500k', label: 'свыше 500 000 ₸', from: 500_000, to: Infinity },
];

export function priceRangeOf(price) {
  return PRICE_RANGES.find((r) => price >= r.from && price < r.to).id;
}

export const ORDER_STATUSES = {
  new: 'Новый',
  confirmed: 'Подтверждён',
  picking: 'Комплектуется',
  shipped: 'Передан в доставку',
  readyForPickup: 'Готов к выдаче',
  completed: 'Выполнен',
  cancelled: 'Отменён',
};

// Ход заказа (ТЗ, п. 1.5): из какого статуса в какие можно перейти.
// Передача покупателю зависит от способа получения: доставка или самовывоз со склада.
// Отменить можно до передачи в доставку или на выдачу. Проверяет это Cloud Function
// setOrderStatus, а административная панель по этой же таблице показывает только допустимые кнопки
export function nextStatuses(status, method) {
  const handover = method === 'delivery' ? 'shipped' : 'readyForPickup';
  const flow = {
    new: ['confirmed', 'cancelled'],
    confirmed: ['picking', 'cancelled'],
    picking: [handover, 'cancelled'],
    shipped: ['completed'],
    readyForPickup: ['completed'],
  };
  return flow[status] ?? [];
}

// Больше штук одного товара в одном заказе не принимается: крупный опт оформляется через менеджера
export const MAX_ITEM_QTY = 99;

export const DELIVERY_METHODS = {
  pickup: 'Самовывоз со склада',
  delivery: 'Доставка',
};

export const ROLES = {
  customer: 'Покупатель',
  manager: 'Менеджер',
  content: 'Контент-менеджер',
  admin: 'Администратор',
};
