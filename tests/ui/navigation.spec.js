// Навигация и данные на страницах: как покупатель и сотрудник ходят по сайту
import { expect, test } from '@playwright/test';
import { loadSeed } from '../../scripts/seed-data.js';
import { login } from './helpers.js';

const seed = await loadSeed();

// На телефоне и компьютере один и тот же сценарий: разметка меню одна
for (const kind of ['phone', 'desktop']) {
  test.describe(`навигация @${kind}`, () => {
    test.use(kind === 'phone' ? { viewport: { width: 390, height: 844 } } : {});

    test('из шапки открываются каталог, корзина и вход', async ({ page }) => {
      await page.goto('index.html');
      const nav = page.getByRole('navigation', { name: 'Основное меню' });
      await nav.getByRole('link', { name: 'Корзина' }).click();
      await expect(page).toHaveURL(/cart\.html$/);
      await expect(nav.getByRole('link', { name: 'Корзина' })).toHaveAttribute('aria-current', 'page');
      await nav.getByRole('link', { name: 'Войти' }).click();
      await expect(page).toHaveURL(/login\.html$/);
      await nav.getByRole('link', { name: 'Каталог' }).click();
      await expect(page.getByRole('heading', { name: 'Каталог' })).toBeVisible();
      await page.locator('.logo').click();
      await expect(page).toHaveURL(/index\.html$/);
    });

    test('категория открывается одним нажатием, товар — из карточки, назад — по «хлебным крошкам»', async ({ page }) => {
      await page.goto('index.html');
      await page.locator('.category', { hasText: 'Полив и опрыскивание' }).click();
      await expect(page).toHaveURL(/category=watering/);
      await expect(page.getByRole('heading', { name: 'Полив и опрыскивание' })).toBeVisible();
      await expect(page.locator('.category[aria-current="true"]')).toContainText('Полив');
      await page.locator('.product-card').first().click();
      await expect(page).toHaveURL(/product\.html\?id=/);
      await expect(page.locator('h1')).toBeVisible();
      await page.getByRole('navigation', { name: 'Навигация' }).getByRole('link', { name: 'Полив и опрыскивание' }).click();
      await expect(page).toHaveURL(/category=watering/);
    });

    test('несуществующий адрес: своя страница 404 со стилями и рабочей ссылкой', async ({ page }) => {
      const response = await page.goto('no/such/page');
      expect(response.status()).toBe(404);
      await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible();
      const header = await page.locator('.site-header').evaluate((el) => getComputedStyle(el).position);
      expect(header).toBe('sticky');
      await page.getByRole('link', { name: 'Перейти в каталог' }).click();
      await expect(page).toHaveURL(/index\.html$/);
      await expect(page.locator('.product-card').first()).toBeVisible();
    });

    test('несуществующий товар: понятное сообщение', async ({ page }) => {
      await page.goto('product.html?id=no-such-product');
      await expect(page.getByRole('heading', { name: 'Товар не найден' })).toBeVisible();
    });

    test('гостя из кабинета и админ-панели отправляет на вход и возвращает обратно', async ({ page }) => {
      await page.goto('account.html');
      await expect(page).toHaveURL(/login\.html\?next=account\.html/);
      await page.goto('admin.html');
      await expect(page).toHaveURL(/login\.html\?next=admin\.html/);
      await login(page, 'content', 'admin.html');
      await expect(page.getByRole('heading', { name: 'Администрирование' })).toBeVisible();
    });

    test('покупателю в меню — имя и счётчик корзины, ссылки на админ-панель нет', async ({ page }) => {
      await login(page, 'buyer');
      const nav = page.getByRole('navigation', { name: 'Основное меню' });
      await expect(nav.getByRole('link', { name: 'Асан' })).toBeVisible();
      await expect(nav.locator('[data-cart-count]')).toHaveText('6');
      await expect(nav.locator('[data-admin-link]')).toBeHidden();
    });

    test('покупателю админ-панель закрыта', async ({ page }) => {
      await login(page, 'buyer', 'admin.html');
      await expect(page.getByText('Раздел доступен только сотрудникам')).toBeVisible();
      await expect(page.locator('[data-admin]')).toBeHidden();
    });

    for (const [who, visible, hidden] of [
      ['admin', ['Товары', 'Категории', 'Заказы', 'Импорт'], []],
      ['content', ['Товары', 'Категории', 'Импорт'], ['Заказы']],
      ['manager', ['Товары', 'Категории', 'Заказы'], ['Импорт']],
    ]) {
      test(`разделы админ-панели для роли ${who}`, async ({ page }) => {
        await login(page, who, 'admin.html');
        const tabs = page.getByRole('navigation', { name: 'Разделы' });
        await expect(page.locator('[data-table="products"] tr')).toHaveCount(seed.products.length);
        for (const name of visible) await expect(tabs.getByRole('link', { name })).toBeVisible();
        for (const name of hidden) await expect(tabs.getByRole('link', { name })).toHaveCount(0);
        await expect(page.getByRole('navigation', { name: 'Основное меню' }).locator('[data-admin-link]')).toBeVisible();
      });
    }

    test('вкладки админ-панели переключают разделы', async ({ page }) => {
      await login(page, 'admin', 'admin.html');
      const tabs = page.getByRole('navigation', { name: 'Разделы' });
      await tabs.getByRole('link', { name: 'Заказы' }).click();
      await expect(page.locator('[data-section="orders"]')).toBeVisible();
      await expect(page.locator('[data-section="products"]')).toBeHidden();
      await expect(tabs.getByRole('link', { name: 'Заказы' })).toHaveAttribute('aria-current', 'page');
      await tabs.getByRole('link', { name: 'Импорт' }).click();
      await expect(page.locator('#import-file')).toBeVisible();
    });
  });
}

test.describe('тестовые данные на страницах @desktop', () => {
  test('в каталоге все товары, в каждой категории свои', async ({ page }) => {
    await page.goto('index.html');
    await expect(page.locator('[data-catalog-count]')).toHaveText(`Найдено: ${seed.products.length}`);
    await expect(page.locator('.category')).toHaveCount(seed.categories.length + 1);
    for (const c of seed.categories) {
      await page.goto(`index.html?category=${c.id}`);
      const expected = seed.products.filter((p) => p.categoryId === c.id).length;
      await expect(page.locator('[data-catalog-count]')).toHaveText(`Найдено: ${expected}`);
      await expect(page.locator('.product-card')).toHaveCount(expected);
    }
  });

  test('фото из Cloud Storage загружаются, у товара без фото — иконка', async ({ page }) => {
    await page.goto('index.html');
    await expect(page.locator('.product-card').first()).toBeVisible();
    // Отключаем ленивую загрузку, чтобы браузер загрузил фото всех карточек сразу
    await page.locator('.product-card__photo').evaluateAll((images) => images.forEach((img) => { img.loading = 'eager'; }));
    await expect.poll(() => page.locator('.product-card__photo').evaluateAll((images) =>
      images.filter((img) => img.complete && img.naturalWidth === 480).length)).toBe(34);
    await expect(page.locator('.products .photo-placeholder')).toHaveCount(1);
  });

  test('товары без остатка показаны как «Под заказ»', async ({ page }) => {
    await page.goto('index.html');
    await expect(page.locator('.stock--out')).toHaveCount(seed.products.filter((p) => p.stock === 0).length);
    await page.goto('product.html?id=motokultivator-5-5');
    await expect(page.getByText('Под заказ')).toBeVisible();
  });

  test('покупатель видит только свои заказы', async ({ page }) => {
    await login(page, 'buyer');
    const own = seed.orders.filter((o) => o.user === 'buyer');
    await expect(page.locator('[data-orders] tr')).toHaveCount(own.length);
    for (const o of own) await expect(page.locator('[data-orders]')).toContainText(o.number);
    for (const o of seed.orders.filter((x) => x.user !== 'buyer')) {
      await expect(page.locator('[data-orders]')).not.toContainText(o.number);
    }
    await expect(page.locator('[data-orders]')).toContainText('Готов к выдаче');
  });

  test('сотрудник видит заказы всех покупателей и все статусы', async ({ page }) => {
    await login(page, 'manager', 'admin.html');
    await page.goto('admin.html#orders');
    await expect(page.locator('[data-table="orders"] tr')).toHaveCount(seed.orders.length);
    for (const status of ['Новый', 'Подтверждён', 'Комплектуется', 'Передан в доставку', 'Готов к выдаче', 'Выполнен', 'Отменён']) {
      await expect(page.locator('[data-table="orders"]')).toContainText(status);
    }
  });

  test('корзина покупателя: цены из каталога, итог считается', async ({ page }) => {
    await login(page, 'buyer', 'cart.html');
    const items = Object.entries(seed.carts.buyer);
    await expect(page.locator('.cart-item')).toHaveCount(items.length);
    const total = items.reduce((sum, [id, qty]) => sum + seed.products.find((p) => p.id === id).price * qty, 0);
    const shown = (await page.locator('[data-cart-total]').textContent()).replace(/\D/g, '');
    expect(Number(shown)).toBe(total);
  });

  test('у фермера своя корзина', async ({ page }) => {
    await login(page, 'farmer', 'cart.html');
    await expect(page.locator('.cart-item')).toHaveCount(1);
    await expect(page.locator('.cart-item')).toContainText('Зернодробилка');
  });
});
