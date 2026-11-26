// Подключение к Firebase. Остальные модули берут функции Firestore и Authentication через этот файл.
// Версия SDK указана здесь и в <link rel="modulepreload"> страниц (их сверяет tests/seed.test.js).
//
// Firestore Lite, а не полная библиотека: сайт только читает и пишет документы и считает их,
// обновления в реальном времени (onSnapshot) и офлайн-кэш ему не нужны. Lite весит 44 КБ вместо
// 187 КБ и обращается к базе обычными HTTP-запросами, без долгого установления потокового
// соединения. На медленном 4G это ускорило появление каталога (отчёт за 4-ю неделю)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import {
  getFirestore,
  connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore-lite.js';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';

export * from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore-lite.js';
export * from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';

// Сайт открыт с этого компьютера (npm run dev) или с телефона по адресу домашней сети
// либо Tailscale (npm run dev:phone) → работаем с локальными эмуляторами на этом же адресе
const isLoopback = ['localhost', '127.0.0.1'].includes(location.hostname);
const isPrivateNetwork =
  /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(location.hostname);
export const isLocal = isLoopback || isPrivateNetwork;
export const emulatorHost = isLoopback ? '127.0.0.1' : location.hostname;
// Порты эмуляторов — как в firebase.json (совпадение проверяет tests/pages.test.js)
export const PORTS = { firestore: 28573, auth: 28574, storage: 28575, functions: 28579 };

// Настоящий проект Firebase (опубликованный сайт). Это не секрет: такие же настройки получает
// браузер каждого посетителя. Доступ к данным ограничивают правила firestore.rules и storage.rules
const productionConfig = {
  apiKey: 'AIzaSyAWU4bI2R0SBDAqCTAnE2q6w5gwJ01YwRY',
  authDomain: 'agrodala.firebaseapp.com',
  projectId: 'agrodala',
  storageBucket: 'agrodala.firebasestorage.app',
  messagingSenderId: '984426393995',
  appId: '1:984426393995:web:85489f6c25f22b4ad1bf8e',
};

export const app = initializeApp(
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
  connectFirestoreEmulator(db, emulatorHost, PORTS.firestore);
  connectAuthEmulator(auth, `http://${emulatorHost}:${PORTS.auth}`, { disableWarnings: true });
}

// Cloud Functions и загруженные фото у опубликованного сайта. Тариф Blaze, на котором функции
// и хранилище работают в облаке, у проекта не подключён, поэтому они запущены на ноутбуке
// разработчика (npm run backend: эмуляторы функций и хранилища с настоящей базой) и открыты
// в интернет через Cloudflare Tunnel — только адреса функций /agrodala/europe-central2/….
// После подключения Blaze и публикации функций (npm run deploy) здесь нужно поставить null
const LAPTOP_BACKEND = 'https://agrodala-api.artmori.art';
export const REGION = 'europe-central2'; // как в functions/index.js
export const backendFunctionsUrl = isLocal || !LAPTOP_BACKEND ? null : `${LAPTOP_BACKEND}/${app.options.projectId}/${REGION}`;

// Адрес фотографии по её пути в базе.
// img/products/… — фото из тестовых данных: опубликованы вместе с сайтом, работают без ноутбука.
// products/<id>/… — фото, загруженные в админ-панели: лежат в Cloud Storage. Правила Storage
// разрешают всем читать фото товаров, поэтому адрес строится сразу, без отдельного запроса
// getDownloadURL на каждую карточку; на ноутбуке их отдаёт функция photo
const storageHost = isLocal ? `http://${emulatorHost}:${PORTS.storage}` : 'https://firebasestorage.googleapis.com';

export function photoUrl(path) {
  if (path.startsWith('img/')) return `/${path}`;
  if (backendFunctionsUrl) return `${backendFunctionsUrl}/photo?path=${encodeURIComponent(path)}`;
  const bucket = app.options.storageBucket;
  return `${storageHost}/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
}
