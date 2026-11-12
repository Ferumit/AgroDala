// Страницы сайта: заранее загружаемые модули Firebase совпадают с тем, что импортирует js/firebase.js.
// Иначе после смены версии SDK браузер качал бы две версии библиотеки
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
