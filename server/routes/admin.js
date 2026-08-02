const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const db = require('../db');
const { requireAdminAuth } = require('../middleware/auth');
const { getFullMenu } = require('../lib/menu');
const { serializeOrder } = require('./orders');
const { resolveRecipientPhone, sendOrderReadySms, isOrderFinishedForCustomer } = require('../lib/orderSms');
const cardpointe = require('../lib/cardpointe');
const crypto = require('crypto');
const { createResetToken, consumeResetToken } = require('../lib/passwordReset');
const { sendPasswordResetEmail, sendStaffInviteEmail, sendLoginOtpEmail } = require('../lib/authEmails');
const { createOtp, verifyOtp, msUntilResendAllowed } = require('../lib/loginOtp');
const { loginLimiter, forgotPasswordLimiter } = require('../middleware/rateLimit');
const { getWeekHours, setWeekHours } = require('../lib/businessHours');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const { dataDir } = require('../lib/paths');
const uploadsDir = path.join(dataDir, 'uploads', 'menu');

// ---- Auth (session-based) ----

router.get('/login', (req, res) => {
  if (req.session.adminId && (req.session.isPlatformAdmin || req.session.storeId === req.store.id)) {
    return res.redirect(`/${req.store.slug}/admin`);
  }
  res.render('admin/login', { error: null, store: req.store });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = (email || '').toLowerCase();

  const platformAdmin = db.prepare('SELECT * FROM platform_admins WHERE email = ?').get(normalizedEmail);
  if (platformAdmin && bcrypt.compareSync(password || '', platformAdmin.password_hash)) {
    req.session.pendingAdminId = platformAdmin.id;
    req.session.pendingIsPlatformAdmin = true;
    req.session.pendingAdminEmail = platformAdmin.email;
    await sendPendingOtp(req, 'platform', platformAdmin.id, platformAdmin.email);
    return res.redirect(`/${req.store.slug}/admin/login/verify`);
  }

  const admin = db
    .prepare('SELECT * FROM admin_users WHERE store_id = ? AND email = ?')
    .get(req.store.id, normalizedEmail);
  if (!admin || !bcrypt.compareSync(password || '', admin.password_hash)) {
    return res.render('admin/login', { error: 'Invalid email or password', store: req.store });
  }
  req.session.pendingAdminId = admin.id;
  req.session.pendingIsPlatformAdmin = false;
  req.session.pendingAdminEmail = admin.email;
  req.session.pendingRole = admin.role;
  await sendPendingOtp(req, 'admin', admin.id, admin.email);
  res.redirect(`/${req.store.slug}/admin/login/verify`);
});

// Shared by the initial /login success and the resend action.
async function sendPendingOtp(req, accountType, accountId, email) {
  const code = createOtp(req.store.id, accountType, accountId);
  try {
    await sendLoginOtpEmail(email, code, req.store.name);
  } catch (err) {
    console.error('[email] admin login code failed:', err.message);
  }
}

router.get('/login/verify', (req, res) => {
  if (!req.session.pendingAdminId) {
    return res.redirect(`/${req.store.slug}/admin/login`);
  }
  res.render('admin/verify-otp', { error: null, store: req.store });
});

router.post('/login/verify', loginLimiter, (req, res) => {
  const { pendingAdminId, pendingIsPlatformAdmin, pendingAdminEmail, pendingRole } = req.session;
  if (!pendingAdminId) {
    return res.redirect(`/${req.store.slug}/admin/login`);
  }

  const accountType = pendingIsPlatformAdmin ? 'platform' : 'admin';
  const result = verifyOtp(req.store.id, accountType, pendingAdminId, req.body.code);

  if (!result.ok) {
    if (result.reason === 'locked' || result.reason === 'no_code' || result.reason === 'expired') {
      delete req.session.pendingAdminId;
      delete req.session.pendingIsPlatformAdmin;
      delete req.session.pendingAdminEmail;
      delete req.session.pendingRole;
      return res.render('admin/login', {
        error: 'That code expired or had too many wrong attempts. Please log in again.',
        store: req.store,
      });
    }
    return res.render('admin/verify-otp', { error: 'Incorrect code. Please try again.', store: req.store });
  }

  req.session.adminId = pendingAdminId;
  req.session.isPlatformAdmin = pendingIsPlatformAdmin;
  req.session.storeId = req.store.id;
  req.session.adminEmail = pendingAdminEmail;
  req.session.role = pendingRole;
  delete req.session.pendingAdminId;
  delete req.session.pendingIsPlatformAdmin;
  delete req.session.pendingAdminEmail;
  delete req.session.pendingRole;

  res.redirect(`/${req.store.slug}/admin`);
});

router.post('/login/verify/resend', forgotPasswordLimiter, async (req, res) => {
  const { pendingAdminId, pendingIsPlatformAdmin, pendingAdminEmail } = req.session;
  if (!pendingAdminId) {
    return res.redirect(`/${req.store.slug}/admin/login`);
  }

  const accountType = pendingIsPlatformAdmin ? 'platform' : 'admin';
  const waitMs = msUntilResendAllowed(req.store.id, accountType, pendingAdminId);
  if (waitMs > 0) {
    return res.render('admin/verify-otp', {
      error: `Please wait ${Math.ceil(waitMs / 1000)}s before requesting another code.`,
      store: req.store,
    });
  }

  await sendPendingOtp(req, accountType, pendingAdminId, pendingAdminEmail);
  res.render('admin/verify-otp', { error: 'A new code has been sent.', store: req.store });
});

// Sessions created before role-checking shipped won't have session.role
// cached yet - fall back to a fresh DB lookup rather than denying them.
function isOwner(req) {
  if (req.session.isPlatformAdmin) return true;
  let role = req.session.role;
  if (!role && req.session.adminId) {
    const admin = db.prepare('SELECT role FROM admin_users WHERE id = ? AND store_id = ?').get(req.session.adminId, req.store.id);
    role = admin?.role;
  }
  return role === 'owner';
}

// Staff management and payment credentials are owner-only - a staff account
// must not be able to add/remove other staff (or the owner), or view/change
// this store's CardPointe merchant credentials.
function requireOwner(message) {
  return (req, res, next) => {
    if (isOwner(req)) return next();
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: message });
    return res.status(403).send(message);
  };
}

router.post('/logout', (req, res) => {
  const slug = req.store.slug;
  req.session.destroy(() => res.redirect(`/${slug}/admin/login`));
});

router.get('/forgot-password', (req, res) => {
  res.render('admin/forgot-password', { store: req.store, sent: false });
});

router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body || {};
  const admin = email
    ? db.prepare('SELECT * FROM admin_users WHERE store_id = ? AND email = ?').get(req.store.id, email.toLowerCase())
    : null;
  // Always show the same "check your email" page whether or not the account
  // exists, so this can't be used to discover which emails have an account.
  if (admin) {
    const rawToken = createResetToken(req.store.id, 'admin', admin.id);
    try {
      await sendPasswordResetEmail(req.store, 'admin', admin.email, rawToken);
    } catch (err) {
      console.error('[email] admin password reset failed:', err.message);
    }
  }
  res.render('admin/forgot-password', { store: req.store, sent: true });
});

router.get('/reset-password', (req, res) => {
  res.render('admin/reset-password', { store: req.store, token: req.query.token || null, error: null });
});

router.post('/reset-password', loginLimiter, (req, res) => {
  const { token, password } = req.body || {};
  if (!password || password.length < 8) {
    return res.render('admin/reset-password', { store: req.store, token, error: 'Password must be at least 8 characters' });
  }
  const adminId = consumeResetToken(req.store.id, 'admin', token);
  if (!adminId) {
    return res.render('admin/reset-password', { store: req.store, token: null, error: 'This reset link is invalid or has expired' });
  }
  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ? AND store_id = ?').run(passwordHash, adminId, req.store.id);
  res.redirect(`/${req.store.slug}/admin/login`);
});

router.use(requireAdminAuth);

// ---- Pages ----

function renderPage(view, section, page) {
  return (req, res) =>
    res.render(view, {
      adminEmail: req.session.adminEmail,
      isPlatformAdmin: Boolean(req.session.isPlatformAdmin),
      section,
      page,
      store: req.store,
    });
}

router.get('/', renderPage('admin/home', 'home', null));
router.get('/orders', renderPage('admin/orders', 'orders', null));

router.get('/menu', (req, res) => res.redirect(`/${req.store.slug}/admin/menu/overview`));
router.get('/menu/overview', renderPage('admin/menu/overview', 'menu', 'overview'));
router.get('/menu/items', renderPage('admin/menu/items', 'menu', 'items'));
router.get('/menu/categories', renderPage('admin/menu/categories', 'menu', 'categories'));
router.get('/menu/add-ons', renderPage('admin/menu/add-ons', 'menu', 'add-ons'));
router.get('/menu/modifiers', (req, res) => res.redirect(`/${req.store.slug}/admin/menu/add-ons`));

router.get('/marketing', (req, res) => res.redirect(`/${req.store.slug}/admin/marketing/coupons`));
router.get('/marketing/coupons', renderPage('admin/marketing/coupons', 'marketing', 'coupons'));
router.get('/marketing/loyalty', renderPage('admin/marketing/loyalty', 'marketing', 'loyalty'));
router.get('/marketing/announcements', renderPage('admin/marketing/announcements', 'marketing', 'announcements'));
router.get('/promotions', (req, res) => res.redirect(`/${req.store.slug}/admin/marketing/coupons`));

router.get('/reporting', (req, res) => res.redirect(`/${req.store.slug}/admin/reporting/order-reports`));
router.get('/reporting/order-reports', renderPage('admin/reporting/order-reports', 'reporting', 'order-reports'));
router.get('/reporting/all-reports', (req, res) => res.redirect(`/${req.store.slug}/admin/reporting/order-reports`));
router.get('/reporting/analytics', renderPage('admin/reporting/analytics', 'reporting', 'analytics'));

router.get('/customers', renderPage('admin/customers', 'customers', null));

router.get('/staff', requireOwner('Only the store owner can manage staff'), renderPage('admin/staff', 'staff', null));

router.get('/design', (req, res) => res.redirect(`/${req.store.slug}/admin/design/branding`));
router.get('/design/branding', renderPage('admin/design/branding', 'design', 'branding'));
router.get('/design/settings', (req, res) => res.redirect(`/${req.store.slug}/admin/design/branding`));
router.get('/design/media-library', renderPage('admin/design/media-library', 'design', 'media-library'));
router.get('/design/photos', (req, res) => res.redirect(`/${req.store.slug}/admin/design/media-library`));

router.get('/settings', (req, res) => res.redirect(`/${req.store.slug}/admin/settings/restaurant-profile`));
router.get('/settings/restaurant-profile', renderPage('admin/settings/restaurant-profile', 'settings', 'restaurant-profile'));
router.get('/settings/location-profile', (req, res) => res.redirect(`/${req.store.slug}/admin/settings/restaurant-profile`));
router.get('/settings/business-hours', renderPage('admin/settings/business-hours', 'settings', 'business-hours'));
router.get('/settings/location-hours', (req, res) => res.redirect(`/${req.store.slug}/admin/settings/business-hours`));
router.get('/settings/order-channels', renderPage('admin/settings/order-channels', 'settings', 'order-channels'));
router.get('/settings/order-methods', (req, res) => res.redirect(`/${req.store.slug}/admin/settings/order-channels`));
router.get(
  '/settings/payments',
  requireOwner('Only the store owner can view payment settings'),
  renderPage('admin/settings/payments', 'settings', 'payments')
);
router.get(
  '/settings/devices',
  requireOwner('Only the store owner can manage devices'),
  renderPage('admin/settings/devices', 'settings', 'devices')
);

// ---- JSON API for dashboard/menu/settings pages ----

router.get('/api/menu', (req, res) => {
  res.json({ categories: getFullMenu(req.store.id, { includeInactive: true }) });
});

router.post('/api/categories', (req, res) => {
  const { name, sortOrder, supportsHalfAndHalf } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const info = db
    .prepare('INSERT INTO categories (store_id, name, sort_order, supports_half_and_half) VALUES (?, ?, ?, ?)')
    .run(req.store.id, name, sortOrder || 0, supportsHalfAndHalf ? 1 : 0);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/api/categories/:id', (req, res) => {
  const { name, sortOrder, supportsHalfAndHalf } = req.body || {};
  const current = db.prepare('SELECT * FROM categories WHERE id = ? AND store_id = ?').get(req.params.id, req.store.id);
  if (!current) return res.status(404).json({ error: 'Category not found' });
  db.prepare('UPDATE categories SET name = ?, sort_order = ?, supports_half_and_half = ? WHERE id = ?').run(
    name ?? current.name,
    Number.isInteger(sortOrder) ? sortOrder : current.sort_order,
    typeof supportsHalfAndHalf === 'boolean' ? (supportsHalfAndHalf ? 1 : 0) : current.supports_half_and_half,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/api/categories/:id', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ? AND store_id = ?').run(req.params.id, req.store.id);
  res.json({ ok: true });
});

function getOwnedCategory(categoryId, storeId) {
  return db.prepare('SELECT * FROM categories WHERE id = ? AND store_id = ?').get(categoryId, storeId);
}

// Joins through categories (menu_items has no direct store_id) to verify ownership.
function getOwnedItem(itemId, storeId) {
  return db
    .prepare(`SELECT mi.* FROM menu_items mi JOIN categories c ON c.id = mi.category_id WHERE mi.id = ? AND c.store_id = ?`)
    .get(itemId, storeId);
}

router.post('/api/items', (req, res) => {
  const { categoryId, name, description, imageUrl, sortOrder } = req.body || {};
  if (!categoryId || !name) return res.status(400).json({ error: 'categoryId and name are required' });
  if (!getOwnedCategory(categoryId, req.store.id)) return res.status(404).json({ error: 'Category not found' });
  const info = db
    .prepare('INSERT INTO menu_items (category_id, name, description, image_url, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(categoryId, name, description || null, imageUrl || null, sortOrder || 0);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/api/items/:id', (req, res) => {
  const { name, description, imageUrl, isActive, sortOrder, categoryId } = req.body || {};
  const current = getOwnedItem(req.params.id, req.store.id);
  if (!current) return res.status(404).json({ error: 'Item not found' });
  if (categoryId !== undefined && !getOwnedCategory(categoryId, req.store.id)) {
    return res.status(404).json({ error: 'Category not found' });
  }
  db.prepare(
    `UPDATE menu_items SET
      name = ?, description = ?, image_url = ?, is_active = ?, sort_order = ?, category_id = ?
     WHERE id = ?`
  ).run(
    name ?? current.name,
    description ?? current.description,
    imageUrl ?? current.image_url,
    typeof isActive === 'boolean' ? (isActive ? 1 : 0) : current.is_active,
    Number.isInteger(sortOrder) ? sortOrder : current.sort_order,
    categoryId ?? current.category_id,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/api/items/:id', (req, res) => {
  if (!getOwnedItem(req.params.id, req.store.id)) return res.status(404).json({ error: 'Item not found' });
  try {
    db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.id);
    res.json({ ok: true, deactivated: false });
  } catch (err) {
    // An item that has ever been ordered can't be hard-deleted - order_items
    // keeps a reference to it for order-history purposes. Deactivating it
    // instead removes it from the customer-facing menu without breaking
    // that history.
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      db.prepare('UPDATE menu_items SET is_active = 0 WHERE id = ?').run(req.params.id);
      return res.json({ ok: true, deactivated: true });
    }
    throw err;
  }
});

router.post('/api/items/:id/image', upload.single('image'), async (req, res) => {
  const item = getOwnedItem(req.params.id, req.store.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });

  fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = `${item.id}-${Date.now()}.jpg`;
  await sharp(req.file.buffer).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(path.join(uploadsDir, filename));

  const imageUrl = `/uploads/menu/${filename}`;
  db.prepare('UPDATE menu_items SET image_url = ? WHERE id = ?').run(imageUrl, item.id);
  res.json({ imageUrl });
});

router.post('/api/items/:id/sizes', (req, res) => {
  const { label, priceCents, sortOrder } = req.body || {};
  if (!label || !Number.isInteger(priceCents)) return res.status(400).json({ error: 'label and priceCents are required' });
  if (!getOwnedItem(req.params.id, req.store.id)) return res.status(404).json({ error: 'Item not found' });
  const info = db
    .prepare('INSERT INTO item_sizes (menu_item_id, label, price_cents, sort_order) VALUES (?, ?, ?, ?)')
    .run(req.params.id, label, priceCents, sortOrder || 0);
  res.status(201).json({ id: info.lastInsertRowid });
});

function getOwnedSize(sizeId, storeId) {
  return db
    .prepare(
      `SELECT s.* FROM item_sizes s
       JOIN menu_items mi ON mi.id = s.menu_item_id
       JOIN categories c ON c.id = mi.category_id
       WHERE s.id = ? AND c.store_id = ?`
    )
    .get(sizeId, storeId);
}

router.put('/api/sizes/:id', (req, res) => {
  const { label, priceCents } = req.body || {};
  const current = getOwnedSize(req.params.id, req.store.id);
  if (!current) return res.status(404).json({ error: 'Size not found' });
  db.prepare('UPDATE item_sizes SET label = ?, price_cents = ? WHERE id = ?').run(
    label ?? current.label,
    Number.isInteger(priceCents) ? priceCents : current.price_cents,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/api/sizes/:id', (req, res) => {
  if (!getOwnedSize(req.params.id, req.store.id)) return res.status(404).json({ error: 'Size not found' });
  db.prepare('DELETE FROM item_sizes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Extra groups are shared entities within a store (see menu_item_extra_groups): "add
// group" on an item creates a brand new shared group and attaches it; "attach" links an
// already-existing group (e.g. "Pizza Toppings") to another item without duplicating it.

function getOwnedGroup(groupId, storeId) {
  return db.prepare('SELECT * FROM extra_groups WHERE id = ? AND store_id = ?').get(groupId, storeId);
}

router.get('/api/extra-groups', (req, res) => {
  const groups = db.prepare('SELECT * FROM extra_groups WHERE store_id = ? ORDER BY name').all(req.store.id);
  const groupIds = groups.map((g) => g.id);
  const extras = groupIds.length
    ? db
        .prepare(`SELECT * FROM extras WHERE extra_group_id IN (${groupIds.map(() => '?').join(',')}) ORDER BY sort_order, id`)
        .all(...groupIds)
    : [];
  const extrasByGroup = extras.reduce((acc, e) => {
    (acc[e.extra_group_id] = acc[e.extra_group_id] || []).push(e);
    return acc;
  }, {});
  res.json({
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.min_select,
      maxSelect: g.max_select,
      extras: (extrasByGroup[g.id] || []).map((e) => ({ id: e.id, name: e.name, priceCents: e.price_cents })),
    })),
  });
});

// Creates a shared group with no item attached yet (used by the Add-ons library page;
// attach it to items afterward via the per-item attach endpoint below).
router.post('/api/extra-groups', (req, res) => {
  const { name, minSelect, maxSelect } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const info = db
    .prepare('INSERT INTO extra_groups (store_id, name, min_select, max_select) VALUES (?, ?, ?, ?)')
    .run(req.store.id, name, minSelect ?? 0, maxSelect ?? 1);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.post('/api/items/:id/extra-groups', (req, res) => {
  const { name, minSelect, maxSelect, sortOrder } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!getOwnedItem(req.params.id, req.store.id)) return res.status(404).json({ error: 'Item not found' });
  const attach = db.transaction(() => {
    const groupInfo = db
      .prepare('INSERT INTO extra_groups (store_id, name, min_select, max_select, sort_order) VALUES (?, ?, ?, ?, ?)')
      .run(req.store.id, name, minSelect ?? 0, maxSelect ?? 1, sortOrder || 0);
    db.prepare('INSERT INTO menu_item_extra_groups (menu_item_id, extra_group_id, sort_order) VALUES (?, ?, ?)').run(
      req.params.id,
      groupInfo.lastInsertRowid,
      sortOrder || 0
    );
    return groupInfo.lastInsertRowid;
  });
  res.status(201).json({ id: attach() });
});

router.post('/api/items/:id/extra-groups/:groupId/attach', (req, res) => {
  if (!getOwnedItem(req.params.id, req.store.id)) return res.status(404).json({ error: 'Item not found' });
  const group = getOwnedGroup(req.params.groupId, req.store.id);
  if (!group) return res.status(404).json({ error: 'Extra group not found' });
  const existing = db
    .prepare('SELECT id FROM menu_item_extra_groups WHERE menu_item_id = ? AND extra_group_id = ?')
    .get(req.params.id, req.params.groupId);
  if (existing) return res.status(409).json({ error: 'This group is already attached to this item' });
  db.prepare('INSERT INTO menu_item_extra_groups (menu_item_id, extra_group_id) VALUES (?, ?)').run(
    req.params.id,
    req.params.groupId
  );
  res.status(201).json({ ok: true });
});

// Detach only removes the link between this item and the group - the shared group (and
// its extras) still exists and stays attached to any other items using it.
router.delete('/api/items/:id/extra-groups/:groupId', (req, res) => {
  if (!getOwnedItem(req.params.id, req.store.id)) return res.status(404).json({ error: 'Item not found' });
  db.prepare('DELETE FROM menu_item_extra_groups WHERE menu_item_id = ? AND extra_group_id = ?').run(
    req.params.id,
    req.params.groupId
  );
  res.json({ ok: true });
});

router.put('/api/extra-groups/:id', (req, res) => {
  const { name, minSelect, maxSelect } = req.body || {};
  const current = getOwnedGroup(req.params.id, req.store.id);
  if (!current) return res.status(404).json({ error: 'Extra group not found' });
  db.prepare('UPDATE extra_groups SET name = ?, min_select = ?, max_select = ? WHERE id = ?').run(
    name ?? current.name,
    Number.isInteger(minSelect) ? minSelect : current.min_select,
    Number.isInteger(maxSelect) ? maxSelect : current.max_select,
    req.params.id
  );
  res.json({ ok: true });
});

// Deletes the shared group entirely (cascades: detaches from every item, removes its extras).
router.delete('/api/extra-groups/:id', (req, res) => {
  if (!getOwnedGroup(req.params.id, req.store.id)) return res.status(404).json({ error: 'Extra group not found' });
  db.prepare('DELETE FROM extra_groups WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/api/extra-groups/:id/extras', (req, res) => {
  const { name, priceCents, sortOrder } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!getOwnedGroup(req.params.id, req.store.id)) return res.status(404).json({ error: 'Extra group not found' });
  const info = db
    .prepare('INSERT INTO extras (extra_group_id, name, price_cents, sort_order) VALUES (?, ?, ?, ?)')
    .run(req.params.id, name, priceCents || 0, sortOrder || 0);
  res.status(201).json({ id: info.lastInsertRowid });
});

function getOwnedExtra(extraId, storeId) {
  return db
    .prepare(
      `SELECT e.* FROM extras e JOIN extra_groups eg ON eg.id = e.extra_group_id WHERE e.id = ? AND eg.store_id = ?`
    )
    .get(extraId, storeId);
}

router.put('/api/extras/:id', (req, res) => {
  const { name, priceCents } = req.body || {};
  const current = getOwnedExtra(req.params.id, req.store.id);
  if (!current) return res.status(404).json({ error: 'Extra not found' });
  db.prepare('UPDATE extras SET name = ?, price_cents = ? WHERE id = ?').run(
    name ?? current.name,
    Number.isInteger(priceCents) ? priceCents : current.price_cents,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/api/extras/:id', (req, res) => {
  if (!getOwnedExtra(req.params.id, req.store.id)) return res.status(404).json({ error: 'Extra not found' });
  db.prepare('DELETE FROM extras WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Promotions ----

router.get('/api/promotions', (req, res) => {
  res.json({ promotions: db.prepare('SELECT * FROM promotions WHERE store_id = ? ORDER BY created_at DESC').all(req.store.id) });
});

router.post('/api/promotions', (req, res) => {
  const p = req.body || {};
  if (!p.title || !p.discountType || !Number.isInteger(p.discountValue)) {
    return res.status(400).json({ error: 'title, discountType and discountValue are required' });
  }
  const info = db
    .prepare(
      `INSERT INTO promotions
        (store_id, code, title, description, discount_type, discount_value, min_subtotal_cents, auto_apply, starts_at, ends_at, days_of_week, start_time, end_time, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.store.id,
      p.code || null,
      p.title,
      p.description || null,
      p.discountType,
      p.discountValue,
      p.minSubtotalCents || 0,
      p.autoApply ? 1 : 0,
      p.startsAt || null,
      p.endsAt || null,
      p.daysOfWeek || null,
      p.startTime || null,
      p.endTime || null,
      p.isActive === false ? 0 : 1
    );
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/api/promotions/:id', (req, res) => {
  const p = req.body || {};
  const current = db.prepare('SELECT * FROM promotions WHERE id = ? AND store_id = ?').get(req.params.id, req.store.id);
  if (!current) return res.status(404).json({ error: 'Promotion not found' });
  db.prepare(
    `UPDATE promotions SET
      code = ?, title = ?, description = ?, discount_type = ?, discount_value = ?, min_subtotal_cents = ?,
      auto_apply = ?, starts_at = ?, ends_at = ?, days_of_week = ?, start_time = ?, end_time = ?, is_active = ?
     WHERE id = ?`
  ).run(
    p.code !== undefined ? p.code || null : current.code,
    p.title ?? current.title,
    p.description !== undefined ? p.description : current.description,
    p.discountType ?? current.discount_type,
    Number.isInteger(p.discountValue) ? p.discountValue : current.discount_value,
    Number.isInteger(p.minSubtotalCents) ? p.minSubtotalCents : current.min_subtotal_cents,
    typeof p.autoApply === 'boolean' ? (p.autoApply ? 1 : 0) : current.auto_apply,
    p.startsAt !== undefined ? p.startsAt : current.starts_at,
    p.endsAt !== undefined ? p.endsAt : current.ends_at,
    p.daysOfWeek !== undefined ? p.daysOfWeek : current.days_of_week,
    p.startTime !== undefined ? p.startTime : current.start_time,
    p.endTime !== undefined ? p.endTime : current.end_time,
    typeof p.isActive === 'boolean' ? (p.isActive ? 1 : 0) : current.is_active,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/api/promotions/:id', (req, res) => {
  db.prepare('DELETE FROM promotions WHERE id = ? AND store_id = ?').run(req.params.id, req.store.id);
  res.json({ ok: true });
});

// ---- Settings (the store's own row in `stores`) ----

router.get('/api/settings', (req, res) => {
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.store.id);
  // The CardPointe API password is a write-only secret - it's never echoed back,
  // only whether one has been set. The rest of the CardPointe fields are only
  // sent to owners - staff shouldn't be able to see the merchant credentials
  // even via this shared settings endpoint.
  const { cardpointe_password, cardpointe_site, cardpointe_merchid, cardpointe_username, cardpointe_testmode, ...safe } = store;
  const cardpointeFields = isOwner(req)
    ? { cardpointe_site, cardpointe_merchid, cardpointe_username, cardpointe_testmode }
    : {};
  res.json({ ...safe, ...cardpointeFields, cardpointe_password_set: isOwner(req) ? Boolean(cardpointe_password) : undefined });
});

const CARDPOINTE_FIELDS = ['cardpointeSite', 'cardpointeMerchid', 'cardpointeUsername', 'cardpointePassword', 'cardpointeTestmode'];

router.put('/api/settings', (req, res) => {
  const s = req.body || {};
  if (!isOwner(req) && CARDPOINTE_FIELDS.some((f) => f in s)) {
    return res.status(403).json({ error: 'Only the store owner can change payment settings' });
  }
  const current = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.store.id);
  db.prepare(
    `UPDATE stores SET
      name = ?, address = ?, delivery_fee_cents = ?, min_delivery_cents = ?, tax_rate_bps = ?,
      delivery_radius_miles = ?, is_open_override = ?,
      loyalty_earn_rate_per_dollar = ?, loyalty_redeem_value_cents = ?, loyalty_min_redeem_points = ?,
      pickup_enabled = ?, delivery_enabled = ?, curbside_enabled = ?, theme_accent_color = ?,
      online_ordering_enabled = ?, store_description = ?, prep_time_minutes = ?, order_mode = ?,
      digital_menu_url = ?, cardpointe_site = ?, cardpointe_merchid = ?, cardpointe_username = ?,
      cardpointe_password = ?, cardpointe_testmode = ?
     WHERE id = ?`
  ).run(
    s.name ?? current.name,
    s.address ?? current.address,
    Number.isInteger(s.deliveryFeeCents) ? s.deliveryFeeCents : current.delivery_fee_cents,
    Number.isInteger(s.minDeliveryCents) ? s.minDeliveryCents : current.min_delivery_cents,
    Number.isInteger(s.taxRateBps) ? s.taxRateBps : current.tax_rate_bps,
    typeof s.deliveryRadiusMiles === 'number' ? s.deliveryRadiusMiles : current.delivery_radius_miles,
    s.isOpenOverride ?? current.is_open_override,
    typeof s.loyaltyEarnRatePerDollar === 'number' ? s.loyaltyEarnRatePerDollar : current.loyalty_earn_rate_per_dollar,
    typeof s.loyaltyRedeemValueCents === 'number' ? s.loyaltyRedeemValueCents : current.loyalty_redeem_value_cents,
    Number.isInteger(s.loyaltyMinRedeemPoints) ? s.loyaltyMinRedeemPoints : current.loyalty_min_redeem_points,
    typeof s.pickupEnabled === 'boolean' ? (s.pickupEnabled ? 1 : 0) : current.pickup_enabled,
    typeof s.deliveryEnabled === 'boolean' ? (s.deliveryEnabled ? 1 : 0) : current.delivery_enabled,
    typeof s.curbsideEnabled === 'boolean' ? (s.curbsideEnabled ? 1 : 0) : current.curbside_enabled,
    s.themeAccentColor ?? current.theme_accent_color,
    typeof s.onlineOrderingEnabled === 'boolean' ? (s.onlineOrderingEnabled ? 1 : 0) : current.online_ordering_enabled,
    s.storeDescription ?? current.store_description,
    Number.isInteger(s.prepTimeMinutes) ? s.prepTimeMinutes : current.prep_time_minutes,
    s.orderMode ?? current.order_mode,
    s.digitalMenuUrl ?? current.digital_menu_url,
    typeof s.cardpointeSite === 'string' ? s.cardpointeSite.trim() : current.cardpointe_site,
    typeof s.cardpointeMerchid === 'string' ? s.cardpointeMerchid.trim() : current.cardpointe_merchid,
    typeof s.cardpointeUsername === 'string' ? s.cardpointeUsername.trim() : current.cardpointe_username,
    typeof s.cardpointePassword === 'string' && s.cardpointePassword.length > 0 ? s.cardpointePassword : current.cardpointe_password,
    typeof s.cardpointeTestmode === 'boolean' ? (s.cardpointeTestmode ? 1 : 0) : current.cardpointe_testmode,
    req.store.id
  );
  res.json({ ok: true });
});

// ---- Business hours ----

router.get('/api/business-hours', (req, res) => {
  const type = req.query.type === 'delivery' ? 'delivery' : 'pickup';
  res.json({ type, days: getWeekHours(req.store.id, type) });
});

router.put('/api/business-hours', (req, res) => {
  const { type, days } = req.body || {};
  if (!['pickup', 'delivery'].includes(type) || !Array.isArray(days)) {
    return res.status(400).json({ error: 'type and days are required' });
  }
  setWeekHours(req.store.id, type, days);
  res.json({ ok: true });
});

// ---- Branding images (ad / header / footer) ----

const BRANDING_SLOTS = { ad: 'ad_image_url', header: 'header_image_url', footer: 'footer_image_url' };

router.post('/api/design/:slot/image', upload.single('image'), async (req, res) => {
  const column = BRANDING_SLOTS[req.params.slot];
  if (!column) return res.status(400).json({ error: 'Invalid image slot' });
  if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });

  fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = `branding-${req.store.id}-${req.params.slot}-${Date.now()}.jpg`;
  await sharp(req.file.buffer).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(path.join(uploadsDir, filename));

  const imageUrl = `/uploads/menu/${filename}`;
  db.prepare(`UPDATE stores SET ${column} = ? WHERE id = ?`).run(imageUrl, req.store.id);
  res.json({ imageUrl });
});

// ---- Orders queue ----

router.get('/api/orders', (req, res) => {
  const status = req.query.status;
  const orders = status
    ? db.prepare('SELECT * FROM orders WHERE store_id = ? AND status = ? ORDER BY created_at DESC').all(req.store.id, status)
    : db
        .prepare("SELECT * FROM orders WHERE store_id = ? AND status != 'completed' ORDER BY created_at DESC")
        .all(req.store.id);
  res.json({ orders: orders.map(serializeOrder) });
});

const VALID_STATUSES = ['placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'];

router.patch('/api/orders/:id', (req, res) => {
  const { status } = req.body || {};
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const info = db.prepare('UPDATE orders SET status = ? WHERE id = ? AND store_id = ?').run(status, req.params.id, req.store.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Order not found' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  const io = req.app.get('io');
  io.to(`order:${req.store.id}:${order.id}`).emit('order:update', serializeOrder(order));
  io.to(`admin:${req.store.id}`).emit('order:update', serializeOrder(order));
  if (isOrderFinishedForCustomer(order)) {
    sendOrderReadySms(req.store, serializeOrder(order), resolveRecipientPhone(order)).catch((err) =>
      console.error('[sms] order ready failed:', err.message)
    );
  }
  res.json({ order: serializeOrder(order) });
});

// ---- Announcements ----

router.get('/api/announcements', (req, res) => {
  res.json({ announcements: db.prepare('SELECT * FROM announcements WHERE store_id = ? ORDER BY created_at DESC').all(req.store.id) });
});

router.post('/api/announcements', (req, res) => {
  const { message, isActive } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message is required' });
  const info = db
    .prepare('INSERT INTO announcements (store_id, message, is_active) VALUES (?, ?, ?)')
    .run(req.store.id, message, isActive === false ? 0 : 1);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/api/announcements/:id', (req, res) => {
  const { message, isActive } = req.body || {};
  const current = db.prepare('SELECT * FROM announcements WHERE id = ? AND store_id = ?').get(req.params.id, req.store.id);
  if (!current) return res.status(404).json({ error: 'Announcement not found' });
  db.prepare('UPDATE announcements SET message = ?, is_active = ? WHERE id = ?').run(
    message ?? current.message,
    typeof isActive === 'boolean' ? (isActive ? 1 : 0) : current.is_active,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/api/announcements/:id', (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id = ? AND store_id = ?').run(req.params.id, req.store.id);
  res.json({ ok: true });
});

// ---- Customers ----

router.get('/api/customers', (req, res) => {
  const customers = db
    .prepare(
      `SELECT c.id, c.name, c.email, c.phone, c.loyalty_points, c.created_at,
              COUNT(o.id) AS order_count, COALESCE(SUM(o.total_cents), 0) AS lifetime_spend_cents
       FROM customers c
       LEFT JOIN orders o ON o.customer_id = c.id
       WHERE c.store_id = ?
       GROUP BY c.id
       ORDER BY c.created_at DESC`
    )
    .all(req.store.id);
  res.json({
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      loyaltyPoints: c.loyalty_points,
      createdAt: c.created_at,
      orderCount: c.order_count,
      lifetimeSpendCents: c.lifetime_spend_cents,
    })),
  });
});

// ---- Staff ----

router.get('/api/staff', requireOwner('Only the store owner can manage staff'), (req, res) => {
  const staff = db
    .prepare('SELECT id, email, role, created_at FROM admin_users WHERE store_id = ? ORDER BY created_at ASC')
    .all(req.store.id);
  res.json({
    staff: staff.map((s) => ({ id: s.id, email: s.email, role: s.role, createdAt: s.created_at })),
  });
});

router.post('/api/staff', requireOwner('Only the store owner can manage staff'), async (req, res) => {
  const email = (req.body?.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'email is required' });

  const existing = db.prepare('SELECT id FROM admin_users WHERE store_id = ? AND email = ?').get(req.store.id, email);
  if (existing) return res.status(409).json({ error: 'A staff account with this email already exists' });

  // The new account gets an unusable random password - the invited staff
  // member sets their own via the same emailed link used for password
  // resets, so no temporary password ever needs to be typed or shared.
  const unusablePassword = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
  const info = db
    .prepare('INSERT INTO admin_users (store_id, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(req.store.id, email, unusablePassword, 'staff');

  const rawToken = createResetToken(req.store.id, 'admin', info.lastInsertRowid);
  try {
    await sendStaffInviteEmail(req.store, email, rawToken);
  } catch (err) {
    console.error('[email] staff invite failed:', err.message);
  }

  res.status(201).json({ id: info.lastInsertRowid, email, role: 'staff' });
});

router.delete('/api/staff/:id', requireOwner('Only the store owner can manage staff'), (req, res) => {
  const targetId = Number(req.params.id);
  if (!req.session.isPlatformAdmin && req.session.adminId === targetId) {
    return res.status(400).json({ error: "You can't remove your own account" });
  }
  const remaining = db.prepare('SELECT COUNT(*) AS n FROM admin_users WHERE store_id = ?').get(req.store.id).n;
  if (remaining <= 1) {
    return res.status(400).json({ error: 'A store must keep at least one staff account' });
  }
  const info = db.prepare('DELETE FROM admin_users WHERE id = ? AND store_id = ?').run(targetId, req.store.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Staff account not found' });
  res.json({ ok: true });
});

// ---- Reporting ----

router.get('/api/reports/summary', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const todayOrders = db
    .prepare(`SELECT * FROM orders WHERE store_id = ? AND date(created_at) = ? AND status != 'cancelled'`)
    .all(req.store.id, today);
  const pendingCount = db
    .prepare(`SELECT COUNT(*) AS n FROM orders WHERE store_id = ? AND status NOT IN ('completed', 'cancelled')`)
    .get(req.store.id).n;
  const revenueCents = todayOrders.reduce((sum, o) => sum + o.total_cents, 0);
  const avgOrderCents = todayOrders.length ? Math.round(revenueCents / todayOrders.length) : 0;
  res.json({
    todayOrderCount: todayOrders.length,
    todayRevenueCents: revenueCents,
    pendingCount,
    avgOrderCents,
  });
});

router.get('/api/reports/orders', (req, res) => {
  const { from, to, status } = req.query;
  const clauses = ['store_id = ?'];
  const params = [req.store.id];
  if (from) {
    clauses.push('date(created_at) >= ?');
    params.push(from);
  }
  if (to) {
    clauses.push('date(created_at) <= ?');
    params.push(to);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  const orders = db.prepare(`SELECT * FROM orders WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`).all(...params);

  if (req.query.format === 'csv') {
    const header = 'Order ID,Date,Type,Status,Customer/Guest,Subtotal,Discount,Delivery Fee,Gratuity,Tax,Total,Payment Status\n';
    const rows = orders
      .map((o) =>
        [
          o.id,
          o.created_at,
          o.type,
          o.status,
          (o.guest_name || 'registered customer').replace(/,/g, ' '),
          (o.subtotal_cents / 100).toFixed(2),
          (o.promotion_discount_cents / 100).toFixed(2),
          (o.delivery_fee_cents / 100).toFixed(2),
          (o.tip_cents / 100).toFixed(2),
          (o.tax_cents / 100).toFixed(2),
          (o.total_cents / 100).toFixed(2),
          o.payment_status,
        ].join(',')
      )
      .join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    return res.send(header + rows);
  }

  res.json({ orders: orders.map(serializeOrder) });
});

router.get('/api/reports/analytics', (req, res) => {
  const revenueByDay = db
    .prepare(
      `SELECT date(created_at) AS day, SUM(total_cents) AS revenue_cents, COUNT(*) AS order_count
       FROM orders
       WHERE store_id = ? AND status != 'cancelled' AND created_at >= date('now', '-30 days')
       GROUP BY day
       ORDER BY day`
    )
    .all(req.store.id);

  const topItems = db
    .prepare(
      `SELECT menu_item_name, SUM(quantity) AS total_quantity, SUM(quantity * unit_price_cents) AS total_revenue_cents
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.store_id = ? AND o.status != 'cancelled'
       GROUP BY menu_item_name
       ORDER BY total_quantity DESC
       LIMIT 5`
    )
    .all(req.store.id);

  res.json({
    revenueByDay: revenueByDay.map((r) => ({ day: r.day, revenueCents: r.revenue_cents, orderCount: r.order_count })),
    topItems: topItems.map((i) => ({
      name: i.menu_item_name,
      totalQuantity: i.total_quantity,
      totalRevenueCents: i.total_revenue_cents,
    })),
  });
});

// ---- Media Library ----
// Uploads share one flat directory across every store; ownership is inferred from
// which store's menu items or branding fields currently reference a given filename.

function fileOwnerStoreId(url) {
  const item = db
    .prepare(`SELECT c.store_id FROM menu_items mi JOIN categories c ON c.id = mi.category_id WHERE mi.image_url = ?`)
    .get(url);
  if (item) return item.store_id;
  const store = db
    .prepare('SELECT id FROM stores WHERE ad_image_url = ? OR header_image_url = ? OR footer_image_url = ?')
    .get(url, url, url);
  return store ? store.id : null;
}

router.get('/api/photos', (req, res) => {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const files = fs.readdirSync(uploadsDir).map((filename) => {
    const stat = fs.statSync(path.join(uploadsDir, filename));
    return { filename, url: `/uploads/menu/${filename}`, sizeBytes: stat.size, modifiedAt: stat.mtime };
  });
  const visible = files.filter((f) => {
    const ownerId = fileOwnerStoreId(f.url);
    return ownerId === null || ownerId === req.store.id;
  });
  res.json({ photos: visible.map((f) => ({ ...f, inUse: fileOwnerStoreId(f.url) === req.store.id })) });
});

router.delete('/api/photos/:filename', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);
  if (!filePath.startsWith(uploadsDir)) return res.status(400).json({ error: 'Invalid filename' });
  const ownerId = fileOwnerStoreId(`/uploads/menu/${req.params.filename}`);
  if (ownerId !== null && ownerId !== req.store.id) {
    return res.status(403).json({ error: 'This file belongs to another store' });
  }
  fs.rm(filePath, { force: true }, (err) => {
    if (err) return res.status(500).json({ error: 'Could not delete file' });
    res.json({ ok: true });
  });
});

// ---- Payments status ----

router.get('/api/payments-status', (req, res) => {
  res.json({ cardpointeConfigured: cardpointe.isConfigured(req.store) });
});

// ---- Devices: kitchen display + receipt printer ----
// Both are owner-only, same reasoning as payments: these hand out standing
// access to this store's live order stream to whatever physical device holds
// the link/key, so only the owner should be able to view or regenerate them.

router.get('/api/devices', requireOwner('Only the store owner can manage devices'), (req, res) => {
  const store = db
    .prepare('SELECT slug, kitchen_display_token, printer_enabled, printer_key FROM stores WHERE id = ?')
    .get(req.store.id);
  res.json({
    kitchenDisplayUrl: store.kitchen_display_token ? `/${store.slug}/kitchen?token=${store.kitchen_display_token}` : null,
    printerEnabled: Boolean(store.printer_enabled),
    cloudprntUrl: store.printer_key ? `/api/${store.slug}/print/cloudprnt?key=${store.printer_key}` : null,
  });
});

router.post('/api/devices/kitchen-token/regenerate', requireOwner('Only the store owner can manage devices'), (req, res) => {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE stores SET kitchen_display_token = ? WHERE id = ?').run(token, req.store.id);
  res.json({ kitchenDisplayUrl: `/${req.store.slug}/kitchen?token=${token}` });
});

router.put('/api/devices/printer', requireOwner('Only the store owner can manage devices'), (req, res) => {
  const { enabled } = req.body || {};
  db.prepare('UPDATE stores SET printer_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, req.store.id);
  res.json({ ok: true });
});

router.post('/api/devices/printer/regenerate-key', requireOwner('Only the store owner can manage devices'), (req, res) => {
  const key = crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE stores SET printer_key = ? WHERE id = ?').run(key, req.store.id);
  res.json({ cloudprntUrl: `/api/${req.store.slug}/print/cloudprnt?key=${key}` });
});

function isYes(v) {
  return v === true || v === 'Y' || v === 'y';
}

router.post('/api/orders/:id/refund', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND store_id = ?').get(req.params.id, req.store.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!order.cardpointe_retref) return res.status(400).json({ error: 'This order has no associated card payment' });

  const remainingCents = order.total_cents - order.refunded_cents;
  const requested = Number.isInteger(req.body?.amountCents) ? req.body.amountCents : remainingCents;
  if (requested <= 0 || requested > remainingCents) {
    return res.status(400).json({ error: `amountCents must be between 1 and ${remainingCents}` });
  }

  let status;
  try {
    status = await cardpointe.inquire(req.store, { retref: order.cardpointe_retref });
  } catch (err) {
    console.error('[cardpointe] inquire failed:', err.message);
    return res.status(502).json({ error: 'Could not reach payment provider' });
  }

  try {
    let result;
    if (isYes(status.voidable)) {
      result = await cardpointe.voidTransaction(req.store, { retref: order.cardpointe_retref, amountCents: requested });
    } else if (isYes(status.refundable)) {
      result = await cardpointe.refund(req.store, { retref: order.cardpointe_retref, amountCents: requested, orderId: order.id });
    } else {
      return res.status(400).json({ error: 'This transaction is not eligible for a refund or void right now' });
    }
    if (!result.approved) {
      return res.status(502).json({ error: result.resptext || 'Refund was declined by the payment provider' });
    }
  } catch (err) {
    console.error('[cardpointe] refund/void failed:', err.message);
    return res.status(502).json({ error: err.message || 'Refund failed' });
  }

  const newRefundedCents = order.refunded_cents + requested;
  const newPaymentStatus = newRefundedCents >= order.total_cents ? 'refunded' : 'partially_refunded';
  db.prepare('UPDATE orders SET refunded_cents = ?, payment_status = ? WHERE id = ?').run(
    newRefundedCents,
    newPaymentStatus,
    order.id
  );

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  const io = req.app.get('io');
  io.to(`order:${req.store.id}:${order.id}`).emit('order:update', serializeOrder(updated));
  io.to(`admin:${req.store.id}`).emit('order:update', serializeOrder(updated));

  res.json({ order: serializeOrder(updated) });
});

module.exports = router;
