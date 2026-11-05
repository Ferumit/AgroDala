// Проверка тестовых данных: связи, охват значений фильтров, суммы заказов, файлы фото и иконок.
// Эмулятор не нужен: данные читаются из папки seed/
import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, buildOrder, buildProduct, loadSeed, statusPath } from '../scripts/seed-data.js';
import { ORDER_STATUSES, PRICE_RANGES, priceRangeOf } from '../public/js/dictionaries.js';

let seed;
let docs; // товары в том виде, как они попадают в базу
let orders;

const unique = (items) => new Set(items).size === items.length;
const values = (field) => new Set(docs.map((p) => p[field]));
const file = (path) => existsSync(new URL(`../${path}`, import.meta.url));

// Товары, для которых нет подходящего свободного фото: для них показывается иконка категории
const WITHOUT_PHOTO = ['seyalka-ruchnaya-6'];

beforeAll(async () => {
  seed = await loadSeed();
  docs = seed.products.map((p) => buildProduct(p, seed));
  const uidOf = Object.fromEntries(ACCOUNTS.map((a) => [a.key, `uid-${a.key}`]));
  orders = seed.orders.map((o) => buildOrder(o, { products: seed.products, uidOf, now: Date.UTC(2026, 10, 1) }));
});

describe('объём и уникальность', () => {
  it('8 категорий, 6 поставщиков, 35 товаров', () => {
    expect(seed.categories).toHaveLength(8);
    expect(seed.suppliers).toHaveLength(6);
    expect(seed.products).toHaveLength(35);
  });

  it('идентификаторы и названия не повторяются', () => {
    for (const list of [seed.categories, seed.suppliers, seed.products]) {
      expect(unique(list.map((x) => x.id))).toBe(true);
      expect(unique(list.map((x) => x.name))).toBe(true);
    }
  });

  it('порядок категорий на главной странице: 1, 2, 3…', () => {
    expect(seed.categories.map((c) => c.order).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('связи', () => {
  it('у каждого товара существующие категория и поставщик', () => {
    const categories = new Set(seed.categories.map((c) => c.id));
    const suppliers = new Set(seed.suppliers.map((s) => s.id));
    for (const p of seed.products) {
      expect(categories.has(p.categoryId), p.id).toBe(true);
      expect(suppliers.has(p.supplierId), p.id).toBe(true);
    }
  });

  it('в каждой категории и у каждого поставщика не меньше 3 товаров', () => {
    for (const c of seed.categories) {
      expect(seed.products.filter((p) => p.categoryId === c.id).length, c.id).toBeGreaterThanOrEqual(3);
    }
    for (const s of seed.suppliers) {
      expect(seed.products.filter((p) => p.supplierId === s.id).length, s.id).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('значения для фильтров 4-й недели (ТЗ, таблица 2)', () => {
  it('встречаются все назначения, типы и страны', () => {
    expect(values('purpose')).toEqual(new Set(['field', 'garden', 'general']));
    expect(values('type')).toEqual(new Set(['heavy', 'mini']));
    expect(values('origin')).toEqual(new Set(['china', 'europe']));
  });

  it('в каждом ценовом диапазоне есть товары', () => {
    for (const range of PRICE_RANGES) {
      expect(docs.filter((p) => p.priceRange === range.id).length, range.id).toBeGreaterThanOrEqual(3);
    }
  });

  it('границы диапазонов: нижняя включается, верхняя нет', () => {
    expect(priceRangeOf(19_999)).toBe('upTo20k');
    expect(priceRangeOf(20_000)).toBe('20kTo100k');
    expect(priceRangeOf(99_999)).toBe('20kTo100k');
    expect(priceRangeOf(100_000)).toBe('100kTo500k');
    expect(priceRangeOf(499_999)).toBe('100kTo500k');
    expect(priceRangeOf(500_000)).toBe('over500k');
  });

  it('есть товары в наличии и под заказ', () => {
    expect(docs.some((p) => p.stock > 0)).toBe(true);
    expect(docs.filter((p) => p.stock === 0).length).toBeGreaterThanOrEqual(3);
  });

  it('в одной категории есть товары и из Китая, и из Европы: есть что сравнивать', () => {
    const mixed = seed.categories.filter((c) =>
      new Set(docs.filter((p) => p.categoryId === c.id).map((p) => p.origin)).size === 2);
    expect(mixed.length).toBeGreaterThanOrEqual(6);
  });

  it('производитель и страна взяты у поставщика', () => {
    docs.forEach((p) => {
      const supplier = seed.suppliers.find((s) => s.id === p.supplierId);
      expect(p.manufacturer).toBe(supplier.brand);
      expect(p.country).toBe(supplier.country);
      expect(p.origin).toBe(supplier.origin);
    });
  });
});

describe('содержание товаров', () => {
  it('цена — целое число, у товара есть описание и характеристики', () => {
    for (const p of seed.products) {
      expect(Number.isInteger(p.price) && p.price > 0, p.id).toBe(true);
      expect(Number.isInteger(p.stock) && p.stock >= 0, p.id).toBe(true);
      expect(p.description.length, p.id).toBeGreaterThan(30);
      expect(Object.keys(p.specs).length, p.id).toBeGreaterThanOrEqual(3);
    }
  });

  it('у товаров есть фото двух размеров и сведения об авторе', () => {
    for (const { id } of seed.products) {
      if (WITHOUT_PHOTO.includes(id)) continue;
      expect(file(`seed/images/${id}.jpg`), id).toBe(true);
      expect(file(`seed/images/${id}-thumb.jpg`), id).toBe(true);
      const credit = seed.credits[id];
      expect(credit?.author && credit?.license && credit?.source, id).toBeTruthy();
    }
  });

  it('у каждой категории есть файл иконки', () => {
    for (const c of seed.categories) expect(file(`public/img/icons/${c.icon}.svg`), c.icon).toBe(true);
  });
});

describe('демонстрационные заказы и корзины (ТЗ, п. 2.5)', () => {
  it('встречаются все статусы заказа', () => {
    expect(new Set(orders.map((o) => o.status))).toEqual(new Set(Object.keys(ORDER_STATUSES)));
  });

  it('номера заказов не повторяются', () => {
    expect(unique(orders.map((o) => o.number))).toBe(true);
  });

  it('сумма заказа равна сумме позиций по ценам каталога', () => {
    for (const o of orders) {
      let total = 0;
      for (const item of o.items) {
        const product = seed.products.find((p) => p.id === item.productId);
        expect(item.price, item.productId).toBe(product.price);
        expect(item.qty).toBeGreaterThan(0);
        total += product.price * item.qty;
      }
      expect(o.total, o.number).toBe(total);
    }
  });

  it('история статусов начинается с «Новый» и заканчивается текущим статусом', () => {
    for (const o of orders) {
      expect(o.statusHistory[0].status, o.number).toBe('new');
      expect(o.statusHistory.at(-1).status, o.number).toBe(o.status);
    }
  });

  it('путь статусов зависит от способа получения', () => {
    expect(statusPath('completed', 'delivery')).toEqual(['new', 'confirmed', 'picking', 'shipped', 'completed']);
    expect(statusPath('completed', 'pickup')).toEqual(['new', 'confirmed', 'picking', 'readyForPickup', 'completed']);
    expect(statusPath('cancelled', 'pickup')).toEqual(['new', 'cancelled']);
  });

  it('заказы и корзины есть только у покупателей, товары в корзинах существуют', () => {
    const customers = ACCOUNTS.filter((a) => a.role === 'customer').map((a) => a.key);
    for (const o of seed.orders) expect(customers).toContain(o.user);
    for (const [key, items] of Object.entries(seed.carts)) {
      expect(customers).toContain(key);
      for (const [productId, qty] of Object.entries(items)) {
        expect(seed.products.some((p) => p.id === productId), productId).toBe(true);
        expect(qty).toBeGreaterThan(0);
      }
    }
  });
});
