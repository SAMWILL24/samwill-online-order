const db = require('../db');
const { toAbsoluteUrl } = require('./url');

function getFullMenu({ includeInactive = false } = {}) {
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all();
  const items = includeInactive
    ? db.prepare('SELECT * FROM menu_items ORDER BY sort_order, id').all()
    : db.prepare('SELECT * FROM menu_items WHERE is_active = 1 ORDER BY sort_order, id').all();
  const sizes = db.prepare('SELECT * FROM item_sizes ORDER BY sort_order, id').all();
  const links = db
    .prepare('SELECT * FROM menu_item_extra_groups ORDER BY sort_order, id')
    .all();
  const groupsById = groupById(db.prepare('SELECT * FROM extra_groups').all());
  const extras = db.prepare('SELECT * FROM extras ORDER BY sort_order, id').all();

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
