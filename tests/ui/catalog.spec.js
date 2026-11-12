// Каталог в браузере: блок фильтров, градация цен, сортировка, поиск, подгрузка и карточка товара.
// Ожидаемые товары считаются прямо по файлам seed/ — так же, как их видит покупатель
import { expect, test } from '@playwright/test';
import { buildProduct, loadSeed } from '../../scripts/seed-data.js';
import { showAll } from './helpers.js';

const seed = await loadSeed();
const products = seed.products.map((p) => ({ id: p.id, ...buildProduct(p, seed) }));
const byPrice = (a, b) => a.price - b.price;
const tenge = (n) => `${new Intl.NumberFormat('ru-RU').format(n)} ₸`;

// Блок фильтров: чипы и поля ищем только внутри него, на карточках тоже есть «Китай»
const filters = (page) => page.locator('.filters');
const chip = (page, text) => filters(page).locator('.chip', { hasText: text });
const prices = async (page) =>
  (await page.locator('.product-card__price').allTextContents()).map((t) => Number(t.replace(/\D/g, '')));

for (const kind of ['phone', 'desktop']) {
  test.describe(`каталог @${kind}`, () => {
    test.use(kind === 'phone' ? { viewport: { width: 390, height: 844 } } : {});

    test('фильтры: число товаров видно на кнопке, после применения — в адресе и в списке', async ({ page }) => {
      const expected = products
        .filter((p) => p.purpose === 'garden' && p.origin === 'china' && p.stock > 0)
        .sort(byPrice);
      await page.goto('index.html');
      await expect(page.locator('.product-card').first()).toBeVisible();
      await filters(page).locator('summary').click();
      await chip(page, 'Для дачи и сада').click();
      await chip(page, 'Китай').click();
      await chip(page, 'Только в наличии').click();
      await page.locator('#sort').selectOption('priceAsc');
      await expect(page.locator('[data-apply]')).toHaveText(new RegExp(`^Показать ${expected.length} товар`));
      await page.locator('[data-apply]').click();

      await expect(page).toHaveURL(/\?purpose=garden&origin=china&stock=1&sort=priceAsc$/);
      await expect(filters(page)).not.toHaveAttribute('open');
      await expect(page.locator('[data-filters-count]')).toHaveText('3');
      await expect(page.locator('[data-catalog-count]')).toHaveText(`Найдено: ${expected.length}`);
      await expect(page.locator('.product-card__name')).toHaveText(expected.map((p) => p.name));
      // Заголовок результатов не остался за краем экрана
      await expect(page.locator('[data-catalog-title]')).toBeInViewport();
    });

    test('поиск из шапки: окончания, «ё» и несколько слов', async ({ page }) => {
      await page.goto('index.html');
      for (const [q, names] of [
        ['лопаты', ['Лопата штыковая закалённая, черенок из ясеня', 'Лопата штыковая с металлическим черенком']],
        ['трехкорпусный', ['Плуг навесной трёхкорпусный П-3-35']],
        ['дизельный мотоблок', ['Мотоблок дизельный 10 л. с.']],
      ]) {
        await page.locator('#search-input').fill(q);
        await page.locator('#search-input').press('Enter');
        await expect(page.locator('[data-catalog-title]')).toHaveText(`Поиск: «${q}»`);
        await expect(page.locator('[data-catalog-count]')).toHaveText(`Найдено: ${names.length}`);
        // Порядок — «сначала новые», поэтому сравниваем без учёта порядка
        const shown = (await page.locator('.product-card__name').allTextContents()).map((t) => t.trim());
        expect(shown.sort()).toEqual([...names].sort());
        await expect(page.locator('#search-input')).toHaveValue(q);
      }
    });

    test('кнопка «Назад» в браузере возвращает прошлые фильтры', async ({ page }) => {
      await page.goto('index.html?category=hand');
      await expect(page.locator('.product-card').first()).toBeVisible();
      await filters(page).locator('summary').click();
      await page.locator('#sort').selectOption('priceDesc');
      await page.locator('[data-apply]').click();
      await expect(page).toHaveURL(/category=hand&sort=priceDesc$/);
      await filters(page).locator('summary').click();
      await chip(page, 'Европа').click();
      await page.locator('[data-apply]').click();
      await expect(page).toHaveURL(/origin=europe/);
      const europe = products.filter((p) => p.categoryId === 'hand' && p.origin === 'europe');
      await expect(page.locator('.product-card')).toHaveCount(europe.length);

      await page.goBack();
      await expect(page).toHaveURL(/category=hand&sort=priceDesc$/);
      const hand = products.filter((p) => p.categoryId === 'hand').sort(byPrice).reverse();
      await expect(page.locator('.product-card__name')).toHaveText(hand.map((p) => p.name));
      await expect(page.locator('#sort')).toHaveValue('priceDesc');
      await expect(chip(page, 'Европа').locator('input')).not.toBeChecked();
    });

    test('из подборки — в карточку товара и обратно к той же подборке', async ({ page }) => {
      await page.goto('index.html?category=hand&sort=priceAsc');
      await page.locator('.product-card').first().click();
      await expect(page.locator('h1')).toHaveText(products.filter((p) => p.categoryId === 'hand').sort(byPrice)[0].name);
      // Похожие — из той же категории и без самого товара
      const similar = page.locator('.similar .product-card__name');
      await expect(similar).toHaveCount(4);
      for (const name of await similar.allTextContents()) {
        expect(products.find((p) => p.name === name.trim()).categoryId).toBe('hand');
        expect(name.trim()).not.toBe(await page.locator('h1').textContent());
      }
      await page.getByRole('link', { name: '← К результатам' }).click();
      await expect(page).toHaveURL(/index\.html\?category=hand&sort=priceAsc$/);
      await expect(page.locator('#sort')).toHaveValue('priceAsc');
    });
  });
}

test.describe('каталог: подробные проверки @desktop', () => {
  test('градация цен: готовый диапазон и свой «от — до» исключают друг друга', async ({ page }) => {
    await page.goto('index.html');
    await expect(page.locator('.product-card').first()).toBeVisible();
    await filters(page).locator('summary').click();
    await chip(page, 'свыше 500 000 ₸').click();
    await page.locator('[data-apply]').click();
    await showAll(page);
    const expensive = products.filter((p) => p.price >= 500_000);
    await expect(page.locator('.product-card')).toHaveCount(expensive.length);
    expect(Math.min(...(await prices(page)))).toBeGreaterThanOrEqual(500_000);

    // Свой диапазон: ввод цены сбрасывает готовый диапазон на «Любая»; границы включаются
    await filters(page).locator('summary').click();
    await page.getByLabel('Цена от, тенге').fill('19900');
    await expect(chip(page, 'Любая').locator('input')).toBeChecked();
    await page.getByLabel('Цена до, тенге').fill('21500');
    await page.locator('#sort').selectOption('priceAsc');
    await page.locator('[data-apply]').click();
    await expect(page).toHaveURL(/priceFrom=19900&priceTo=21500&sort=priceAsc/);
    await expect(page.locator('.product-card__price')).toHaveText([tenge(19_900), tenge(21_500)]);

    // Перепутанные «от» и «до» меняются местами
    await filters(page).locator('summary').click();
    await page.getByLabel('Цена от, тенге').fill('21500');
    await page.getByLabel('Цена до, тенге').fill('19900');
    await page.locator('[data-apply]').click();
    await expect(page).toHaveURL(/priceFrom=19900&priceTo=21500/);
    await expect(page.locator('.product-card')).toHaveCount(2);
  });

  test('сортировки: по цене в обе стороны, по названию, сначала новые', async ({ page }) => {
    const cases = {
      priceAsc: [...products].sort(byPrice),
      priceDesc: [...products].sort(byPrice).reverse(),
      name: [...products].sort((a, b) => (a.sortName < b.sortName ? -1 : 1)),
      // Даты добавления в seed.js идут по порядку файла: первый товар — самый новый
      new: products,
    };
    for (const [sort, expected] of Object.entries(cases)) {
      await page.goto(`index.html?sort=${sort}`);
      await showAll(page);
      await expect(page.locator('.product-card__name'), sort).toHaveText(expected.map((p) => p.name));
    }
  });

  test('«Показать ещё» подгружает по 12 товаров до конца списка', async ({ page }) => {
    await page.goto('index.html');
    await expect(page.locator('.product-card')).toHaveCount(12);
    await expect(page.locator('[data-catalog-count]')).toHaveText(`Найдено: ${products.length}`);
    await page.locator('[data-more]').click();
    await expect(page.locator('.product-card')).toHaveCount(24);
    // Фокус переходит на первый подгруженный товар
    await expect(page.locator('.product-card').nth(12)).toBeFocused();
    await page.locator('[data-more]').click();
    await expect(page.locator('.product-card')).toHaveCount(products.length);
    await expect(page.locator('[data-more]')).toBeHidden();
  });

  test('ничего не найдено: понятное сообщение и сброс', async ({ page }) => {
    await page.goto('index.html?q=xyz&stock=1');
    await expect(page.locator('.products__empty')).toContainText('Ничего не найдено');
    await expect(page.locator('[data-catalog-count]')).toHaveText('Найдено: 0');
    await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
    // Сначала сбрасываются фильтры блока, поиск остаётся
    await expect(page).toHaveURL(/index\.html\?q=xyz$/);
    await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
    await expect(page).toHaveURL(/index\.html$/);
    await expect(page.locator('[data-catalog-count]')).toHaveText(`Найдено: ${products.length}`);
  });

  test('адрес с фильтрами открывает ту же подборку; ошибочные значения отбрасываются', async ({ page }) => {
    await page.goto('index.html?category=soil&type=heavy&manufacturer=Feldwerk&sort=priceDesc&purpose=space');
    const expected = products
      .filter((p) => p.categoryId === 'soil' && p.type === 'heavy' && p.manufacturer === 'Feldwerk')
      .sort(byPrice)
      .reverse();
    await expect(page.locator('.product-card__name')).toHaveText(expected.map((p) => p.name));
    await expect(page.locator('#manufacturer')).toHaveValue('Feldwerk');
    await expect(page.locator('#sort')).toHaveValue('priceDesc');
    await expect(chip(page, 'Крупное оборудование').locator('input')).toBeChecked();
    await expect(page.locator('[data-filters-count]')).toHaveText('2');
    await expect(page.locator('.category[aria-current="true"]')).toContainText('Почвообработка');
  });

  test('поиск на главной — без перезагрузки страницы, с других страниц — переходом', async ({ page }) => {
    await page.goto('index.html');
    await expect(page.locator('.product-card').first()).toBeVisible();
    await page.evaluate(() => { window.notReloaded = true; });
    await page.locator('#search-input').fill('насос');
    await page.locator('#search-input').press('Enter');
    await expect(page).toHaveURL(/index\.html\?q=/);
    await expect(page.locator('[data-catalog-title]')).toHaveText('Поиск: «насос»');
    expect(await page.evaluate(() => window.notReloaded)).toBe(true);

    await page.goto('product.html?id=diskator-2-5');
    await page.locator('#search-input').fill('грейдер');
    await page.locator('#search-input').press('Enter');
    await expect(page).toHaveURL(/index\.html\?q=/);
    await expect(page.locator('.product-card')).toHaveCount(products.filter((p) => /Грейдер/.test(p.name)).length);
  });

  test('неизвестная категория в адресе — показывается весь каталог', async ({ page }) => {
    await page.goto('index.html?category=no-such&sort=priceAsc');
    await expect(page.locator('[data-catalog-title]')).toHaveText('Каталог');
    await expect(page.locator('[data-catalog-count]')).toHaveText(`Найдено: ${products.length}`);
    await expect(page.locator('.category[aria-current="true"]')).toContainText('Все товары');
    await expect(page.locator('.product-card__price').first()).toHaveText(tenge(Math.min(...products.map((p) => p.price))));
  });

  // Гонки: ответы базы задерживаются через page.route, чтобы порядок событий был всегда один и тот же
  const isQuery = (url) => /:run(Aggregation)?Query$/.test(url.pathname);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  test('опоздавший ответ на прежние фильтры не заменяет новые результаты', async ({ page }) => {
    await page.goto('index.html');
    await expect(page.locator('.product-card').first()).toBeVisible();
    // Запросы с диапазоном «свыше 500 000 ₸» отвечают на 2 секунды позже
    await page.route(isQuery, async (route) => {
      if (route.request().postData()?.includes('over500k')) await sleep(2000);
      await route.continue();
    });
    const slow = page.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith(':runQuery') && r.request().postData()?.includes('over500k'));
    await filters(page).locator('summary').click();
    await chip(page, 'свыше 500 000 ₸').click();
    await page.locator('[data-apply]').click();
    // Не дожидаясь ответа, покупатель выбирает другой диапазон
    await filters(page).locator('summary').click();
    await chip(page, 'до 20 000 ₸').click();
    await page.locator('[data-apply]').click();
    const cheap = products.filter((p) => p.price < 20_000);
    await expect(page.locator('[data-catalog-count]')).toHaveText(`Найдено: ${cheap.length}`);
    await slow;
    await sleep(300);
    expect(Math.max(...(await prices(page)))).toBeLessThan(20_000);
    await expect(page.locator('[data-catalog-count]')).toHaveText(`Найдено: ${cheap.length}`);
  });

  test('текст в строке поиска не стирается, пока каталог загружается', async ({ page }) => {
    await page.route(isQuery, async (route) => {
      await sleep(1500);
      await route.continue();
    });
    await page.goto('index.html');
    await page.locator('#search-input').fill('лопата');
    await page.locator('#search-input').blur();
    await expect(page.locator('.product-card').first()).toBeVisible();
    await expect(page.locator('#search-input')).toHaveValue('лопата');
  });

  test('производители в списке — из базы, по алфавиту', async ({ page }) => {
    await page.goto('index.html');
    const brands = [...new Set(products.map((p) => p.manufacturer))].sort((a, b) => a.localeCompare(b));
    await expect(page.locator('#manufacturer option')).toHaveText(['Все производители', ...brands]);
  });
});
