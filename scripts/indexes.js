// Составные индексы Firestore для запросов каталога → firestore.indexes.json.
// Запуск: node scripts/indexes.js (после изменения фильтров или сортировок в public/js/catalog.js)
//
// Эмулятор индексы не требует, а настоящая база без нужного индекса отвечает ошибкой
// FAILED_PRECONDITION. Завести индекс на каждое сочетание фильтров нельзя: полей фильтра 8,
// сортировок 4, а сочетаний — тысячи при лимите 200 составных индексов на базу. Поэтому
// заводятся индексы «одно поле фильтра + поле сортировки»: запрос с несколькими равенствами
// Firestore выполняет, объединяя такие индексы (index merging, алгоритм zig-zag merge join).
// Свой диапазон цены (price >= / <=) при сортировке не по цене требует, чтобы цена шла
// в индексе после поля сортировки — в том же направлении: Firestore неявно дописывает к запросу
// orderBy('price') с направлением последней сортировки. Для «Сначала новые» (createdAt по убыванию)
// это price по убыванию; индекс с price по возрастанию настоящая база не принимала (найдено
// проверкой на облачной базе, 6-я неделя)
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { EQUALITY_FIELDS, SEARCH_FIELD, SORTS } from '../public/js/catalog.js';

const FILE = new URL('../firestore.indexes.json', import.meta.url);

const order = (fieldPath, dir) => ({ fieldPath, order: dir === 'desc' ? 'DESCENDING' : 'ASCENDING' });
const filterField = (fieldPath) =>
  fieldPath === SEARCH_FIELD ? { fieldPath, arrayConfig: 'CONTAINS' } : { fieldPath, order: 'ASCENDING' };
const index = (...fields) => ({ collectionGroup: 'products', queryScope: 'COLLECTION', fields });

export function catalogIndexes() {
  const filters = [...EQUALITY_FIELDS, SEARCH_FIELD];
  const sorts = Object.values(SORTS);
  const byOther = sorts.filter((s) => s.field !== 'price');
  const unique = new Map();
  const add = (fields) => unique.set(JSON.stringify(fields), index(...fields));
  for (const f of filters) for (const s of sorts) add([filterField(f), order(s.field, s.dir)]);
  for (const s of byOther) {
    add([order(s.field, s.dir), order('price', s.dir)]);
    for (const f of filters) add([filterField(f), order(s.field, s.dir), order('price', s.dir)]);
  }
  return [...unique.values()];
}

// Индексы других коллекций (заказы в личном кабинете) остаются как были
export async function buildIndexes() {
  const current = JSON.parse(await readFile(FILE, 'utf8'));
  return {
    indexes: [...current.indexes.filter((i) => i.collectionGroup !== 'products'), ...catalogIndexes()],
    fieldOverrides: current.fieldOverrides ?? [],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await buildIndexes();
  await writeFile(FILE, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`firestore.indexes.json: индексов ${result.indexes.length}, из них для каталога ${catalogIndexes().length}`);
}
