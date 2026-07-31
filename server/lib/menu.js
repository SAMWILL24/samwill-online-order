const db = require('../db');
const { toAbsoluteUrl } = require('./url');

function getFullMenu(storeId, { includeInactive = false } = {}) {
  const categories = db.prepare('SELECT * FROM categories WHERE store_id = ? ORDER BY sort_order, id').all(storeId);
  const categoryIds = categories.map((c) => c.id);
  if (categoryIds.length === 0) return [];
  const placeholders = categoryIds.map(() => '?').join(',');

  const items = includeInactive
    ? db.prepare(`SELECT * FROM menu_items WHERE category_id IN (${placeholders}) ORDER BY sort_order, id`).all(...categoryIds)
    : db
        .prepare(`SELECT * FROM menu_items WHERE category_id IN (${placeholders}) AND is_active = 1 ORDER BY sort_order, id`)
        .all(...categoryIds);
  const itemIds = items.map((i) => i.id);
  const itemPlaceholders = itemIds.map(() => '?').join(',');

  const sizes = itemIds.length
    ? db.prepare(`SELECT * FROM item_sizes WHERE menu_item_id IN (${itemPlaceholders}) ORDER BY sort_order, id`).all(...itemIds)
    : [];
  const links = itemIds.length
    ? db
        .prepare(`SELECT * FROM menu_item_extra_groups WHERE menu_item_id IN (${itemPlaceholders}) ORDER BY sort_order, id`)
        .all(...itemIds)
    : [];
  const groupsById = groupById(db.prepare('SELECT * FROM extra_groups WHERE store_id = ?').all(storeId));
  const groupIds = Object.keys(groupsById);
  const extras = groupIds.length
    ? db
        .prepare(`SELECT * FROM extras WHERE extra_group_id IN (${groupIds.map(() => '?').join(',')}) ORDER BY sort_order, id`)
        .all(...groupIds)
    : [];

  const sizesByItem = groupBy(sizes, 'menu_item_id');
  const linksByItem = groupBy(links, 'menu_item_id');
  const extrasByGroup = groupBy(extras, 'extra_group_id');

  const itemsByCategory = groupBy(items, 'category_id');

  return categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    supportsHalfAndHalf: Boolean(cat.supports_half_and_half),
    items: (itemsByCategory[cat.id] || []).map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      imageUrl: toAbsoluteUrl(item.image_url),
      isActive: Boolean(item.is_active),
      sizes: (sizesByItem[item.id] || []).map((s) => ({ id: s.id, label: s.label, priceCents: s.price_cents })),
      extraGroups: (linksByItem[item.id] || [])
        .map((link) => groupsById[link.extra_group_id])
        .filter(Boolean)
        .map((g) => ({
          id: g.id,
          name: g.name,
          minSelect: g.min_select,
          maxSelect: g.max_select,
          extras: (extrasByGroup[g.id] || []).map((e) => ({ id: e.id, name: e.name, priceCents: e.price_cents })),
        })),
    })),
  }));
}

function groupBy(rows, key) {
  return rows.reduce((acc, row) => {
    (acc[row[key]] = acc[row[key]] || []).push(row);
    return acc;
  }, {});
}

function groupById(rows) {
  return rows.reduce((acc, row) => {
    acc[row.id] = row;
    return acc;
  }, {});
}

module.exports = { getFullMenu };
