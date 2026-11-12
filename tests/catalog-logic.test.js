// Логика каталога без базы: поиск (search.js), адрес страницы ↔ фильтры и описание запроса (catalog.js)
import { describe, expect, it } from 'vitest';
import { matchesSearch, normalize, parseSearch, searchTokens, stem, words } from '../public/js/search.js';
import {
  activeFilterCount,
  catalogQuery,
  derivedFields,
  filtersToParams,
  parseFilters,
} from '../public/js/catalog.js';

const parse = (query) => parseFilters(new URLSearchParams(query));

describe('поиск: слова и их начала', () => {
  it('строчные буквы и «е» вместо «ё»', () => {
    expect(normalize('Трёхкорпусный ПЛУГ')).toBe('трехкорпусный плуг');
  });

  it('слова — из букв и цифр, знаки препинания разделяют', () => {
    expect(words('Плуг навесной П-3-35, 1,05 м')).toEqual(['плуг', 'навесной', 'п', '3', '35', '1', '05', 'м']);
  });

  it('начала слов от 2 букв, без повторов', () => {
    const tokens = searchTokens('Лопата штыковая', 'GardenPro');
    expect(tokens).toEqual(expect.arrayContaining(['ло', 'лоп', 'лопата', 'шт', 'штыковая', 'ga', 'gardenpro']));
    expect(tokens).not.toContain('л');
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('у длинного слова сохраняются начала только до 20 букв', () => {
    const tokens = searchTokens('Электрогазосварочноагрегатный');
    expect(Math.max(...tokens.map((t) => t.length))).toBe(20);
  });

  it.each([
    ['лопаты', 'лопат'],
    ['лопата', 'лопат'],
    ['культиваторы', 'культиватор'],
    ['бензиновый', 'бензинов'],
    ['капельного', 'капельн'],
    ['плуги', 'плуг'],
    ['весы', 'весы'],
    ['вилы', 'вилы'],
    ['насос', 'насос'],
    ['greenfield', 'greenfield'],
  ])('окончание: %s → %s', (word, expected) => {
    expect(stem(word)).toBe(expected);
  });

  it('запрос: основы слов без повторов, длинная первой, однобуквенные отброшены', () => {
    expect(parseSearch('  Мотоблок   ДИЗЕЛЬНЫЙ ')).toEqual(['мотоблок', 'дизельн']);
    expect(parseSearch('лопата лопаты')).toEqual(['лопат']);
    expect(parseSearch('л. с.')).toEqual([]);
    expect(parseSearch('')).toEqual([]);
  });

  it('товар подходит, если каждое слово запроса — начало какого-нибудь его слова', () => {
    const tokens = searchTokens('Мотоблок дизельный 10 л. с.', 'HarvestPro');
    expect(matchesSearch(tokens, parseSearch('дизельные мотоблоки'))).toBe(true);
    expect(matchesSearch(tokens, parseSearch('мотоблок бензиновый'))).toBe(false);
    expect(matchesSearch(tokens, parseSearch('harvest'))).toBe(true);
  });
});

describe('адрес страницы ↔ фильтры', () => {
  it('пустой адрес — фильтров нет, сначала новые', () => {
    expect(parse('')).toEqual({
      category: null, purpose: [], type: [], origin: [], manufacturer: null,
      price: null, priceFrom: null, priceTo: null, inStock: false, sort: 'new', q: '',
    });
  });

  it('чужие значения отбрасываются, в том числе имена свойств объекта', () => {
    const f = parse('purpose=field,space,constructor,field&type=__proto__&sort=constructor&price=toString');
    expect(f.purpose).toEqual(['field']);
    expect(f.type).toEqual([]);
    expect(f.sort).toBe('new');
    expect(f.price).toBeNull();
  });

  it.each(['-5', 'abc', '10.5', '', ' '])('цена «%s» не принимается', (value) => {
    expect(parse(`priceFrom=${value}`).priceFrom).toBeNull();
  });

  it('«от» больше «до» — границы меняются местами', () => {
    expect(parse('priceFrom=50000&priceTo=10000')).toMatchObject({ priceFrom: 10000, priceTo: 50000 });
  });

  it('готовый диапазон важнее своего «от — до»', () => {
    expect(parse('price=upTo20k&priceFrom=1&priceTo=2')).toMatchObject({ price: 'upTo20k', priceFrom: null, priceTo: null });
  });

  it('фильтры → адрес → те же фильтры; значения по умолчанию в адрес не пишутся', () => {
    const f = parse('category=hand&purpose=garden,general&origin=china&manufacturer=GardenPro&priceTo=20000&stock=1&sort=priceAsc&q=лопата');
    expect(parseFilters(filtersToParams(f))).toEqual(f);
    expect(filtersToParams(parse('sort=new&purpose=')).toString()).toBe('');
  });

  it('число выбранных фильтров: категория, поиск и сортировка не считаются', () => {
    expect(activeFilterCount(parse('category=hand&q=x&sort=name'))).toBe(0);
    expect(activeFilterCount(parse('purpose=field&type=mini&manufacturer=X&priceFrom=5&stock=1'))).toBe(5);
  });
});

describe('фильтры → условия запроса', () => {
  it('без фильтров — только сортировка', () => {
    expect(catalogQuery(parse(''))).toEqual({ where: [], orderBy: ['createdAt', 'desc'], extraStems: [] });
  });

  it('одно значение — равенство, несколько — in, выбраны все — условия нет', () => {
    expect(catalogQuery(parse('purpose=field')).where).toEqual([['purpose', '==', 'field']]);
    expect(catalogQuery(parse('purpose=field,garden')).where).toEqual([['purpose', 'in', ['field', 'garden']]]);
    expect(catalogQuery(parse('purpose=field,garden,general&type=heavy,mini')).where).toEqual([]);
  });

  it('готовый диапазон — по полю priceRange, свой — неравенствами по цене', () => {
    expect(catalogQuery(parse('price=over500k&sort=name')).where).toEqual([['priceRange', '==', 'over500k']]);
    expect(catalogQuery(parse('priceFrom=1000&priceTo=5000')).where).toEqual([['price', '>=', 1000], ['price', '<=', 5000]]);
  });

  it('поиск: база ищет самую длинную основу, остальные — для проверки в браузере', () => {
    const spec = catalogQuery(parse('q=мотоблок дизельный&sort=priceDesc'));
    expect(spec.where).toEqual([['searchTokens', 'array-contains', 'мотоблок']]);
    expect(spec.extraStems).toEqual(['дизельн']);
    expect(spec.orderBy).toEqual(['price', 'desc']);
  });
});

describe('вычисляемые поля товара', () => {
  it('наличие, название для сортировки, диапазон цены, слова для поиска', () => {
    const fields = derivedFields({ name: 'Ёмкость 200 л', manufacturer: 'Terrano', price: 20_000, stock: 0 });
    expect(fields).toMatchObject({ priceRange: '20kTo100k', inStock: false, sortName: 'емкость 200 л' });
    expect(fields.searchTokens).toEqual(expect.arrayContaining(['ем', 'емкость', '200', 'terrano']));
  });
});
