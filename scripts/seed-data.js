// Тестовые данные: чтение файлов seed/ и сборка документов базы.
// Без обращений к Firebase, поэтому модуль используют и scripts/seed.js, и тесты
import { readFile } from 'node:fs/promises';
import { priceRangeOf } from '../public/js/dictionaries.js';

export const PASSWORD = 'agrodala123'; // только для эмулятора

// Учётные записи для проверки ролей. key связывает покупателей с seed/orders.json и carts.json
export const ACCOUNTS = [
  { key: 'admin', email: 'admin@agrodala.example', name: 'Администратор', role: 'admin' },
  { key: 'manager', email: 'manager@agrodala.example', name: 'Менеджер по продажам', role: 'manager' },
  { key: 'content', email: 'content@agrodala.example', name: 'Контент-менеджер', role: 'content' },
  {
    key: 'buyer',
    email: 'buyer@agrodala.example',
    name: 'Асан Покупатель',
    role: 'customer',
    phone: '+7 700 000 00 01',
    addresses: [{ label: 'Дом', city: 'Астана', street: 'ул. Пушкина, 1' }],
  },
  {
    key: 'farmer',
    email: 'farmer@agrodala.example',
    name: 'Марат Фермер',
    role: 'customer',
    phone: '+7 700 000 00 02',
    addresses: [{ label: 'Хозяйство', city: 'с. Шортанды', street: 'ул. Целинная, 3' }],
  },
];

const readJson = async (path) => JSON.parse(await readFile(new URL(`../seed/${path}`, import.meta.url), 'utf8'));

export async function loadSeed() {
  const [categories, suppliers, products, orders, carts, credits] = await Promise.all(
    ['categories.json', 'suppliers.json', 'products.json', 'orders.json', 'carts.json', 'images/credits.json'].map(readJson)
  );
  return { categories, suppliers, products, orders, carts, credits };
}

// Документ товара: поля поставщика копируются в товар, чтобы фильтр по стране и
// производителю выполнялся одним запросом; диапазон цены вычисляется из цены
export function buildProduct({ id, ...product }, { categories, suppliers, credits }, photos = {}) {
  const supplier = suppliers.find((s) => s.id === product.supplierId);
  const category = categories.find((c) => c.id === product.categoryId);
  const credit = credits[id];
  return {
    ...product,
    purpose: product.purpose ?? category.purpose,
    manufacturer: supplier.brand,
    origin: supplier.origin,
    country: supplier.country,
    priceRange: priceRangeOf(product.price),
    ...photos,
    ...(credit && {
      imageCredit: { author: credit.author, license: credit.license, source: credit.source },
    }),
  };
}

// Какие статусы заказ прошёл, чтобы оказаться в нынешнем (ТЗ, п. 1.5)
export function statusPath(status, method) {
  const handover = method === 'delivery' ? 'shipped' : 'readyForPickup';
  if (status === 'cancelled') return ['new', 'cancelled'];
  const path = ['new', 'confirmed', 'picking', handover, 'completed'];
  return path.slice(0, path.indexOf(status) + 1);
}

// Демонстрационный заказ: цены фиксируются на момент оформления, сумма считается из них.
// В настоящей работе это будут делать Cloud Functions (5-я неделя)
export function buildOrder(order, { products, uidOf, now = Date.now() }) {
  const account = ACCOUNTS.find((a) => a.key === order.user);
  const items = order.items.map(({ productId, qty }) => {
    const product = products.find((p) => p.id === productId);
    return { productId, name: product.name, price: product.price, qty };
  });
  const createdAt = new Date(now - order.daysAgo * 24 * 60 * 60 * 1000);
  const history = statusPath(order.status, order.delivery.method);
  return {
    number: order.number,
    userId: uidOf[order.user],
    items,
    total: items.reduce((sum, item) => sum + item.price * item.qty, 0),
    delivery: order.delivery,
    contact: { name: account.name, phone: account.phone },
    ...(order.comment && { comment: order.comment }),
    status: order.status,
    // Каждый следующий статус ставит менеджер спустя полдня после предыдущего
    statusHistory: history.map((status, i) => ({
      status,
      at: new Date(createdAt.getTime() + i * 12 * 60 * 60 * 1000),
      by: i === 0 ? uidOf[order.user] : uidOf.manager,
    })),
    createdAt,
  };
}
