// Общее для входа, регистрации и личного кабинета
import { auth, db, doc, getDoc, setDoc, serverTimestamp } from './firebase.js';

// Пользователь, когда Firebase уже прочитал сохранённую сессию (null — не вошёл)
export async function currentUser() {
  await auth.authStateReady();
  return auth.currentUser;
}

// Профиль покупателя в users/{uid}. Создаётся при регистрации; если тогда запись
// не удалась (например, пропал интернет), профиль создаётся при следующем входе
export async function ensureProfile(user, { name, phone } = {}) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();

  const profile = {
    name: (name || user.displayName || user.email.split('@')[0]).slice(0, 100),
    email: user.email,
    role: 'customer', // правила Firestore разрешают при регистрации только эту роль
    addresses: [],
    createdAt: serverTimestamp(),
    ...(phone && { phone }),
  };
  await setDoc(ref, profile);
  return profile;
}

export const STAFF_ROLES = ['manager', 'content', 'admin'];

// После входа возвращаем туда, откуда пришли: login.html?next=cart.html.
// Разрешены только страницы этого сайта, чтобы ссылкой нельзя было увести на чужой
export function nextPage(fallback = 'account.html') {
  const next = new URLSearchParams(location.search).get('next');
  return next && /^[a-z0-9-]+\.html(\?[\w=&%-]*)?$/.test(next) ? next : fallback;
}

const AUTH_ERRORS = {
  'auth/invalid-credential': 'Неверная почта или пароль.',
  'auth/wrong-password': 'Неверная почта или пароль.',
  'auth/user-not-found': 'Неверная почта или пароль.',
  'auth/invalid-email': 'Некорректный адрес электронной почты.',
  'auth/email-already-in-use': 'Этот адрес уже зарегистрирован. Войдите или восстановите пароль.',
  'auth/weak-password': 'Слишком простой пароль: нужно не меньше 6 символов.',
  'auth/missing-password': 'Введите пароль.',
  'auth/too-many-requests': 'Слишком много попыток. Подождите немного и попробуйте снова.',
  'auth/network-request-failed': 'Нет связи с сервером. Проверьте интернет и попробуйте снова.',
  'auth/user-disabled': 'Учётная запись заблокирована. Обратитесь в поддержку.',
};

export function authErrorMessage(err) {
  return AUTH_ERRORS[err?.code] ?? 'Не получилось. Попробуйте ещё раз.';
}
