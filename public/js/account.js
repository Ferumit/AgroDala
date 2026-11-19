// Личный кабинет: профиль, адрес доставки, история заказов с подробностями, выход.
// Новый заказ (ещё не подтверждённый менеджером) покупатель может отменить сам
import {
  auth,
  db,
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  signOut,
} from './firebase.js';
import { currentUser, ensureProfile, STAFF_ROLES } from './auth.js';
import { ORDER_STATUSES, ROLES } from './dictionaries.js';
import { escapeHtml, formatPrice, statusLabel } from './ui.js';
import { openOrderDialog } from './order-dialog.js';

const form = document.querySelector('[data-profile]');
const message = document.querySelector('[data-message]');
const ordersBody = document.querySelector('[data-orders]');

function showMessage(text, kind) {
  message.textContent = text;
  message.className = `form-message form-message--${kind}`;
  message.hidden = false;
}

function fillProfile(user, profile) {
  document.querySelector('[data-greeting]').textContent = `Здравствуйте, ${profile.name}`;
  form.name.value = profile.name;
  form.phone.value = profile.phone ?? '';
  form.email.value = user.email;
  const [address] = profile.addresses ?? [];
  form.city.value = address?.city ?? '';
  form.street.value = address?.street ?? '';

  if (STAFF_ROLES.includes(profile.role)) {
    const staff = document.querySelector('[data-staff]');
    staff.innerHTML = `Ваша роль: <strong>${ROLES[profile.role]}</strong>. <a href="admin.html">Перейти в административную панель</a>`;
    staff.hidden = false;
  }
}

let orders = new Map();

async function loadOrders(uid) {
  const snap = await getDocs(
    query(collection(db, 'orders'), where('userId', '==', uid), orderBy('createdAt', 'desc'))
  );
  orders = new Map(snap.docs.map((d) => [d.id, d.data()]));
  if (snap.empty) {
    ordersBody.innerHTML = '<tr><td colspan="4" class="muted">Заказов пока нет</td></tr>';
    return;
  }
  ordersBody.innerHTML = snap.docs
    .map((d) => {
      const o = d.data();
      return `<tr>
        <td data-label="Номер"><button class="link-button" type="button" data-order="${escapeHtml(d.id)}"
          title="Состав и история заказа">${escapeHtml(o.number)}</button></td>
        <td data-label="Дата">${o.createdAt?.toDate().toLocaleDateString('ru-RU') ?? ''}</td>
        <td data-label="Сумма">${formatPrice(o.total)}</td>
        <td data-label="Статус">${statusLabel(o.status, ORDER_STATUSES)}</td>
      </tr>`;
    })
    .join('');
}

const cancelActions = (order) => (order.status === 'new' ? ['cancelled'] : []);

ordersBody.addEventListener('click', (event) => {
  const button = event.target.closest('[data-order]');
  if (!button) return;
  const id = button.dataset.order;
  const order = orders.get(id);
  openOrderDialog(order, {
    actions: cancelActions(order),
    onAction: async (status) => {
      const { call, callErrorMessage } = await import('./functions.js');
      try {
        await call('setOrderStatus', { orderId: id, status });
      } catch (err) {
        throw new Error(callErrorMessage(err));
      }
      const updated = (await getDoc(doc(db, 'orders', id))).data();
      await loadOrders(auth.currentUser.uid);
      return { order: updated, actions: cancelActions(updated) };
    },
  });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  const city = form.city.value.trim();
  const street = form.street.value.trim();
  try {
    await updateDoc(doc(db, 'users', auth.currentUser.uid), {
      name: form.name.value.trim(),
      phone: form.phone.value.trim(),
      addresses: city || street ? [{ label: 'Основной', city, street }] : [],
    });
    document.querySelector('[data-greeting]').textContent = `Здравствуйте, ${form.name.value.trim()}`;
    showMessage('Изменения сохранены.', 'success');
  } catch (err) {
    console.error(err);
    showMessage('Не удалось сохранить. Проверьте данные и попробуйте снова.', 'error');
  } finally {
    button.disabled = false;
  }
});

document.querySelector('[data-logout]').addEventListener('click', async () => {
  await signOut(auth);
  location.replace('index.html');
});

const user = await currentUser();
if (!user) {
  location.replace('login.html?next=account.html');
} else {
  try {
    fillProfile(user, await ensureProfile(user));
    document.querySelector('[data-account]').hidden = false;
    await loadOrders(user.uid);
  } catch (err) {
    console.error(err);
    showMessage('Не удалось загрузить данные кабинета. Обновите страницу.', 'error');
    document.querySelector('[data-account]').hidden = false;
  }
}
