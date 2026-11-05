// Вход, регистрация и выход. Сценарии на телефоне важны отдельно: для мобильного браузера
// Firebase Auth работает иначе (см. комментарий в public/js/firebase.js)
import { expect, test } from '@playwright/test';
import { login } from './helpers.js';

for (const kind of ['phone', 'desktop']) {
  test.describe(`вход и регистрация @${kind}`, () => {
    test.use(kind === 'phone' ? { viewport: { width: 390, height: 844 } } : {});

    test('сессия не теряется при переходе сразу после входа: 8 входов подряд', async ({ browser }, testInfo) => {
      test.setTimeout(90_000);
      for (let i = 0; i < 8; i++) {
        const context = await browser.newContext(testInfo.project.use);
        const page = await context.newPage();
        await login(page, 'buyer');
        // Если сессия потеряна, кабинет отправит обратно на вход и заказов не будет
        await expect(page.locator('[data-orders] .status').first()).toBeVisible();
        await expect(page).toHaveURL(/account\.html$/);
        await context.close();
      }
    });

    test('сайт не загружает iframe входа через всплывающие окна', async ({ page }) => {
      const iframes = [];
      page.on('request', (request) => {
        if (/\/auth\/iframe|__\/auth\//.test(request.url())) iframes.push(request.url());
      });
      await login(page, 'buyer');
      await expect(page.locator('[data-orders] .status').first()).toBeVisible();
      expect(iframes).toEqual([]);
    });

    test('неверный пароль: сообщение, страница та же', async ({ page }) => {
      await page.goto('login.html');
      await page.locator('#login-email').fill('buyer@agrodala.example');
      await page.locator('#login-password').fill('wrong-password');
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText('Неверная почта или пароль.');
      await expect(page).toHaveURL(/login\.html/);
    });

    test('регистрация покупателя, выход и повторный вход', async ({ page }) => {
      const email = `new-${kind}-${Date.now()}@agrodala.example`;
      await page.goto('login.html');
      await page.getByRole('tab', { name: 'Регистрация' }).click();
      await page.locator('#register-name').fill('Новый Покупатель');
      await page.locator('#register-email').fill(email);
      await page.locator('#register-password').fill('secret-123');
      await page.locator('#register-password2').fill('secret-123');
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
      await page.waitForURL('**/account.html');
      await expect(page.getByRole('heading', { name: 'Здравствуйте, Новый Покупатель' })).toBeVisible();
      await expect(page.getByText('Заказов пока нет')).toBeVisible();
      // У нового покупателя корзина пуста, ссылки на админ-панель нет
      await expect(page.locator('[data-admin-link]')).toBeHidden();
      await page.getByRole('button', { name: 'Выйти' }).click();
      await page.waitForURL('**/index.html');
      await expect(page.getByRole('navigation', { name: 'Основное меню' }).getByRole('link', { name: 'Войти' })).toBeVisible();

      await page.goto('login.html');
      await page.locator('#login-email').fill(email);
      await page.locator('#login-password').fill('secret-123');
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      await page.waitForURL('**/account.html');
      await expect(page.getByRole('heading', { name: 'Здравствуйте, Новый Покупатель' })).toBeVisible();
    });

    test('покупатель сохраняет адрес доставки', async ({ page }) => {
      await login(page, 'farmer');
      const street = `ул. Целинная, ${Date.now() % 100}`;
      await page.locator('#street').fill(street);
      await page.getByRole('button', { name: 'Сохранить' }).click();
      await expect(page.locator('[data-message]')).toHaveText('Изменения сохранены.');
      await page.reload();
      await expect(page.locator('#street')).toHaveValue(street);
    });
  });
}
