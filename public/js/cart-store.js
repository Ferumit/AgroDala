// Запись корзины carts/{uid}: { items: { productId: количество }, updatedAt }.
// Цен в корзине нет — сумму считает сервер при оформлении (functions/lib/orders.js)
import { db, doc, getDoc, setDoc, serverTimestamp } from './firebase.js';
import { MAX_ITEM_QTY } from './dictionaries.js';

export async function readCart(uid) {
  return (await getDoc(doc(db, 'carts', uid))).data()?.items ?? {};
}

async function writeCart(uid, items) {
  await setDoc(doc(db, 'carts', uid), { items, updatedAt: serverTimestamp() });
  // Шапка сайта обновляет счётчик товаров (js/layout.js)
  dispatchEvent(new CustomEvent('cart-changed', { detail: items }));
  return items;
}

export async function addToCart(uid, productId, qty = 1) {
  const items = await readCart(uid);
  items[productId] = Math.min((items[productId] ?? 0) + qty, MAX_ITEM_QTY);
  return writeCart(uid, items);
}

export async function setQty(uid, productId, qty) {
  const items = await readCart(uid);
  if (qty > 0) items[productId] = Math.min(qty, MAX_ITEM_QTY);
  else delete items[productId];
  return writeCart(uid, items);
}

export const cartCount = (items) => Object.values(items ?? {}).reduce((sum, qty) => sum + qty, 0);
