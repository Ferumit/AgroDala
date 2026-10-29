// Общие шапка и подвал: одна разметка на все страницы сайта
import { icon } from './ui.js';

const page = document.body.dataset.page;
const current = (name) => (name === page ? 'aria-current="page"' : '');

document.body.insertAdjacentHTML(
  'afterbegin',
  `<header class="site-header">
    <div class="site-header__inner">
      <a class="logo" href="index.html">${icon('sprout')}AgroDala</a>
      <form class="search" action="index.html" role="search">
        <label class="visually-hidden" for="search-input">Поиск по каталогу</label>
        <input id="search-input" name="q" type="search" placeholder="Поиск инструмента">
        <button type="submit">${icon('search', 'Найти')}</button>
      </form>
      <nav class="site-nav" aria-label="Основное меню">
        <a href="index.html" ${current('home')}>${icon('store')}<span class="site-nav__label">Каталог</span></a>
        <a href="cart.html" ${current('cart')}>${icon('shopping-cart')}<span class="site-nav__label">Корзина</span><span class="badge" data-cart-count hidden></span></a>
        <a href="login.html" ${current('login')} data-account-link>${icon('user')}<span class="site-nav__label">Войти</span></a>
      </nav>
    </div>
  </header>`
);

document.body.insertAdjacentHTML(
  'beforeend',
  `<footer class="site-footer">
    <div class="site-footer__inner">
      <div>
        <p><strong>AgroDala</strong> — сельскохозяйственный инструмент из Китая и Европы</p>
        <p>Учебный проект: товары и поставщики вымышленные</p>
      </div>
      <div>
        <p>Астана, ул. Агрономическая, 7, офис 12</p>
        <p>Склад и самовывоз: ул. Складская, 15</p>
      </div>
      <div>
        <p><a href="mailto:support@agrodala.example">support@agrodala.example</a></p>
        <p>+7 (700) 000-00-00</p>
      </div>
    </div>
  </footer>`
);
