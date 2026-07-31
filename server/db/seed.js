const bcrypt = require('bcryptjs');
const db = require('./index');
const { categoryPlaceholder } = require('../lib/placeholderImage');

const categoryCount = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
if (categoryCount > 0) {
  console.log('Seed skipped: data already present.');
  process.exit(0);
}

const insertCategory = db.prepare('INSERT INTO categories (name, sort_order, supports_half_and_half) VALUES (?, ?, ?)');
const insertItem = db.prepare(`INSERT INTO menu_items (category_id, name, description, image_url, sort_order)
  VALUES (?, ?, ?, ?, ?)`);
const insertSize = db.prepare(`INSERT INTO item_sizes (menu_item_id, label, price_cents, sort_order)
  VALUES (?, ?, ?, ?)`);
const insertExtraGroup = db.prepare(`INSERT INTO extra_groups (name, min_select, max_select, sort_order)
  VALUES (?, ?, ?, ?)`);
const insertExtra = db.prepare(`INSERT INTO extras (extra_group_id, name, price_cents, sort_order)
  VALUES (?, ?, ?, ?)`);
const attachGroup = db.prepare(`INSERT INTO menu_item_extra_groups (menu_item_id, extra_group_id, sort_order)
  VALUES (?, ?, ?)`);
const insertPromotion = db.prepare(`INSERT INTO promotions
  (code, title, description, discount_type, discount_value, min_subtotal_cents, auto_apply, days_of_week, start_time, end_time)
  VALUES (@code, @title, @description, @discountType, @discountValue, @minSubtotalCents, @autoApply, @daysOfWeek, @startTime, @endTime)`);

const seed = db.transaction((CATEGORY_IMAGES) => {
  const pizzaCat = insertCategory.run('Pizzas', 0, 1).lastInsertRowid;
  const appCat = insertCategory.run('Appetizers', 1, 0).lastInsertRowid;
  const saladCat = insertCategory.run('Salads', 2, 0).lastInsertRowid;
  const drinkCat = insertCategory.run('Drinks', 3, 0).lastInsertRowid;

  const pizzas = [
    { name: 'Cheese', desc: 'Pizza sauce and mozzarella.', sizes: [['SM', 950], ['LG', 1350]], toppings: true },
    { name: 'Pepperoni', desc: 'Pizza sauce, mozzarella and pepperoni.', sizes: [['SM', 1150], ['LG', 1650]], toppings: true },
    { name: 'House Special', desc: 'Sausage, pepperoni, mushroom, onion, pepper and extra cheese.', sizes: [['SM', 1500], ['LG', 2175]], toppings: true },
    { name: 'Veggie', desc: 'Black olives, broccoli, mushroom, pepper and onion.', sizes: [['SM', 1375], ['LG', 2050]], toppings: true },
    { name: 'BBQ Chicken', desc: 'BBQ sauce, mozzarella and grilled chicken.', sizes: [['SM', 1350], ['LG', 1850]], toppings: true },
  ];

  const toppingList = ['Extra Cheese', 'Pepperoni', 'Sausage', 'Mushroom', 'Onion', 'Green Pepper', 'Black Olives', 'Bacon'];

  // One shared "Pizza Toppings" group, attached to every pizza - edit it once (e.g. add a
  // topping) and it updates on every pizza that uses it, instead of duplicating per item.
  const toppingsGroupId = insertExtraGroup.run('Pizza Toppings', 0, 6, 0).lastInsertRowid;
  toppingList.forEach((t, tIdx) => insertExtra.run(toppingsGroupId, t, 150, tIdx));

  pizzas.forEach((p, idx) => {
    const itemId = insertItem.run(pizzaCat, p.name, p.desc, CATEGORY_IMAGES.Pizzas, idx).lastInsertRowid;
    p.sizes.forEach(([label, price], sIdx) => insertSize.run(itemId, label, price, sIdx));
    if (p.toppings) attachGroup.run(itemId, toppingsGroupId, 0);
  });

  const apps = [
    { name: 'Garlic Bread', desc: 'Toasted baguette with garlic butter.', price: 595 },
    { name: 'Mozzarella Sticks', desc: 'Six pieces, served with marinara.', price: 795 },
    { name: 'Buffalo Wings', desc: 'Eight pieces, tossed in buffalo sauce.', price: 1195 },
  ];
  apps.forEach((a, idx) => {
    const itemId = insertItem.run(appCat, a.name, a.desc, CATEGORY_IMAGES.Appetizers, idx).lastInsertRowid;
    insertSize.run(itemId, 'Regular', a.price, 0);
  });

  const salads = [
    { name: 'Garden Salad', desc: 'Lettuce, tomato, cucumber, onion.', price: 695 },
    { name: 'Greek Salad', desc: 'Lettuce, feta, olives, tomato, red onion.', price: 895 },
  ];
  const dressingGroupId = insertExtraGroup.run('Dressing', 1, 1, 0).lastInsertRowid;
  ['Ranch', 'Italian', 'Balsamic Vinaigrette', 'Greek'].forEach((d, dIdx) => insertExtra.run(dressingGroupId, d, 0, dIdx));
  salads.forEach((s, idx) => {
    const itemId = insertItem.run(saladCat, s.name, s.desc, CATEGORY_IMAGES.Salads, idx).lastInsertRowid;
    insertSize.run(itemId, 'Regular', s.price, 0);
    attachGroup.run(itemId, dressingGroupId, 0);
  });

  const drinks = [
    { name: 'Soda (Can)', desc: 'Coke, Diet Coke, Sprite, or Root Beer.', price: 250 },
    { name: 'Bottled Water', desc: '16.9 oz.', price: 200 },
    { name: '2-Liter Soda', desc: 'Coke, Diet Coke, or Sprite.', price: 450 },
  ];
  drinks.forEach((d, idx) => {
    const itemId = insertItem.run(drinkCat, d.name, d.desc, CATEGORY_IMAGES.Drinks, idx).lastInsertRowid;
    insertSize.run(itemId, 'Regular', d.price, 0);
  });

  db.prepare(`UPDATE restaurant_settings SET name = ?, address = ?, store_description = ? WHERE id = 1`)
    .run(
      'SAMWILL Kitchen',
      '123 Main St, Springfield, USA',
      'Hand-tossed pizza, apps, and salads made fresh to order.'
    );

  const insertHours = db.prepare(
    'INSERT INTO business_hours (type, day_of_week, is_open, open_time, close_time) VALUES (?, ?, 1, ?, ?)'
  );
  for (let day = 0; day <= 6; day++) {
    insertHours.run('pickup', day, '11:00', '21:00');
    insertHours.run('delivery', day, '11:00', '20:30');
  }

  insertPromotion.run({
    code: 'WELCOME10',
    title: '10% Off Your Order',
    description: 'New here? Take 10% off with code WELCOME10.',
    discountType: 'percent',
    discountValue: 10,
    minSubtotalCents: 0,
    autoApply: 0,
    daysOfWeek: null,
    startTime: null,
    endTime: null,
  });

  insertPromotion.run({
    code: null,
    title: 'Happy Hour: 15% Off',
    description: '15% off every weekday afternoon, 2-5 PM.',
    discountType: 'percent',
    discountValue: 15,
    minSubtotalCents: 0,
    autoApply: 1,
    daysOfWeek: '1,2,3,4,5',
    startTime: '14:00',
    endTime: '17:00',
  });

  insertPromotion.run({
    code: null,
    title: '$5 Off Orders Over $30',
    description: 'Automatically applied at checkout on orders of $30 or more.',
    discountType: 'fixed',
    discountValue: 500,
    minSubtotalCents: 3000,
    autoApply: 1,
    daysOfWeek: null,
    startTime: null,
    endTime: null,
  });
});

async function run() {
  const CATEGORY_IMAGES = {
    Pizzas: await categoryPlaceholder('🍕', '#ffe8d6'),
    Appetizers: await categoryPlaceholder('🍟', '#ffe0b3'),
    Salads: await categoryPlaceholder('🥗', '#d9f2d9'),
    Drinks: await categoryPlaceholder('🥤', '#d6e8ff'),
  };

  seed(CATEGORY_IMAGES);

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@samwill.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'change-me-on-first-login';
  const existingAdmin = db.prepare('SELECT id FROM admin_users WHERE email = ?').get(adminEmail);
  if (!existingAdmin) {
    const hash = bcrypt.hashSync(adminPassword, 10);
    db.prepare('INSERT INTO admin_users (email, password_hash, role) VALUES (?, ?, ?)').run(adminEmail, hash, 'owner');
    console.log(`Admin user created: ${adminEmail} / ${adminPassword}`);
  }

  console.log('Seed complete: demo menu (Pizzas, Appetizers, Salads, Drinks) inserted.');
}

run();
