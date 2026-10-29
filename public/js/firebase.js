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
    ? { projectId: 'demo-agrodala', apiKey: 'demo-key', authDomain: 'demo-agrodala.firebaseapp.com' }
    : productionConfig
);

export const db = getFirestore(app);
export const auth = getAuth(app);

if (isLocal) {
  connectFirestoreEmulator(db, '127.0.0.1', 8085);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
