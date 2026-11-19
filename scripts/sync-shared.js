// Общие модули сайта и Cloud Functions: справочники, поиск и поля каталога.
// Функции публикуются только из папки functions/, поэтому файлы из public/js копируются в
// functions/shared/. Запускается сам перед npm start / npm run dev / npm test и перед публикацией
// функций; tests/functions-logic.test.js проверяет, что копии не отстали от оригиналов
import { copyFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SHARED = ['dictionaries.js', 'search.js', 'catalog.js'];

// Копирует только при запуске как скрипта (node scripts/sync-shared.js), а не при импорте из тестов
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = new URL('../', import.meta.url);
  mkdirSync(new URL('functions/shared/', root), { recursive: true });
  for (const file of SHARED) {
    copyFileSync(new URL(`public/js/${file}`, root), new URL(`functions/shared/${file}`, root));
  }
}
