// Личный кабинет: профиль, адрес доставки, история заказов, выход
import {
  auth,
  db,
  doc,
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
import { escapeHtml, formatPrice } from './ui.js';

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

async function loadOrders(uid) {
  const snap = await getDocs(
    query(collection(db, 'orders'), where('userId', '==', uid), orderBy('createdAt', 'desc'))
  );
  if (snap.empty) {
    ordersBody.innerHTML = '<tr><td colspan="4" class="muted">Заказов пока нет</td></tr>';
    return;
  }
  ordersBody.innerHTML = snap.docs
    .map((d) => {
      const o = d.data();
      return `<tr>
        <td>${escapeHtml(o.number)}</td>
        <td>${o.createdAt?.toDate().toLocaleDateString('ru-RU') ?? ''}</td>
        <td>${formatPrice(o.total)}</td>
        <td>${ORDER_STATUSES[o.status] ?? escapeHtml(o.status)}</td>
      </tr>`;
    })
    .join('');
}

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
