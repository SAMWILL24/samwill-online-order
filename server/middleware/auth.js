const jwt = require('jsonwebtoken');
const db = require('../db');

function signCustomerToken(customer) {
  return jwt.sign({ sub: customer.id, email: customer.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// A token can be structurally valid but reference a customer that no longer exists
// (deleted account, or a stale token from before a dev DB reset) - treat that the
// same as "not logged in" rather than letting a dangling id reach the DB layer.
function customerExists(id) {
  return Boolean(db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id));
}

function optionalCustomerAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      if (customerExists(payload.sub)) req.customerId = payload.sub;
    } catch {
      // ignore invalid/expired token, treat as guest
    }
  }
  next();
}

function requireCustomerAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    if (!customerExists(payload.sub)) return res.status(401).json({ error: 'Account no longer exists' });
    req.customerId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdminAuth(req, res, next) {
  if (req.session && req.session.adminId) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Admin authentication required' });
  return res.redirect('/admin/login');
}

module.exports = { signCustomerToken, optionalCustomerAuth, requireCustomerAuth, requireAdminAuth };
