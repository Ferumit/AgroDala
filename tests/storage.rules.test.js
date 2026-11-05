// Проверка правил безопасности Cloud Storage (фотографии товаров).
// Роль берётся из Firestore, поэтому в тесте работают оба эмулятора
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

let env;

const image = { contentType: 'image/jpeg' };
const small = new Uint8Array(1024);
const PHOTO = 'products/p1/main.jpg';

const as = (uid) =>
  (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-agrodala',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });
});

afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, role] of Object.entries({ buyer: 'customer', manager: 'manager', content: 'content', admin: 'admin' })) {
      await setDoc(doc(db, 'users', uid), { name: 'Тест', email: `${uid}@test.kz`, role });
    }
    await uploadBytes(ref(ctx.storage(), PHOTO), small, image);
    await uploadBytes(ref(ctx.storage(), 'private/report.pdf'), small, { contentType: 'application/pdf' });
  });
});

describe('фотографии товаров', () => {
  it('фото товара видит любой посетитель', async () => {
    await assertSucceeds(getBytes(ref(as(null), PHOTO)));
    await assertSucceeds(getBytes(ref(as('buyer'), PHOTO)));
  });

  it.each([
    ['гость', null],
    ['покупатель', 'buyer'],
    ['менеджер по продажам', 'manager'],
    ['пользователь без профиля', 'nobody'],
  ])('%s не загружает и не удаляет фото', async (_name, uid) => {
    await assertFails(uploadBytes(ref(as(uid), 'products/p1/new.jpg'), small, image));
    await assertFails(deleteObject(ref(as(uid), PHOTO)));
  });

  it.each([
    ['контент-менеджер', 'content'],
    ['администратор', 'admin'],
  ])('%s загружает и удаляет фото', async (_name, uid) => {
    await assertSucceeds(uploadBytes(ref(as(uid), 'products/p1/new.jpg'), small, image));
    await assertSucceeds(deleteObject(ref(as(uid), 'products/p1/new.jpg')));
  });

  it('можно загрузить только изображение', async () => {
    await assertFails(uploadBytes(ref(as('content'), 'products/p1/virus.exe'), small, { contentType: 'application/octet-stream' }));
    await assertFails(uploadBytes(ref(as('content'), 'products/p1/page.html'), small, { contentType: 'text/html' }));
  });

  it('файл не больше 5 МБ', async () => {
    const limit = 5 * 1024 * 1024;
    await assertSucceeds(uploadBytes(ref(as('content'), 'products/p1/ok.jpg'), new Uint8Array(limit - 1), image));
    await assertFails(uploadBytes(ref(as('content'), 'products/p1/big.jpg'), new Uint8Array(limit), image));
  });

  it('вне папки products/ закрыто для всех', async () => {
    await assertFails(getBytes(ref(as(null), 'private/report.pdf')));
    await assertFails(getBytes(ref(as('admin'), 'private/report.pdf')));
    await assertFails(uploadBytes(ref(as('admin'), 'private/new.jpg'), small, image));
  });
});
