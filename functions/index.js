// Cloud Functions AgroDala (ТЗ, п. 2.2): операции, которые нельзя доверить браузеру.
//   placeOrder      — оформление заказа: сумма по ценам каталога, резерв товара, номер заказа;
//   setOrderStatus  — смена статуса менеджером (или отмена покупателем нового заказа);
//   importCsv       — импорт товаров и клиентов из Excel (CSV);
//   syncCatalogMeta — список производителей для фильтра при изменении товаров.
// Функции работают через Admin SDK, который не проверяет firestore.rules, поэтому права
// проверяются здесь же: по входу (request.auth) и роли из профиля users/{uid}
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { logger, setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { productFromRecord, parseCsv, toRecords, userFromRecord } from './lib/csv.js';
import { OrderError, checkStatusChange, orderNumber, priceOrder, stockToReturn, validateCheckout } from './lib/orders.js';
import { ORDER_STATUSES } from './shared/dictionaries.js';

// Варшава — ближайший к Казахстану регион Google Cloud с Cloud Functions второго поколения.
// Сайт вызывает функции в этом же регионе (public/js/functions.js)
export const REGION = 'europe-central2';
setGlobalOptions({ region: REGION, maxInstances: 10 });

initializeApp();
const db = getFirestore();

const price = (value) => `${new Intl.NumberFormat('ru-RU').format(value)} ₸`;

async function roleOf(uid) {
  return (await db.doc(`users/${uid}`).get()).get('role') ?? null;
}

function signedInUid(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Войдите в личный кабинет.');
  return request.auth.uid;
}

// Ошибки из lib/ (их текст можно показать покупателю) превращаются в HttpsError —
// браузер получит code, message и details. Остальные ошибки пишутся в журнал,
// а наружу уходит общее сообщение без подробностей устройства системы
function handle(handler) {
  return async (request) => {
    try {
      return await handler(request);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      if (err instanceof OrderError) throw new HttpsError(err.code, err.message, err.details);
      logger.error(err);
      throw new HttpsError('internal', 'Не удалось выполнить операцию. Попробуйте ещё раз.');
    }
  };
}

export const placeOrder = onCall(
  handle(async (request) => {
    const uid = signedInUid(request);
    const checkout = validateCheckout(request.data);
    const { expectedTotal } = request.data ?? {};
    const cartRef = db.doc(`carts/${uid}`);
    const counterRef = db.doc('counters/orders');
    const orderRef = db.collection('orders').doc();

    try {
      // Транзакция: корзина, цены, остатки и номер заказа читаются и записываются как одно целое.
      // Если за это время кто-то купил последний товар или оформил другой заказ,
      // Firestore повторит транзакцию с новыми данными
      return await db.runTransaction(async (tx) => {
        const cart = (await tx.get(cartRef)).data();
        const ids = Object.keys(cart?.items ?? {});
        const snaps = ids.length > 0 ? await tx.getAll(...ids.map((id) => db.doc(`products/${id}`))) : [];
        const counter = (await tx.get(counterRef)).data();
        const products = new Map(snaps.filter((s) => s.exists).map((s) => [s.id, s.data()]));

        const { items, total } = priceOrder(cart?.items, products);
        // Покупатель видел в корзине одну сумму, а цена успела измениться — не оформляем молча
        if (Number.isInteger(expectedTotal) && expectedTotal !== total) {
          throw new OrderError(
            'failed-precondition',
            `Цены изменились: сумма заказа теперь ${price(total)}. Проверьте корзину и оформите заказ ещё раз.`,
            { total }
          );
        }

        const now = Timestamp.now();
        const last = (counter?.last ?? 0) + 1;
        const order = {
          number: orderNumber(last),
          userId: uid,
          items,
          total,
          ...checkout,
          status: 'new',
          statusHistory: [{ status: 'new', at: now, by: uid }],
          createdAt: now,
        };
        for (const item of items.filter((i) => i.fromStock > 0)) {
          const stock = products.get(item.productId).stock - item.fromStock;
          tx.update(db.doc(`products/${item.productId}`), { stock, inStock: stock > 0 });
        }
        tx.set(counterRef, { last });
        tx.set(orderRef, order);
        tx.delete(cartRef);
        logger.info(`Заказ ${order.number}: ${items.length} поз., ${total} ₸`, { uid, orderId: orderRef.id });
        return {
          orderId: orderRef.id,
          number: order.number,
          total,
          backorder: items.some((i) => i.backorder > 0),
        };
      });
    } catch (err) {
      // Товары, которых больше нет в каталоге, убираем из корзины: покупатель увидит актуальную
      for (const id of err.details?.missing ?? []) {
        await cartRef.update({ [`items.${id}`]: FieldValue.delete() }).catch(() => {});
      }
      throw err;
    }
  })
);

export const setOrderStatus = onCall(
  handle(async (request) => {
    const uid = signedInUid(request);
    const { orderId, status } = request.data ?? {};
    if (typeof orderId !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(orderId) || !Object.hasOwn(ORDER_STATUSES, status)) {
      throw new HttpsError('invalid-argument', 'Неизвестный заказ или статус.');
    }
    const role = await roleOf(uid);
    const ref = db.doc(`orders/${orderId}`);

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError('not-found', 'Заказ не найден.');
      const order = snap.data();
      checkStatusChange(order, status, { uid, role });

      // При отмене зарезервированный товар возвращается на склад
      const returns = status === 'cancelled' ? stockToReturn(order) : [];
      const productSnaps = returns.length > 0 ? await tx.getAll(...returns.map((r) => db.doc(`products/${r.productId}`))) : [];
      productSnaps.forEach((product, i) => {
        if (!product.exists) return; // товар удалили из каталога — возвращать некуда
        const stock = product.get('stock') + returns[i].qty;
        tx.update(product.ref, { stock, inStock: stock > 0 });
      });
      tx.update(ref, {
        status,
        statusHistory: FieldValue.arrayUnion({ status, at: Timestamp.now(), by: uid }),
      });
      logger.info(`Заказ ${order.number}: ${order.status} → ${status}`, { uid, role });
      return { status };
    });
  })
);

// Какие роли что импортируют: товары — контент-менеджер и администратор,
// клиентов (персональные данные) — только администратор
const IMPORT_ROLES = { products: ['content', 'admin'], users: ['admin'] };
const MAX_CSV_LENGTH = 2_000_000;

export const importCsv = onCall(
  { timeoutSeconds: 300, memory: '512MiB' },
  handle(async (request) => {
    const uid = signedInUid(request);
    const { kind, csv } = request.data ?? {};
    if (!Object.hasOwn(IMPORT_ROLES, kind)) throw new HttpsError('invalid-argument', 'Неизвестный вид импорта.');
    if (!IMPORT_ROLES[kind].includes(await roleOf(uid))) {
      throw new HttpsError('permission-denied', 'Недостаточно прав для этого импорта.');
    }
    if (typeof csv !== 'string' || csv.length > MAX_CSV_LENGTH) {
      throw new HttpsError('invalid-argument', 'Файл не прочитан или больше 2 МБ.');
    }
    let parsed;
    try {
      parsed = toRecords(parseCsv(csv), kind);
    } catch (err) {
      throw new HttpsError('invalid-argument', err.message);
    }
    const report = kind === 'products' ? await importProducts(parsed.records) : await importUsers(parsed.records);
    logger.info(`Импорт ${kind}: создано ${report.created}, обновлено ${report.updated}, ошибок ${report.errors.length}`, { uid });
    return { ...report, unknownColumns: parsed.unknown };
  })
);

// Товар ищется по коду (столбец «Код»), а без кода — по точному названию: повторная загрузка
// того же файла обновит товары, а не создаст копии. Фото и дата добавления при обновлении сохраняются
async function importProducts(records) {
  const [categoriesSnap, namesSnap] = await Promise.all([
    db.collection('categories').get(),
    db.collection('products').select('name').get(),
  ]);
  const categories = categoriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const idByName = new Map(namesSnap.docs.map((d) => [d.get('name'), d.id]));
  const existing = new Set(namesSnap.docs.map((d) => d.id));

  const errors = [];
  const writes = [];
  const seen = new Set();
  for (const record of records) {
    const result = productFromRecord(record, categories);
    if (result.errors) {
      errors.push({ line: record.line, messages: result.errors });
      continue;
    }
    const id = result.id ?? idByName.get(result.product.name) ?? null;
    if (id && seen.has(id)) {
      errors.push({ line: record.line, messages: ['этот товар уже есть выше в файле'] });
      continue;
    }
    if (id) seen.add(id);
    writes.push({ id, product: result.product, exists: id !== null && existing.has(id) });
  }

  const now = Timestamp.now();
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const { id, product, exists } of writes.slice(i, i + 400)) {
      const ref = id ? db.doc(`products/${id}`) : db.collection('products').doc();
      if (exists) batch.set(ref, product, { merge: true });
      else batch.set(ref, { ...product, createdAt: now });
    }
    await batch.commit();
  }
  const updated = writes.filter((w) => w.exists).length;
  return { created: writes.length - updated, updated, errors };
}

// Клиент получает учётную запись для входа без пароля (пароль он задаст через «Забыли пароль?»)
// и профиль покупателя. Если адрес уже зарегистрирован, обновляются имя, телефон и адрес;
// профили сотрудников импорт не трогает
async function importUsers(records) {
  const auth = getAuth();
  const errors = [];
  const seen = new Set();
  let created = 0;
  let updated = 0;
  for (const record of records) {
    const result = userFromRecord(record);
    if (result.errors) {
      errors.push({ line: record.line, messages: result.errors });
      continue;
    }
    const { email, profile } = result;
    if (seen.has(email)) {
      errors.push({ line: record.line, messages: ['этот адрес уже есть выше в файле'] });
      continue;
    }
    seen.add(email);
    try {
      const user = await auth.getUserByEmail(email).catch((err) => {
        if (err.code === 'auth/user-not-found') return null;
        throw err;
      });
      if (user) {
        const ref = db.doc(`users/${user.uid}`);
        const current = (await ref.get()).data();
        if (current && current.role !== 'customer') {
          errors.push({ line: record.line, messages: ['это адрес сотрудника — профиль не изменён'] });
          continue;
        }
        const { name, phone, addresses } = profile;
        await ref.set(
          current ? { name, ...(phone && { phone }), addresses } : { ...profile, createdAt: Timestamp.now() },
          { merge: true }
        );
        updated++;
      } else {
        const { uid } = await auth.createUser({ email, displayName: profile.name });
        await db.doc(`users/${uid}`).set({ ...profile, createdAt: Timestamp.now() });
        created++;
      }
    } catch (err) {
      logger.warn(`Импорт клиента, строка ${record.line}`, err);
      errors.push({ line: record.line, messages: ['не удалось сохранить, попробуйте ещё раз'] });
    }
  }
  return { created, updated, errors };
}

// Список производителей для блока фильтров (docs/database.md, коллекция meta).
// Пересчитывается, только когда товар добавлен, удалён или у него сменился производитель
export const syncCatalogMeta = onDocumentWritten('products/{productId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (before && after && before.manufacturer === after.manufacturer) return;
  const snap = await db.collection('products').select('manufacturer').get();
  const manufacturers = [...new Set(snap.docs.map((d) => d.get('manufacturer')).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  await db.doc('meta/catalog').set({ manufacturers, updatedAt: FieldValue.serverTimestamp() });
});
