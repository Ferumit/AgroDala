// Страница товара: product.html?id=<идентификатор товара>
import { db, collection, doc, getDoc, getDocs, limit, orderBy, photoUrl, query, where } from './firebase.js';
import { escapeHtml, formatPrice, icon, stockLabel } from './ui.js';
import { ORIGINS, PURPOSES, TYPES } from './dictionaries.js';
import { currentUser } from './auth.js';
import { addToCart } from './cart-store.js';

const root = document.querySelector('[data-product]');
const id = new URLSearchParams(location.search).get('id');

// Большое фото с подписью об авторе: снимки взяты с Wikimedia Commons
// под свободными лицензиями, и большинство из них требуют указывать автора.
// Если фото несколько, под большим — миниатюры для переключения
function photo(p, iconName = 'package') {
  if (!p.images?.length) {
    return `<div class="product__photo photo-placeholder">${icon(iconName)}</div>`;
  }
  const credit = p.imageCredit
    ? `<figcaption>Фото: ${escapeHtml(p.imageCredit.author)},
         <a href="${escapeHtml(p.imageCredit.source)}" target="_blank" rel="noopener">${escapeHtml(p.imageCredit.license)}</a>,
         Wikimedia Commons</figcaption>`
    : '';
  const thumbs =
    p.images.length > 1
      ? `<div class="gallery" role="group" aria-label="Фотографии товара">${p.images
          .map(
            (path, i) => `<button class="gallery__thumb" type="button" data-photo="${escapeHtml(photoUrl(path))}"
                aria-label="Фото ${i + 1} из ${p.images.length}" aria-pressed="${i === 0}">
                <img src="${photoUrl(path)}" alt="" width="96" height="72" loading="lazy"></button>`
          )
          .join('')}</div>`
      : '';
  return `<figure class="product__photo">
      <img src="${photoUrl(p.images[0])}" alt="${escapeHtml(p.name)}" width="960" height="720" data-main-photo>
      ${thumbs}
      ${credit}
    </figure>`;
}

root.addEventListener('click', (event) => {
  const thumb = event.target.closest('[data-photo]');
  if (!thumb) return;
  root.querySelector('[data-main-photo]').src = thumb.dataset.photo;
  for (const b of root.querySelectorAll('[data-photo]')) b.setAttribute('aria-pressed', String(b === thumb));
});

// Ссылка назад к подборке: если покупатель пришёл из каталога с фильтрами или поиском,
// вернётся к тем же результатам, а не к началу каталога
function backLink() {
  try {
    const from = new URL(document.referrer);
    const fromCatalog = from.origin === location.origin && /\/(index\.html)?$/.test(from.pathname);
    if (fromCatalog && from.search) {
      return `<a class="back-link" href="${escapeHtml(from.pathname.slice(1) || 'index.html')}${escapeHtml(from.search)}">← К результатам</a>`;
    }
  } catch {
    // Нет referrer — нет и ссылки
  }
  return '';
}

// Ещё товары той же категории, сначала новые: запрос по индексу categoryId + createdAt
async function renderSimilar(id, p, category) {
  const snap = await getDocs(
    query(collection(db, 'products'), where('categoryId', '==', p.categoryId), orderBy('createdAt', 'desc'), limit(5))
  );
  const others = snap.docs.filter((d) => d.id !== id).slice(0, 4);
  if (others.length === 0) return;
  root.insertAdjacentHTML(
    'beforeend',
    `<section class="similar">
      <h2>Ещё в разделе «${escapeHtml(category?.name ?? 'Категория')}»</h2>
      <ul class="products">${others
        .map((d) => {
          const o = d.data();
          const image = o.thumbnail
            ? `<img class="product-card__photo" src="${photoUrl(o.thumbnail)}" alt="${escapeHtml(o.name)}" width="480" height="360" loading="lazy">`
            : `<div class="photo-placeholder">${icon(category?.icon ?? 'package')}</div>`;
          return `<li><a class="product-card" href="product.html?id=${encodeURIComponent(d.id)}">
              ${image}
              <div class="product-card__body">
                <span class="product-card__name">${escapeHtml(o.name)}</span>
                ${stockLabel(o.stock)}
                <span class="product-card__price">${formatPrice(o.price)}</span>
              </div></a></li>`;
        })
        .join('')}</ul>
    </section>`
  );
}

// «Германия (Европа)», но просто «Китай», а не «Китай (Китай)»
function country(p) {
  const region = ORIGINS[p.origin];
  if (!p.country) return region ?? '';
  return region && region !== p.country ? `${p.country} (${region})` : p.country;
}

function render(p, category) {
  document.title = `${p.name} — AgroDala`;
  const specs = Object.entries(p.specs ?? {})
    .map(([name, value]) => `<tr><th scope="row">${escapeHtml(name)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('');
  // Описание и характеристики необязательны (товар из админ-панели или импорта): пустые разделы не показываем
  const details = [
    p.description ? `<h2>Описание</h2><p>${escapeHtml(p.description)}</p>` : '',
    specs ? `<h2>Характеристики</h2><table class="specs"><tbody>${specs}</tbody></table>` : '',
  ].join('');

  root.innerHTML = `
    ${backLink()}
    <nav class="breadcrumbs" aria-label="Навигация">
      <a href="index.html">Каталог</a> /
      <a href="index.html?category=${encodeURIComponent(p.categoryId)}">${escapeHtml(category?.name ?? 'Категория')}</a>
    </nav>
    <div class="product">
      ${photo(p, category?.icon)}
      <div class="panel">
        <h1>${escapeHtml(p.name)}</h1>
        ${stockLabel(p.stock)}
        <p class="product__price">${formatPrice(p.price)}</p>
        <button class="btn" type="button" data-add-to-cart>
          ${icon('shopping-cart')} В корзину
        </button>
        <p class="form-message" data-cart-status role="status" hidden></p>
        <dl class="product__facts">
          <dt>Производитель</dt><dd>${escapeHtml(p.manufacturer)}</dd>
          <dt>Страна</dt><dd>${escapeHtml(country(p))}</dd>
          <dt>Назначение</dt><dd>${PURPOSES[p.purpose] ?? ''}</dd>
          <dt>Тип</dt><dd>${TYPES[p.type] ?? ''}</dd>
        </dl>
      </div>
    </div>
    ${details ? `<section class="panel" style="margin-top: 20px">${details}</section>` : ''}`;
}

// Корзина хранится в базе у вошедшего покупателя (carts/{uid}), поэтому сначала — вход.
// После входа покупатель вернётся на эту же страницу
async function onAddToCart(button, product) {
  const status = root.querySelector('[data-cart-status]');
  const user = await currentUser();
  if (!user) {
    location.href = `login.html?next=${encodeURIComponent(`product.html?id=${id}`)}`;
    return;
  }
  button.disabled = true;
  try {
    const items = await addToCart(user.uid, id);
    const backorder = items[id] > product.stock
      ? ` Сейчас на складе ${product.stock} шт., остальное — под заказ: срок поставки уточнит менеджер.`
      : '';
    status.innerHTML = `В корзине: ${items[id]} шт. <a href="cart.html">Перейти в корзину</a>.${backorder}`;
    status.className = 'form-message form-message--success';
  } catch (err) {
    console.error(err);
    status.textContent = 'Не удалось добавить в корзину. Попробуйте ещё раз.';
    status.className = 'form-message form-message--error';
  } finally {
    status.hidden = false;
    button.disabled = false;
  }
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
  root.querySelector('[data-add-to-cart]').addEventListener('click', (event) => onAddToCart(event.currentTarget, product));
  // Похожие товары — дополнение: если не загрузились, страница товара всё равно работает
  renderSimilar(id, product, categorySnap.data()).catch((err) => console.error(err));
}

main().catch((err) => {
  console.error(err);
  root.innerHTML = '<p class="error">Не удалось загрузить товар. Обновите страницу.</p>';
});
