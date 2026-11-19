// Страницы сайта: заранее загружаемые модули Firebase совпадают с тем, что импортирует js/firebase.js
// (иначе после смены версии SDK браузер качал бы две версии библиотеки), а порты эмуляторов
// в js/firebase.js — с firebase.json (иначе сайт не нашёл бы базу)
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const firebaseJs = readFileSync('public/js/firebase.js', 'utf8');
const imported = [...new Set(firebaseJs.match(/https:\/\/www\.gstatic\.com\/firebasejs\/[^'"]+/g))].sort();
const pages = readdirSync('public').filter((f) => f.endsWith('.html'));

describe('предзагрузка библиотеки Firebase', () => {
  it('firebase.js импортирует одну версию SDK', () => {
    const versions = new Set(imported.map((url) => url.split('/')[4]));
    expect(versions.size).toBe(1);
    expect(imported).toHaveLength(3);
  });

  it.each(pages)('%s: предзагружаются ровно те файлы, что импортирует firebase.js', (page) => {
    const html = readFileSync(`public/${page}`, 'utf8');
    const preloaded = [...html.matchAll(/<link rel="modulepreload" href="(https:[^"]+)">/g)].map((m) => m[1]).sort();
    expect(preloaded).toEqual(imported);
  });
});

// Функции и загрузка фото подключаются отдельными модулями только на страницах, где нужны
// (корзина, кабинет, администрирование). Версия SDK у них должна быть та же, что в firebase.js
it('все модули сайта берут Firebase одной версии', () => {
  const version = imported[0].split('/')[4];
  for (const file of readdirSync('public/js')) {
    const urls = readFileSync(`public/js/${file}`, 'utf8').match(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+/g) ?? [];
    for (const url of urls) expect(url.split('/')[4], file).toBe(version);
  }
});

describe('порты эмуляторов', () => {
  it('в js/firebase.js и firebase.phone.json те же, что в firebase.json', () => {
    const ports = (file) => JSON.parse(readFileSync(file, 'utf8')).emulators;
    const main = ports('firebase.json');
    const inBrowser = JSON.parse(
      firebaseJs.match(/const PORTS = (\{[^}]+\})/)[1].replace(/(\w+):/g, '"$1":')
    );
    expect(inBrowser).toEqual({
      firestore: main.firestore.port,
      auth: main.auth.port,
      storage: main.storage.port,
      functions: main.functions.port,
    });
    const phone = ports('firebase.phone.json');
    for (const name of Object.keys(main).filter((n) => main[n].port)) {
      expect(phone[name].port, name).toBe(main[name].port);
    }
  });
});
