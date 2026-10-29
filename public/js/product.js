// Страница товара: product.html?id=<идентификатор товара>
import { db, doc, getDoc } from './firebase.js';
import { escapeHtml, formatPrice, icon, stockLabel } from './ui.js';
import { ORIGINS, PURPOSES, TYPES } from './dictionaries.js';

const root = document.querySelector('[data-product]');
const id = new URLSearchParams(location.search).get('id');

function render(p, category) {
  document.title = `${p.name} — AgroDala`;
  const specs = Object.entries(p.specs ?? {})
    .map(([name, value]) => `<tr><th scope="row">${escapeHtml(name)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('');

  root.innerHTML = `
    <nav class="breadcrumbs" aria-label="Навигация">
      <a href="index.html">Каталог</a> /
      <a href="index.html?category=${encodeURIComponent(p.categoryId)}">${escapeHtml(category?.name ?? 'Категория')}</a>
    </nav>
    <div class="product">
      <div class="product__photo photo-placeholder">${icon(category?.icon ?? 'package')}</div>
      <div class="panel">
        <h1>${escapeHtml(p.name)}</h1>
        ${stockLabel(p.stock)}
        <p class="product__price">${formatPrice(p.price)}</p>
        <button class="btn" type="button" data-add-to-cart disabled
                title="Корзина подключается на 5-й неделе разработки">
          ${icon('shopping-cart')} В корзину
        </button>
        <dl class="product__facts">
          <dt>Производитель</dt><dd>${escapeHtml(p.manufacturer)}</dd>
          <dt>Страна</dt><dd>${escapeHtml(p.country)} (${ORIGINS[p.origin] ?? ''})</dd>
          <dt>Назначение</dt><dd>${PURPOSES[p.purpose] ?? ''}</dd>
          <dt>Тип</dt><dd>${TYPES[p.type] ?? ''}</dd>
        </dl>
      </div>
    </div>
    <section class="panel" style="margin-top: 20px">
      <h2>Описание</h2>
      <p>${escapeHtml(p.description)}</p>
      <h2>Характеристики</h2>
      <table class="specs"><tbody>${specs}</tbody></table>
    </section>`;
}

async function main() {
  if (!id) {
    root.innerHTML = '<p>Товар не указан. <a href="index.html">Вернуться в каталог</a></p>';
    return;
  }
  const snap = await getDoc(doc(db, 'products', id));
  if (!snap.exists()) {
    root.innerHTML = '<h1>Товар не найден</h1><p><a href="index.html">Вернуться в каталог</a></p>';
    return;
  }
  const product = snap.data();
  const categorySnap = await getDoc(doc(db, 'categories', product.categoryId));
  render(product, categorySnap.data());
}

main().catch((err) => {
  console.error(err);
  root.innerHTML = '<p class="error">Не удалось загрузить товар. Обновите страницу.</p>';
});
