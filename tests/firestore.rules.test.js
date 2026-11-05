// Проверка правил безопасности Firestore на эмуляторе.
// Запуск: npm test (эмуляторы поднимаются и гасятся автоматически)
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { buildProduct, loadSeed } from '../scripts/seed-data.js';
import { priceRangeOf } from '../public/js/dictionaries.js';

let env;

const created = Timestamp.fromDate(new Date('2026-10-01'));

const product = {
  name: 'Лопата штыковая',
  categoryId: 'hand',
  supplierId: 's1',
  purpose: 'garden',
  type: 'mini',
  manufacturer: 'GardenPro',
  origin: 'china',
  price: 6900,
  priceRange: 'upTo20k',
  stock: 10,
  createdAt: created,
};
const newProduct = { ...product, createdAt: serverTimestamp() };
const category = { name: 'Ручной инструмент', icon: 'shovel', purpose: 'garden', order: 5 };
const supplier = { name: 'Feldwerk GmbH', brand: 'Feldwerk', country: 'Германия', origin: 'europe' };

const profile = (role, email) => ({ name: 'Тест', email, role, addresses: [] });
const newProfile = (role, email) => ({ ...profile(role, email), createdAt: serverTimestamp() });

// Клиент Firestore от имени пользователя uid (null — гость)
const as = (uid) =>
  (uid ? env.authenticatedContext(uid, { email: `${uid}@test.kz` }) : env.unauthenticatedContext())
    .firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-agrodala',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  // Исходные данные кладём в обход правил
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'categories/hand'), category);
    await setDoc(doc(db, 'products/p1'), product);
    await setDoc(doc(db, 'suppliers/s1'), supplier);
    await setDoc(doc(db, 'users/buyer'), profile('customer', 'buyer@test.kz'));
    await setDoc(doc(db, 'users/other'), profile('customer', 'other@test.kz'));
    await setDoc(doc(db, 'users/content'), profile('content', 'content@test.kz'));
    await setDoc(doc(db, 'users/manager'), profile('manager', 'manager@test.kz'));
    await setDoc(doc(db, 'users/admin'), profile('admin', 'admin@test.kz'));
    await setDoc(doc(db, 'carts/buyer'), { items: { p1: 2 } });
    await setDoc(doc(db, 'carts/other'), { items: { p1: 1 } });
    await setDoc(doc(db, 'orders/o1'), { userId: 'buyer', total: 13800, status: 'new' });
    await setDoc(doc(db, 'orders/o2'), { userId: 'other', total: 6900, status: 'new' });
    await setDoc(doc(db, 'counters/orders'), { last: 2 });
  });
});

// Матрица прав из docs/database.md: кому какое действие разрешено.
// Каждая строка проверяется от имени каждой роли: и разрешение, и запрет
const ROLES = { гость: null, покупатель: 'buyer', менеджер: 'manager', 'контент-менеджер': 'content', администратор: 'admin' };
const ALL = ['гость', 'покупатель', 'менеджер', 'контент-менеджер', 'администратор'];
const SIGNED_IN = ['покупатель', 'менеджер', 'контент-менеджер', 'администратор'];
const CATALOG_EDITORS = ['контент-менеджер', 'администратор'];
const PEOPLE_READERS = ['менеджер', 'администратор'];
const NOBODY = [];

const MATRIX = [
  ['читать товар', (db) => getDoc(doc(db, 'products/p1')), ALL],
  ['читать список товаров', (db) => getDocs(collection(db, 'products')), ALL],
  ['добавлять товар', (db) => setDoc(doc(db, 'products/p2'), newProduct), CATALOG_EDITORS],
  ['менять товар', (db) => updateDoc(doc(db, 'products/p1'), { stock: 5 }), CATALOG_EDITORS],
  ['удалять товар', (db) => deleteDoc(doc(db, 'products/p1')), CATALOG_EDITORS],
  ['читать категорию', (db) => getDoc(doc(db, 'categories/hand')), ALL],
  ['добавлять категорию', (db) => setDoc(doc(db, 'categories/c2'), category), CATALOG_EDITORS],
  ['менять категорию', (db) => updateDoc(doc(db, 'categories/hand'), { order: 9 }), CATALOG_EDITORS],
  ['удалять категорию', (db) => deleteDoc(doc(db, 'categories/hand')), CATALOG_EDITORS],
  ['читать поставщика', (db) => getDoc(doc(db, 'suppliers/s1')), ['менеджер', ...CATALOG_EDITORS]],
  ['добавлять поставщика', (db) => setDoc(doc(db, 'suppliers/s2'), supplier), CATALOG_EDITORS],
  ['менять поставщика', (db) => updateDoc(doc(db, 'suppliers/s1'), { brand: 'FW' }), CATALOG_EDITORS],
  ['читать свой профиль', (db, uid) => getDoc(doc(db, 'users', uid ?? 'nobody')), SIGNED_IN],
  ['менять свой телефон', (db, uid) => updateDoc(doc(db, 'users', uid ?? 'nobody'), { phone: '+77000000001' }), SIGNED_IN],
  ['менять свою роль на администратора', (db, uid) => updateDoc(doc(db, 'users', uid ?? 'nobody'), { role: 'admin' }), ['администратор']],
  ['читать чужой профиль', (db) => getDoc(doc(db, 'users/other')), PEOPLE_READERS],
  ['читать список пользователей', (db) => getDocs(collection(db, 'users')), PEOPLE_READERS],
  ['менять чужую роль', (db) => updateDoc(doc(db, 'users/other'), { role: 'manager' }), ['администратор']],
  ['удалять профиль', (db) => deleteDoc(doc(db, 'users/other')), NOBODY],
  ['читать чужую корзину', (db) => getDoc(doc(db, 'carts/other')), NOBODY],
  ['менять чужую корзину', (db) => setDoc(doc(db, 'carts/other'), { items: {} }), NOBODY],
  ['читать заказ другого покупателя', (db) => getDoc(doc(db, 'orders/o2')), PEOPLE_READERS],
  ['читать все заказы списком', (db) => getDocs(collection(db, 'orders')), PEOPLE_READERS],
  ['создавать заказ', (db, uid) => setDoc(doc(db, 'orders/o3'), { userId: uid ?? 'x', total: 1 }), NOBODY],
  ['менять статус заказа', (db) => updateDoc(doc(db, 'orders/o1'), { status: 'completed' }), NOBODY],
  ['удалять заказ', (db) => deleteDoc(doc(db, 'orders/o1')), NOBODY],
  ['читать служебный счётчик', (db) => getDoc(doc(db, 'counters/orders')), NOBODY],
  ['менять служебный счётчик', (db) => setDoc(doc(db, 'counters/orders'), { last: 0 }), NOBODY],
  ['писать в неописанную коллекцию', (db) => setDoc(doc(db, 'secrets/x'), { a: 1 }), NOBODY],
];

describe.each(MATRIX)('матрица прав: %s', (_name, action, allowed) => {
  it.each(Object.keys(ROLES))('%s', async (role) => {
    const uid = ROLES[role];
    await (allowed.includes(role) ? assertSucceeds : assertFails)(action(as(uid), uid));
  });
});

describe('каталог: проверка данных', () => {
  it('контент-менеджер добавляет товар с датой от сервера', async () => {
    await assertSucceeds(setDoc(doc(as('content'), 'products/p2'), newProduct));
  });

  it('дату добавления нельзя задать самому или изменить', async () => {
    const db = as('content');
    await assertFails(setDoc(doc(db, 'products/p2'), product));
    await assertFails(updateDoc(doc(db, 'products/p1'), { createdAt: Timestamp.now() }));
  });

  it.each([
    ['отрицательная цена', { price: -5, priceRange: 'upTo20k' }],
    ['цена строкой', { price: '6900' }],
    ['дробная цена', { price: 6900.5 }],
    ['неизвестная страна', { origin: 'mars' }],
    ['неизвестное назначение', { purpose: 'space' }],
    ['неизвестный тип', { type: 'huge' }],
    ['отрицательный остаток', { stock: -1 }],
    ['пустое название', { name: '' }],
    ['лишнее поле', { discount: 99 }],
  ])('товар не сохраняется даже у сотрудника: %s', async (_name, change) => {
    await assertFails(setDoc(doc(as('content'), 'products/p3'), { ...newProduct, ...change }));
  });

  it('товар без обязательных полей не сохраняется', async () => {
    await assertFails(setDoc(doc(as('content'), 'products/p3'), { name: 'Без остальных полей' }));
  });

  it('диапазон цены должен соответствовать цене', async () => {
    const db = as('content');
    await assertFails(setDoc(doc(db, 'products/p3'), { ...newProduct, priceRange: 'over500k' }));
    await assertFails(updateDoc(doc(db, 'products/p1'), { price: 25000 }));
    await assertSucceeds(updateDoc(doc(db, 'products/p1'), { price: 25000, priceRange: '20kTo100k' }));
  });

  // Диапазоны заданы и в правилах, и в dictionaries.js: границы должны совпадать
  it.each([19_999, 20_000, 99_999, 100_000, 499_999, 500_000])('граница диапазона: цена %i', async (price) => {
    const wrong = priceRangeOf(price) === 'upTo20k' ? '20kTo100k' : 'upTo20k';
    const db = as('content');
    await assertSucceeds(setDoc(doc(db, 'products/p3'), { ...newProduct, price, priceRange: priceRangeOf(price) }));
    await assertFails(setDoc(doc(db, 'products/p4'), { ...newProduct, price, priceRange: wrong }));
  });

  it('товар нельзя привязать к несуществующей категории или поставщику', async () => {
    const db = as('content');
    await assertFails(setDoc(doc(db, 'products/p3'), { ...newProduct, categoryId: 'nope' }));
    await assertFails(setDoc(doc(db, 'products/p3'), { ...newProduct, supplierId: 'nope' }));
  });

  it('категория и поставщик с неверными данными не сохраняются', async () => {
    const db = as('content');
    await assertFails(setDoc(doc(db, 'categories/c2'), { ...category, purpose: 'space' }));
    await assertFails(setDoc(doc(db, 'categories/c2'), { ...category, order: 'first' }));
    await assertFails(setDoc(doc(db, 'suppliers/s2'), { ...supplier, origin: 'mars' }));
    await assertFails(setDoc(doc(db, 'suppliers/s2'), { name: 'Только название' }));
    await assertSucceeds(setDoc(doc(db, 'suppliers/s2'), supplier));
  });

  it('все тестовые данные проходят правила', async () => {
    const seed = await loadSeed();
    const db = as('content');
    for (const { id, ...c } of seed.categories) await assertSucceeds(setDoc(doc(db, 'categories', id), c));
    for (const { id, ...s } of seed.suppliers) await assertSucceeds(setDoc(doc(db, 'suppliers', id), s));
    for (const p of seed.products) {
      const data = { ...buildProduct(p, seed, { images: [], thumbnail: 'x.jpg' }), createdAt: serverTimestamp() };
      await assertSucceeds(setDoc(doc(db, 'products', p.id), data));
    }
    const snap = await getDocs(collection(db, 'products'));
    expect(snap.size).toBe(seed.products.length + 1); // ещё p1 из подготовки
  });
});

describe('профиль пользователя', () => {
  it('новый пользователь создаёт себе профиль покупателя', async () => {
    await assertSucceeds(setDoc(doc(as('newbie'), 'users/newbie'), newProfile('customer', 'newbie@test.kz')));
  });

  it('при регистрации нельзя назначить себе роль сотрудника', async () => {
    await assertFails(setDoc(doc(as('newbie'), 'users/newbie'), newProfile('admin', 'newbie@test.kz')));
  });

  it('при регистрации нельзя указать чужую почту или свою дату', async () => {
    const db = as('newbie');
    await assertFails(setDoc(doc(db, 'users/newbie'), newProfile('customer', 'boss@test.kz')));
    await assertFails(setDoc(doc(db, 'users/newbie'), { ...profile('customer', 'newbie@test.kz'), createdAt: created }));
  });

  it('нельзя создать профиль другому пользователю', async () => {
    await assertFails(setDoc(doc(as('newbie'), 'users/victim'), newProfile('customer', 'newbie@test.kz')));
  });

  it('покупатель меняет имя и адрес, но не почту', async () => {
    const db = as('buyer');
    await assertSucceeds(updateDoc(doc(db, 'users/buyer'), {
      name: 'Асан',
      addresses: [{ label: 'Дом', city: 'Астана', street: 'ул. Пушкина, 1' }],
    }));
    await assertFails(updateDoc(doc(db, 'users/buyer'), { email: 'boss@test.kz' }));
  });

  it.each([
    ['телефон с буквами', { phone: 'позвонить' }],
    ['слишком длинный телефон', { phone: '1'.repeat(21) }],
    ['шесть адресов', { addresses: Array(6).fill({ city: 'Астана' }) }],
    ['лишнее поле в адресе', { addresses: [{ city: 'Астана', secret: 1 }] }],
    ['слишком длинный адрес', { addresses: [{ street: 'я'.repeat(121) }] }],
    ['адрес не объект', { addresses: ['Астана'] }],
    ['пустое имя', { name: '' }],
    ['лишнее поле в профиле', { isVip: true }],
  ])('неверные данные профиля не сохраняются: %s', async (_name, change) => {
    await assertFails(updateDoc(doc(as('buyer'), 'users/buyer'), change));
  });

  it('администратор назначает только роли из списка и не меняет почту', async () => {
    const db = as('admin');
    await assertSucceeds(updateDoc(doc(db, 'users/other'), { role: 'content' }));
    await assertFails(updateDoc(doc(db, 'users/other'), { role: 'superuser' }));
    await assertFails(updateDoc(doc(db, 'users/other'), { email: 'x@test.kz' }));
  });
});

describe('корзина', () => {
  it('покупатель читает и меняет свою корзину', async () => {
    const db = as('buyer');
    await assertSucceeds(getDoc(doc(db, 'carts/buyer')));
    await assertSucceeds(setDoc(doc(db, 'carts/buyer'), { items: { p1: 3 }, updatedAt: serverTimestamp() }));
    await assertSucceeds(deleteDoc(doc(db, 'carts/buyer')));
  });

  it('в корзину нельзя записать цену или сумму', async () => {
    await assertFails(setDoc(doc(as('buyer'), 'carts/buyer'), { items: { p1: 1 }, total: 1 }));
  });

  it('в корзине не больше 50 позиций', async () => {
    const items = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`p${i}`, 1]));
    await assertFails(setDoc(doc(as('buyer'), 'carts/buyer'), { items }));
  });
});

describe('заказы', () => {
  it('покупатель видит свой заказ', async () => {
    await assertSucceeds(getDoc(doc(as('buyer'), 'orders/o1')));
  });

  it('покупатель получает список только своих заказов', async () => {
    const db = as('buyer');
    const snap = await assertSucceeds(getDocs(query(collection(db, 'orders'), where('userId', '==', 'buyer'))));
    expect(snap.size).toBe(1);
    await assertFails(getDocs(query(collection(db, 'orders'), where('userId', '==', 'other'))));
  });

  it('контент-менеджеру заказы покупателей недоступны', async () => {
    await assertFails(getDoc(doc(as('content'), 'orders/o1')));
  });
});
