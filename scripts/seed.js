// Заполняет ЛОКАЛЬНЫЙ эмулятор Firebase тестовыми данными из папки seed/.
// Запуск: сначала `npm run dev` (эмуляторы), затем в другом терминале `npm run seed`.
// Адреса эмуляторов задаются здесь же, поэтому настоящую базу скрипт не тронет
import { readFile, access } from 'node:fs/promises';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { priceRangeOf } from '../public/js/dictionaries.js';

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

const load = async (name) =>
  JSON.parse(await readFile(new URL(`../seed/${name}.json`, import.meta.url), 'utf8'));

// Учётные записи для проверки ролей. Пароль один на всех — это только эмулятор
const PASSWORD = 'agrodala123';
const ACCOUNTS = [
  { email: 'admin@agrodala.example', name: 'Администратор', role: 'admin' },
  { email: 'manager@agrodala.example', name: 'Менеджер по продажам', role: 'manager' },
  { email: 'content@agrodala.example', name: 'Контент-менеджер', role: 'content' },
  { email: 'buyer@agrodala.example', name: 'Асан Покупатель', role: 'customer', phone: '+7 700 000 00 01',
    addresses: [{ label: 'Дом', city: 'Астана', street: 'ул. Пушкина, 1' }] },
];

async function clearCollection(name) {
  const snapshot = await db.collection(name).get();
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

// Фото товара: seed/images/<id>.jpg (960×720) и <id>-thumb.jpg (480×360) для каталога.
// Загружаются в Cloud Storage, а в базу записываются пути к ним и автор снимка
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
  const [categories, suppliers, products] = await Promise.all(
    ['categories', 'suppliers', 'products'].map(load)
  );
  const credits = JSON.parse(
    await readFile(new URL('../seed/images/credits.json', import.meta.url), 'utf8')
  );

  for (const name of ['categories', 'suppliers', 'products', 'users', 'carts', 'orders']) {
    await clearCollection(name);
  }

  const purposeOf = Object.fromEntries(categories.map((c) => [c.id, c.purpose]));
  const supplierById = Object.fromEntries(suppliers.map((s) => [s.id, s]));

  const batch = db.batch();
  for (const { id, ...category } of categories) {
    batch.set(db.collection('categories').doc(id), category);
  }
  for (const { id, ...supplier } of suppliers) {
    batch.set(db.collection('suppliers').doc(id), supplier);
  }
  // Даты добавления разносим по дням, чтобы работала сортировка «по новизне»
  await bucket.deleteFiles({ prefix: 'products/' });
  const photos = await Promise.all(products.map(({ id }) => uploadPhotos(id)));

  const now = Date.now();
  products.forEach(({ id, ...product }, i) => {
    const supplier = supplierById[product.supplierId];
    const credit = credits[id];
    batch.set(db.collection('products').doc(id), {
      ...product,
      purpose: product.purpose ?? purposeOf[product.categoryId],
      manufacturer: supplier.brand,
      origin: supplier.origin,
      country: supplier.country,
      priceRange: priceRangeOf(product.price),
      ...photos[i],
      ...(credit && {
        imageCredit: { author: credit.author, license: credit.license, source: credit.source },
      }),
      createdAt: Timestamp.fromMillis(now - i * 24 * 60 * 60 * 1000),
    });
  });
  await batch.commit();

  // Пользователи: сначала Authentication (вход), потом профиль с ролью в Firestore
  await auth.deleteUsers((await auth.listUsers()).users.map((u) => u.uid));
  for (const { email, name, role, phone, addresses } of ACCOUNTS) {
    const user = await auth.createUser({ email, password: PASSWORD, displayName: name });
    await db.collection('users').doc(user.uid).set({
      name,
      email,
      role,
      ...(phone && { phone }),
      addresses: addresses ?? [],
      createdAt: Timestamp.now(),
    });
  }

  console.log(
    `Готово: категорий ${categories.length}, поставщиков ${suppliers.length}, ` +
      `товаров ${products.length} (с фото ${photos.filter((p) => p.thumbnail).length}), ` +
      `пользователей ${ACCOUNTS.length} (пароль ${PASSWORD})`
  );
}

main().catch((err) => {
  console.error('Не удалось заполнить базу. Запущены ли эмуляторы (npm run dev)?');
  console.error(err.message);
  process.exit(1);
});
