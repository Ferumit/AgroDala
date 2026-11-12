// Одна команда для работы и показа сайта: npm start
//   1) тесты базы данных, правил доступа и каталога (Vitest);
//   2) тестовые данные: категории, товары с фото, учётные записи, заказы;
//   3) сайт и эмуляторы работают, пока не нажать Ctrl+C.
// Скрипт запускается внутри `firebase emulators:exec`, поэтому эмуляторы к этому моменту уже подняты,
// а после выхода из скрипта Firebase сам их останавливает
import { spawnSync } from 'node:child_process';
import { PANEL, SITE } from './emulators.js';

const run = (command, args) =>
  spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' }).status;

console.log('\n=== 1/2. Тесты: база данных, правила доступа, каталог ===\n');
const tests = run('npx', ['vitest', 'run']);

// Тесты очищают базу, поэтому данные заливаются после них. Сайт запускается и при упавших тестах:
// показать его можно, но об ошибках сказано ниже
console.log('\n=== 2/2. Тестовые данные ===\n');
const seed = run('node', ['scripts/seed.js']);
if (seed !== 0) process.exit(seed);

console.log(`
============================================================
  Сайт:              ${SITE}
  Панель эмуляторов: ${PANEL}   (база данных, пользователи, фото)
  Вход: admin@agrodala.example / agrodala123 (и другие из README)
  Тесты: ${tests === 0 ? 'все прошли' : 'ЕСТЬ ОШИБКИ — см. вывод выше'}
  Остановить: Ctrl+C
============================================================
`);

// Скрипт ждёт, пока его не остановят: пока он работает, работают и эмуляторы
const stop = () => process.exit(0);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
