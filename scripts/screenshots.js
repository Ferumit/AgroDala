// Скриншоты страниц для docs/mockups.md и отчётов. Запуск: npm run screenshots
import { chromium, devices } from '@playwright/test';
import { login } from '../tests/ui/helpers.js';

const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const BASE = 'http://127.0.0.1:5000/';
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

const openFilters = (page) => page.locator('.filters summary').click();

// Панель эмуляторов: данные в базе и учётные записи
const UI = 'http://127.0.0.1:4000/';
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
  { name: '02-filtry-pk', url: 'index.html', marker: '#sort', act: openFilters, fullPage: false },
  { name: '03-kategoriya-pk', url: 'index.html?category=watering', marker: '.product-card' },
  { name: '06-tovar-pk', url: 'product.html?id=diskator-2-5', marker: '.specs' },
  { name: '08-korzina-pk', who: 'buyer', url: 'cart.html', marker: '.cart-item' },
  { name: '09-vhod-pk', url: 'login.html', marker: '#login-email' },
  { name: '10-kabinet-pk', who: 'buyer', url: 'account.html', marker: '[data-orders] .status' },
  { name: '11-admin-pk', who: 'admin', url: 'admin.html', marker: '[data-table="products"] tr' },
  { name: '14-admin-zakazy-pk', who: 'admin', url: 'admin.html#orders', marker: '[data-table="orders"] tr' },
  { name: '15-admin-import-pk', who: 'admin', url: 'admin.html#import', marker: '#import-file' },
  { name: '16-404-pk', url: 'no/such/page', marker: '.empty-state', fullPage: false },
]);

await shots(phone(390, 844), [
  { name: '04-glavnaya-telefon', url: 'index.html', marker: '.product-card', fullPage: false },
  { name: '05-filtry-telefon', url: 'index.html', marker: '#sort', act: openFilters, fullPage: false },
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

await uiShots();

await browser.close();
