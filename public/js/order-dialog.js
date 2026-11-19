// Окно с подробностями заказа: состав, получение, история статусов и кнопки действий.
// Общее для личного кабинета (покупатель может отменить новый заказ) и административной панели
// (менеджер переводит заказ по статусам). Само изменение делает Cloud Function setOrderStatus
import { DELIVERY_METHODS, ORDER_STATUSES } from './dictionaries.js';
import { escapeHtml, formatPrice, statusLabel } from './ui.js';

// Подписи кнопок: какое действие переводит заказ в этот статус
export const ACTION_LABELS = {
  confirmed: 'Подтвердить',
  picking: 'Начать комплектацию',
  shipped: 'Передать в доставку',
  readyForPickup: 'Готов к выдаче',
  completed: 'Выполнен',
  cancelled: 'Отменить заказ',
};

const dateTime = (ts) =>
  ts?.toDate?.().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) ?? '';

let dialog;

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.setAttribute('aria-labelledby', 'order-dialog-title');
  document.body.append(dialog);
  // Щелчок по затемнению вокруг окна закрывает его
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  return dialog;
}

function render(order, actions) {
  const items = order.items
    .map(
      (i) => `<tr>
        <td data-label="Товар"><a href="product.html?id=${encodeURIComponent(i.productId)}">${escapeHtml(i.name)}</a>
          ${i.backorder > 0 ? `<br><span class="stock stock--out">под заказ: ${i.backorder} шт.</span>` : ''}</td>
        <td data-label="Цена">${formatPrice(i.price)}</td>
        <td data-label="Кол-во">${i.qty} шт.</td>
        <td data-label="Сумма">${formatPrice(i.price * i.qty)}</td>
      </tr>`
    )
    .join('');
  const history = (order.statusHistory ?? [])
    .map(
      (h) => `<li>${statusLabel(h.status, ORDER_STATUSES)} <span class="muted">${dateTime(h.at)} ·
        ${h.by === order.userId ? 'покупатель' : 'сотрудник магазина'}</span></li>`
    )
    .join('');
  const address = order.delivery?.method === 'delivery' ? `: ${escapeHtml(order.delivery.address)}` : '';
  return `
    <div class="modal__head">
      <h2 id="order-dialog-title">Заказ ${escapeHtml(order.number)}</h2>
      <button class="icon-button" type="button" data-close aria-label="Закрыть">✕</button>
    </div>
    <p>${statusLabel(order.status, ORDER_STATUSES)} <span class="muted">от ${dateTime(order.createdAt)}</span></p>
    <dl class="product__facts">
      <dt>Покупатель</dt><dd>${escapeHtml(order.contact?.name)}, ${escapeHtml(order.contact?.phone)}</dd>
      <dt>Получение</dt><dd>${DELIVERY_METHODS[order.delivery?.method] ?? ''}${address}</dd>
      ${order.comment ? `<dt>Комментарий</dt><dd>${escapeHtml(order.comment)}</dd>` : ''}
    </dl>
    <div class="table-wrap">
      <table class="table table--cards">
        <thead><tr><th>Товар</th><th>Цена</th><th>Кол-во</th><th>Сумма</th></tr></thead>
        <tbody>${items}</tbody>
      </table>
    </div>
    <p><strong>Итого: ${formatPrice(order.total)}</strong></p>
    <h3>История статусов</h3>
    <ol class="history">${history}</ol>
    <p class="form-message" data-dialog-message role="alert" hidden></p>
    ${actions.length > 0
      ? `<div class="form-actions">${actions
          .map((s) => `<button class="btn ${s === 'cancelled' ? 'btn--ghost' : ''}" type="button" data-status="${s}">${ACTION_LABELS[s]}</button>`)
          .join('')}</div>`
      : ''}`;
}

// order — данные заказа; actions — статусы, в которые можно перевести заказ;
// onAction(status) выполняет перевод и возвращает обновлённый заказ (или бросает ошибку с текстом)
export function openOrderDialog(order, { actions = [], onAction } = {}) {
  const el = ensureDialog();
  const show = (current, currentActions) => {
    el.innerHTML = render(current, currentActions);
    el.querySelector('[data-close]').addEventListener('click', () => el.close());
    el.querySelectorAll('[data-status]').forEach((button) =>
      button.addEventListener('click', async () => {
        const status = button.dataset.status;
        if (status === 'cancelled' && !confirm(`Отменить заказ ${current.number}?`)) return;
        el.querySelectorAll('[data-status]').forEach((b) => (b.disabled = true));
        try {
          const next = await onAction(status);
          show(next.order, next.actions);
        } catch (err) {
          const box = el.querySelector('[data-dialog-message]');
          box.textContent = err.message;
          box.className = 'form-message form-message--error';
          box.hidden = false;
          el.querySelectorAll('[data-status]').forEach((b) => (b.disabled = false));
        }
      })
    );
  };
  show(order, actions);
  if (!el.open) el.showModal();
}
