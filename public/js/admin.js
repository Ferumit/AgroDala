// Административная панель (ТЗ, таблица 2): товары, категории, заказы, импорт из Excel (CSV).
// Разделы зависят от роли сотрудника. Каталог контент-менеджер и администратор меняют прямо
// в Firestore — что и кому можно, проверяют правила firestore.rules и storage.rules.
// Заказы и импорт идут через Cloud Functions (functions/index.js): там пересчитываются остатки,
// ведётся история статусов и создаются учётные записи клиентов
import {
  db,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  orderBy,
  photoUrl,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from './firebase.js';
import { currentUser, STAFF_ROLES } from './auth.js';
import { derivedFields } from './catalog.js';
import { DELIVERY_METHODS, ORDER_STATUSES, ORIGINS, PURPOSES, TYPES, nextStatuses } from './dictionaries.js';
import { openOrderDialog } from './order-dialog.js';
import { escapeHtml, formatPrice, statusLabel } from './ui.js';

// Какие разделы видит каждая роль (docs/database.md, права доступа)
const SECTIONS = {
  admin: ['products', 'categories', 'orders', 'import'],
  content: ['products', 'categories', 'import'],
  manager: ['products', 'categories', 'orders'],
};
const CATALOG_EDITORS = ['content', 'admin'];
// Иконки для категорий — файлы из img/icons
const CATEGORY_ICONS = ['tractor', 'construction', 'sprout', 'cog', 'shovel', 'droplets', 'zap', 'wheat', 'package', 'truck', 'store'];

let role = null;
let categories = [];
let products = [];
let orders = [];

const $ = (selector, root = document) => root.querySelector(selector);
const cell = (label, value) => `<td data-label="${label}">${value}</td>`;
const isEditor = () => CATALOG_EDITORS.includes(role);

function fill(name, rows, total = rows.length) {
  $(`[data-table="${name}"]`).innerHTML = rows.join('') || `<tr><td colspan="8" class="muted">Ничего нет</td></tr>`;
  $(`[data-count="${name}"]`).textContent = rows.length === total ? `(${total})` : `(${rows.length} из ${total})`;
}

function showMessage(text, kind = 'success') {
  const box = $('[data-admin-message]');
  box.textContent = text;
  box.className = `form-message form-message--${kind}`;
  box.hidden = false;
}

function formMessage(form, text) {
  const box = $('[data-form-message]', form);
  box.textContent = text;
  box.className = 'form-message form-message--error';
  box.hidden = !text;
}

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

const actions = (kind, id) =>
  isEditor()
    ? cell('', `<div class="row-actions">
        <button class="btn btn--ghost btn--small" type="button" data-edit-${kind}="${escapeHtml(id)}">Изменить</button>
        <button class="btn btn--ghost btn--small" type="button" data-delete-${kind}="${escapeHtml(id)}">Удалить</button>
      </div>`)
    : '';

// ---------- Каталог ----------

async function loadCatalog() {
  const [categoriesSnap, productsSnap] = await Promise.all([
    getDocs(query(collection(db, 'categories'), orderBy('order'))),
    getDocs(query(collection(db, 'products'), orderBy('name'))),
  ]);
  categories = categoriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  products = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const nameOf = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  fill('products', products.map((p) => `<tr>
    ${cell('Название', `<a href="product.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a>`)}
    ${cell('Категория', escapeHtml(nameOf[p.categoryId] ?? p.categoryId))}
    ${cell('Производитель', escapeHtml(p.manufacturer))}
    ${cell('Цена', formatPrice(p.price))}
    ${cell('Остаток', p.stock > 0 ? `${p.stock} шт.` : 'под заказ')}
    ${actions('product', p.id)}
  </tr>`));

  fill('categories', categories.map((c) => `<tr>
    ${cell('№', c.order)}
    ${cell('Название', `<a href="index.html?category=${encodeURIComponent(c.id)}">${escapeHtml(c.name)}</a>`)}
    ${cell('Назначение', PURPOSES[c.purpose] ?? '')}
    ${cell('Товаров', products.filter((p) => p.categoryId === c.id).length)}
    ${actions('category', c.id)}
  </tr>`));
}

function options(select, dict, selected) {
  select.innerHTML = Object.entries(dict)
    .map(([value, label]) => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`)
    .join('');
}

// «Мощность: 7 л. с.» по строкам → { Мощность: '7 л. с.' }
function parseSpecs(text) {
  const specs = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    const name = line.slice(0, at).trim().slice(0, 60);
    const value = line.slice(at + 1).trim().slice(0, 200);
    if (name && value) specs[name] = value;
  }
  return specs;
}

const productDialog = $('[data-product-dialog]');
const productForm = $('[data-product-form]');
let editingProduct = null;

function openProduct(id) {
  const p = id ? products.find((x) => x.id === id) : null;
  editingProduct = p;
  const f = productForm;
  $('#product-dialog-title').textContent = p ? 'Изменить товар' : 'Новый товар';
  const categoryId = p?.categoryId ?? categories[0]?.id;
  options(f.categoryId, Object.fromEntries(categories.map((c) => [c.id, c.name])), categoryId);
  options(f.purpose, PURPOSES, p?.purpose ?? categories.find((c) => c.id === categoryId)?.purpose);
  options(f.type, TYPES, p?.type ?? 'mini');
  options(f.origin, ORIGINS, p?.origin ?? 'china');
  f.name.value = p?.name ?? '';
  f.manufacturer.value = p?.manufacturer ?? '';
  f.country.value = p?.country ?? '';
  f.price.value = p?.price ?? '';
  f.stock.value = p?.stock ?? 0;
  f.description.value = p?.description ?? '';
  f.specs.value = Object.entries(p?.specs ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  f.photo.value = '';
  const preview = $('[data-photo-preview]');
  preview.hidden = !p?.thumbnail;
  if (p?.thumbnail) preview.src = photoUrl(p.thumbnail);
  $('#manufacturers').innerHTML = [...new Set(products.map((x) => x.manufacturer))]
    .map((m) => `<option value="${escapeHtml(m)}">`)
    .join('');
  formMessage(f, '');
  productDialog.showModal();
}

// Новый товар получает назначение своей категории; его можно поменять
productForm.categoryId.addEventListener('change', () => {
  const category = categories.find((c) => c.id === productForm.categoryId.value);
  if (category && !editingProduct) productForm.purpose.value = category.purpose;
});

productForm.photo.addEventListener('change', () => {
  const [file] = productForm.photo.files;
  const preview = $('[data-photo-preview]');
  if (file) {
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
  }
});

productForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const f = productForm;
  if (!f.reportValidity()) return;
  const price = Number(f.price.value);
  const stock = Number(f.stock.value);
  if (!Number.isInteger(price) || !Number.isInteger(stock)) {
    formMessage(f, 'Цена и остаток — целые числа.');
    return;
  }
  const [file] = f.photo.files;
  if (file && file.size > 20 * 1024 * 1024) {
    formMessage(f, 'Фото больше 20 МБ. Выберите снимок поменьше.');
    return;
  }
  const save = $('[type="submit"]', f);
  save.disabled = true;
  save.textContent = file ? 'Загружаем фото…' : 'Сохраняем…';
  const name = f.name.value.trim();
  const manufacturer = f.manufacturer.value.trim();
  const country = f.country.value.trim();
  const description = f.description.value.trim();
  const specs = parseSpecs(f.specs.value);
  const old = editingProduct;
  try {
    const ref = old ? doc(db, 'products', old.id) : doc(collection(db, 'products'));
    let photos = {};
    let upload = null;
    if (file) {
      upload = await import('./photo-upload.js');
      photos = await upload.uploadProductPhoto(ref.id, file);
    }
    const data = {
      name,
      categoryId: f.categoryId.value,
      purpose: f.purpose.value,
      type: f.type.value,
      manufacturer,
      origin: f.origin.value,
      price,
      stock,
      ...derivedFields({ name, manufacturer, price, stock }),
      ...photos,
    };
    const hasSpecs = Object.keys(specs).length > 0;
    if (old) {
      await updateDoc(ref, {
        ...data,
        country: country || deleteField(),
        description: description || deleteField(),
        specs: hasSpecs ? specs : deleteField(),
        // Подпись автора относится к старому фото с Wikimedia Commons
        ...(file && { imageCredit: deleteField() }),
      });
      if (upload) await upload.deletePhotos([...(old.images ?? []), old.thumbnail]);
    } else {
      await setDoc(ref, {
        ...data,
        ...(country && { country }),
        ...(description && { description }),
        ...(hasSpecs && { specs }),
        createdAt: serverTimestamp(),
      });
    }
    productDialog.close();
    showMessage(`Товар «${name}» сохранён.`);
    await loadCatalog();
  } catch (err) {
    console.error(err);
    formMessage(f, err.code === 'permission-denied'
      ? 'База не приняла данные: проверьте поля (название до 200 символов, цена больше нуля) и права доступа.'
      : 'Не удалось сохранить. Проверьте интернет и попробуйте снова.');
  } finally {
    save.disabled = false;
    save.textContent = 'Сохранить';
  }
});

async function deleteProduct(id) {
  const p = products.find((x) => x.id === id);
  if (!confirm(`Удалить товар «${p.name}»? В уже оформленных заказах он останется.`)) return;
  try {
    await deleteDoc(doc(db, 'products', id));
    const { deletePhotos } = await import('./photo-upload.js');
    await deletePhotos([...(p.images ?? []), p.thumbnail]);
    showMessage(`Товар «${p.name}» удалён.`);
    await loadCatalog();
  } catch (err) {
    console.error(err);
    showMessage('Не удалось удалить товар.', 'error');
  }
}

// ---------- Категории ----------

const TRANSLIT = Object.fromEntries(
  'а:a б:b в:v г:g д:d е:e ё:e ж:zh з:z и:i й:y к:k л:l м:m н:n о:o п:p р:r с:s т:t у:u ф:f х:h ц:ts ч:ch ш:sh щ:sch ъ: ы:y ь: э:e ю:yu я:ya ә:a ғ:g қ:k ң:n ө:o ұ:u ү:u һ:h і:i'
    .split(' ')
    .map((pair) => pair.split(':'))
);

// Код категории для адреса страницы: «Садовая техника» → sadovaya-tehnika
export function slugify(name) {
  const slug = [...name.toLowerCase()]
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'category';
}

const categoryDialog = $('[data-category-dialog]');
const categoryForm = $('[data-category-form]');
let editingCategory = null;

function openCategory(id) {
  const c = id ? categories.find((x) => x.id === id) : null;
  editingCategory = c;
  const f = categoryForm;
  $('#category-dialog-title').textContent = c ? 'Изменить категорию' : 'Новая категория';
  f.name.value = c?.name ?? '';
  options(f.purpose, PURPOSES, c?.purpose ?? 'general');
  f.order.value = c?.order ?? Math.max(0, ...categories.map((x) => x.order)) + 1;
  f.description.value = c?.description ?? '';
  const current = c?.icon ?? 'package';
  $('[data-icon-choices]').innerHTML = CATEGORY_ICONS.map(
    (name) => `<label class="chip"><input type="radio" name="icon" value="${name}"${name === current ? ' checked' : ''}>
      <span><span class="icon" style="-webkit-mask-image: url(img/icons/${name}.svg); mask-image: url(img/icons/${name}.svg)" aria-hidden="true"></span>
      <span class="visually-hidden">${name}</span></span></label>`
  ).join('');
  formMessage(f, '');
  categoryDialog.showModal();
}

categoryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const f = categoryForm;
  if (!f.reportValidity()) return;
  const order = Number(f.order.value);
  if (!Number.isInteger(order)) {
    formMessage(f, 'Порядок — целое число.');
    return;
  }
  const name = f.name.value.trim();
  const description = f.description.value.trim();
  const data = { name, icon: f.icon.value, purpose: f.purpose.value, order };
  try {
    if (editingCategory) {
      await updateDoc(doc(db, 'categories', editingCategory.id), { ...data, description: description || deleteField() });
    } else {
      // Код из названия; если такой уже есть — с номером: sadovaya-tehnika-2
      const base = slugify(name);
      let id = base;
      for (let n = 2; categories.some((c) => c.id === id) || (await getDoc(doc(db, 'categories', id))).exists(); n++) {
        id = `${base}-${n}`;
      }
      await setDoc(doc(db, 'categories', id), { ...data, ...(description && { description }) });
    }
    categoryDialog.close();
    showMessage(`Категория «${name}» сохранена.`);
    await loadCatalog();
  } catch (err) {
    console.error(err);
    formMessage(f, 'Не удалось сохранить категорию. Проверьте поля и попробуйте снова.');
  }
});

async function deleteCategory(id) {
  const c = categories.find((x) => x.id === id);
  const count = products.filter((p) => p.categoryId === id).length;
  if (count > 0) {
    showMessage(`В категории «${c.name}» товаров: ${count}. Сначала перенесите их в другую категорию или удалите.`, 'error');
    return;
  }
  if (!confirm(`Удалить категорию «${c.name}»?`)) return;
  try {
    await deleteDoc(doc(db, 'categories', id));
    showMessage(`Категория «${c.name}» удалена.`);
    await loadCatalog();
  } catch (err) {
    console.error(err);
    showMessage('Не удалось удалить категорию.', 'error');
  }
}

// Закрытие окон кнопками «Отмена» и крестиком
document.querySelectorAll('dialog [data-close]').forEach((button) =>
  button.addEventListener('click', () => button.closest('dialog').close())
);

document.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  const { newItem, editProduct, deleteProduct: delP, editCategory, deleteCategory: delC } = {
    newItem: target.dataset.new,
    editProduct: target.dataset.editProduct,
    deleteProduct: target.dataset.deleteProduct,
    editCategory: target.dataset.editCategory,
    deleteCategory: target.dataset.deleteCategory,
  };
  if (newItem === 'product') openProduct(null);
  else if (newItem === 'category') openCategory(null);
  else if (editProduct) openProduct(editProduct);
  else if (delP) deleteProduct(delP);
  else if (editCategory) openCategory(editCategory);
  else if (delC) deleteCategory(delC);
});

// ---------- Заказы ----------

const FILTERS = {
  '': () => true,
  active: (o) => !['completed', 'cancelled'].includes(o.status),
  new: (o) => o.status === 'new',
  done: (o) => ['completed', 'cancelled'].includes(o.status),
};
const orderFilter = $('[data-order-filter]');

function renderOrders() {
  const shown = orders.filter(FILTERS[orderFilter.value]);
  fill('orders', shown.map((o) => `<tr>
      ${cell('Номер', `<button class="link-button" type="button" data-order="${escapeHtml(o.id)}">${escapeHtml(o.number)}</button>`)}
      ${cell('Дата', o.createdAt?.toDate().toLocaleDateString('ru-RU') ?? '')}
      ${cell('Покупатель', escapeHtml(o.contact?.name))}
      ${cell('Телефон', escapeHtml(o.contact?.phone))}
      ${cell('Получение', DELIVERY_METHODS[o.delivery?.method] ?? '')}
      ${cell('Сумма', formatPrice(o.total))}
      ${cell('Статус', statusLabel(o.status, ORDER_STATUSES))}
    </tr>`), orders.length);
}

async function loadOrders() {
  const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')));
  orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderOrders();
}

orderFilter.addEventListener('change', renderOrders);

$('[data-table="orders"]').addEventListener('click', (event) => {
  const button = event.target.closest('[data-order]');
  if (!button) return;
  const order = orders.find((o) => o.id === button.dataset.order);
  const allowed = (o) => nextStatuses(o.status, o.delivery?.method);
  openOrderDialog(order, {
    actions: allowed(order),
    onAction: async (status) => {
      const { call, callErrorMessage } = await import('./functions.js');
      try {
        await call('setOrderStatus', { orderId: order.id, status });
      } catch (err) {
        throw new Error(callErrorMessage(err));
      }
      const updated = { id: order.id, ...(await getDoc(doc(db, 'orders', order.id))).data() };
      orders = orders.map((o) => (o.id === order.id ? updated : o));
      renderOrders();
      // Отмена вернула товар на склад — обновляем остатки в таблице товаров
      if (status === 'cancelled') loadCatalog().catch(console.error);
      return { order: updated, actions: allowed(updated) };
    },
  });
});

// ---------- Импорт ----------

const importForm = $('[data-import]');
const report = $('[data-import-report]');

importForm.addEventListener('change', (event) => {
  if (event.target.name !== 'kind') return;
  document.querySelectorAll('[data-import-help]').forEach((p) => {
    p.hidden = p.dataset.importHelp !== event.target.value;
  });
});

// Excel сохраняет CSV либо в UTF-8, либо в кодировке Windows-1251 (старый «CSV (разделители…)»).
// Если файл не читается как UTF-8, значит он в Windows-1251
async function readCsv(file) {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1251').decode(buffer);
  }
}

importForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const [file] = importForm.file.files;
  if (!file) {
    importForm.file.reportValidity();
    return;
  }
  const kind = importForm.kind.value;
  const button = $('[type="submit"]', importForm);
  button.disabled = true;
  button.textContent = 'Загружаем…';
  report.hidden = true;
  try {
    const { call } = await import('./functions.js');
    const result = await call('importCsv', { kind, csv: await readCsv(file) });
    const what = kind === 'products' ? 'Товаров' : 'Клиентов';
    const errors = result.errors.length > 0
      ? `<p>Пропущены строки с ошибками (${result.errors.length}) — исправьте их в файле и загрузите его ещё раз:</p>
         <ul>${result.errors.slice(0, 50).map((e) => `<li>Строка ${e.line}: ${e.messages.map(escapeHtml).join('; ')}</li>`).join('')}</ul>`
      : '';
    const unknown = result.unknownColumns.length > 0
      ? `<p class="muted">Не учтены столбцы: ${result.unknownColumns.map(escapeHtml).join(', ')}.</p>`
      : '';
    report.innerHTML = `<p class="form-message form-message--${result.errors.length ? 'error' : 'success'}">
        ${what} добавлено: ${result.created}, обновлено: ${result.updated}.</p>${errors}${unknown}`;
    if (kind === 'products') await loadCatalog();
  } catch (err) {
    console.error(err);
    const { callErrorMessage } = await import('./functions.js');
    report.innerHTML = `<p class="form-message form-message--error">${escapeHtml(callErrorMessage(err))}</p>`;
  } finally {
    report.hidden = false;
    button.disabled = false;
    button.textContent = 'Загрузить';
  }
});

// ---------- Запуск ----------

async function main() {
  const user = await currentUser();
  if (!user) {
    location.replace('login.html?next=admin.html');
    return;
  }
  const profile = (await getDoc(doc(db, 'users', user.uid))).data();
  $('[data-admin-loading]').hidden = true;
  if (!STAFF_ROLES.includes(profile?.role)) {
    $('[data-admin-denied]').hidden = false;
    return;
  }
  role = profile.role;
  const allowed = SECTIONS[role];
  document.querySelectorAll('[data-editor-only]').forEach((el) => {
    el.hidden = !isEditor();
  });
  // Клиентов (персональные данные) импортирует только администратор
  $('[data-import-users]').hidden = role !== 'admin';
  showSection(allowed);
  addEventListener('hashchange', () => showSection(allowed));
  $('[data-admin]').hidden = false;
  await Promise.all([loadCatalog(), allowed.includes('orders') ? loadOrders() : null]);
}

main().catch((err) => {
  console.error(err);
  const loading = $('[data-admin-loading]');
  loading.hidden = false;
  loading.className = 'error';
  loading.textContent = 'Не удалось загрузить данные. Обновите страницу.';
});
