const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signCustomerToken, requireCustomerAuth } = require('../middleware/auth');
const { createResetToken, consumeResetToken } = require('../lib/passwordReset');
const { sendPasswordResetEmail } = require('../lib/authEmails');
const { loginLimiter, forgotPasswordLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/register', loginLimiter, (req, res) => {
  const { email, password, name, phone } = req.body || {};
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, password and name are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const existing = db.prepare('SELECT id FROM customers WHERE store_id = ? AND email = ?').get(req.store.id, email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO customers (store_id, email, password_hash, name, phone) VALUES (?, ?, ?, ?, ?)')
    .run(req.store.id, email.toLowerCase(), passwordHash, name, phone || null);

  const customer = { id: info.lastInsertRowid, email: email.toLowerCase(), store_id: req.store.id };
  res.status(201).json({
    token: signCustomerToken(customer),
    customer: { id: customer.id, email: customer.email, name, phone: phone || null, loyaltyPoints: 0 },
  });
});

router.post('/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const customer = db.prepare('SELECT * FROM customers WHERE store_id = ? AND email = ?').get(req.store.id, email.toLowerCase());
  if (!customer || !bcrypt.compareSync(password, customer.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  res.json({
    token: signCustomerToken(customer),
    customer: {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      loyaltyPoints: customer.loyalty_points,
    },
  });
});

router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body || {};
  const customer = email
    ? db.prepare('SELECT * FROM customers WHERE store_id = ? AND email = ?').get(req.store.id, email.toLowerCase())
    : null;
  // Always respond the same way whether or not the account exists, so this
  // endpoint can't be used to discover which emails have an account.
  if (customer) {
    const rawToken = createResetToken(req.store.id, 'customer', customer.id);
    try {
      await sendPasswordResetEmail(req.store, 'customer', customer.email, rawToken);
    } catch (err) {
      console.error('[email] password reset failed:', err.message);
    }
  }
  res.json({ ok: true });
});

router.post('/reset-password', loginLimiter, (req, res) => {
  const { token, password } = req.body || {};
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const customerId = consumeResetToken(req.store.id, 'customer', token);
  if (!customerId) return res.status(400).json({ error: 'This reset link is invalid or has expired' });

  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE customers SET password_hash = ? WHERE id = ? AND store_id = ?').run(passwordHash, customerId, req.store.id);
  res.json({ ok: true });
});

router.get('/me', requireCustomerAuth, (req, res) => {
  const customer = db
    .prepare('SELECT id, email, name, phone, loyalty_points FROM customers WHERE id = ? AND store_id = ?')
    .get(req.customerId, req.store.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  res.json({
    customer: {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      loyaltyPoints: customer.loyalty_points,
    },
  });
});

module.exports = router;
