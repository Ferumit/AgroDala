// Логика Cloud Functions без эмулятора: проверка формы заказа, расчёт суммы и резерва,
// права на смену статуса, разбор CSV из Excel. Сами функции с базой проверяет tests/functions.test.js
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkStatusChange,
  orderNumber,
  priceOrder,
  stockToReturn,
  validateCheckout,
} from '../functions/lib/orders.js';
import { parseCsv, productFromRecord, toRecords, userFromRecord } from '../functions/lib/csv.js';
import { nextStatuses } from '../public/js/dictionaries.js';
import { loadSeed } from '../scripts/seed-data.js';
import { SHARED } from '../scripts/sync-shared.js';

const checkout = (patch = {}) => ({
  contact: { name: 'Нурлан', phone: '+7 700 123 45 67' },
  delivery: { method: 'pickup' },
  ...patch,
});

describe('общие модули сайта и функций', () => {
  it.each(SHARED)('functions/shared/%s совпадает с public/js (npm run dev обновляет копию)', (file) => {
    expect(readFileSync(`functions/shared/${file}`, 'utf8')).toBe(readFileSync(`public/js/${file}`, 'utf8'));
  });
});

describe('данные оформления заказа', () => {
  it('самовывоз: адрес не нужен и не сохраняется', () => {
    const result = validateCheckout(checkout({ delivery: { method: 'pickup', address: 'лишний' }, comment: '  ' }));
    expect(result).toEqual({ contact: { name: 'Нурлан', phone: '+7 700 123 45 67' }, delivery: { method: 'pickup' } });
  });

  it('доставка без адреса не принимается', () => {
    expect(() => validateCheckout(checkout({ delivery: { method: 'delivery', address: ' ' } }))).toThrow(/адрес доставки/);
  });

  it.each([
    ['пустое имя', { contact: { name: '', phone: '+7 700 123 45 67' } }, /имя/],
    ['телефон из букв', { contact: { name: 'А', phone: 'позвоните' } }, /телефон/],
    ['короткий телефон', { contact: { name: 'А', phone: '12-34' } }, /телефон/],
    ['неизвестный способ получения', { delivery: { method: 'drone' } }, /способ получения/],
    ['комментарий длиннее 500', { comment: 'а'.repeat(501) }, /комментарий/],
  ])('%s', (_, patch, message) => {
    expect(() => validateCheckout(checkout(patch))).toThrow(message);
  });
});

describe('расчёт заказа', () => {
  const products = new Map([
    ['a', { name: 'Лопата', price: 4500, stock: 10 }],
    ['b', { name: 'Мотоблок', price: 289000, stock: 1 }],
    ['c', { name: 'Плуг', price: 120000, stock: 0 }],
  ]);

  it('цены берутся из каталога, остаток резервируется, нехватка — под заказ', () => {
    const { items, total } = priceOrder({ a: 2, b: 3, c: 1 }, products);
    expect(total).toBe(2 * 4500 + 3 * 289000 + 120000);
    expect(items).toEqual([
      { productId: 'a', name: 'Лопата', price: 4500, qty: 2, fromStock: 2, backorder: 0 },
      { productId: 'b', name: 'Мотоблок', price: 289000, qty: 3, fromStock: 1, backorder: 2 },
      { productId: 'c', name: 'Плуг', price: 120000, qty: 1, fromStock: 0, backorder: 1 },
    ]);
  });

  it('пустая корзина, неверное количество и удалённый товар', () => {
    expect(() => priceOrder({}, products)).toThrow(/пуста/);
    expect(() => priceOrder({ a: 0 }, products)).toThrow(/от 1 до 99/);
    expect(() => priceOrder({ a: 1.5 }, products)).toThrow(/от 1 до 99/);
    expect(() => priceOrder({ a: 100 }, products)).toThrow(/от 1 до 99/);
    try {
      priceOrder({ a: 1, gone: 1 }, products);
      expect.unreachable();
    } catch (err) {
      expect(err.code).toBe('failed-precondition');
      expect(err.details).toEqual({ missing: ['gone'] });
    }
  });

  it('номер заказа и возврат резерва при отмене', () => {
    expect(orderNumber(9)).toBe('AD-000009');
    expect(stockToReturn({ items: [{ productId: 'a', fromStock: 2 }, { productId: 'c', fromStock: 0 }, { productId: 'd' }] }))
      .toEqual([{ productId: 'a', qty: 2 }]);
  });
});

describe('смена статуса заказа', () => {
  const order = { userId: 'buyer', status: 'new', delivery: { method: 'pickup' } };

  it('ход заказа зависит от способа получения', () => {
    expect(nextStatuses('picking', 'delivery')).toEqual(['shipped', 'cancelled']);
    expect(nextStatuses('picking', 'pickup')).toEqual(['readyForPickup', 'cancelled']);
    expect(nextStatuses('completed', 'pickup')).toEqual([]);
  });

  it('менеджер ведёт заказ только по порядку', () => {
    expect(() => checkStatusChange(order, 'confirmed', { uid: 'm', role: 'manager' })).not.toThrow();
    expect(() => checkStatusChange(order, 'completed', { uid: 'm', role: 'manager' })).toThrow(/другом статусе/);
  });

  it('покупатель может только отменить свой новый заказ', () => {
    expect(() => checkStatusChange(order, 'cancelled', { uid: 'buyer', role: 'customer' })).not.toThrow();
    expect(() => checkStatusChange(order, 'confirmed', { uid: 'buyer', role: 'customer' })).toThrow(/прав/);
    expect(() => checkStatusChange(order, 'cancelled', { uid: 'other', role: 'customer' })).toThrow(/прав/);
    expect(() => checkStatusChange({ ...order, status: 'confirmed' }, 'cancelled', { uid: 'buyer', role: 'customer' }))
      .toThrow(/через менеджера/);
    // Контент-менеджер заказы не ведёт
    expect(() => checkStatusChange(order, 'confirmed', { uid: 'c', role: 'content' })).toThrow(/прав/);
  });
});

describe('разбор CSV из Excel', () => {
  it('точка с запятой, кавычки, BOM, переносы строк Windows и пустые строки', () => {
    const csv = '﻿Название;Описание\r\nЛопата;"Сталь; черенок ""берёза"""\r\n;\r\nГрабли;"две\nстроки"\r\n';
    expect(parseCsv(csv)).toEqual([['Название', 'Описание'], ['Лопата', 'Сталь; черенок "берёза"'], ['Грабли', 'две\nстроки']]);
  });

  it('разделитель — запятая, если в заголовке запятых больше', () => {
    expect(parseCsv('name,price\nЛопата,4500')).toEqual([['name', 'price'], ['Лопата', '4500']]);
  });

  it('заголовки по-русски или как поля базы; без обязательного столбца — ошибка', () => {
    const { records, unknown } = toRecords(parseCsv('Имя;E-mail;Скидка\nАйгерим;a@b.kz;5'), 'users');
    expect(records).toEqual([{ line: 2, values: { name: 'Айгерим', email: 'a@b.kz' } }]);
    expect(unknown).toEqual(['Скидка']);
    expect(() => toRecords(parseCsv('Имя;Телефон\nА;1'), 'users')).toThrow(/«Email»/);
  });

  it('примеры из панели загружаются без ошибок', async () => {
    const { categories } = await loadSeed();
    const products = toRecords(parseCsv(readFileSync('public/import/tovary-primer.csv', 'utf8')), 'products');
    const parsed = products.records.map((r) => productFromRecord(r, categories));
    expect(parsed.filter((p) => p.errors)).toEqual([]);
    // Назначение не указано → берётся из категории; цена «3 200» → 3200
    expect(parsed[1].product).toMatchObject({ categoryId: 'watering', purpose: 'general', price: 3200, inStock: true });
    expect(parsed[2].product).toMatchObject({ origin: 'europe', stock: 0, inStock: false, priceRange: 'upTo20k' });

    const users = toRecords(parseCsv(readFileSync('public/import/klienty-primer.csv', 'utf8')), 'users');
    expect(users.records.map(userFromRecord).filter((u) => u.errors)).toEqual([]);
  });

  it('строка товара с ошибками: все ошибки сразу, с понятным текстом', async () => {
    const { categories } = await loadSeed();
    const { errors } = productFromRecord(
      { values: { name: 'Плуг', category: 'Космос', type: 'heavy', manufacturer: 'X', origin: 'Марс', price: '12,5' } },
      categories
    );
    expect(errors).toHaveLength(3);
    expect(errors.join(' ')).toMatch(/категория «Космос».*происхождение «Марс».*цена «12,5»/);
  });

  it('клиент: почта приводится к нижнему регистру, адрес — в профиль', () => {
    const { profile } = userFromRecord({ values: { name: 'Ержан', email: 'Erzhan@Mail.KZ', city: 'Караганда', street: '' } });
    expect(profile).toEqual({
      name: 'Ержан',
      email: 'erzhan@mail.kz',
      role: 'customer',
      addresses: [{ label: 'Основной', city: 'Караганда', street: '' }],
    });
    expect(userFromRecord({ values: { name: '', email: 'нет' } }).errors).toHaveLength(2);
  });
});
