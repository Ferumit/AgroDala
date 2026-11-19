// Загрузка фотографий товара в Cloud Storage из административной панели.
// Браузер сам уменьшает снимок: большое фото — до 960 пикселей по ширине, миниатюра для каталога —
// 480×360 (как у тестовых данных). Так в хранилище не попадают снимки с телефона по 5–10 МБ,
// а каталог грузит лёгкие миниатюры. Правила storage.rules пускают сюда только контент-менеджера
// и администратора
import {
  getStorage,
  connectStorageEmulator,
  ref,
  uploadBytes,
  deleteObject,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-storage.js';
import { app, emulatorHost, isLocal, PORTS } from './firebase.js';

const storage = getStorage(app);
if (isLocal) connectStorageEmulator(storage, emulatorHost, PORTS.storage);

// cover: заполнить кадр целиком с обрезкой краёв (миниатюра), иначе — вписать с сохранением пропорций
async function resize(file, width, height, cover) {
  const bitmap = await createImageBitmap(file);
  const scale = cover
    ? Math.max(width / bitmap.width, height / bitmap.height)
    : Math.min(1, width / bitmap.width, height / bitmap.height);
  const w = cover ? width : Math.round(bitmap.width * scale);
  const h = cover ? height : Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const sw = cover ? w / scale : bitmap.width;
  const sh = cover ? h / scale : bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

// Имена файлов с отметкой времени: новое фото получает новый адрес, и браузер
// не покажет из кэша старое
export async function uploadProductPhoto(productId, file) {
  const stamp = Date.now();
  const main = `products/${productId}/main-${stamp}.jpg`;
  const thumb = `products/${productId}/thumb-${stamp}.jpg`;
  const metadata = { contentType: 'image/jpeg', cacheControl: 'public, max-age=86400' };
  const [big, small] = await Promise.all([resize(file, 960, 960, false), resize(file, 480, 360, true)]);
  await Promise.all([uploadBytes(ref(storage, main), big, metadata), uploadBytes(ref(storage, thumb), small, metadata)]);
  return { images: [main], thumbnail: thumb };
}

// Старые файлы удаляются после того, как товар сохранён с новыми. Ошибка удаления не мешает работе:
// останется лишний файл в хранилище
export async function deletePhotos(paths) {
  await Promise.all(paths.filter(Boolean).map((path) => deleteObject(ref(storage, path)).catch(() => {})));
}
