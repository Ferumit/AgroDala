// Общее для браузерных тестов
import { PASSWORD } from '../../scripts/seed-data.js';

export const accounts = {
  admin: 'admin@agrodala.example',
  manager: 'manager@agrodala.example',
  content: 'content@agrodala.example',
  buyer: 'buyer@agrodala.example',
  farmer: 'farmer@agrodala.example',
};

export async function login(page, who, next = 'account.html') {
  await page.goto(`login.html?next=${next}`);
  await page.locator('#login-email').fill(accounts[who]);
  await page.locator('#login-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL(`**/${next}`);
}

// Что выходит за правый край экрана. Прокручиваемые контейнеры (иконки категорий, таблицы,
// вкладки) сами прячут лишнее: их содержимое не считается, важно, что не вылезают они сами
export async function overflow(page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const scrollable = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
      }
      return false;
    };
    const out = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > width + 1 && !scrollable(el)
          && getComputedStyle(el).position !== 'absolute';
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: width,
      out: out.slice(0, 5),
    };
  });
}

// Текст, обрезанный краем своего блока (важно для узких карточек на телефоне)
export async function clippedText(page, selector) {
  return page.evaluate((sel) =>
    [...document.querySelectorAll(sel)]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent.trim()), selector);
}

// Интерактивные элементы меньше minSize по высоте или ширине.
// Ссылки внутри текста правило не касается
export async function smallTargets(page, minSize = 40) {
  return page.evaluate((min) =>
    [...document.querySelectorAll('.site-nav a, .search button, .logo, .btn, .chip span, .category, .tabs a, .tabs button, .field input:not(.chip input), .field select, .icon-button, summary')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.height < min || r.width < min);
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return `${el.textContent.trim().slice(0, 20) || el.className}: ${Math.round(r.width)}×${Math.round(r.height)}`;
      }), minSize);
}
