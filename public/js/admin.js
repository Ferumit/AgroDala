// Административная панель: разделы по ролям и данные из базы только для просмотра.
// Добавление, изменение, смена статусов и импорт — 5-я неделя (ТЗ, таблица 6).
// Настоящая защита данных — в firestore.rules, здесь только то, что показать сотруднику
import { db, collection, doc, getDoc, getDocs, orderBy, query } from './firebase.js';
import { currentUser, STAFF_ROLES } from './auth.js';
import { ORDER_STATUSES, PURPOSES } from './dictionaries.js';
import { escapeHtml, formatPrice, statusLabel } from './ui.js';

// Какие разделы видит каждая роль (docs/database.md, права доступа)
const SECTIONS = {
  admin: ['products', 'categories', 'orders', 'import'],
  content: ['products', 'categories', 'import'],
  manager: ['products', 'categories', 'orders'],
};

const fill = (name, rows) => {
  document.querySelector(`[data-table="${name}"]`).innerHTML = rows.join('');
  document.querySelector(`[data-count="${name}"]`).textContent = `(${rows.length})`;
};
const cell = (label, value) => `<td data-label="${label}">${value}</td>`;

function showSection(allowed) {
  const wanted = location.hash.slice(1);
  const active = allowed.includes(wanted) ? wanted : allowed[0];
  document.querySelectorAll('[data-section]').forEach((s) => {
    s.hidden = s.dataset.section !== active;
  });
  document.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.hidden = !allowed.includes(tab.dataset.tab);
    if (tab.dataset.tab === active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
}

async function loadCatalog() {
  const [categoriesSnap, productsSnap] = await Promise.all([
    getDocs(query(collection(db, 'categories'), orderBy('order'))),
    getDocs(query(collection(db, 'products'), orderBy('name'))),
  ]);
  const products = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const nameOf = Object.fromEntries(categoriesSnap.docs.map((d) => [d.id, d.data().name]));

  fill('products', products.map((p) => `<tr>
    ${cell('Название', `<a href="product.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a>`)}
    ${cell('Категория', escapeHtml(nameOf[p.categoryId] ?? p.categoryId))}
    ${cell('Производитель', escapeHtml(p.manufacturer))}
    ${cell('Цена', formatPrice(p.price))}
    ${cell('Остаток', p.stock > 0 ? `${p.stock} шт.` : 'под заказ')}
  </tr>`));

  fill('categories', categoriesSnap.docs.map((d) => {
    const c = d.data();
    return `<tr>
      ${cell('№', c.order)}
      ${cell('Название', `<a href="index.html?category=${encodeURIComponent(d.id)}">${escapeHtml(c.name)}</a>`)}
      ${cell('Назначение', PURPOSES[c.purpose] ?? '')}
      ${cell('Товаров', products.filter((p) => p.categoryId === d.id).length)}
    </tr>`;
  }));
}

async function loadOrders() {
  const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')));
  fill('orders', snap.docs.map((d) => {
    const o = d.data();
    return `<tr>
      ${cell('Номер', escapeHtml(o.number))}
      ${cell('Дата', o.createdAt?.toDate().toLocaleDateString('ru-RU') ?? '')}
      ${cell('Покупатель', escapeHtml(o.contact?.name))}
      ${cell('Телефон', escapeHtml(o.contact?.phone))}
      ${cell('Получение', o.delivery?.method === 'delivery' ? 'Доставка' : 'Самовывоз')}
      ${cell('Сумма', formatPrice(o.total))}
      ${cell('Статус', statusLabel(o.status, ORDER_STATUSES))}
    </tr>`;
  }));
}

async function main() {
  const user = await currentUser();
  if (!user) {
    location.replace('login.html?next=admin.html');
    return;
  }
  const profile = (await getDoc(doc(db, 'users', user.uid))).data();
  document.querySelector('[data-admin-loading]').hidden = true;
  if (!STAFF_ROLES.includes(profile?.role)) {
    document.querySelector('[data-admin-denied]').hidden = false;
    return;
  }
  const allowed = SECTIONS[profile.role];
  showSection(allowed);
  addEventListener('hashchange', () => showSection(allowed));
  document.querySelector('[data-admin]').hidden = false;
  await Promise.all([loadCatalog(), allowed.includes('orders') ? loadOrders() : null]);
}

main().catch((err) => {
  console.error(err);
  const loading = document.querySelector('[data-admin-loading]');
  loading.hidden = false;
  loading.className = 'error';
  loading.textContent = 'Не удалось загрузить данные. Обновите страницу.';
});
