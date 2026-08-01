const crypto = require('crypto');
const db = require('../db');

function ticketText(store, order) {
  const line = '-'.repeat(32);
  const itemLines = order.items
    .map((i) => {
      const name = i.isHalfAndHalf ? `Half ${i.menuItemName} / Half ${i.secondMenuItemName}` : i.menuItemName;
      const extras = i.extras.length
        ? `\n   + ${i.extras.map((e) => (i.isHalfAndHalf ? `${e.name} (${e.half})` : e.name)).join(', ')}`
        : '';
      const itemNote = i.notes ? `\n   Note: ${i.notes}` : '';
      return `${i.quantity}x ${name} (${i.sizeLabel})${extras}${itemNote}`;
    })
    .join('\n');
  const guestLine = order.guest ? `${order.guest.name} / ${order.guest.phone}` : 'Registered customer';

  return [
    store.name,
    line,
    `Order #${order.id}          ${order.type.toUpperCase()}`,
    `Requested: ${order.requestedTime}`,
    line,
    itemLines,
    line,
    ...(order.notes ? [`Note: ${order.notes}`, line] : []),
    guestLine,
    '',
    '',
    '',
  ].join('\n');
}

// Enqueues a plain-text ticket for the store's receipt printer to pick up on
// its next CloudPRNT poll. No-op if the store hasn't turned printing on.
function enqueuePrintJob(store, order) {
  if (!store.printer_enabled) return;
  const jobToken = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO print_jobs (store_id, order_id, job_token, content) VALUES (?, ?, ?, ?)').run(
    store.id,
    order.id,
    jobToken,
    ticketText(store, order)
  );
}

module.exports = { enqueuePrintJob, ticketText };
