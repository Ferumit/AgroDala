// Заполняет базу тестовыми данными из папки seed/.
//   npm run seed       — ЛОКАЛЬНЫЙ эмулятор (сначала `npm run dev` в другом терминале);
//   npm run seed:prod  — настоящий проект agrodala (опубликованный сайт), см. ниже.
// Без флага --prod адреса эмуляторов задаются здесь же, поэтому настоящую базу скрипт не тронет.
//
// В облаке фото из тестовых данных не загружаются в Storage, а публикуются вместе с сайтом.
// Для --prod нужен ключ сервисного аккаунта проекта (консоль Firebase → Настройки проекта →
// Сервисные аккаунты) в ~/.config/agrodala/service-account.json или по пути из
// GOOGLE_APPLICATION_CREDENTIALS. Пароль демонстрационных учётных записей в облаке — не
// agrodala123 из README (его видит любой на GitHub), а случайный: он создаётся при первом
// запуске и хранится в ~/.config/agrodala/prod-password. Если в облачной базе уже есть товары,
// скрипт ничего не трогает, пока не добавить --reset (тогда заказы покупателей будут удалены)
import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { ACCOUNTS, PASSWORD, buildCatalogMeta, buildOrder, buildProduct, loadSeed } from './seed-data.js';
import { PORTS } from './emulators.js';

const PROD = process.argv.includes('--prod');
const RESET = process.argv.includes('--reset');
const CONFIG_DIR = `${homedir()}/.config/agrodala`;

const exists = (path) => access(path).then(() => true, () => false);

// Пароль демонстрационных учётных записей в облаке: 16 символов из букв и цифр
async function prodPassword() {
  const file = `${CONFIG_DIR}/prod-password`;
  if (await exists(file)) return (await readFile(file, 'utf8')).trim();
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const password = [...randomBytes(16)].map((b) => alphabet[b % alphabet.length]).join('');
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(file, `${password}\n`, { mode: 0o600 });
  return password;
}

if (PROD) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS ??= `${CONFIG_DIR}/service-account.json`;
  if (!(await exists(process.env.GOOGLE_APPLICATION_CREDENTIALS))) {
    console.error(`Нет ключа сервисного аккаунта: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
    process.exit(1);
  }
  initializeApp({ projectId: 'agrodala', storageBucket: 'agrodala.firebasestorage.app' });
} else {
  process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${PORTS.firestore}`;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${PORTS.auth}`;
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = `127.0.0.1:${PORTS.storage}`;
  // Без этого Admin SDK ищет проект и ключи на сервере метаданных Google Cloud и ждёт тайм-аута
  process.env.GCLOUD_PROJECT = 'demo-agrodala';
  process.env.METADATA_SERVER_DETECTION = 'none';
  initializeApp({ projectId: 'demo-agrodala', storageBucket: 'demo-agrodala.appspot.com' });
}
const db = getFirestore();
const auth = getAuth();
const bucket = getStorage().bucket();
const password = PROD ? await prodPassword() : PASSWORD;

async function clearCollection(name) {
  const snapshot = await db.collection(name).get();
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

// Фото товара: seed/images/<id>.jpg (960×720) и <id>-thumb.jpg (480×360) для каталога.
// Загружаются в Cloud Storage, а в базу записываются пути к ним
// В облаке хранилища нет (тариф Spark), поэтому там фото публикуются вместе с сайтом:
// scripts/copy-photos.js копирует их в public/img/products/ перед публикацией хостинга
async function uploadPhotos(id) {
  const local = (suffix) => new URL(`../seed/images/${id}${suffix}.jpg`, import.meta.url).pathname;
  if (!(await exists(local('')))) return { images: [] };
  if (PROD) return { images: [`img/products/${id}.jpg`], thumbnail: `img/products/${id}-thumb.jpg` };
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

  if (PROD && !RESET && !(await db.collection('products').limit(1).get()).empty) {
    console.error('В облачной базе уже есть данные. Чтобы стереть их и заполнить заново: npm run seed:prod -- --reset');
    process.exit(1);
  }

  for (const name of ['categories', 'suppliers', 'products', 'meta', 'users', 'carts', 'orders', 'counters']) {
    await clearCollection(name);
  }

  const batch = db.batch();
  for (const { id, ...category } of categories) {
    batch.set(db.collection('categories').doc(id), category);
  }
  for (const { id, ...supplier } of suppliers) {
    batch.set(db.collection('suppliers').doc(id), supplier);
  }
  if (!PROD) await bucket.deleteFiles({ prefix: 'products/' });
  const photos = await Promise.all(products.map(({ id }) => uploadPhotos(id)));

  // Даты добавления разносим по дням, чтобы работала сортировка «по новизне»
  const now = Date.now();
  const docs = products.map((product, i) => buildProduct(product, seed, photos[i]));
  docs.forEach((product, i) => {
    batch.set(db.collection('products').doc(products[i].id), {
      ...product,
      createdAt: Timestamp.fromMillis(now - i * 24 * 60 * 60 * 1000),
    });
  });
  batch.set(db.collection('meta').doc('catalog'), { ...buildCatalogMeta(docs), updatedAt: Timestamp.now() });
  await batch.commit();

  // Пользователи: сначала Authentication (вход), потом профиль с ролью в Firestore
  // В облаке удаляются только демонстрационные учётные записи, зарегистрированные посетители остаются
  const existing = (await auth.listUsers()).users;
  const demoEmails = new Set(ACCOUNTS.map((a) => a.email));
  await auth.deleteUsers(existing.filter((u) => !PROD || demoEmails.has(u.email)).map((u) => u.uid));
  const uidOf = {};
  for (const { key, email, name, role, phone, addresses } of ACCOUNTS) {
    const user = await auth.createUser({ email, password, displayName: name });
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
      `пользователей ${ACCOUNTS.length} (пароль ${PROD ? `в ${CONFIG_DIR}/prod-password` : PASSWORD}), ` +
      `заказов ${orders.length}, корзин ${Object.keys(carts).length}`
  );
}

main().catch((err) => {
  console.error(PROD ? 'Не удалось заполнить облачную базу.' : 'Не удалось заполнить базу. Запущены ли эмуляторы (npm run dev)?');
  console.error(err.message);
  process.exit(1);
});
