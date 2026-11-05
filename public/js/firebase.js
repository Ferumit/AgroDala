// Подключение к Firebase. Версия SDK указана в одном месте — здесь;
// остальные модули берут функции Firestore и Authentication через этот файл
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import {
  getFirestore,
  connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';

export * from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
export * from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';

// Сайт открыт с этого компьютера (npm run dev) или с телефона по адресу домашней сети
// либо Tailscale (npm run dev:phone) → работаем с локальными эмуляторами на этом же адресе
const isLoopback = ['localhost', '127.0.0.1'].includes(location.hostname);
const isPrivateNetwork =
  /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(location.hostname);
const isLocal = isLoopback || isPrivateNetwork;
const emulatorHost = isLoopback ? '127.0.0.1' : location.hostname;

// Настоящий проект Firebase подключается на этапе публикации (неделя 6 по ТЗ)
const productionConfig = null;

if (!isLocal && !productionConfig) {
  throw new Error('Проект Firebase для публикации ещё не настроен');
}

const app = initializeApp(
  isLocal
    ? {
        projectId: 'demo-agrodala',
        apiKey: 'demo-key',
        authDomain: 'demo-agrodala.firebaseapp.com',
        storageBucket: 'demo-agrodala.appspot.com',
      }
    : productionConfig
);

export const db = getFirestore(app);
// Не getAuth(): он подключает вход через всплывающие окна, а для него на телефонах и в Safari
// сразу загружает iframe. Вход у нас только по почте и паролю, поэтому iframe не нужен.
// С getAuth() при мобильном User-Agent примерно в каждом шестом входе следующая страница
// не находила сессию (на эмуляторах; причина внутри SDK не установлена), здесь — ни разу
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
});

if (isLocal) {
  connectFirestoreEmulator(db, emulatorHost, 8085);
  connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
}

// Адрес фотографии из Cloud Storage по её пути в базе (products/<id>/main.jpg).
// Правила Storage разрешают всем читать фото товаров, поэтому адрес строится сразу,
// без отдельного запроса getDownloadURL на каждую карточку
const storageHost = isLocal ? `http://${emulatorHost}:9199` : 'https://firebasestorage.googleapis.com';

export function photoUrl(path) {
  const bucket = app.options.storageBucket;
  return `${storageHost}/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
}
