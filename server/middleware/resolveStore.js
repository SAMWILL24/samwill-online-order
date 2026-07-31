const db = require('../db');

// Looks up the store from the :storeSlug URL param and attaches it to req.store.
// Every public/admin route in this app is mounted under a store slug, so this runs
// before any of them - a request for a slug that doesn't exist (or is deactivated)
// never reaches route logic that would otherwise assume a single implicit store.
function resolveStore(req, res, next) {
  const slug = req.params.storeSlug;
  const store = db.prepare('SELECT * FROM stores WHERE slug = ? AND is_active = 1').get(slug);
  if (!store) {
    return res.status(404).json({ error: `Store "${slug}" not found` });
  }
  req.store = store;
  next();
}

module.exports = { resolveStore };
