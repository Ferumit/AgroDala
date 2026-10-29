// Подключение к Firebase. Версия SDK указана в одном месте — здесь;
// остальные модули берут функции Firestore и Authentication через этот файл
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import {
  getFirestore,
  connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';

export * from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
export * from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';

// Сайт открыт с этого компьютера → работаем с локальными эмуляторами (npm run dev)
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

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
export const auth = getAuth(app);

if (isLocal) {
  connectFirestoreEmulator(db, '127.0.0.1', 8085);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}

// Адрес фотографии из Cloud Storage по её пути в базе (products/<id>/main.jpg).
// Правила Storage разрешают всем читать фото товаров, поэтому адрес строится сразу,
// без отдельного запроса getDownloadURL на каждую карточку
const storageHost = isLocal ? 'http://127.0.0.1:9199' : 'https://firebasestorage.googleapis.com';

export function photoUrl(path) {
  const bucket = app.options.storageBucket;
  return `${storageHost}/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
}
