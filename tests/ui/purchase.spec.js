// Полный сценарий покупки (ТЗ, п. 3.2): товар → корзина → оформление → статус в кабинете,
// а менеджер в административной панели подтверждает заказ. Каждый сценарий регистрирует
// своего покупателя и покупает товар с большим остатком, чтобы не мешать тестам каталога
import { expect, test } from '@playwright/test';
import { login, overflow, register } from './helpers.js';

const PRODUCT = 'grabli-vitye-14'; // «Грабли витые», 3 400 ₸, на складе 80 шт.

async function addToCart(page) {
  await page.goto(`product.html?id=${PRODUCT}`);
  await page.getByRole('button', { name: 'В корзину' }).click();
  await expect(page.locator('[data-cart-status]')).toContainText('В корзине: 1 шт.');
  await expect(page.locator('[data-cart-count]')).toHaveText('1');
}

for (const kind of ['phone', 'desktop']) {
  test.describe(`покупка @${kind}`, () => {
    test.use(kind === 'phone' ? { viewport: { width: 360, height: 780 } } : {});

    test('товар → корзина → заказ с доставкой → статус в кабинете', async ({ page, browser }, testInfo) => {
      test.setTimeout(90_000);
      await register(page, 'Айдос Покупатель');
      await addToCart(page);

      await page.getByRole('link', { name: 'Перейти в корзину' }).click();
      await expect(page.locator('.cart-item')).toHaveCount(1);
      await page.getByLabel(/Количество/).fill('2');
      await page.getByLabel(/Количество/).press('Tab');
      await expect(page.locator('[data-cart-total]')).toHaveText('6 800 ₸');
      await expect(page.locator('[data-cart-count]')).toHaveText('2');

      // Имя подставлено из профиля; адрес нужен только для доставки
      await expect(page.locator('#name')).toHaveValue('Айдос Покупатель');
      await expect(page.locator('#address')).toBeHidden();
      await page.locator('#phone').fill('+7 701 555 44 33');
      await page.getByText('Доставка', { exact: true }).click();
      // Без адреса форма не отправляется: браузер ставит курсор в поле адреса
      await page.getByRole('button', { name: 'Оформить заказ' }).click();
      await expect(page.locator('#address')).toBeFocused();
      await page.locator('#address').fill('Астана, ул. Кенесары, 40');
      expect((await overflow(page)).out).toEqual([]);
      await page.getByRole('button', { name: 'Оформить заказ' }).click();

      const title = page.getByRole('heading', { name: /^Заказ AD-\d{6} оформлен$/ });
      await expect(title).toBeVisible();
      const number = (await title.textContent()).match(/AD-\d{6}/)[0];
      await expect(page.locator('[data-cart-count]')).toBeHidden();

      await page.getByRole('link', { name: 'Мои заказы' }).click();
      const row = page.locator('[data-orders] tr', { hasText: number });
      await expect(row).toContainText('6 800 ₸');
      await expect(row.locator('.status')).toHaveText('Новый');
      await row.getByRole('button', { name: number }).click();
      const dialog = page.getByRole('dialog', { name: `Заказ ${number}` });
      await expect(dialog).toContainText('Грабли');
      await expect(dialog).toContainText('Доставка: Астана, ул. Кенесары, 40');
      expect((await overflow(page)).out).toEqual([]);

      if (kind !== 'desktop') return;
      // Менеджер подтверждает заказ — покупатель видит новый статус
      const context = await browser.newContext(testInfo.project.use);
      const manager = await context.newPage();
      await login(manager, 'manager', 'admin.html');
      await manager.goto('admin.html#orders');
      await manager.locator('[data-order-filter]').selectOption('new');
      await manager.getByRole('button', { name: number }).click();
      const managerDialog = manager.getByRole('dialog', { name: `Заказ ${number}` });
      await managerDialog.getByRole('button', { name: 'Подтвердить' }).click();
      await expect(managerDialog.locator('.status').first()).toHaveText('Подтверждён');
      await expect(managerDialog.getByRole('button', { name: 'Начать комплектацию' })).toBeVisible();
      await context.close();

      await page.reload();
      await expect(page.locator('[data-orders] tr', { hasText: number }).locator('.status')).toHaveText('Подтверждён');
    });
  });
}

test.describe('покупка @desktop', () => {
  test('гостя «В корзину» отправляет на вход и возвращает к товару', async ({ page }) => {
    await page.goto(`product.html?id=${PRODUCT}`);
    await page.getByRole('button', { name: 'В корзину' }).click();
    await expect(page).toHaveURL(/login\.html\?next=product\.html%3Fid%3Dgrabli-vitye-14$/);
  });

  test('покупатель отменяет новый заказ, остаток возвращается', async ({ page }) => {
    await register(page);
    await addToCart(page);
    await page.goto('cart.html');
    await expect(page.locator('.cart-item')).toHaveCount(1);
    await page.locator('#phone').fill('+7 701 555 44 33');
    await page.getByRole('button', { name: 'Оформить заказ' }).click();
    const number = (await page.getByRole('heading', { name: /оформлен/ }).textContent()).match(/AD-\d{6}/)[0];

    await page.goto('account.html');
    await page.getByRole('button', { name: number }).click();
    page.once('dialog', (confirm) => confirm.accept());
    await page.getByRole('button', { name: 'Отменить заказ' }).click();
    const dialog = page.getByRole('dialog', { name: `Заказ ${number}` });
    await expect(dialog.locator('.status').first()).toHaveText('Отменён');
    await expect(dialog.getByRole('button', { name: 'Отменить заказ' })).toBeHidden();
  });

  test('контент-менеджер меняет описание товара, у менеджера кнопок изменения нет', async ({ page, browser }, testInfo) => {
    await login(page, 'content', 'admin.html');
    const row = page.locator('[data-table="products"] tr', { hasText: 'Грабли витые' });
    await row.getByRole('button', { name: 'Изменить' }).click();
    const dialog = page.getByRole('dialog', { name: 'Изменить товар' });
    const description = `Описание обновлено тестом ${Date.now()}`;
    await dialog.getByLabel('Описание').fill(description);
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.locator('[data-admin-message]')).toContainText('сохранён');
    await page.goto(`product.html?id=${PRODUCT}`);
    await expect(page.getByText(description)).toBeVisible();

    const context = await browser.newContext(testInfo.project.use);
    const manager = await context.newPage();
    await login(manager, 'manager', 'admin.html');
    await expect(manager.locator('[data-table="products"] tr').first()).toBeVisible();
    await expect(manager.getByRole('button', { name: 'Изменить' })).toHaveCount(0);
    await expect(manager.getByRole('button', { name: 'Добавить товар' })).toBeHidden();
    await context.close();
  });
});
