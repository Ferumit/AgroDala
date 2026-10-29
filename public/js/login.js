// Вход, регистрация и восстановление пароля (Firebase Authentication)
import {
  auth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
} from './firebase.js';
import { authErrorMessage, currentUser, ensureProfile, nextPage } from './auth.js';

const message = document.querySelector('[data-message]');
const forms = Object.fromEntries(
  [...document.querySelectorAll('[data-form]')].map((form) => [form.dataset.form, form])
);
const tabs = document.querySelectorAll('[role="tab"]');

function showMessage(text, kind = 'error') {
  message.textContent = text;
  message.className = `form-message form-message--${kind}`;
  message.hidden = false;
}

// Вкладки: #register и #reset в адресе сразу открывают нужную форму
function showTab(name) {
  if (!forms[name]) name = 'login';
  for (const [key, form] of Object.entries(forms)) form.hidden = key !== name;
  tabs.forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.tab === name)));
  message.hidden = true;
  history.replaceState(null, '', name === 'login' ? location.pathname + location.search : `#${name}`);
  // Почту, введённую в одной форме, переносим в другую
  const email = [...document.querySelectorAll('input[type="email"]')].find((i) => i.value)?.value;
  if (email && !forms[name].email.value) forms[name].email.value = email;
  forms[name].querySelector('input')?.focus();
}

document.querySelectorAll('[data-tab]').forEach((el) =>
  el.addEventListener('click', () => showTab(el.dataset.tab))
);

// Кнопка блокируется на время запроса, чтобы не отправить форму дважды
async function submitting(form, busyText, action) {
  const button = form.querySelector('[type="submit"]');
  const text = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  message.hidden = true;
  try {
    await action();
  } catch (err) {
    console.error(err);
    showMessage(authErrorMessage(err));
  } finally {
    button.disabled = false;
    button.textContent = text;
  }
}

forms.login.addEventListener('submit', (event) => {
  event.preventDefault();
  const { email, password } = forms.login;
  submitting(forms.login, 'Вход…', async () => {
    const { user } = await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
    await ensureProfile(user);
    location.replace(nextPage());
  });
});

const { password, password2 } = forms.register;
password2.addEventListener('input', () =>
  password2.setCustomValidity(password2.value === password.value ? '' : 'Пароли не совпадают')
);

forms.register.addEventListener('submit', (event) => {
  event.preventDefault();
  const { name, phone, email } = forms.register;
  submitting(forms.register, 'Регистрация…', async () => {
    const { user } = await createUserWithEmailAndPassword(auth, email.value.trim(), password.value);
    await updateProfile(user, { displayName: name.value.trim() });
    await ensureProfile(user, { name: name.value.trim(), phone: phone.value.trim() });
    location.replace(nextPage());
  });
});

forms.reset.addEventListener('submit', (event) => {
  event.preventDefault();
  const { email } = forms.reset;
  submitting(forms.reset, 'Отправка…', async () => {
    try {
      await sendPasswordResetEmail(auth, email.value.trim());
    } catch (err) {
      // Не сообщаем, есть ли такой адрес в базе: иначе по форме можно проверять чужие почты
      if (err.code !== 'auth/user-not-found') throw err;
    }
    showMessage(`Если адрес ${email.value.trim()} зарегистрирован, на него придёт письмо со ссылкой.`, 'success');
  });
});

// Уже вошли — форма входа не нужна
if (await currentUser()) {
  location.replace(nextPage());
} else {
  showTab(location.hash.slice(1));
}
