// Cloud Functions на эмуляторе: вызовы идут так же, как из браузера (клиентская библиотека Firebase
// от имени вошедшего пользователя), а результат проверяется прямо в базе через Admin SDK.
// Запуск: npm test (эмуляторы auth, firestore, functions поднимаются автоматически)
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp as deleteClientApp, initializeApp as initializeClientApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { PORTS } from '../scripts/emulators.js';

const PROJECT = 'demo-agrodala'; // функции эмулятор запускает только в этом проекте
const PASSWORD = 'functions-test';
process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${PORTS.firestore}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${PORTS.auth}`;
// Без этого Admin SDK ищет проект на сервере метаданных Google Cloud и ждёт тайм-аута
process.env.METADATA_SERVER_DETECTION = 'none';

const admin = initializeApp({ projectId: PROJECT }, 'functions-test');
const db = getFirestore(admin);
const auth = getAdminAuth(admin);
const clientApps = [];
const uid = {};

// Функция от имени пользователя key (null — гость)
async function caller(key) {
  const app = initializeClientApp({ projectId: PROJECT, apiKey: 'demo-key' }, `client-${clientApps.length}`);
  clientApps.push(app);
  if (key) {
    const clientAuth = getAuth(app);
    connectAuthEmulator(clientAuth, `http://127.0.0.1:${PORTS.auth}`, { disableWarnings: true });
    await signInWithEmailAndPassword(clientAuth, `${key}@test.kz`, PASSWORD);
  }
  const functions = getFunctions(app, 'europe-central2');
  connectFunctionsEmulator(functions, '127.0.0.1', PORTS.functions);
  return (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);
}

const call = {};
const product = async (id) => (await db.doc(`products/${id}`).get()).data();
const checkout = { contact: { name: 'Покупатель', phone: '+7 700 123 45 67' }, delivery: { method: 'pickup' } };

beforeAll(async () => {
  const emulator = (port, path) => fetch(`http://127.0.0.1:${port}/emulator/v1/projects/${PROJECT}/${path}`, { method: 'DELETE' });
  await emulator(PORTS.firestore, 'databases/(default)/documents');
  await emulator(PORTS.auth, 'accounts');

  for (const [key, role] of [['buyer', 'customer'], ['manager', 'manager'], ['content', 'content'], ['admin', 'admin']]) {
    const user = await auth.createUser({ email: `${key}@test.kz`, password: PASSWORD });
    uid[key] = user.uid;
    await db.doc(`users/${user.uid}`).set({ name: key, email: `${key}@test.kz`, role, createdAt: Timestamp.now() });
  }
  const batch = db.batch();
  batch.set(db.doc('categories/hand'), { name: 'Ручной садовый инструмент', icon: 'shovel', purpose: 'garden', order: 1 });
  batch.set(db.doc('categories/watering'), { name: 'Полив и опрыскивание', icon: 'droplets', purpose: 'general', order: 2 });
  batch.set(db.doc('products/lopata'), { name: 'Лопата', manufacturer: 'GardenPro', categoryId: 'hand', price: 4500, stock: 3, inStock: true });
  batch.set(db.doc('products/plug'), { name: 'Плуг', manufacturer: 'Agripol', categoryId: 'hand', price: 100000, stock: 0, inStock: false });
  batch.set(db.doc('counters/orders'), { last: 41 });
  await batch.commit();

  for (const key of ['buyer', 'manager', 'content', 'admin']) call[key] = await caller(key);
  call.guest = await caller(null);
});

afterAll(async () => {
  await Promise.all(clientApps.map(deleteClientApp));
  await deleteApp(admin);
});

describe('оформление заказа (placeOrder)', () => {
  it('гость заказ не оформит', async () => {
    await expect(call.guest('placeOrder', checkout)).rejects.toMatchObject({ code: 'functions/unauthenticated' });
  });

  let orderId;

  it('сумма — по ценам каталога, товар резервируется, номер выдаётся по порядку, корзина очищается', async () => {
    await db.doc(`carts/${uid.buyer}`).set({ items: { lopata: 2, plug: 1 } });
    const result = await call.buyer('placeOrder', { ...checkout, expectedTotal: 109000 });
    expect(result).toMatchObject({ number: 'AD-000042', total: 109000, backorder: true });
    orderId = result.orderId;

    const order = (await db.doc(`orders/${orderId}`).get()).data();
    expect(order).toMatchObject({ userId: uid.buyer, status: 'new', total: 109000, delivery: { method: 'pickup' } });
    expect(order.items).toEqual([
      { productId: 'lopata', name: 'Лопата', price: 4500, qty: 2, fromStock: 2, backorder: 0 },
      { productId: 'plug', name: 'Плуг', price: 100000, qty: 1, fromStock: 0, backorder: 1 },
    ]);
    expect(order.statusHistory).toHaveLength(1);
    expect(await product('lopata')).toMatchObject({ stock: 1, inStock: true });
    expect((await db.doc(`carts/${uid.buyer}`).get()).exists).toBe(false);
  });

  it('цена изменилась, пока покупатель смотрел корзину, — заказ не создаётся', async () => {
    await db.doc(`carts/${uid.buyer}`).set({ items: { lopata: 1 } });
    await expect(call.buyer('placeOrder', { ...checkout, expectedTotal: 4000 })).rejects.toMatchObject({
      code: 'functions/failed-precondition',
      message: expect.stringMatching(/4\s500 ₸/),
    });
    expect((await db.collection('orders').get()).size).toBe(1);
  });

  it('статусы: менеджер ведёт заказ по порядку, покупатель только отменяет новый', async () => {
    await expect(call.buyer('setOrderStatus', { orderId, status: 'confirmed' })).rejects.toMatchObject({
      code: 'functions/permission-denied',
    });
    await call.manager('setOrderStatus', { orderId, status: 'confirmed' });
    await expect(call.manager('setOrderStatus', { orderId, status: 'completed' })).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    await expect(call.buyer('setOrderStatus', { orderId, status: 'cancelled' })).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    const order = (await db.doc(`orders/${orderId}`).get()).data();
    expect(order.status).toBe('confirmed');
    expect(order.statusHistory.map((h) => [h.status, h.by])).toEqual([['new', uid.buyer], ['confirmed', uid.manager]]);
  });

  it('отмена нового заказа покупателем возвращает резерв на склад', async () => {
    const { orderId: second } = await call.buyer('placeOrder', checkout); // в корзине лопата, 1 шт.
    expect(await product('lopata')).toMatchObject({ stock: 0, inStock: false });
    await call.buyer('setOrderStatus', { orderId: second, status: 'cancelled' });
    expect(await product('lopata')).toMatchObject({ stock: 1, inStock: true });
  });
});

describe('импорт из CSV (importCsv)', () => {
  const productsCsv = readFileSync('public/import/tovary-primer.csv', 'utf8');
  const usersCsv = readFileSync('public/import/klienty-primer.csv', 'utf8');

  it('товары: покупатель не может, контент-менеджер загружает и повторно обновляет', async () => {
    await expect(call.buyer('importCsv', { kind: 'products', csv: productsCsv })).rejects.toMatchObject({
      code: 'functions/permission-denied',
    });
    expect(await call.content('importCsv', { kind: 'products', csv: productsCsv })).toMatchObject({ created: 3, updated: 0, errors: [] });
    expect(await product('vily-4-zuba')).toMatchObject({ categoryId: 'hand', price: 6500, priceRange: 'upTo20k', inStock: true });
    expect(await call.content('importCsv', { kind: 'products', csv: productsCsv })).toMatchObject({ created: 0, updated: 3 });
  });

  it('список производителей для фильтра обновляет триггер syncCatalogMeta', async () => {
    await expect
      .poll(async () => (await db.doc('meta/catalog').get()).get('manufacturers'), { timeout: 10_000 })
      .toEqual(['Agripol', 'Feldwerk', 'GardenPro']);
  });

  it('клиенты: только администратор; клиент получает вход по почте и профиль покупателя', async () => {
    await expect(call.content('importCsv', { kind: 'users', csv: usersCsv })).rejects.toMatchObject({
      code: 'functions/permission-denied',
    });
    expect(await call.admin('importCsv', { kind: 'users', csv: usersCsv })).toMatchObject({ created: 3, updated: 0, errors: [] });
    const user = await auth.getUserByEmail('aigerim.saparova@example.kz');
    expect((await db.doc(`users/${user.uid}`).get()).data()).toMatchObject({
      role: 'customer',
      addresses: [{ label: 'Основной', city: 'Астана', street: 'ул. Кенесары, 40, кв. 12' }],
    });
    expect(await call.admin('importCsv', { kind: 'users', csv: usersCsv })).toMatchObject({ created: 0, updated: 3 });
  });

  it('ошибки в файле: понятный текст с номером строки, остальные строки загружаются', async () => {
    const csv = 'Название;Категория;Тип;Производитель;Происхождение;Цена\nГрабли;hand;mini;Terrano;Европа;5900\nКосмолёт;hand;mini;X;Марс;1';
    const result = await call.content('importCsv', { kind: 'products', csv });
    expect(result).toMatchObject({ created: 1, errors: [{ line: 3, messages: [expect.stringMatching(/Марс/)] }] });
  });
});
