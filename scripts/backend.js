// npm run backend — «сервер» опубликованного сайта на ноутбуке разработчика.
//
// У облачного проекта agrodala тариф Spark: база, вход и хостинг работают в облаке, а Cloud Functions
// и Cloud Storage на нём недоступны. Поэтому они запускаются здесь, в эмуляторах Firebase, но
// с НАСТОЯЩЕЙ базой и пользователями проекта agrodala:
//   - эмулятор функций (порт 28579): placeOrder, setOrderStatus, importCsv и функции для фото;
//     эмуляторов Firestore и Authentication нет, поэтому Admin SDK в функциях обращается к облаку
//     по ключу сервисного аккаунта;
//   - эмулятор хранилища (порт 28575): фото, загруженные в админ-панели. Наружу он не открыт,
//     фото выдаёт функция photo. Файлы сохраняются в .emulator-data/backend при остановке (Ctrl+C).
// Из интернета функции доступны через Cloudflare Tunnel ноутбука (https://agrodala-api.artmori.art,
// адрес записан в public/js/firebase.js). Туннель настраивается один раз, см. README, «Публикация».
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';

const exists = (path) => access(path).then(() => true, () => false);
const key = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? `${homedir()}/.config/agrodala/service-account.json`;
if (!(await exists(key))) {
  console.error(`Нет ключа сервисного аккаунта: ${key}`);
  process.exit(1);
}

const dataDir = new URL('../.emulator-data/backend', import.meta.url).pathname;
const args = ['emulators:start', '-P', 'prod', '--only', 'functions,storage', '--export-on-exit', dataDir];
if (await exists(`${dataDir}/firebase-export-metadata.json`)) args.push('--import', dataDir);

const firebase = new URL('../node_modules/.bin/firebase', import.meta.url).pathname;
const child = spawn(firebase, args, {
  stdio: 'inherit',
  env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: key },
});
// Ctrl+C получает и firebase: он сохраняет фото и останавливает эмуляторы сам
process.on('SIGINT', () => {});
child.on('exit', (code) => process.exit(code ?? 0));
