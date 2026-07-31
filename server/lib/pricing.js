const db = require('../db');

class OrderValidationError extends Error {}

function getSettings(storeId) {
  return db.prepare('SELECT * FROM stores WHERE id = ?').get(storeId);
}

function getItemExtraGroups(storeId, menuItemId) {
  return db
    .prepare(
      `SELECT eg.* FROM extra_groups eg
       JOIN menu_item_extra_groups mieg ON mieg.extra_group_id = eg.id
       WHERE mieg.menu_item_id = ? AND eg.store_id = ?`
    )
    .all(menuItemId, storeId);
}

function getGroupExtras(groupId) {
  return db.prepare('SELECT * FROM extras WHERE extra_group_id = ?').all(groupId);
}

// Validates a set of chosen extra ids against an item's extra groups (min/max per group).
// Returns the resolved extra rows.
function validateExtraSelection(storeId, menuItem, extraIds) {
  const groups = getItemExtraGroups(storeId, menuItem.id);
  const chosen = [];
  for (const group of groups) {
    const groupExtras = getGroupExtras(group.id);
    const chosenInGroup = groupExtras.filter((e) => extraIds.includes(e.id));
    if (chosenInGroup.length < group.min_select || chosenInGroup.length > group.max_select) {
      throw new OrderValidationError(
        `"${group.name}" for ${menuItem.name} requires between ${group.min_select} and ${group.max_select} selections`
      );
    }
    chosen.push(...chosenInGroup);
  }
  const validIds = new Set(groups.flatMap((g) => getGroupExtras(g.id).map((e) => e.id)));
  for (const id of extraIds) {
    if (!validIds.has(id)) throw new OrderValidationError(`Invalid extra selection for ${menuItem.name}`);
  }
  return chosen;
}

// Joins through categories to verify the item actually belongs to this store - a
// menuItemId from another store must never be priceable/orderable here.
function getActiveMenuItem(storeId, menuItemId) {
  const item = db
    .prepare(
      `SELECT mi.* FROM menu_items mi
       JOIN categories c ON c.id = mi.category_id
       WHERE mi.id = ? AND mi.is_active = 1 AND c.store_id = ?`
    )
    .get(menuItemId, storeId);
  if (!item) throw new OrderValidationError(`Menu item ${menuItemId} not found`);
  return item;
}

function getSize(menuItemId, sizeId) {
  return db.prepare('SELECT * FROM item_sizes WHERE id = ? AND menu_item_id = ?').get(sizeId, menuItemId);
}

function priceHalfAndHalfLine(storeId, line) {
  const menuItem = getActiveMenuItem(storeId, line.menuItemId);
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(menuItem.category_id);
  if (!category || !category.supports_half_and_half) {
    throw new OrderValidationError(`${menuItem.name} does not support half & half`);
  }

  const secondMenuItem = getActiveMenuItem(storeId, line.halfAndHalf.secondMenuItemId);
  if (secondMenuItem.category_id !== menuItem.category_id) {
    throw new OrderValidationError('Both halves must be from the same category');
  }

  const size = getSize(menuItem.id, line.sizeId);
  if (!size) throw new OrderValidationError(`Invalid size for ${menuItem.name}`);
  const secondSize = db
    .prepare('SELECT * FROM item_sizes WHERE menu_item_id = ? AND label = ?')
    .get(secondMenuItem.id, size.label);
  if (!secondSize) throw new OrderValidationError(`${secondMenuItem.name} is not available in size ${size.label}`);

  const quantity = Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : 1;
  const placements = Array.isArray(line.halfAndHalf.extras) ? line.halfAndHalf.extras : [];

  const leftIds = placements.filter((p) => p.half === 'left' || p.half === 'whole').map((p) => p.extraId);
  const rightIds = placements.filter((p) => p.half === 'right' || p.half === 'whole').map((p) => p.extraId);
  validateExtraSelection(storeId, menuItem, leftIds);
  validateExtraSelection(storeId, secondMenuItem, rightIds);

  const groups = getItemExtraGroups(storeId, menuItem.id);
  const allExtrasById = new Map(groups.flatMap((g) => getGroupExtras(g.id)).map((e) => [e.id, e]));

  const resolvedExtras = placements.map((p) => {
    const extra = allExtrasById.get(p.extraId);
    if (!extra) throw new OrderValidationError('Invalid topping selection');
    const priceCents = p.half === 'whole' ? extra.price_cents : Math.round(extra.price_cents / 2);
    return { id: extra.id, name: extra.name, price_cents: priceCents, half: p.half };
  });

  const basePriceCents = Math.max(size.price_cents, secondSize.price_cents);
  const extrasTotalCents = resolvedExtras.reduce((sum, e) => sum + e.price_cents, 0);
  const unitPriceCents = basePriceCents + extrasTotalCents;

  return {
    menuItem,
    secondMenuItem,
    size,
    quantity,
    extras: resolvedExtras,
    unitPriceCents,
    lineTotalCents: unitPriceCents * quantity,
    notes: typeof line.notes === 'string' ? line.notes.slice(0, 500) : null,
    isHalfAndHalf: true,
  };
}

// cartLines: [{ menuItemId, sizeId, quantity, extraIds: [], notes }] or half & half lines
// (see priceHalfAndHalfLine). Recomputes every price server-side from the DB; never trusts
// client-sent amounts. Every lookup is scoped to storeId so one store's menu/items can
// never be priced or ordered against another store.
function priceCart(storeId, cartLines, orderType) {
  if (!Array.isArray(cartLines) || cartLines.length === 0) {
    throw new OrderValidationError('Cart is empty');
  }

  const settings = getSettings(storeId);
  const lines = cartLines.map((line) => {
    if (line.halfAndHalf) return priceHalfAndHalfLine(storeId, line);

    const menuItem = getActiveMenuItem(storeId, line.menuItemId);
    const size = getSize(menuItem.id, line.sizeId);
    if (!size) throw new OrderValidationError(`Invalid size for ${menuItem.name}`);

    const quantity = Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : 1;
    const extraIds = Array.isArray(line.extraIds) ? line.extraIds : [];
    const chosenExtras = validateExtraSelection(storeId, menuItem, extraIds);

    const extrasTotalCents = chosenExtras.reduce((sum, e) => sum + e.price_cents, 0);
    const unitPriceCents = size.price_cents + extrasTotalCents;

    return {
      menuItem,
      size,
      quantity,
      extras: chosenExtras.map((e) => ({ id: e.id, name: e.name, price_cents: e.price_cents, half: 'whole' })),
      unitPriceCents,
      lineTotalCents: unitPriceCents * quantity,
      notes: typeof line.notes === 'string' ? line.notes.slice(0, 500) : null,
      isHalfAndHalf: false,
    };
  });

  const subtotalCents = lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
  if (orderType === 'delivery' && subtotalCents < settings.min_delivery_cents) {
    throw new OrderValidationError(
      `Delivery orders require a minimum of $${(settings.min_delivery_cents / 100).toFixed(2)}`
    );
  }

  const deliveryFeeCents = orderType === 'delivery' ? settings.delivery_fee_cents : 0;
  const taxCents = Math.round(subtotalCents * (settings.tax_rate_bps / 10000));

  return { lines, subtotalCents, deliveryFeeCents, taxCents, settings };
}

module.exports = { priceCart, getSettings, OrderValidationError };
