// Корзина и оформление заказа.
// Корзина — документ carts/{uid} с идентификаторами товаров и количеством; цены всегда берутся
// из каталога. Заказ создаёт Cloud Function placeOrder: она заново читает корзину и цены,
// резервирует товар на складе и сохраняет заказ. Сумма, которую видит покупатель, отправляется
// для сверки: если цена успела измениться, функция откажет и корзина покажет новые цены
import { db, doc, getDoc, photoUrl } from './firebase.js';
import { currentUser, ensureProfile } from './auth.js';
import { readCart, setQty } from './cart-store.js';
import { MAX_ITEM_QTY } from './dictionaries.js';
import { escapeHtml, formatPrice, icon } from './ui.js';

const empty = document.querySelector('[data-cart-empty]');
const list = document.querySelector('[data-cart-items]');
const total = document.querySelector('[data-cart-total]');
const form = document.querySelector('[data-checkout]');
const submit = form.querySelector('[type="submit"]');
const message = document.querySelector('[data-checkout-message]');

let user = null;
let rows = [];

function photo(p) {
  return p.thumbnail
    ? `<img src="${photoUrl(p.thumbnail)}" alt="" width="72" height="54" loading="lazy">`
    : `<div class="photo-placeholder">${icon('package')}</div>`;
}

// Товара на складе меньше, чем в корзине: остальное будет «под заказ»
function stockNote({ qty, product }) {
  if (qty <= product.stock) return '';
  const text = product.stock > 0
    ? `На складе ${product.stock} шт., остальное — под заказ`
    : 'Под заказ: срок поставки уточнит менеджер';
  return `<span class="stock stock--out">${text}</span>`;
}

const sum = () => rows.reduce((s, r) => s + r.product.price * r.qty, 0);

function render() {
  list.innerHTML = rows
    .map(
      (row) => `
      <li class="cart-item" data-id="${escapeHtml(row.id)}">
        <a class="cart-item__photo" href="product.html?id=${encodeURIComponent(row.id)}" tabindex="-1" aria-hidden="true">${photo(row.product)}</a>
        <div class="cart-item__info">
          <a class="cart-item__name" href="product.html?id=${encodeURIComponent(row.id)}">${escapeHtml(row.product.name)}</a>
          <span class="muted">${formatPrice(row.product.price)} за шт.</span>
          ${stockNote(row)}
        </div>
        <input class="cart-item__qty" type="number" value="${row.qty}" min="1" max="${MAX_ITEM_QTY}" inputmode="numeric"
               aria-label="Количество: ${escapeHtml(row.product.name)}" data-qty>
        <div class="cart-item__sum">
          <span>${formatPrice(row.product.price * row.qty)}</span>
          <button class="icon-button" type="button" data-remove title="Удалить из корзины">${icon('trash-2', 'Удалить из корзины')}</button>
        </div>
      </li>`
    )
    .join('');
  total.textContent = formatPrice(sum());
  list.hidden = rows.length === 0;
  empty.hidden = rows.length > 0;
  submit.disabled = rows.length === 0;
}

async function loadCart() {
  const items = Object.entries(await readCart(user.uid));
  const snaps = await Promise.all(items.map(([id]) => getDoc(doc(db, 'products', id))));
  // Товар могли убрать из каталога, пока он лежал в корзине: такие позиции не показываем,
  // а при оформлении функция удалит их из корзины сама
  rows = items.map(([id, qty], i) => ({ id, qty, product: snaps[i].data() })).filter((r) => r.product);
  render();
}

async function changeQty(id, qty) {
  list.setAttribute('aria-busy', 'true');
  try {
    await setQty(user.uid, id, qty);
    await loadCart();
  } catch (err) {
    console.error(err);
    showMessage('Не удалось изменить корзину. Обновите страницу.', 'error');
  } finally {
    list.removeAttribute('aria-busy');
  }
}

list.addEventListener('change', (event) => {
  if (!event.target.matches('[data-qty]')) return;
  const id = event.target.closest('[data-id]').dataset.id;
  const qty = Math.min(Math.max(Number.parseInt(event.target.value, 10) || 1, 1), MAX_ITEM_QTY);
  changeQty(id, qty);
});

list.addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove]');
  if (button) changeQty(button.closest('[data-id]').dataset.id, 0);
});

function showMessage(text, kind) {
  message.textContent = text;
  message.className = `form-message form-message--${kind}`;
  message.hidden = false;
}

// Адрес нужен только для доставки
function syncDelivery() {
  const delivery = form.delivery.value === 'delivery';
  document.querySelector('[data-address-field]').hidden = !delivery;
  document.querySelector('[data-pickup-note]').hidden = delivery;
  form.address.required = delivery;
}
form.addEventListener('change', (event) => {
  if (event.target.name === 'delivery') syncDelivery();
});

// Подставляем данные из профиля, но только в пустые поля: покупатель мог начать
// заполнять форму, пока страница загружалась
function fillFromProfile(profile) {
  const [address] = profile.addresses ?? [];
  const values = {
    name: profile.name,
    phone: profile.phone,
    address: [address?.city, address?.street].filter(Boolean).join(', '),
  };
  for (const [field, value] of Object.entries(values)) {
    if (!form[field].value && value) form[field].value = value;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.hidden = true;
  if (!form.reportValidity()) return;
  submit.disabled = true;
  submit.textContent = 'Оформляем…';
  try {
    // Модуль функций грузится только при оформлении: просмотр корзины без него быстрее
    const { call } = await import('./functions.js');
    const delivery = form.delivery.value;
    const order = await call('placeOrder', {
      contact: { name: form.name.value.trim(), phone: form.phone.value.trim() },
      delivery: { method: delivery, ...(delivery === 'delivery' && { address: form.address.value.trim() }) },
      comment: form.comment.value.trim(),
      expectedTotal: sum(),
    });
    showDone(order);
  } catch (err) {
    console.error(err);
    const { callErrorMessage } = await import('./functions.js');
    showMessage(callErrorMessage(err), 'error');
    // Изменились цены или каталог — показываем корзину такой, какой её увидел сервер
    if (err.code === 'functions/failed-precondition') await loadCart().catch(() => {});
    submit.disabled = rows.length === 0;
  } finally {
    submit.textContent = 'Оформить заказ';
  }
});

function showDone({ number, total: orderTotal, backorder }) {
  document.querySelector('[data-cart-page]').hidden = true;
  document.querySelector('[data-order-title]').textContent = `Заказ ${number} оформлен`;
  document.querySelector('[data-order-text]').textContent =
    `Сумма ${formatPrice(orderTotal)}. Статус — «Новый»: менеджер свяжется с вами, чтобы подтвердить заказ.` +
    (backorder ? ' Часть товаров — под заказ, срок поставки менеджер сообщит при звонке.' : '') +
    ' Следить за статусом можно в личном кабинете.';
  document.querySelector('[data-order-done]').hidden = false;
  dispatchEvent(new CustomEvent('cart-changed', { detail: {} }));
}

async function main() {
  user = await currentUser();
  if (!user) {
    document.querySelector('[data-cart-login]').hidden = false;
    return;
  }
  const [profile] = await Promise.all([ensureProfile(user), loadCart()]);
  fillFromProfile(profile);
  syncDelivery();
}

main().catch((err) => {
  console.error(err);
  empty.querySelector('p').textContent = 'Не удалось загрузить корзину. Обновите страницу.';
});
