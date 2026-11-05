// Адаптивность (ТЗ, п. 2.3: экраны от 360 пикселей): на каждом размере экрана
// страницы не шире экрана, текст не обрезан, раскладка соответствует ширине
import { expect, test } from '@playwright/test';
import { clippedText, login, overflow, smallTargets } from './helpers.js';

const SCREENS = [
  { name: 'телефон 360×640', width: 360, height: 640, kind: 'phone', columns: 2 },
  { name: 'телефон 390×844', width: 390, height: 844, kind: 'phone', columns: 2 },
  { name: 'телефон лёжа 844×390', width: 844, height: 390, kind: 'phone', columns: 3 },
  { name: 'планшет 768×1024', width: 768, height: 1024, kind: 'desktop', columns: 3 },
  { name: 'ноутбук 1024×768', width: 1024, height: 768, kind: 'desktop', columns: 4 },
  { name: 'компьютер 1366×900', width: 1366, height: 900, kind: 'desktop', columns: 4 },
  { name: 'большой экран 1920×1080', width: 1920, height: 1080, kind: 'desktop', columns: 4 },
];

// Страницы гостя: адрес и текст, по которому видно, что страница загрузилась
const GUEST_PAGES = [
  ['главная', 'index.html', 'Найдено: 35'],
  ['категория', 'index.html?category=sowing', 'Найдено: 4'],
  ['товар с фото', 'product.html?id=diskator-2-5', 'Характеристики'],
  ['товар без фото', 'product.html?id=seyalka-ruchnaya-6', 'Характеристики'],
  ['корзина', 'cart.html', 'В корзине пока нет товаров'],
  ['вход', 'login.html', 'Забыли пароль?'],
  ['страница 404', 'no/such/page', 'Страница не найдена'],
];

const noOverflow = async (page) => {
  const result = await overflow(page);
  expect(result.scrollWidth, `шире экрана: ${result.out.join(', ')}`).toBeLessThanOrEqual(result.clientWidth);
  expect(result.out, 'выходит за край экрана').toEqual([]);
};

for (const screen of SCREENS) {
  test.describe(`${screen.name} @${screen.kind}`, () => {
    test.use({ viewport: { width: screen.width, height: screen.height } });

    for (const [name, url, marker] of GUEST_PAGES) {
      test(`страница «${name}» помещается в экран`, async ({ page }) => {
        await page.goto(url);
        await expect(page.getByText(marker).first()).toBeVisible();
        await noOverflow(page);
        expect(await clippedText(page, '.product-card__name, h1, .site-nav a')).toEqual([]);
      });
    }

    test('раскрытые фильтры помещаются в экран', async ({ page }) => {
      await page.goto('index.html');
      await page.locator('.filters summary').click();
      await expect(page.locator('#sort')).toBeVisible();
      await noOverflow(page);
    });

    test('регистрация и восстановление пароля помещаются в экран', async ({ page }) => {
      await page.goto('login.html');
      await page.getByRole('tab', { name: 'Регистрация' }).click();
      await expect(page.locator('#register-password2')).toBeVisible();
      await noOverflow(page);
      await page.getByRole('tab', { name: 'Вход' }).click();
      await page.getByRole('button', { name: 'Забыли пароль?' }).click();
      await expect(page.locator('#reset-email')).toBeVisible();
      await noOverflow(page);
    });

    test('кабинет и заполненная корзина покупателя помещаются в экран', async ({ page }) => {
      await login(page, 'buyer');
      await expect(page.locator('[data-orders] tr')).toHaveCount(5);
      await noOverflow(page);
      await page.goto('cart.html');
      await expect(page.locator('.cart-item')).toHaveCount(3);
      await noOverflow(page);
      expect(await clippedText(page, '.cart-item__name')).toEqual([]);
    });

    test('разделы административной панели помещаются в экран', async ({ page }) => {
      await login(page, 'admin', 'admin.html');
      await expect(page.locator('[data-table="products"] tr')).toHaveCount(35);
      for (const section of ['products', 'categories', 'orders', 'import']) {
        await page.goto(`admin.html#${section}`);
        await expect(page.locator(`[data-section="${section}"]`)).toBeVisible();
        await noOverflow(page);
      }
    });

    test(`в каталоге ${screen.columns} колонки карточек`, async ({ page }) => {
      await page.goto('index.html');
      await expect(page.locator('.product-card').first()).toBeVisible();
      const lefts = await page.locator('.products > li').evaluateAll((items) =>
        items.map((li) => Math.round(li.getBoundingClientRect().left)));
      expect(new Set(lefts).size).toBe(screen.columns);
    });

    test('иконки категорий доступны все', async ({ page }) => {
      await page.goto('index.html');
      const icons = page.locator('.category');
      await expect(icons).toHaveCount(9);
      const last = icons.last();
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      const box = await page.locator('.categories').evaluate((el) => ({
        scrollable: el.scrollWidth > el.clientWidth,
        rows: new Set([...el.children].map((li) => Math.round(li.getBoundingClientRect().top))).size,
      }));
      // Широкий экран: один ряд без прокрутки. Узкий: один ряд, листается пальцем
      expect(box.rows).toBe(1);
      expect(box.scrollable).toBe(screen.width < 1000);
    });

    test('в меню у ссылок есть подпись для экранного диктора', async ({ page }) => {
      await page.goto('index.html');
      const nav = page.getByRole('navigation', { name: 'Основное меню' });
      for (const name of ['Каталог', 'Корзина', 'Войти']) {
        await expect(nav.getByRole('link', { name })).toBeVisible();
      }
      // На телефоне подписи скрыты визуально, на широком экране видны
      const labelWidth = await nav.locator('.site-nav__label').first().evaluate((el) => el.getBoundingClientRect().width);
      if (screen.width < 760) expect(labelWidth).toBeLessThanOrEqual(1);
      else expect(labelWidth).toBeGreaterThan(10);
    });

    test('таблица заказов: карточки на узком экране, таблица на широком', async ({ page }) => {
      await login(page, 'buyer');
      await expect(page.locator('[data-orders] .status').first()).toBeVisible();
      const row = page.locator('[data-orders] tr').first();
      const display = await row.evaluate((el) => getComputedStyle(el).display);
      expect(display).toBe(screen.width < 600 ? 'block' : 'table-row');
    });
  });
}

// Развёртка: страница не вылезает за экран ни на какой ширине, а не только на контрольных.
// Точки перелома проверяются с обеих сторон: там раскладка меняется и чаще всего ломается
test.describe('развёртка ширин от 360 до 1920 @desktop', () => {
  test.setTimeout(240_000); // десятки размеров на нескольких страницах; WebKit заметно медленнее
  const widths = [...new Set([
    ...Array.from({ length: 53 }, (_, i) => 360 + i * 20),
    ...[600, 760, 900, 1000].flatMap((w) => [w - 1, w]),
    1920,
  ])].sort((a, b) => a - b);

  const sweep = async (page) => {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      const result = await overflow(page);
      expect(result.scrollWidth, `${width} px: ${result.out.join(', ')}`).toBeLessThanOrEqual(result.clientWidth);
      expect(result.out, `${width} px`).toEqual([]);
    }
  };

  for (const [name, url, marker] of GUEST_PAGES) {
    test(`гость: ${name}`, async ({ page }) => {
      await page.goto(url);
      await expect(page.getByText(marker).first()).toBeVisible();
      await sweep(page);
    });
  }

  test('покупатель: кабинет и корзина', async ({ page }) => {
    await login(page, 'buyer');
    await expect(page.locator('[data-orders] .status').first()).toBeVisible();
    await sweep(page);
    await page.goto('cart.html');
    await expect(page.locator('.cart-item').first()).toBeVisible();
    await sweep(page);
  });

  test('администратор: все разделы, в меню четыре ссылки', async ({ page }) => {
    await login(page, 'admin', 'admin.html');
    await expect(page.locator('[data-table="products"] tr').first()).toBeVisible();
    await expect(page.locator('[data-admin-link]')).toBeVisible();
    for (const section of ['products', 'categories', 'orders', 'import']) {
      await page.goto(`admin.html#${section}`);
      await expect(page.locator(`[data-section="${section}"]`)).toBeVisible();
      await sweep(page);
    }
  });
});

// Размер элементов под палец: только на телефонах
for (const screen of SCREENS.filter((s) => s.kind === 'phone')) {
  test.describe(`${screen.name} @phone`, () => {
    test.use({ viewport: { width: screen.width, height: screen.height } });

    test('кнопки и поля удобны для пальца: от 40 пикселей', async ({ page }) => {
      await page.goto('index.html');
      await page.locator('.filters summary').click();
      await expect(page.locator('#sort')).toBeVisible();
      expect(await smallTargets(page)).toEqual([]);
      await page.goto('login.html');
      await expect(page.locator('#login-email')).toBeVisible();
      expect(await smallTargets(page)).toEqual([]);
    });
  });
}
