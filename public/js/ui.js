// Небольшие помощники для отрисовки страниц

const priceFormat = new Intl.NumberFormat('ru-RU');

export function formatPrice(value) {
  return `${priceFormat.format(value)} ₸`;
}

// Текст из базы вставляем в HTML только через эту функцию,
// чтобы символы < > & " не превратились в разметку
export function escapeHtml(text) {
  return String(text ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  );
}

export function icon(name, label = '') {
  const a11y = label ? `role="img" aria-label="${escapeHtml(label)}"` : 'aria-hidden="true"';
  const url = `url(img/icons/${escapeHtml(name)}.svg)`;
  return `<span class="icon" style="-webkit-mask-image: ${url}; mask-image: ${url}" ${a11y}></span>`;
}

export function stockLabel(stock) {
  return stock > 0
    ? `<span class="stock">В наличии: ${stock} шт.</span>`
    : '<span class="stock stock--out">Под заказ</span>';
}
