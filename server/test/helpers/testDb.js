const fs = require('fs');
const os = require('os');
const path = require('path');

// Must run before ../../db (or anything that requires it) is ever imported -
// lib/paths.js reads DATA_DIR once at require time, so every test file that
// needs the database imports this helper first.
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samwill-online-order-test-'));
process.env.DATA_DIR = testDataDir;

const db = require('../../db');

// Minimal two-store fixture: each store gets one category with one menu item
// (one size, one extra group with one extra), independent of the other -
// enough to test pricing and to prove store A's data can never be reached
// through store B's id.
function createStore(slug, name, overrides = {}) {
  const info = db
    .prepare(
      `INSERT INTO stores (slug, name, delivery_fee_cents, min_delivery_cents, tax_rate_bps)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(slug, name, overrides.deliveryFeeCents ?? 350, overrides.minDeliveryCents ?? 1500, overrides.taxRateBps ?? 1000);
  return info.lastInsertRowid;
}

function seedMenuFixture(storeId, { supportsHalfAndHalf = false } = {}) {
  const categoryInfo = db
    .prepare('INSERT INTO categories (store_id, name, supports_half_and_half) VALUES (?, ?, ?)')
    .run(storeId, 'Pizzas', supportsHalfAndHalf ? 1 : 0);
  const categoryId = categoryInfo.lastInsertRowid;

  const itemInfo = db.prepare('INSERT INTO menu_items (category_id, name) VALUES (?, ?)').run(categoryId, 'Cheese Pizza');
  const menuItemId = itemInfo.lastInsertRowid;

  const sizeInfo = db
    .prepare('INSERT INTO item_sizes (menu_item_id, label, price_cents) VALUES (?, ?, ?)')
    .run(menuItemId, 'SM', 1000);
  const sizeId = sizeInfo.lastInsertRowid;

  const groupInfo = db
    .prepare('INSERT INTO extra_groups (store_id, name, min_select, max_select) VALUES (?, ?, ?, ?)')
    .run(storeId, 'Toppings', 0, 2);
  const groupId = groupInfo.lastInsertRowid;
  db.prepare('INSERT INTO menu_item_extra_groups (menu_item_id, extra_group_id) VALUES (?, ?)').run(menuItemId, groupId);

  const extraInfo = db
    .prepare('INSERT INTO extras (extra_group_id, name, price_cents) VALUES (?, ?, ?)')
    .run(groupId, 'Pepperoni', 150);
  const extraId = extraInfo.lastInsertRowid;

  return { categoryId, menuItemId, sizeId, groupId, extraId };
}

function cleanup() {
  db.close();
  fs.rmSync(testDataDir, { recursive: true, force: true });
}

module.exports = { db, createStore, seedMenuFixture, cleanup };
