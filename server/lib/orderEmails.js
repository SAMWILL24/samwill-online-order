const db = require('../db');
const { sendEmail } = require('./email');

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function itemsText(order) {
  return order.items
    .map((i) => {
      const name = i.isHalfAndHalf ? `Half ${i.menuItemName} / Half ${i.secondMenuItemName}` : i.menuItemName;
      const extras = i.extras.length ? ` + ${i.extras.map((e) => e.name).join(', ')}` : '';
      return `${i.quantity}x ${name} (${i.sizeLabel})${extras}`;
    })
    .join('\n');
}

function itemsHtml(order) {
  return order.items
    .map((i) => {
      const name = i.isHalfAndHalf ? `Half ${i.menuItemName} / Half ${i.secondMenuItemName}` : i.menuItemName;
      const extras = i.extras.length ? ` + ${i.extras.map((e) => e.name).join(', ')}` : '';
      return `<li>${i.quantity}x ${name} (${i.sizeLabel})${extras} &mdash; ${money(i.unitPriceCents * i.quantity)}</li>`;
    })
    .join('');
}

function trackingUrl(store, orderId) {
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  return `${base}/${store.slug}/order/${orderId}`;
}

// Fire-and-forget from the request path - a slow or failed email must never
// delay or break order placement, so callers should not await these.
// `recipientEmail` is resolved by the caller (guest.email, or the logged-in
// customer's email looked up separately) since the serialized order only
// carries guest contact details, not a registered customer's.
async function sendOrderConfirmation(store, order, recipientEmail) {
  if (!recipientEmail) return;

  await sendEmail({
    to: recipientEmail,
    subject: `${store.name}: Order #${order.id} confirmed`,
    text:
      `Thanks for your order from ${store.name}!\n\n` +
      `Order #${order.id} (${order.type})\n\n${itemsText(order)}\n\n` +
      `Total: ${money(order.totalCents)}\n\n` +
      `Track your order: ${trackingUrl(store, order.id)}`,
    html:
      `<p>Thanks for your order from <strong>${store.name}</strong>!</p>` +
      `<p>Order #${order.id} (${order.type})</p>` +
      `<ul>${itemsHtml(order)}</ul>` +
      `<p><strong>Total: ${money(order.totalCents)}</strong></p>` +
      `<p><a href="${trackingUrl(store, order.id)}">Track your order</a></p>`,
  });
}

async function sendNewOrderAlert(store, order) {
  const admins = db.prepare('SELECT email FROM admin_users WHERE store_id = ?').all(store.id);
  if (admins.length === 0) return;
  const customerLine = order.guest ? `${order.guest.name} (${order.guest.phone})` : 'Registered customer';

  await sendEmail({
    to: admins.map((a) => a.email),
    subject: `${store.name}: New order #${order.id} (${money(order.totalCents)})`,
    text: `New ${order.type} order #${order.id} from ${customerLine}\n\n${itemsText(order)}\n\nTotal: ${money(order.totalCents)}`,
    html:
      `<p>New ${order.type} order #${order.id} from ${customerLine}</p>` +
      `<ul>${itemsHtml(order)}</ul>` +
      `<p><strong>Total: ${money(order.totalCents)}</strong></p>`,
  });
}

module.exports = { sendOrderConfirmation, sendNewOrderAlert };
