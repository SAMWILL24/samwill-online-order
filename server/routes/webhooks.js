const express = require('express');
const db = require('../db');
const { stripe, isConfigured: stripeConfigured } = require('../lib/stripe');
const { serializeOrder } = require('./orders');

const router = express.Router();

// Mounted with express.raw() in server.js so Stripe's signature check has the exact raw body.
router.post('/stripe', (req, res) => {
  if (!stripeConfigured) return res.status(400).send('Stripe not configured');

  const signature = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object;
    const orderId = intent.metadata && intent.metadata.orderId;
    if (orderId) {
      const status = event.type === 'payment_intent.succeeded' ? 'paid' : 'failed';
      const orderStatus = event.type === 'payment_intent.succeeded' ? 'confirmed' : 'placed';
      db.prepare('UPDATE orders SET payment_status = ?, status = ? WHERE id = ?').run(status, orderStatus, orderId);

      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (order) {
        const io = req.app.get('io');
        io.to(`order:${orderId}`).emit('order:update', serializeOrder(order));
        io.to('admin').emit('order:update', serializeOrder(order));
      }
    }
  }

  res.json({ received: true });
});

module.exports = router;
