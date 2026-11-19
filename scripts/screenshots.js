// Скриншоты страниц для docs/mockups.md и отчётов. Запуск: npm run screenshots
import { chromium, devices } from '@playwright/test';
import { login } from '../tests/ui/helpers.js';
import { PANEL, SITE } from './emulators.js';

const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const BASE = SITE;
const PC = { viewport: { width: 1366, height: 900 } };
const phone = (width, height) => ({ ...devices['Pixel 7'], viewport: { width, height } });

const browser = await chromium.launch();

async function shots(options, list) {
  const context = await browser.newContext({ baseURL: BASE, locale: 'ru-RU', ...options });
  const page = await context.newPage();
  for (const { name, who, url, marker, act, fullPage = true } of list) {
    if (who) await login(page, who, url.split('#')[0]);
    await page.goto(url);
    if (act) await act(page);
    if (marker) await page.locator(marker).first().waitFor();
    // Состояния networkidle здесь не бывает: у Firestore постоянно открыто соединение.
    // Поэтому загружаем все фото сразу, без ленивой загрузки, и ждём их
    await page.evaluate(() => document.querySelectorAll('img').forEach((img) => { img.loading = 'eager'; }));
    await page.waitForFunction(() => [...document.images].every((img) => img.complete));
    await page.screenshot({ path: `${OUT}${name}.png`, fullPage });
    console.log(name);
    if (who) {
      await page.goto('account.html');
      await page.locator('[data-logout]').click();
      await page.waitForURL('**/index.html');
    }
  }
  await context.close();
}

// Блок фильтров с выбранными фильтрами: на кнопке уже видно, сколько товаров найдётся
async function chooseFilters(page) {
  await page.locator('.filters summary').click();
  for (const text of ['Для дачи и сада', 'Китай', 'Только в наличии']) {
    await page.locator('.filters .chip', { hasText: text }).click();
  }
  await page.locator('#sort').selectOption('priceAsc');
  await page.waitForFunction(() => /\d/.test(document.querySelector('[data-apply]').textContent));
}

// Карточка товара, открытая из подборки: есть ссылка «← К результатам»
async function fromResults(page) {
  await page.locator('.product-card').first().click();
  await page.locator('.similar .product-card').first().waitFor();
}

// Панель эмуляторов: данные в базе и учётные записи
const UI = PANEL;
async function uiShots() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ru-RU' });
  const page = await context.newPage();
  await page.goto(`${UI}firestore/default/data/products/diskator-2-5`);
  await page.getByText('Feldwerk').first().waitFor();
  await page.screenshot({ path: `${OUT}13-baza-dannyh.png` });
  console.log('13-baza-dannyh');
  await page.goto(`${UI}firestore/default/data/orders`);
  await page.locator('[data-testid^="firestore-document"], a[href*="/data/orders/"]').first().click();
  await page.getByText('statusHistory').first().waitFor();
  await page.screenshot({ path: `${OUT}22-baza-zakazy.png` });
  console.log('22-baza-zakazy');
  await page.goto(`${UI}auth`);
  await page.getByText('Асан Покупатель').first().waitFor();
  await page.screenshot({ path: `${OUT}23-polzovateli.png` });
  console.log('23-polzovateli');
  await context.close();
}

await shots(PC, [
  { name: '01-glavnaya-pk', url: 'index.html', marker: '.product-card' },
  { name: '02-filtry-pk', url: 'index.html', marker: '#sort', act: chooseFilters, fullPage: false },
  { name: '03-kategoriya-pk', url: 'index.html?category=watering', marker: '.product-card' },
  { name: '06-tovar-pk', url: 'product.html?id=diskator-2-5', marker: '.specs' },
  { name: '08-korzina-pk', who: 'buyer', url: 'cart.html', marker: '.cart-item' },
  { name: '09-vhod-pk', url: 'login.html', marker: '#login-email' },
  { name: '10-kabinet-pk', who: 'buyer', url: 'account.html', marker: '[data-orders] .status' },
  { name: '11-admin-pk', who: 'admin', url: 'admin.html', marker: '[data-table="products"] tr' },
  { name: '14-admin-zakazy-pk', who: 'admin', url: 'admin.html#orders', marker: '[data-table="orders"] tr' },
  { name: '15-admin-import-pk', who: 'admin', url: 'admin.html#import', marker: '#import-file' },
  { name: '16-404-pk', url: 'no/such/page', marker: '.empty-state', fullPage: false },
  { name: '24-podborka-pk', url: 'index.html?purpose=garden&origin=china&stock=1&sort=priceAsc', marker: '.product-card' },
  { name: '25-poisk-pk', url: 'index.html?q=лопаты', marker: '.product-card', fullPage: false },
  { name: '26-nichego-pk', url: 'index.html?q=xyz&stock=1', marker: '.products__empty', fullPage: false },
  { name: '27-tovar-iz-podborki-pk', url: 'index.html?category=hand&sort=priceAsc', act: fromResults, marker: '.back-link' },
]);

await shots(phone(390, 844), [
  { name: '04-glavnaya-telefon', url: 'index.html', marker: '.product-card', fullPage: false },
  { name: '05-filtry-telefon', url: 'index.html', marker: '#sort', act: chooseFilters, fullPage: false },
  { name: '28-podborka-telefon', url: 'index.html?purpose=garden&origin=china&stock=1&sort=priceAsc', marker: '.product-card', fullPage: false },
  { name: '29-poisk-telefon', url: 'index.html?q=мотоблок', marker: '.product-card', fullPage: false },
  { name: '07-tovar-telefon', url: 'product.html?id=diskator-2-5', marker: '.specs', fullPage: false },
  { name: '12-korzina-telefon', who: 'buyer', url: 'cart.html', marker: '.cart-item' },
  { name: '17-kabinet-telefon', who: 'buyer', url: 'account.html', marker: '[data-orders] .status' },
  { name: '18-admin-telefon', who: 'admin', url: 'admin.html#orders', marker: '[data-table="orders"] tr', fullPage: false },
  { name: '19-vhod-telefon', url: 'login.html', marker: '#login-email', fullPage: false },
]);

await shots(phone(360, 640), [
  { name: '20-glavnaya-360', url: 'index.html', marker: '.product-card', fullPage: false },
]);

await shots({ viewport: { width: 768, height: 1024 } }, [
  { name: '21-glavnaya-planshet', url: 'index.html', marker: '.product-card', fullPage: false },
]);

// 5-я неделя: полный сценарий покупки и работа сотрудников. Шаги идут по порядку и меняют
// данные (заказ, товар, категория), поэтому выполняются после остальных скриншотов
async function save(page, name, fullPage = false) {
  await page.evaluate(() => document.querySelectorAll('img').forEach((img) => { img.loading = 'eager'; }));
  await page.waitForFunction(() => [...document.images].every((img) => img.complete));
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage });
  console.log(name);
}

async function as(who, next, options = PC) {
  const context = await browser.newContext({ baseURL: BASE, locale: 'ru-RU', ...options });
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  await login(page, who, next);
  return { page, done: () => context.close() };
}

async function week5() {
  // Покупатель: товар → корзина → оформление → кабинет
  const farmer = await as('farmer', 'account.html');
  let page = farmer.page;
  await page.goto('product.html?id=lopata-shtykovaya');
  await page.getByRole('button', { name: 'В корзину' }).click();
  await page.locator('[data-cart-status]:not([hidden])').waitFor();
  await save(page, '30-v-korzinu-pk');
  await page.goto('cart.html');
  await page.locator('.cart-item').nth(1).waitFor();
  await page.getByText('Доставка', { exact: true }).click();
  await page.locator('#comment').fill('Позвонить за час до доставки');
  await save(page, '31-oformlenie-pk', true);
  await page.getByRole('button', { name: 'Оформить заказ' }).click();
  const title = page.getByRole('heading', { name: /оформлен/ });
  await title.waitFor();
  const number = (await title.textContent()).match(/AD-\d{6}/)[0];
  await save(page, '32-zakaz-oformlen-pk');
  await page.goto('account.html');
  await page.getByRole('button', { name: number }).click();
  await page.getByRole('dialog').waitFor();
  await save(page, '33-zakaz-v-kabinete-pk');
  await farmer.done();

  // Менеджер: новый заказ → подтверждение
  const manager = await as('manager', 'admin.html');
  page = manager.page;
  await page.goto('admin.html#orders');
  await page.locator('[data-order-filter]').selectOption('new');
  await page.getByRole('button', { name: number }).click();
  await page.getByRole('dialog').waitFor();
  await save(page, '34-admin-zakaz-pk');
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Начать комплектацию' }).waitFor();
  await save(page, '35-admin-status-pk');
  await manager.done();

  // Контент-менеджер: новый товар с фото, новая категория
  const content = await as('content', 'admin.html');
  page = content.page;
  await page.getByRole('button', { name: 'Добавить товар' }).click();
  const form = page.getByRole('dialog', { name: 'Новый товар' });
  await form.getByLabel('Название').fill('Вилы садовые 5-зубые усиленные');
  await form.getByLabel('Категория').selectOption('hand');
  await form.getByLabel('Производитель').fill('GardenPro');
  await form.getByLabel('Страна производителя').fill('Китай');
  await form.getByLabel('Цена, ₸').fill('7400');
  await form.getByLabel('Остаток, шт.').fill('25');
  await form.getByLabel('Описание').fill('Кованые вилы с пятью зубьями и черенком из ясеня 120 см.');
  await form.getByLabel(/Характеристики/).fill('Число зубьев: 5\nДлина черенка: 120 см\nМатериал: кованая сталь');
  await form.getByLabel(/Фотография/).setInputFiles('seed/images/vily-sadovye-4.jpg');
  await form.locator('[data-photo-preview]').waitFor();
  await save(page, '36-admin-tovar-forma-pk');
  await form.getByRole('button', { name: 'Сохранить' }).click();
  await page.locator('[data-admin-message]:not([hidden])').waitFor();
  await page.getByRole('link', { name: 'Вилы садовые 5-зубые усиленные' }).click();
  await page.locator('.specs').waitFor();
  await save(page, '37-noviy-tovar-pk');
  await page.goto('admin.html#categories');
  await page.getByRole('button', { name: 'Добавить категорию' }).click();
  const category = page.getByRole('dialog', { name: 'Новая категория' });
  await category.getByLabel('Название').fill('Теплицы и парники');
  await category.getByLabel('Назначение').selectOption('garden');
  await category.locator('.chip', { has: page.locator('input[value="sprout"]') }).click();
  await save(page, '38-admin-kategoriya-pk');
  await content.done();

  // Администратор: импорт товаров (с ошибками в двух строках) и клиентов
  const admin = await as('admin', 'admin.html');
  page = admin.page;
  await page.goto('admin.html#import');
  const csv = 'Название;Категория;Тип;Производитель;Происхождение;Цена;Остаток\n' +
    'Тяпка-мотыга;Ручной садовый инструмент;Мини-инструмент;Terrano;Европа;4 900;30\n' +
    'Ведро оцинкованное 12 л;Уборка и хранение урожая;Мини-инструмент;GardenPro;Китай;2 600;100\n' +
    'Сеялка овощная;Посевная техника;Мини-инструмент;Agripol;Польша;38 000;5\n' +
    'Опрыскиватель 8 л;Полив;Мини-инструмент;GardenPro;Китай;девять тысяч;3\n';
  await page.locator('#import-file').setInputFiles({ name: 'tovary.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Загрузить' }).click();
  await page.locator('[data-import-report]:not([hidden])').waitFor();
  await save(page, '39-import-tovarov-pk', true);
  await page.getByText('Клиенты', { exact: true }).click();
  await page.locator('#import-file').setInputFiles('public/import/klienty-primer.csv');
  await page.getByRole('button', { name: 'Загрузить' }).click();
  await page.getByText('Клиентов добавлено').waitFor();
  await save(page, '40-import-klientov-pk', true);
  await admin.done();

  // Телефон: оформление и заказ в кабинете
  const buyer = await as('buyer', 'cart.html', phone(390, 844));
  page = buyer.page;
  await page.locator('.cart-item').first().waitFor();
  await page.locator('[data-checkout]').scrollIntoViewIfNeeded();
  await save(page, '41-oformlenie-telefon', true);
  await page.goto('account.html');
  await page.locator('[data-orders] [data-order]').first().click();
  await page.getByRole('dialog').waitFor();
  await save(page, '42-zakaz-telefon');
  await buyer.done();
}

await week5();
await uiShots();

// Журнал Cloud Functions в панели эмуляторов: заказы, смена статусов, импорт
{
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ru-RU' });
  const page = await context.newPage();
  await page.goto(`${UI}logs?q=${encodeURIComponent('Заказ')}`);
  await page.getByText(/Заказ AD-/).first().waitFor();
  await page.screenshot({ path: `${OUT}43-zhurnal-funkciy.png` });
  console.log('43-zhurnal-funkciy');
  await context.close();
}

await browser.close();
