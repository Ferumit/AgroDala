// Запросы каталога на эмуляторе Firestore. Каждый результат сравнивается с эталоном —
// простым перебором массива товаров на JavaScript, без индексов, курсоров и вычисляемых полей.
// Так проверяется, что фильтры, сортировки, поиск и подгрузка страниц дают те же товары
// в том же порядке, что и «наивный» алгоритм
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as firestore from 'firebase/firestore';
import { PRICE_RANGES } from '../public/js/dictionaries.js';
import { parseSearch } from '../public/js/search.js';
import { SORTS, catalogQuery, matchesSearch, parseFilters, toFirestoreQuery } from '../public/js/catalog.js';
import { buildProduct, loadSeed } from '../scripts/seed-data.js';

const { collection, doc, getCountFromServer, getDocs, limit, startAfter, Timestamp, writeBatch } = firestore;

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-12T00:00:00Z');

let env;
let db;
let seed;
let products;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-agrodala-catalog',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  seed = await loadSeed();
  // Как в scripts/seed.js: товары из seed/products.json, даты добавления через день
  products = seed.products.map((p, i) => ({
    id: p.id,
    ...buildProduct(p, seed, { images: [] }),
    createdAt: Timestamp.fromMillis(NOW - i * DAY),
  }));
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore();
    const batch = writeBatch(admin);
    for (const { id, ...data } of products) batch.set(doc(admin, 'products', id), data);
    await batch.commit();
  });
  // Каталог читают от имени гостя: правила должны это разрешать
  db = env.unauthenticatedContext().firestore();
});

afterAll(() => env.cleanup());

// ---------- Эталон ----------

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const norm = (text) => text.toLowerCase().replaceAll('ё', 'е');

// Наличие считается по остатку, диапазон — по самой цене, поиск — по словам названия
// и производителя, порядок — по исходным полям. Одинаковые значения Firestore упорядочивает
// по идентификатору документа, в направлении последней сортировки
function reference(f) {
  const range = PRICE_RANGES.find((r) => r.id === f.price);
  const stems = parseSearch(f.q);
  const found = products.filter((p) => {
    const chosen = (name, all) => f[name].length === 0 || f[name].length === all || f[name].includes(p[name]);
    const productWords = norm(`${p.name} ${p.manufacturer}`).split(/[^\p{L}\p{N}]+/u);
    return (
      (!f.category || p.categoryId === f.category) &&
      chosen('purpose', 3) && chosen('type', 2) && chosen('origin', 2) &&
      (!f.manufacturer || p.manufacturer === f.manufacturer) &&
      (!f.inStock || p.stock > 0) &&
      (!range || (p.price >= range.from && p.price < range.to)) &&
      (f.priceFrom === null || p.price >= f.priceFrom) &&
      (f.priceTo === null || p.price <= f.priceTo) &&
      stems.every((s) => productWords.some((w) => w.slice(0, 20).startsWith(s)))
    );
  });
  const { field, dir } = SORTS[f.sort];
  const key = {
    createdAt: (p) => p.createdAt.toMillis(),
    price: (p) => p.price,
    sortName: (p) => norm(p.name),
  }[field];
  const sign = dir === 'desc' ? -1 : 1;
  return found.sort((a, b) => sign * (compare(key(a), key(b)) || compare(a.id, b.id))).map((p) => p.id);
}

// ---------- Запрос, как на странице ----------

const toQuery = (spec, ...extra) => toFirestoreQuery(firestore, collection(db, 'products'), spec, ...extra);

async function run(f) {
  const spec = catalogQuery(f);
  const snap = await getDocs(toQuery(spec));
  return snap.docs.filter((d) => matchesSearch(d.data().searchTokens, spec.extraStems)).map((d) => d.id);
}

const filters = (query) => parseFilters(new URLSearchParams(query));

// ---------- Случайные сочетания фильтров ----------

// Генератор псевдослучайных чисел с начальным значением: при каждом запуске одни и те же
// сочетания, поэтому найденную ошибку можно повторить
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const QUERIES = [
  'лопата', 'лопаты', 'ЛОПАТ', 'культиватор', 'мотоблок дизельный', 'бензиновый мотоблок', 'greenfield',
  'Трехкорпусный', 'насос', 'сеялка ручная', 'бензо', 'xyz', '35', 'опрыскиватель 600', 'шланг 3/4', 'садовые вилы',
];

function randomFilters(random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const some = (list) => list.filter(() => random() < 0.4);
  const params = new URLSearchParams();
  if (random() < 0.4) params.set('category', pick(seed.categories).id);
  if (random() < 0.4) params.set('purpose', some(['field', 'garden', 'general']).join(','));
  if (random() < 0.4) params.set('type', some(['heavy', 'mini']).join(','));
  if (random() < 0.4) params.set('origin', some(['china', 'europe']).join(','));
  if (random() < 0.25) params.set('manufacturer', pick([...seed.suppliers.map((s) => s.brand), 'Нет такого']));
  const prices = products.map((p) => p.price);
  const r = random();
  if (r < 0.25) params.set('price', pick(PRICE_RANGES).id);
  // Свой диапазон: часто ровно по цене товара ±1, чтобы проверить, включаются ли границы
  if (r >= 0.25 && r < 0.6) {
    if (random() < 0.7) params.set('priceFrom', pick(prices) + pick([-1, 0, 1]));
    if (random() < 0.7) params.set('priceTo', pick(prices) + pick([-1, 0, 1]));
  }
  if (random() < 0.3) params.set('stock', '1');
  params.set('sort', pick(Object.keys(SORTS)));
  if (random() < 0.3) params.set('q', pick(QUERIES));
  return parseFilters(params);
}

describe('каталог на эмуляторе Firestore', () => {
  it('300 случайных сочетаний фильтров, сортировок и поиска совпадают с эталоном', async () => {
    const random = mulberry32(2026);
    let nonEmpty = 0;
    for (let i = 0; i < 300; i++) {
      const f = randomFilters(random);
      const expected = reference(f);
      const label = JSON.stringify(f);
      expect(await run(f), label).toEqual(expected);
      if (catalogQuery(f).extraStems.length === 0) {
        const count = await getCountFromServer(toQuery(catalogQuery(f)));
        expect(count.data().count, label).toBe(expected.length);
      }
      if (expected.length > 0) nonEmpty++;
    }
    // Проверка имеет смысл, только если заметная часть запросов что-то находит
    expect(nonEmpty).toBeGreaterThan(100);
  }, 180_000);

  it.each(Object.keys(SORTS))('подгрузка по 5 товаров даёт тот же список без повторов и пропусков: %s', async (sort) => {
    for (const query of [`sort=${sort}`, `sort=${sort}&stock=1`, `sort=${sort}&priceFrom=10000&priceTo=900000`]) {
      const f = filters(query);
      const spec = catalogQuery(f);
      const ids = [];
      let last = null;
      for (;;) {
        const snap = await getDocs(toQuery(spec, ...(last ? [startAfter(last)] : []), limit(5)));
        ids.push(...snap.docs.map((d) => d.id));
        if (snap.size < 5) break;
        last = snap.docs.at(-1);
      }
      expect(ids, query).toEqual(reference(f));
    }
  }, 60_000);

  it('пример: товары для дачи из Китая в наличии, сначала дешёвые', async () => {
    const ids = await run(filters('purpose=garden&origin=china&stock=1&sort=priceAsc'));
    const prices = ids.map((id) => products.find((p) => p.id === id).price);
    expect(ids.length).toBeGreaterThan(3);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    for (const id of ids) {
      const p = products.find((x) => x.id === id);
      expect([p.purpose, p.origin, p.stock > 0]).toEqual(['garden', 'china', true]);
    }
  });

  it('свой диапазон цены включает обе границы', async () => {
    const ids = await run(filters('priceFrom=19900&priceTo=21500&sort=priceAsc'));
    expect(ids.map((id) => products.find((p) => p.id === id).price)).toEqual([19900, 21500]);
  });

  it('готовый диапазон «до 20 000 ₸» не включает 20 000', async () => {
    const ids = await run(filters('price=upTo20k&sort=priceDesc'));
    expect(products.find((p) => p.id === ids[0]).price).toBeLessThan(20000);
  });

  it.each([
    ['лопаты', ['Лопата штыковая с металлическим черенком', 'Лопата штыковая закалённая, черенок из ясеня']],
    ['трехкорпусный', ['Плуг навесной трёхкорпусный П-3-35']],
    ['дизельный мотоблок', ['Мотоблок дизельный 10 л. с.']],
    ['мотоблока', ['Мотоблок бензиновый 7 л. с. с фрезами', 'Мотоблок дизельный 10 л. с.', 'Картофелесажалка для мотоблока']],
    ['xyz', []],
  ])('поиск «%s»', async (q, names) => {
    const ids = await run(filters(`q=${q}&sort=name`));
    expect(ids.map((id) => products.find((p) => p.id === id).name).sort()).toEqual([...names].sort());
  });
});
