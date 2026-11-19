// Импорт из Excel (ТЗ, п. 1.1.3): разбор файла CSV и проверка каждой строки.
// Excel на русской Windows сохраняет CSV через точку с запятой, а на английской — через запятую,
// поэтому разделитель определяется по строке заголовков. Заголовки можно писать по-русски
// («Название», «Цена»…) или как поля базы (name, price…). Обращений к базе здесь нет
import { ORIGINS, PURPOSES, TYPES } from '../shared/dictionaries.js';
import { derivedFields } from '../shared/catalog.js';

export const MAX_ROWS = 2000;

// Строки файла → массив ячеек. Поддерживаются кавычки ("текст; с разделителем"),
// удвоенные кавычки внутри них и переносы строк внутри ячейки
export function parseCsv(input) {
  const source = String(input ?? '').replace(/^﻿/, '');
  const firstLine = source.split(/\r?\n/, 1)[0];
  const count = (ch) => firstLine.split(ch).length - 1;
  const delimiter = [';', '\t', ','].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ';');

  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Пустые строки (часто в конце файла из Excel) пропускаем
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const key = (text) => String(text ?? '').trim().toLowerCase().replace(/ё/g, 'е');

const PRODUCT_HEADERS = {
  id: ['id', 'код', 'артикул'],
  name: ['name', 'название', 'наименование'],
  category: ['category', 'categoryid', 'категория'],
  purpose: ['purpose', 'назначение'],
  type: ['type', 'тип'],
  manufacturer: ['manufacturer', 'производитель', 'бренд'],
  origin: ['origin', 'происхождение'],
  country: ['country', 'страна'],
  price: ['price', 'цена'],
  stock: ['stock', 'остаток', 'количество'],
  description: ['description', 'описание'],
};

const USER_HEADERS = {
  name: ['name', 'имя', 'фио'],
  email: ['email', 'e-mail', 'почта', 'электронная почта'],
  phone: ['phone', 'телефон'],
  city: ['city', 'город'],
  street: ['street', 'адрес', 'улица'],
};

export const HEADERS = { products: PRODUCT_HEADERS, users: USER_HEADERS };
// Как назвать столбец в сообщении об ошибке
const TITLES = {
  name: 'Название', category: 'Категория', type: 'Тип', manufacturer: 'Производитель',
  origin: 'Происхождение', price: 'Цена', email: 'Email',
};
const REQUIRED = {
  products: ['name', 'category', 'type', 'manufacturer', 'origin', 'price'],
  users: ['name', 'email'],
};

// Таблица → записи { line, values: { поле: текст } }. line — номер строки в файле (заголовок — 1),
// чтобы в отчёте об импорте можно было сразу найти строку в Excel
export function toRecords(rows, kind) {
  if (rows.length === 0) throw new Error('Файл пустой.');
  const aliases = HEADERS[kind];
  const columns = rows[0].map((title) => {
    const k = key(title);
    return Object.keys(aliases).find((field) => aliases[field].includes(k)) ?? null;
  });
  const missing = REQUIRED[kind].filter((field) => !columns.includes(field));
  if (missing.length > 0) {
    const names = missing.map((f) => `«${kind === 'users' && f === 'name' ? 'Имя' : TITLES[f]}»`).join(', ');
    throw new Error(`В первой строке файла нет столбцов: ${names}.`);
  }
  if (rows.length - 1 > MAX_ROWS) throw new Error(`Слишком много строк: за один раз не больше ${MAX_ROWS}.`);
  const unknown = rows[0].filter((_, i) => columns[i] === null).map((t) => t.trim()).filter(Boolean);
  const records = rows.slice(1).map((cells, i) => {
    const values = {};
    columns.forEach((field, c) => {
      if (field) values[field] = (cells[c] ?? '').trim();
    });
    return { line: i + 2, values };
  });
  return { records, unknown };
}

// Значение справочника можно указать кодом (field) или подписью с сайта («Для полей»)
function fromDictionary(value, dict) {
  const k = key(value);
  return Object.keys(dict).find((code) => code === k || key(dict[code]) === k);
}

function integer(value) {
  const cleaned = String(value).replace(/[\s ₸]/g, '').replace(',', '.');
  if (!/^\d+(\.0+)?$/.test(cleaned)) return NaN;
  return Number.parseInt(cleaned, 10);
}

// Строка товара → документ для базы или список ошибок. Категория — по коду или названию;
// назначение, если не указано, берётся из категории
export function productFromRecord({ values }, categories) {
  const errors = [];
  const check = (ok, message) => ok || errors.push(message);

  const id = values.id ?? '';
  check(!id || /^[a-z0-9-]{2,60}$/.test(id), 'код товара: только латиница, цифры и дефис (2–60 символов)');
  const name = values.name ?? '';
  check(name.length > 0 && name.length <= 200, 'название: обязательно, не длиннее 200 символов');
  const category = categories.find((c) => c.id === values.category || key(c.name) === key(values.category));
  check(category, `категория «${values.category}» не найдена`);
  const purpose = values.purpose ? fromDictionary(values.purpose, PURPOSES) : category?.purpose;
  // Без категории назначение не определить — об этом уже сказано выше
  check(purpose || (!category && !values.purpose), `назначение «${values.purpose}»: допустимо ${Object.values(PURPOSES).join(', ')}`);
  const type = fromDictionary(values.type, TYPES);
  check(type, `тип «${values.type}»: допустимо ${Object.values(TYPES).join(', ')}`);
  const manufacturer = values.manufacturer ?? '';
  check(manufacturer.length > 0 && manufacturer.length <= 80, 'производитель: обязательно, не длиннее 80 символов');
  const origin = fromDictionary(values.origin, ORIGINS);
  check(origin, `происхождение «${values.origin}»: допустимо ${Object.values(ORIGINS).join(', ')}`);
  const price = integer(values.price);
  check(price > 0 && price <= 1_000_000_000, `цена «${values.price}»: целое число тенге больше нуля`);
  const stock = values.stock ? integer(values.stock) : 0;
  check(stock >= 0, `остаток «${values.stock}»: целое число от нуля`);
  const country = values.country ?? '';
  check(country.length <= 60, 'страна: не длиннее 60 символов');
  const description = values.description ?? '';
  check(description.length <= 5000, 'описание: не длиннее 5000 символов');
  if (errors.length > 0) return { errors };

  const product = {
    name,
    categoryId: category.id,
    purpose,
    type,
    manufacturer,
    origin,
    price,
    stock,
    ...(country && { country }),
    ...(description && { description }),
    ...derivedFields({ name, manufacturer, price, stock }),
  };
  return { id: id || null, product };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Строка клиента → профиль покупателя. Пароль не импортируется: клиент задаёт его сам
// через «Забыли пароль?» на странице входа
export function userFromRecord({ values }) {
  const errors = [];
  const check = (ok, message) => ok || errors.push(message);
  const name = values.name ?? '';
  check(name.length > 0 && name.length <= 100, 'имя: обязательно, не длиннее 100 символов');
  const email = (values.email ?? '').toLowerCase();
  check(EMAIL.test(email) && email.length <= 120, `почта «${values.email}» указана неверно`);
  const phone = values.phone ?? '';
  check(/^[0-9 ()+-]{0,20}$/.test(phone), `телефон «${phone}»: только цифры, пробелы, скобки, + и -`);
  const city = values.city ?? '';
  const street = values.street ?? '';
  check(city.length <= 60 && street.length <= 120, 'город — до 60 символов, адрес — до 120');
  if (errors.length > 0) return { errors };
  return {
    email,
    profile: {
      name,
      email,
      role: 'customer',
      ...(phone && { phone }),
      addresses: city || street ? [{ label: 'Основной', city, street }] : [],
    },
  };
}
