// Заполняет ЛОКАЛЬНЫЙ эмулятор Firebase тестовыми данными из папки seed/.
// Запуск: сначала `npm run dev` (эмуляторы), затем в другом терминале `npm run seed`.
// Адреса эмуляторов задаются здесь же, поэтому настоящую базу скрипт не тронет
import { access } from 'node:fs/promises';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { ACCOUNTS, PASSWORD, buildOrder, buildProduct, loadSeed } from './seed-data.js';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
// Без этого Admin SDK ищет проект и ключи на сервере метаданных Google Cloud и ждёт тайм-аута
process.env.GCLOUD_PROJECT = 'demo-agrodala';
process.env.METADATA_SERVER_DETECTION = 'none';

initializeApp({ projectId: 'demo-agrodala', storageBucket: 'demo-agrodala.appspot.com' });
const db = getFirestore();
const auth = getAuth();
const bucket = getStorage().bucket();

async function clearCollection(name) {
  const snapshot = await db.collection(name).get();
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

// Фото товара: seed/images/<id>.jpg (960×720) и <id>-thumb.jpg (480×360) для каталога.
// Загружаются в Cloud Storage, а в базу записываются пути к ним
const exists = (path) => access(path).then(() => true, () => false);

async function uploadPhotos(id) {
  const local = (suffix) => new URL(`../seed/images/${id}${suffix}.jpg`, import.meta.url).pathname;
  if (!(await exists(local('')))) return { images: [] };
  const upload = (suffix, name) =>
    bucket.upload(local(suffix), {
      destination: `products/${id}/${name}`,
      metadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=86400' },
    });
  await Promise.all([upload('', 'main.jpg'), upload('-thumb', 'thumb.jpg')]);
  return { images: [`products/${id}/main.jpg`], thumbnail: `products/${id}/thumb.jpg` };
}

async function main() {
  const seed = await loadSeed();
  const { categories, suppliers, products, orders, carts } = seed;

  for (const name of ['categories', 'suppliers', 'products', 'users', 'carts', 'orders', 'counters']) {
    await clearCollection(name);
  }

  const batch = db.batch();
  for (const { id, ...category } of categories) {
    batch.set(db.collection('categories').doc(id), category);
  }
  for (const { id, ...supplier } of suppliers) {
    batch.set(db.collection('suppliers').doc(id), supplier);
  }
  await bucket.deleteFiles({ prefix: 'products/' });
  const photos = await Promise.all(products.map(({ id }) => uploadPhotos(id)));

  // Даты добавления разносим по дням, чтобы работала сортировка «по новизне»
  const now = Date.now();
  products.forEach((product, i) => {
    batch.set(db.collection('products').doc(product.id), {
      ...buildProduct(product, seed, photos[i]),
      createdAt: Timestamp.fromMillis(now - i * 24 * 60 * 60 * 1000),
    });
  });
  await batch.commit();

  // Пользователи: сначала Authentication (вход), потом профиль с ролью в Firestore
  await auth.deleteUsers((await auth.listUsers()).users.map((u) => u.uid));
  const uidOf = {};
  for (const { key, email, name, role, phone, addresses } of ACCOUNTS) {
    const user = await auth.createUser({ email, password: PASSWORD, displayName: name });
    uidOf[key] = user.uid;
    await db.collection('users').doc(user.uid).set({
      name,
      email,
      role,
      ...(phone && { phone }),
      addresses: addresses ?? [],
      createdAt: Timestamp.now(),
    });
  }

  // Демонстрационные заказы и корзины (ТЗ, п. 2.5) зависят от uid, поэтому идут после пользователей
  const ordersBatch = db.batch();
  for (const order of orders) {
    ordersBatch.set(db.collection('orders').doc(), buildOrder(order, { products, uidOf, now }));
  }
  ordersBatch.set(db.collection('counters').doc('orders'), { last: orders.length });
  for (const [key, items] of Object.entries(carts)) {
    ordersBatch.set(db.collection('carts').doc(uidOf[key]), { items, updatedAt: Timestamp.now() });
  }
  await ordersBatch.commit();

  console.log(
    `Готово: категорий ${categories.length}, поставщиков ${suppliers.length}, ` +
      `товаров ${products.length} (с фото ${photos.filter((p) => p.thumbnail).length}), ` +
      `пользователей ${ACCOUNTS.length} (пароль ${PASSWORD}), ` +
      `заказов ${orders.length}, корзин ${Object.keys(carts).length}`
  );
}

main().catch((err) => {
  console.error('Не удалось заполнить базу. Запущены ли эмуляторы (npm run dev)?');
  console.error(err.message);
  process.exit(1);
});
