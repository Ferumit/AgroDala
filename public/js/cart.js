// Корзина: показывает содержимое carts/{uid} и товары из каталога.
// Цены всегда берутся из каталога: в корзине хранятся только идентификаторы и количество.
// Изменение количества, удаление и оформление заказа — 5-я неделя (ТЗ, таблица 6)
import { db, doc, getDoc, photoUrl } from './firebase.js';
import { currentUser } from './auth.js';
import { escapeHtml, formatPrice, icon } from './ui.js';

const empty = document.querySelector('[data-cart-empty]');
const list = document.querySelector('[data-cart-items]');
const total = document.querySelector('[data-cart-total]');

function photo(p) {
  return p.thumbnail
    ? `<img src="${photoUrl(p.thumbnail)}" alt="" width="72" height="54" loading="lazy">`
    : `<div class="photo-placeholder">${icon('package')}</div>`;
}

function render(rows) {
  list.innerHTML = rows
    .map(
      ({ id, product, qty }) => `
      <li class="cart-item">
        <a class="cart-item__photo" href="product.html?id=${encodeURIComponent(id)}" tabindex="-1" aria-hidden="true">${photo(product)}</a>
        <div class="cart-item__info">
          <a class="cart-item__name" href="product.html?id=${encodeURIComponent(id)}">${escapeHtml(product.name)}</a>
          <span class="muted">${formatPrice(product.price)} за шт.</span>
        </div>
        <input class="cart-item__qty" type="number" value="${qty}" min="1" disabled
               aria-label="Количество: ${escapeHtml(product.name)}">
        <div class="cart-item__sum">
          <span>${formatPrice(product.price * qty)}</span>
          <button class="icon-button" type="button" disabled title="Удалить из корзины">${icon('trash-2', 'Удалить из корзины')}</button>
        </div>
      </li>`
    )
    .join('');
  total.textContent = formatPrice(rows.reduce((sum, r) => sum + r.product.price * r.qty, 0));
  list.hidden = false;
  empty.hidden = true;
}

async function main() {
  const user = await currentUser();
  if (!user) {
    document.querySelector('[data-cart-login]').hidden = false;
    return;
  }
  const cart = (await getDoc(doc(db, 'carts', user.uid))).data();
  const items = Object.entries(cart?.items ?? {});
  const snaps = await Promise.all(items.map(([id]) => getDoc(doc(db, 'products', id))));
  // Товар могли убрать из каталога, пока он лежал в корзине: такие позиции не показываем
  const rows = items
    .map(([id, qty], i) => ({ id, qty, product: snaps[i].data() }))
    .filter((r) => r.product);
  if (rows.length > 0) render(rows);
}

main().catch((err) => {
  console.error(err);
  empty.querySelector('p').textContent = 'Не удалось загрузить корзину. Обновите страницу.';
});
