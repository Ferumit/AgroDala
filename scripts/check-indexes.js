// npm run check:indexes — хватает ли составных индексов НАСТОЯЩЕЙ базе (эмулятор их не проверяет).
// 200 случайных сочетаний фильтров каталога и все сортировки: запрос строит та же функция
// catalogQuery, что и сайт, а выполняет облачная база через Admin SDK (первая страница и подсчёт).
// Без нужного индекса база отвечает FAILED_PRECONDITION. Генератор случайных чисел с фиксированным
// началом — проверку можно повторить. Нужен ключ сервисного аккаунта (см. scripts/seed.js)
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { catalogQuery, parseFilters, SORTS } from '../public/js/catalog.js';
import { PURPOSES, TYPES, ORIGINS, PRICE_RANGES } from '../public/js/dictionaries.js';

process.env.GOOGLE_APPLICATION_CREDENTIALS ??= `${homedir()}/.config/agrodala/service-account.json`;
initializeApp({ projectId: 'agrodala' });
const db = getFirestore();

let seed = 20261126;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const some = (a) => a.filter(() => rnd() < 0.4);
const categories = JSON.parse(readFileSync(new URL('../seed/categories.json', import.meta.url), 'utf8')).map((c) => c.id);
const manufacturers = (await db.doc('meta/catalog').get()).get('manufacturers');
const words = ['лопата', 'мотоблок', 'дизельный', 'грабли', 'плуг', 'насос'];

const combos = [];
for (const sort of Object.keys(SORTS)) combos.push(new URLSearchParams({ sort }));
for (let i = 0; i < 200; i++) {
  const p = new URLSearchParams({ sort: pick(Object.keys(SORTS)) });
  if (rnd() < 0.3) p.set('category', pick(categories));
  for (const [name, dict] of [['purpose', PURPOSES], ['type', TYPES], ['origin', ORIGINS]]) {
    const v = some(Object.keys(dict));
    if (v.length) p.set(name, v.join(','));
  }
  if (rnd() < 0.25) p.set('manufacturer', pick(manufacturers));
  if (rnd() < 0.3) p.set('stock', '1');
  const r = rnd();
  if (r < 0.25) p.set('price', pick(PRICE_RANGES).id);
  else if (r < 0.45) { p.set('priceFrom', String(Math.floor(rnd() * 50000))); p.set('priceTo', String(50000 + Math.floor(rnd() * 900000))); }
  else if (r < 0.5) p.set('priceFrom', '20000');
  if (rnd() < 0.2) p.set('q', pick(words));
  combos.push(p);
}

let ok = 0, failed = [];
for (let i = 0; i < combos.length; i += 8) {
  await Promise.all(combos.slice(i, i + 8).map(async (params) => {
    const spec = catalogQuery(parseFilters(params));
    let q = db.collection('products');
    for (const [field, op, value] of spec.where) q = q.where(field, op, value);
    q = q.orderBy(spec.orderBy[0], spec.orderBy[1]);
    try {
      await Promise.all([q.limit(12).get(), q.count().get()]);
      ok++;
    } catch (err) {
      failed.push(`${params} → ${String(err.message).slice(0, 90)}`);
    }
  }));
}
console.log(`запросов: ${combos.length}, выполнено: ${ok}, отказ: ${failed.length}`);
for (const f of failed.slice(0, 10)) console.log('  ', f);
process.exit(failed.length ? 1 : 0);
