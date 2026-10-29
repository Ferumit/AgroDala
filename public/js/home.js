// Главная страница: иконки категорий и список товаров из Firestore.
// Фильтры, сортировка и поиск подключаются на 4-й неделе (ТЗ, таблица 6)
import { db, collection, getDocs, query, where, orderBy, limit } from './firebase.js';
import { escapeHtml, formatPrice, icon, stockLabel } from './ui.js';

const params = new URLSearchParams(location.search);
const activeCategory = params.get('category');

const categoriesList = document.querySelector('[data-categories]');
const productsList = document.querySelector('[data-products]');
const title = document.querySelector('[data-catalog-title]');
const counter = document.querySelector('[data-catalog-count]');

function renderCategories(categories) {
  const item = (href, iconName, name, active) => `
    <li>
      <a class="category" href="${href}" aria-current="${active}">
        <span class="category__icon">${icon(iconName)}</span>
        ${escapeHtml(name)}
      </a>
    </li>`;
  categoriesList.innerHTML =
    item('index.html', 'package', 'Все товары', !activeCategory) +
    categories
      .map((c) => item(`index.html?category=${encodeURIComponent(c.id)}`, c.icon, c.name, c.id === activeCategory))
      .join('');
}

function renderProducts(products, iconOf) {
  if (products.length === 0) {
    productsList.innerHTML = '<li class="muted">В этой категории пока нет товаров.</li>';
    return;
  }
  productsList.innerHTML = products
    .map(
      (p) => `
      <li>
        <a class="product-card" href="product.html?id=${encodeURIComponent(p.id)}">
          <div class="photo-placeholder">${icon(iconOf[p.categoryId] ?? 'package')}</div>
          <div class="product-card__body">
            <span class="product-card__name">${escapeHtml(p.name)}</span>
            <span class="product-card__meta">${escapeHtml(p.manufacturer)} · ${escapeHtml(p.country)}</span>
            ${stockLabel(p.stock)}
            <span class="product-card__price">${formatPrice(p.price)}</span>
          </div>
        </a>
      </li>`
    )
    .join('');
}

async function main() {
  const categoriesSnap = await getDocs(query(collection(db, 'categories'), orderBy('order')));
  const categories = categoriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderCategories(categories);

  const current = categories.find((c) => c.id === activeCategory);
  title.textContent = current ? current.name : 'Каталог';
  document.title = `${current ? current.name : 'Каталог'} — AgroDala`;

  const productsQuery = current
    ? query(collection(db, 'products'), where('categoryId', '==', current.id), orderBy('createdAt', 'desc'))
    : query(collection(db, 'products'), orderBy('createdAt', 'desc'), limit(48));
  const productsSnap = await getDocs(productsQuery);
  const products = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const iconOf = Object.fromEntries(categories.map((c) => [c.id, c.icon]));
  renderProducts(products, iconOf);
  counter.textContent = `Найдено: ${products.length}`;
}

main().catch((err) => {
  console.error(err);
  productsList.innerHTML =
    '<li class="error">Не удалось загрузить каталог. Проверьте подключение к интернету и обновите страницу.</li>';
});
