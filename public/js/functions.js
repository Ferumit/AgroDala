// Вызов Cloud Functions (functions/index.js). Модуль подключают только страницы, которым функции
// нужны: корзина, кабинет и административная панель. Каталог и карточка товара его не грузят
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-functions.js';
import { app, backendFunctionsUrl, emulatorHost, isLocal, PORTS, REGION } from './firebase.js';

// Функции в облаке — в регионе REGION; функции на ноутбуке разработчика — по адресу backendFunctionsUrl
const functions = getFunctions(app, backendFunctionsUrl ?? REGION);
if (isLocal) connectFunctionsEmulator(functions, emulatorHost, PORTS.functions);

// Результат функции. Ошибки приходят с понятным текстом (message) и кодом (code: functions/…)
export async function call(name, data) {
  const result = await httpsCallable(functions, name, { timeout: 120_000 })(data);
  return result.data;
}

// Текст ошибки для пользователя. Функции сами формулируют понятные сообщения,
// а сетевые и внутренние сбои заменяются общим
export function callErrorMessage(err) {
  const shown = ['functions/invalid-argument', 'functions/failed-precondition', 'functions/permission-denied',
    'functions/not-found', 'functions/unauthenticated'];
  if (shown.includes(err?.code)) return err.message;
  // Ответа от функции нет совсем (нет сети, сервер выключен): у ошибки вместо текста — только код
  const noReply = err?.message === String(err?.code).replace('functions/', '');
  if (noReply || err?.code === 'functions/unavailable' || err?.code === 'functions/deadline-exceeded') {
    return backendFunctionsUrl
      ? 'Сервер магазина сейчас недоступен: в учебной версии заказы обрабатывает компьютер разработчика, ' +
          'и он может быть выключен. Каталог работает, попробуйте оформить позже.'
      : 'Нет связи с сервером. Проверьте интернет и попробуйте снова.';
  }
  return 'Не получилось. Попробуйте ещё раз.';
}
