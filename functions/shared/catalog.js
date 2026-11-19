// Фильтры каталога: адрес страницы ↔ условия запроса к Firestore.
// Модуль не зависит от браузера и Firebase: его проверяют тесты в Node.js,
// а home.js превращает описание запроса в вызовы where() и orderBy()
import { ORIGINS, PRICE_RANGES, PURPOSES, TYPES, priceRangeOf } from './dictionaries.js';
import { normalize, parseSearch, searchTokens } from './search.js';

export { matchesSearch } from './search.js';

// Товаров на странице; следующие подгружаются кнопкой «Показать ещё»
export const PAGE_SIZE = 12;
// Сколько товаров просматривается при поиске из нескольких слов (см. catalogQuery)
export const SEARCH_LIMIT = 200;

export const SORTS = {
  new: { label: 'Сначала новые', field: 'createdAt', dir: 'desc' },
  priceAsc: { label: 'Сначала дешёвые', field: 'price', dir: 'asc' },
  priceDesc: { label: 'Сначала дорогие', field: 'price', dir: 'desc' },
  name: { label: 'По названию', field: 'sortName', dir: 'asc' },
};

// Поля с фильтром на равенство и поле поиска. По ним scripts/indexes.js строит
// составные индексы в firestore.indexes.json
export const EQUALITY_FIELDS = ['categoryId', 'purpose', 'type', 'origin', 'manufacturer', 'inStock', 'priceRange'];
export const SEARCH_FIELD = 'searchTokens';

// Фильтры с выбором нескольких значений
const MULTI = { purpose: PURPOSES, type: TYPES, origin: ORIGINS };

// Поля товара, которые вычисляются из других полей и нужны только для запросов каталога.
// Их заполняет тот, кто сохраняет товар: админ-панель, импорт CSV (Cloud Function) и скрипт тестовых данных.
// Правила Firestore проверяют, что priceRange, inStock и sortName соответствуют цене, остатку и названию
export function derivedFields({ name, manufacturer, price, stock }) {
  return {
    priceRange: priceRangeOf(price),
    inStock: stock > 0,
    // Firestore сравнивает строки по кодам символов: «Ё» оказалась бы раньше «А»,
    // а строчные буквы — после всех заглавных. Поэтому сортируем по нормализованному названию
    sortName: normalize(name),
    searchTokens: searchTokens(name, manufacturer),
  };
}

// Адрес страницы → фильтры. Чужие и ошибочные значения отбрасываются:
// адрес может прийти из ссылки, и строить по нему запрос как есть нельзя
export function parseFilters(params) {
  const has = (dict, key) => typeof key === 'string' && Object.hasOwn(dict, key);
  const list = (name) => [...new Set((params.get(name) ?? '').split(','))].filter((v) => has(MULTI[name], v));
  const amount = (name) => {
    const text = (params.get(name) ?? '').trim();
    const value = Number(text);
    return text !== '' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  };

  const price = PRICE_RANGES.some((r) => r.id === params.get('price')) ? params.get('price') : null;
  let priceFrom = price ? null : amount('priceFrom');
  let priceTo = price ? null : amount('priceTo');
  if (priceFrom !== null && priceTo !== null && priceFrom > priceTo) [priceFrom, priceTo] = [priceTo, priceFrom];

  return {
    category: params.get('category') || null,
    purpose: list('purpose'),
    type: list('type'),
    origin: list('origin'),
    manufacturer: (params.get('manufacturer') ?? '').slice(0, 80) || null,
    // Цена: либо готовый диапазон из ТЗ, либо свой «от — до»
    price,
    priceFrom,
    priceTo,
    inStock: params.get('stock') === '1',
    sort: has(SORTS, params.get('sort')) ? params.get('sort') : 'new',
    q: (params.get('q') ?? '').trim().slice(0, 100),
  };
}

// Фильтры → адрес страницы. Значения по умолчанию не пишутся, чтобы адрес был коротким
export function filtersToParams(f) {
  const params = new URLSearchParams();
  const set = (name, value) => value !== null && value !== '' && value !== false && params.set(name, value);
  set('category', f.category);
  set('q', f.q);
  for (const name of Object.keys(MULTI)) set(name, f[name].join(','));
  set('manufacturer', f.manufacturer);
  set('price', f.price);
  set('priceFrom', f.priceFrom);
  set('priceTo', f.priceTo);
  if (f.inStock) params.set('stock', '1');
  if (f.sort !== 'new') params.set('sort', f.sort);
  return params;
}

// Сколько фильтров выбрано в блоке (без категории, поиска и сортировки) — для счётчика на кнопке
export function activeFilterCount(f) {
  return (
    Object.keys(MULTI).filter((name) => f[name].length > 0).length +
    [f.manufacturer, f.price, f.priceFrom ?? f.priceTo, f.inStock || null].filter((v) => v !== null).length
  );
}

// Фильтры → описание запроса: условия where, порядок orderBy и слова поиска,
// которые база проверить не может (extraStems)
export function catalogQuery(f) {
  const where = [];

  if (f.category) where.push(['categoryId', '==', f.category]);
  // Ничего не выбрано или выбрано всё — фильтра нет. Несколько значений — условие in:
  // Firestore выполняет его как несколько запросов на равенство и объединяет результаты
  for (const [name, dict] of Object.entries(MULTI)) {
    const values = f[name];
    if (values.length === 0 || values.length === Object.keys(dict).length) continue;
    where.push(values.length === 1 ? [name, '==', values[0]] : [name, 'in', values]);
  }
  if (f.manufacturer) where.push(['manufacturer', '==', f.manufacturer]);
  if (f.inStock) where.push(['inStock', '==', true]);
  if (f.price) where.push(['priceRange', '==', f.price]);
  if (f.priceFrom !== null) where.push(['price', '>=', f.priceFrom]);
  if (f.priceTo !== null) where.push(['price', '<=', f.priceTo]);

  // В одном запросе Firestore допускает только одно условие array-contains,
  // поэтому база ищет по одному слову, а остальные проверяются в браузере
  const [first, ...extraStems] = parseSearch(f.q);
  if (first) where.push([SEARCH_FIELD, 'array-contains', first]);

  const { field, dir } = SORTS[f.sort];
  return { where, orderBy: [field, dir], extraStems };
}

// Описание запроса → запрос Firestore. Функции SDK передаются параметром: на сайте это модуль
// с gstatic.com (firebase.js), в тестах — пакет firebase из node_modules. Так тесты проверяют
// тот же код, который работает на странице
export function toFirestoreQuery({ query, where, orderBy }, products, spec, ...extra) {
  return query(
    products,
    ...spec.where.map(([field, op, value]) => where(field, op, value)),
    orderBy(...spec.orderBy),
    ...extra
  );
}
