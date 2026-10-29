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

export const ROLES = {
  customer: 'Покупатель',
  manager: 'Менеджер',
  content: 'Контент-менеджер',
  admin: 'Администратор',
};
