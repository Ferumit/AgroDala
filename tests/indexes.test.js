// Составные индексы для настоящей базы (firestore.indexes.json). Эмулятор индексы не требует,
// поэтому проверяется сам файл: он совпадает с тем, что строит scripts/indexes.js, и для каждого
// вида запроса каталога в нём есть индексы, нужные по правилам Firestore (см. scripts/indexes.js)
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EQUALITY_FIELDS, SEARCH_FIELD, SORTS, catalogQuery, parseFilters } from '../public/js/catalog.js';
import { buildIndexes } from '../scripts/indexes.js';

const file = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));
const catalog = file.indexes.filter((i) => i.collectionGroup === 'products');
const key = (fields) => fields.map((f) => `${f.fieldPath}:${f.order ?? f.arrayConfig}`).join(',');
const existing = new Set(catalog.map((i) => key(i.fields)));

const dir = (d) => (d === 'desc' ? 'DESCENDING' : 'ASCENDING');

// Какие индексы нужны запросу: на каждое поле с равенством (in, array-contains) — индекс
// «поле + сортировка» (несколько таких Firestore объединяет); при своём диапазоне цены
// и сортировке не по цене — ещё и цена после поля сортировки
function required(spec) {
  const [sortField, sortDir] = spec.orderBy;
  const range = spec.where.some(([field, op]) => field === 'price' && (op === '>=' || op === '<='));
  const filtersOn = spec.where.filter(([field]) => field !== 'price').map(([field, op]) => ({
    fieldPath: field,
    ...(op === 'array-contains' ? { arrayConfig: 'CONTAINS' } : { order: 'ASCENDING' }),
  }));
  const tail = [{ fieldPath: sortField, order: dir(sortDir) }];
  if (range && sortField !== 'price') tail.push({ fieldPath: 'price', order: 'ASCENDING' });
  if (filtersOn.length === 0) return tail.length > 1 ? [tail] : [];
  return filtersOn.map((f) => [f, ...tail]);
}

describe('индексы Firestore', () => {
  it('файл совпадает с тем, что строит scripts/indexes.js', async () => {
    expect(file).toEqual(await buildIndexes());
  });

  it('индексов меньше лимита Firestore (200)', () => {
    expect(file.indexes.length).toBeLessThanOrEqual(200);
  });

  it('каждый вид запроса каталога обеспечен индексами', () => {
    const variants = [
      '', 'category=hand', 'purpose=field', 'purpose=field,garden', 'type=mini', 'origin=europe',
      'manufacturer=Feldwerk', 'stock=1', 'price=upTo20k', 'q=лопата', 'q=мотоблок дизельный',
      'category=hand&purpose=garden&type=mini&origin=china&manufacturer=GardenPro&stock=1&q=лопата',
    ];
    const prices = ['', '&priceFrom=1000', '&priceTo=50000', '&priceFrom=1000&priceTo=50000'];
    let checked = 0;
    for (const sort of Object.keys(SORTS)) {
      for (const v of variants) {
        for (const p of prices) {
          const spec = catalogQuery(parseFilters(new URLSearchParams(`${v}${p}&sort=${sort}`)));
          for (const fields of required(spec)) {
            expect(existing.has(key(fields)), `${v}${p}&sort=${sort}: нет индекса ${key(fields)}`).toBe(true);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('в условиях запроса нет полей, о которых не знает генератор индексов', () => {
    const known = new Set([...EQUALITY_FIELDS, SEARCH_FIELD, 'price']);
    const spec = catalogQuery(parseFilters(new URLSearchParams(
      'category=a&purpose=field&type=mini&origin=china&manufacturer=X&stock=1&price=upTo20k&q=лопата'
    )));
    for (const [field] of spec.where) expect(known.has(field), field).toBe(true);
  });
});
