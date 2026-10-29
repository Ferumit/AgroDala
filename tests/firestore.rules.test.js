// Проверка правил безопасности Firestore на эмуляторе.
// Запуск: npm test (эмулятор Firestore поднимается и гасится автоматически)
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

let env;

const product = {
  name: 'Лопата штыковая',
  categoryId: 'hand',
  purpose: 'garden',
  type: 'mini',
  manufacturer: 'GardenPro',
  origin: 'china',
  price: 6900,
  priceRange: 'upTo20k',
  stock: 10,
};

const profile = (role, email) => ({ name: 'Тест', email, role, addresses: [] });

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
    await setDoc(doc(db, 'products/p1'), product);
    await setDoc(doc(db, 'suppliers/s1'), { name: 'Feldwerk GmbH' });
    await setDoc(doc(db, 'users/buyer'), profile('customer', 'buyer@test.kz'));
    await setDoc(doc(db, 'users/other'), profile('customer', 'other@test.kz'));
    await setDoc(doc(db, 'users/content'), profile('content', 'content@test.kz'));
    await setDoc(doc(db, 'users/manager'), profile('manager', 'manager@test.kz'));
    await setDoc(doc(db, 'carts/buyer'), { items: { p1: 2 } });
    await setDoc(doc(db, 'orders/o1'), { userId: 'buyer', total: 13800, status: 'new' });
  });
});

describe('каталог', () => {
  it('гость читает товары', async () => {
    await assertSucceeds(getDoc(doc(as(null), 'products/p1')));
  });

  it('гость и покупатель не меняют товары', async () => {
    await assertFails(setDoc(doc(as(null), 'products/p2'), product));
    await assertFails(updateDoc(doc(as('buyer'), 'products/p1'), { price: 1 }));
    await assertFails(deleteDoc(doc(as('buyer'), 'products/p1')));
  });

  it('контент-менеджер добавляет и меняет товары', async () => {
    await assertSucceeds(setDoc(doc(as('content'), 'products/p2'), product));
    await assertSucceeds(updateDoc(doc(as('content'), 'products/p1'), { price: 7500 }));
  });

  it('менеджер по продажам каталог не меняет', async () => {
    await assertFails(updateDoc(doc(as('manager'), 'products/p1'), { price: 7500 }));
  });

  it('товар с неверными данными не сохраняется даже у сотрудника', async () => {
    const db = as('content');
    await assertFails(setDoc(doc(db, 'products/p3'), { ...product, price: -5 }));
    await assertFails(setDoc(doc(db, 'products/p3'), { ...product, price: '6900' }));
    await assertFails(setDoc(doc(db, 'products/p3'), { ...product, origin: 'mars' }));
    await assertFails(setDoc(doc(db, 'products/p3'), { name: 'Без остальных полей' }));
  });

  it('поставщиков видят сотрудники, но не покупатели', async () => {
    await assertFails(getDoc(doc(as('buyer'), 'suppliers/s1')));
    await assertSucceeds(getDoc(doc(as('manager'), 'suppliers/s1')));
  });
});

describe('профиль пользователя', () => {
  it('новый пользователь создаёт себе профиль покупателя', async () => {
    await assertSucceeds(setDoc(doc(as('newbie'), 'users/newbie'), profile('customer', 'newbie@test.kz')));
  });

  it('при регистрации нельзя назначить себе роль сотрудника', async () => {
    await assertFails(setDoc(doc(as('newbie'), 'users/newbie'), profile('admin', 'newbie@test.kz')));
  });

  it('покупатель меняет имя и телефон, но не роль', async () => {
    const db = as('buyer');
    await assertSucceeds(updateDoc(doc(db, 'users/buyer'), { name: 'Асан', phone: '+77000000001' }));
    await assertFails(updateDoc(doc(db, 'users/buyer'), { role: 'admin' }));
  });

  it('чужой профиль не прочитать, менеджер — может', async () => {
    await assertFails(getDoc(doc(as('other'), 'users/buyer')));
    await assertSucceeds(getDoc(doc(as('manager'), 'users/buyer')));
  });
});

describe('корзина', () => {
  it('покупатель читает и меняет свою корзину', async () => {
    const db = as('buyer');
    await assertSucceeds(getDoc(doc(db, 'carts/buyer')));
    await assertSucceeds(setDoc(doc(db, 'carts/buyer'), { items: { p1: 3 } }));
  });

  it('чужая корзина недоступна', async () => {
    await assertFails(getDoc(doc(as('other'), 'carts/buyer')));
    await assertFails(setDoc(doc(as('other'), 'carts/buyer'), { items: {} }));
  });

  it('в корзину нельзя записать цену', async () => {
    await assertFails(setDoc(doc(as('buyer'), 'carts/buyer'), { items: { p1: 1 }, total: 1 }));
  });
});

describe('заказы', () => {
  it('покупатель видит свой заказ, но не чужой', async () => {
    await assertSucceeds(getDoc(doc(as('buyer'), 'orders/o1')));
    await assertFails(getDoc(doc(as('other'), 'orders/o1')));
  });

  it('менеджер видит заказы покупателей', async () => {
    await assertSucceeds(getDoc(doc(as('manager'), 'orders/o1')));
  });

  it('из браузера заказ не создать и статус не поменять — только Cloud Functions', async () => {
    await assertFails(setDoc(doc(as('buyer'), 'orders/o2'), { userId: 'buyer', total: 1 }));
    await assertFails(updateDoc(doc(as('buyer'), 'orders/o1'), { status: 'completed' }));
    await assertFails(updateDoc(doc(as('manager'), 'orders/o1'), { status: 'confirmed' }));
  });
});
