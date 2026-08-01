const express = require('express');
const db = require('../db');
const { serializeOrder } = require('./orders');

const router = express.Router();

const VALID_STATUSES = ['placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'];

// The kitchen display is a tablet mounted in the kitchen that stays open all
// day - it authenticates with a long-lived per-store token embedded in its
// URL instead of a real admin session, so nobody has to log in on it.
function requireKitchenToken(req, res, next) {
  const token = req.query.token;
  if (!token || !req.store.kitchen_display_token || token !== req.store.kitchen_display_token) {
    return res.status(403).send('Invalid or missing kitchen display link. Generate a new one from Settings > Devices.');
  }
  next();
}

router.get('/', requireKitchenToken, (req, res) => {
  res.render('kitchen', { store: req.store, token: req.query.token });
});

router.get('/api/orders', requireKitchenToken, (req, res) => {
  const orders = db
    .prepare("SELECT * FROM orders WHERE store_id = ? AND status NOT IN ('completed', 'cancelled') ORDER BY created_at ASC")
    .all(req.store.id);
  res.json({ orders: orders.map(serializeOrder) });
});

router.patch('/api/orders/:id', requireKitchenToken, (req, res) => {
  const { status } = req.body || {};
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const info = db.prepare('UPDATE orders SET status = ? WHERE id = ? AND store_id = ?').run(status, req.params.id, req.store.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Order not found' });

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  const io = req.app.get('io');
  io.to(`order:${req.store.id}:${order.id}`).emit('order:update', serializeOrder(order));
  io.to(`admin:${req.store.id}`).emit('order:update', serializeOrder(order));
  res.json({ order: serializeOrder(order) });
});

module.exports = router;
