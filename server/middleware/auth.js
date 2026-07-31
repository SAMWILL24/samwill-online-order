const jwt = require('jsonwebtoken');
const db = require('../db');

function signCustomerToken(customer) {
  return jwt.sign(
    { sub: customer.id, email: customer.email, storeId: customer.store_id },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// A token can be structurally valid but reference a customer that no longer exists
// (deleted account, or a stale token from before a dev DB reset), or belong to a
// different store than the one in the URL - treat all of that as "not logged in"
// rather than letting a mismatched id reach the DB layer.
function customerBelongsToStore(id, storeId) {
  return Boolean(db.prepare('SELECT 1 FROM customers WHERE id = ? AND store_id = ?').get(id, storeId));
}

function optionalCustomerAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      if (payload.storeId === req.store.id && customerBelongsToStore(payload.sub, req.store.id)) {
        req.customerId = payload.sub;
      }
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
    if (payload.storeId !== req.store.id || !customerBelongsToStore(payload.sub, req.store.id)) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.customerId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Requires resolveStore to have already run (req.store set). A logged-in session for
// store A must never authorize actions on store B, even if the admin guesses the URL -
// so both the admin id AND the matching store id are required. The one exception is a
// platform admin (the SAMWILL operator's own login), which is intentionally valid for
// every store.
function requireAdminAuth(req, res, next) {
  if (req.session && req.session.adminId) {
    if (req.session.isPlatformAdmin) return next();
    if (req.session.storeId === req.store.id) return next();
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Admin authentication required' });
  return res.redirect(`/${req.store.slug}/admin/login`);
}

module.exports = { signCustomerToken, optionalCustomerAuth, requireCustomerAuth, requireAdminAuth };
