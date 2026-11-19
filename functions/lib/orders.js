// Оформление и обработка заказа: проверка данных покупателя, расчёт суммы по ценам каталога,
// резерв товара на складе, смена статусов. Здесь нет обращений к базе — только вычисления,
// поэтому всё проверяется тестами в Node.js (tests/functions-logic.test.js), а index.js
// вызывает эти функции внутри транзакций Firestore
import { MAX_ITEM_QTY, nextStatuses } from '../shared/dictionaries.js';

// Ошибка, которую можно показать покупателю как есть. code — как у HttpsError:
// invalid-argument (неверно заполнена форма), failed-precondition (изменились корзина или каталог),
// permission-denied (нет прав)
export class OrderError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const MAX_CART_ITEMS = 50; // столько же разрешают правила Firestore для корзины
const PHONE = /^[0-9 ()+-]{6,20}$/;

function text(value, { field, label, max, required = false }) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (required && !result) throw new OrderError('invalid-argument', `Укажите ${label}.`, { field });
  if (result.length > max) {
    throw new OrderError('invalid-argument', `Слишком длинное поле «${label}»: не больше ${max} символов.`, { field });
  }
  return result;
}

// Данные формы оформления заказа → то, что сохраняется в заказе.
// Браузеру не доверяем: форма проверяется и там, но запрос можно отправить и в обход сайта
export function validateCheckout(data) {
  const name = text(data?.contact?.name, { field: 'name', label: 'имя', max: 100, required: true });
  const phone = text(data?.contact?.phone, { field: 'phone', label: 'телефон', max: 20, required: true });
  const digits = phone.replace(/\D/g, '').length;
  if (!PHONE.test(phone) || digits < 10 || digits > 12) {
    throw new OrderError('invalid-argument', 'Проверьте номер телефона: например, +7 700 000 00 00.', { field: 'phone' });
  }
  const method = data?.delivery?.method;
  if (method !== 'pickup' && method !== 'delivery') {
    throw new OrderError('invalid-argument', 'Выберите способ получения.', { field: 'delivery' });
  }
  const delivery = { method };
  if (method === 'delivery') {
    delivery.address = text(data.delivery.address, { field: 'address', label: 'адрес доставки', max: 200, required: true });
  }
  const comment = text(data?.comment, { field: 'comment', label: 'комментарий', max: 500 });
  return { contact: { name, phone }, delivery, ...(comment && { comment }) };
}

// Корзина { productId: количество } и товары из каталога → позиции заказа и сумма.
// Цена берётся только из каталога и фиксируется в заказе: если она потом изменится,
// заказ останется с той ценой, по которой его оформили.
// fromStock — сколько штук зарезервировано со склада, backorder — сколько «под заказ»
// (товар с нулевым остатком на сайте так и подписан, заказать его можно)
export function priceOrder(cartItems, productsById) {
  const entries = Object.entries(cartItems ?? {});
  if (entries.length === 0) throw new OrderError('failed-precondition', 'Корзина пуста.');
  if (entries.length > MAX_CART_ITEMS) {
    throw new OrderError('failed-precondition', `В одном заказе не больше ${MAX_CART_ITEMS} разных товаров.`);
  }
  const missing = [];
  const items = [];
  for (const [productId, qty] of entries) {
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_ITEM_QTY) {
      throw new OrderError('failed-precondition', `Количество каждого товара — от 1 до ${MAX_ITEM_QTY} шт.`, { productId });
    }
    const product = productsById.get(productId);
    if (!product) {
      missing.push(productId);
      continue;
    }
    const fromStock = Math.min(qty, Math.max(product.stock ?? 0, 0));
    items.push({ productId, name: product.name, price: product.price, qty, fromStock, backorder: qty - fromStock });
  }
  if (missing.length > 0) {
    throw new OrderError('failed-precondition', 'Некоторых товаров из корзины больше нет в каталоге. Корзина обновлена.', { missing });
  }
  return { items, total: items.reduce((sum, item) => sum + item.price * item.qty, 0) };
}

export function orderNumber(n) {
  return `AD-${String(n).padStart(6, '0')}`;
}

// Кто и на какой статус может перевести заказ:
// менеджер и администратор — по таблице nextStatuses (ТЗ, п. 1.5);
// покупатель — только отменить свой заказ, пока его не подтвердил менеджер
export function checkStatusChange(order, target, { uid, role }) {
  const staff = role === 'manager' || role === 'admin';
  if (staff) {
    if (nextStatuses(order.status, order.delivery?.method).includes(target)) return;
    throw new OrderError('failed-precondition', 'Заказ уже в другом статусе. Обновите страницу.', { status: order.status });
  }
  if (order.userId === uid && target === 'cancelled') {
    if (order.status === 'new') return;
    throw new OrderError('failed-precondition', 'Заказ уже подтверждён — отменить его можно через менеджера.');
  }
  throw new OrderError('permission-denied', 'Недостаточно прав для изменения заказа.');
}

// Что вернуть на склад при отмене: только то, что было зарезервировано.
// У демонстрационных заказов из тестовых данных резерва нет (fromStock не указан)
export function stockToReturn(order) {
  return (order.items ?? []).filter((i) => i.fromStock > 0).map((i) => ({ productId: i.productId, qty: i.fromStock }));
}
