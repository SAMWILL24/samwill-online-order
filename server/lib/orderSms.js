const db = require('../db');
const { sendSms } = require('./sms');

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// Mirrors how the order-confirmation email resolves its recipient: a guest
// order carries its own contact details, a registered customer's live on
// their account instead. Takes the raw `orders` row, not the serialized one.
function resolveRecipientPhone(rawOrder) {
  return rawOrder.customer_id
    ? db.prepare('SELECT phone FROM customers WHERE id = ?').get(rawOrder.customer_id)?.phone
    : rawOrder.guest_phone;
}

// Fire-and-forget, same as email - a slow or down SMS provider must never
// delay or break order placement or a status update.
async function sendOrderReceivedSms(store, order, phone) {
  if (!phone) return;
  const paymentLine = order.paymentStatus === 'paid' ? ` Payment of ${money(order.totalCents)} confirmed.` : '';
  await sendSms({
    to: phone,
    body: `${store.name}: order #${order.id} received!${paymentLine} Total ${money(order.totalCents)}.`,
  });
}

// The moment that matters to the customer differs by order type: pickup and
// curbside customers need to know the instant it's ready to grab, while a
// delivery customer doesn't care until it's actually arrived.
function isOrderFinishedForCustomer(order) {
  if (order.type === 'delivery') return order.status === 'completed';
  return order.status === 'ready';
}

async function sendOrderReadySms(store, order, phone) {
  if (!phone) return;
  const body =
    order.type === 'delivery'
      ? `${store.name}: order #${order.id} has been delivered. Enjoy!`
      : `${store.name}: order #${order.id} is ready for pickup!`;
  await sendSms({ to: phone, body });
}

module.exports = { resolveRecipientPhone, sendOrderReceivedSms, sendOrderReadySms, isOrderFinishedForCustomer };
