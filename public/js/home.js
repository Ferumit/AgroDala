// Каталог на главной странице: иконки категорий, блок фильтров и сортировки, поиск и список товаров.
// Выбранные фильтры хранятся в адресе (index.html?category=soil&sort=priceAsc…): подборкой можно
// поделиться ссылкой, а кнопка «Назад» в браузере возвращает к прошлым фильтрам
import * as firestore from './firebase.js';
import { escapeHtml, formatPrice, icon, stockLabel } from './ui.js';
import {
  PAGE_SIZE,
  SEARCH_LIMIT,
  activeFilterCount,
  catalogQuery,
  filtersToParams,
  matchesSearch,
  parseFilters,
  toFirestoreQuery,
} from './catalog.js';

const { db, collection, doc, getDoc, getDocs, getCount, query, orderBy, limit, startAfter, photoUrl } = firestore;

const categoriesList = document.querySelector('[data-categories]');
const productsList = document.querySelector('[data-products]');
const title = document.querySelector('[data-catalog-title]');
const counter = document.querySelector('[data-catalog-count]');
const form = document.querySelector('[data-filters]');
const panel = form.closest('details');
const applyButton = form.querySelector('[data-apply]');
const filtersBadge = document.querySelector('[data-filters-count]');
const moreButton = document.querySelector('[data-more]');
const searchInput = document.getElementById('search-input');

const products = collection(db, 'products');
const toQuery = (spec, ...extra) => toFirestoreQuery(firestore, products, spec, ...extra);

let categories = [];
let iconOf = {};
// Категории нужны для заголовка, иконок и проверки адреса. Запрос товаров уходит, не дожидаясь их,
// а показываются товары, когда пришло и то, и другое (см. main)
let categoriesReady = Promise.resolve();
let filters = parseFilters(new URLSearchParams(location.search));

// Номер последней загрузки: ответ на устаревший запрос (покупатель успел сменить фильтры) не показывается
let generation = 0;

// Строка поиска в шапке показывает запрос из адреса. Заполняется сразу, до загрузки каталога,
// и не трогается, пока в ней курсор: иначе ответ базы стёр бы то, что покупатель уже начал вводить
function syncSearchInput() {
  if (searchInput && document.activeElement !== searchInput) searchInput.value = filters.q;
}
syncSearchInput();
// Для «Показать ещё»: запрос, последний показанный документ и сколько всего товаров нашлось
let page = { spec: null, last: null, shown: 0, total: 0 };

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// ---------- Отрисовка ----------

function renderCategories() {
  const item = (href, iconName, name, active) => `
    <li>
      <a class="category" href="${href}" aria-current="${active}">
        <span class="category__icon">${icon(iconName)}</span>
        ${escapeHtml(name)}
      </a>
    </li>`;
  categoriesList.innerHTML =
    item('index.html', 'package', 'Все товары', !filters.category) +
    categories
      .map((c) => item(`index.html?category=${encodeURIComponent(c.id)}`, c.icon, c.name, c.id === filters.category))
      .join('');
}

// Фото товара или, если его нет, иконка категории на цветном фоне.
// loading="lazy": фото ниже экрана грузятся только при прокрутке
function photo(p, iconName = 'package') {
  const placeholder = `<div class="photo-placeholder">${icon(iconName)}</div>`;
  if (!p.thumbnail) return placeholder;
  return `<img class="product-card__photo" src="${photoUrl(p.thumbnail)}" alt="${escapeHtml(p.name)}"
               width="480" height="360" loading="lazy" data-placeholder="${escapeHtml(iconName)}">`;
}

// Если фото не загрузилось (удалено из хранилища, нет сети) — показываем иконку
document.addEventListener(
  'error',
  (event) => {
    const img = event.target;
    if (img instanceof HTMLImageElement && img.dataset.placeholder) {
      img.outerHTML = `<div class="photo-placeholder">${icon(img.dataset.placeholder)}</div>`;
    }
  },
  true
);

function card(snapshot) {
  const p = snapshot.data();
  return `
    <li>
      <a class="product-card" href="product.html?id=${encodeURIComponent(snapshot.id)}">
        ${photo(p, iconOf[p.categoryId])}
        <div class="product-card__body">
          <span class="product-card__name">${escapeHtml(p.name)}</span>
          <span class="product-card__meta">${escapeHtml(p.manufacturer)} · ${escapeHtml(p.country)}</span>
          ${stockLabel(p.stock)}
          <span class="product-card__price">${formatPrice(p.price)}</span>
        </div>
      </a>
    </li>`;
}

function renderProducts(snapshots) {
  if (snapshots.length > 0) {
    productsList.innerHTML = snapshots.map(card).join('');
  } else if (activeFilterCount(filters) === 0 && !filters.q) {
    productsList.innerHTML = '<li class="muted">В этой категории пока нет товаров.</li>';
  } else {
    productsList.innerHTML = `
      <li class="empty-state products__empty">
        ${icon('search')}
        <p>Ничего не найдено. Измените условия поиска или сбросьте фильтры.</p>
        <button class="btn btn--ghost" type="button" data-reset-all>Сбросить фильтры</button>
      </li>`;
  }
}

function renderHeading() {
  const category = categories.find((c) => c.id === filters.category);
  const name = category ? category.name : 'Каталог';
  title.textContent = filters.q ? `Поиск: «${filters.q}»${category ? ` в разделе «${category.name}»` : ''}` : name;
  document.title = `${filters.q ? `Поиск: ${filters.q}` : name} — AgroDala`;
  const active = activeFilterCount(filters);
  filtersBadge.textContent = active;
  filtersBadge.hidden = active === 0;
}

function showCount(total, partial = false) {
  counter.textContent = `Найдено: ${total}${partial ? '+' : ''}`;
}

// ---------- Форма фильтров ↔ фильтры ----------

function fillForm(f) {
  for (const name of ['purpose', 'type', 'origin']) {
    for (const input of form.elements[name]) input.checked = f[name].includes(input.value);
  }
  for (const input of form.elements.price) input.checked = input.value === (f.price ?? '');
  form.elements.priceFrom.value = f.priceFrom ?? '';
  form.elements.priceTo.value = f.priceTo ?? '';
  const select = form.elements.manufacturer;
  if (f.manufacturer && ![...select.options].some((o) => o.value === f.manufacturer)) {
    select.add(new Option(f.manufacturer, f.manufacturer));
  }
  select.value = f.manufacturer ?? '';
  form.elements.stock.checked = f.inStock;
  form.elements.sort.value = f.sort;
}

// Категория и поиск задаются не в блоке фильтров, поэтому берутся из текущих фильтров
function readForm() {
  const data = new FormData(form);
  const params = new URLSearchParams();
  if (filters.category) params.set('category', filters.category);
  if (filters.q) params.set('q', filters.q);
  for (const name of ['purpose', 'type', 'origin']) params.set(name, data.getAll(name).join(','));
  for (const name of ['price', 'priceFrom', 'priceTo', 'manufacturer', 'sort']) params.set(name, data.get(name) ?? '');
  if (data.get('stock')) params.set('stock', '1');
  return parseFilters(params);
}

// ---------- Загрузка товаров ----------

async function load() {
  const current = ++generation;
  const spec = catalogQuery(filters);
  productsList.setAttribute('aria-busy', 'true');
  moreButton.hidden = true;
  counter.textContent = '';

  if (spec.extraStems.length > 0) {
    // Поиск из нескольких слов: база ищет по самому длинному, остальные проверяются здесь.
    // Товары без последних слов отсеиваются уже после ответа, поэтому подгрузки по страницам нет
    const snap = await getDocs(toQuery(spec, limit(SEARCH_LIMIT)));
    await categoriesReady;
    if (current !== generation) return;
    const found = snap.docs.filter((d) => matchesSearch(d.data().searchTokens, spec.extraStems));
    renderProducts(found);
    showCount(found.length, snap.size === SEARCH_LIMIT);
  } else {
    // Первая страница и общее число найденных — двумя запросами одновременно.
    // count() считает на сервере и не загружает сами документы
    const [snap, count] = await Promise.all([
      getDocs(toQuery(spec, limit(PAGE_SIZE))),
      getCount(toQuery(spec)),
    ]);
    await categoriesReady;
    if (current !== generation) return;
    page = { spec, last: snap.docs.at(-1), shown: snap.size, total: count.data().count };
    renderProducts(snap.docs);
    showCount(page.total);
    moreButton.hidden = page.shown >= page.total;
  }
  productsList.removeAttribute('aria-busy');
}

// Следующая страница начинается после последнего показанного документа (курсор startAfter).
// Это надёжнее пропуска N первых товаров: Firestore не читает их заново, а при одинаковых ценах
// порядок однозначен — у одинаковых значений Firestore дополнительно сравнивает идентификаторы
async function loadMore() {
  const current = generation;
  moreButton.disabled = true;
  try {
    const snap = await getDocs(toQuery(page.spec, startAfter(page.last), limit(PAGE_SIZE)));
    if (current !== generation) return;
    const firstNew = productsList.children.length;
    productsList.insertAdjacentHTML('beforeend', snap.docs.map(card).join(''));
    page = { ...page, last: snap.docs.at(-1) ?? page.last, shown: page.shown + snap.size };
    moreButton.hidden = page.shown >= page.total || snap.size < PAGE_SIZE;
    // Фокус на первый новый товар: с клавиатуры не нужно проходить заново весь список
    productsList.children[firstNew]?.querySelector('a')?.focus();
  } finally {
    moreButton.disabled = false;
  }
}

function showError(err) {
  console.error(err);
  // На настоящей базе запрос без нужного составного индекса не выполняется (см. scripts/indexes.js)
  const message =
    err?.code === 'failed-precondition'
      ? 'Такое сочетание фильтров пока не поддерживается. Уберите один из фильтров.'
      : 'Не удалось загрузить каталог. Проверьте подключение к интернету и обновите страницу.';
  productsList.innerHTML = `<li class="error">${message}</li>`;
  productsList.removeAttribute('aria-busy');
}

async function apply(next, { push }) {
  filters = next;
  if (push) {
    const params = filtersToParams(filters).toString();
    history.pushState(null, '', `index.html${params ? `?${params}` : ''}`);
  }
  const loading = load();
  try {
    await categoriesReady;
    renderCategories();
    renderHeading();
    await loading;
  } catch (err) {
    showError(err);
  }
}

// Сколько товаров найдётся, видно на кнопке ещё до применения — как на Kolesa.kz.
// Запрос откладывается на 300 мс, чтобы не считать после каждой нажатой цифры
let previewTimer;
let previewNumber = 0;

function previewCount() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const number = ++previewNumber;
    const spec = catalogQuery(readForm());
    if (spec.extraStems.length > 0) {
      applyButton.textContent = 'Показать';
      return;
    }
    try {
      const n = (await getCount(toQuery(spec))).data().count;
      if (number === previewNumber) {
        applyButton.textContent = `Показать ${n} ${plural(n, 'товар', 'товара', 'товаров')}`;
      }
    } catch (err) {
      console.error(err);
      applyButton.textContent = 'Показать';
    }
  }, 300);
}

// Готовый диапазон цены и свой «от — до» взаимоисключающие: выбор одного очищает другое
form.addEventListener('input', (event) => {
  const { name, value } = event.target;
  if ((name === 'priceFrom' || name === 'priceTo') && value !== '') {
    form.querySelector('input[name="price"][value=""]').checked = true;
  }
  if (name === 'price' && value !== '') {
    form.elements.priceFrom.value = '';
    form.elements.priceTo.value = '';
  }
  previewCount();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  clearTimeout(previewTimer);
  const next = readForm();
  fillForm(next); // например, «от» и «до» переставлены местами, если были перепутаны
  // Блок закрывается сразу, без анимации: положение результатов нужно знать уже сейчас
  panel.classList.add('filters--instant');
  panel.open = false;
  requestAnimationFrame(() => panel.classList.remove('filters--instant'));
  apply(next, { push: true });
  showResults();
});

// После применения фильтров — к началу результатов: на телефоне открытый блок фильтров
// занимает весь экран, и без прокрутки покупатель остался бы посреди списка
function showResults() {
  const head = title.closest('.catalog-head');
  if (head.getBoundingClientRect().top < 0) {
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    head.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  }
}

// «Сбросить» очищает блок фильтров, но оставляет категорию и поиск
function resetFilters() {
  const params = new URLSearchParams();
  if (filters.category) params.set('category', filters.category);
  if (filters.q) params.set('q', filters.q);
  const next = parseFilters(params);
  fillForm(next);
  applyButton.textContent = 'Показать';
  return apply(next, { push: true });
}

form.addEventListener('reset', (event) => {
  event.preventDefault();
  resetFilters();
  showResults();
});

productsList.addEventListener('click', (event) => {
  if (!event.target.closest('[data-reset-all]')) return;
  if (activeFilterCount(filters) === 0) {
    // Фильтров нет — значит, ничего не нашёл поиск: убираем и его
    filters = { ...filters, q: '' };
  }
  resetFilters();
});

moreButton.addEventListener('click', () => loadMore().catch(showError));

// Поиск из шапки на этой странице выполняется без перезагрузки — так же, как фильтры:
// не загружаются заново страница и библиотека Firebase. Поиск идёт по всему каталогу.
// На других страницах форма поиска просто открывает index.html?q=…
searchInput?.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const next = parseFilters(new URLSearchParams({ q: searchInput.value }));
  fillForm(next);
  apply(next, { push: true });
  showResults();
});

// Кнопки «Назад» и «Вперёд» браузера: фильтры берутся из адреса
window.addEventListener('popstate', () => {
  const next = parseFilters(new URLSearchParams(location.search));
  fillForm(next);
  apply(next, { push: false });
  syncSearchInput();
});

// Список производителей — из документа meta/catalog. Приходит независимо от каталога:
// если в адресе уже был производитель, он остаётся выбранным, а список упорядочивается
function addManufacturers(names) {
  const select = form.elements.manufacturer;
  const chosen = select.value;
  const all = new Set([...[...select.options].slice(1).map((o) => o.value), ...names]);
  select.length = 1;
  for (const name of [...all].sort((a, b) => a.localeCompare(b))) select.add(new Option(name, name));
  select.value = chosen;
}

async function main() {
  const meta = getDoc(doc(db, 'meta', 'catalog'));
  categoriesReady = getDocs(query(collection(db, 'categories'), orderBy('order'))).then((snap) => {
    categories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    iconOf = Object.fromEntries(categories.map((c) => [c.id, c.icon]));
  });
  fillForm(filters);
  // Список производителей не нужен для первого показа каталога: не ждём его
  meta.then((snap) => addManufacturers(snap.data()?.manufacturers ?? [])).catch((err) => console.error(err));
  // Запросы категорий и товаров идут одновременно: на медленном 4G это экономит одно ожидание ответа
  const first = apply(filters, { push: false });
  await categoriesReady;
  // Неизвестная категория в адресе (например, удалённая) — показываем весь каталог
  if (filters.category && !categories.some((c) => c.id === filters.category)) {
    await apply({ ...filters, category: null }, { push: false });
    return;
  }
  await first;
}

main().catch(showError);
