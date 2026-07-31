const bcrypt = require('bcryptjs');
const db = require('./index');
const { categoryPlaceholder } = require('../lib/placeholderImage');

const storeCount = db.prepare('SELECT COUNT(*) AS n FROM stores').get().n;
if (storeCount > 0) {
  console.log('Seed skipped: data already present.');
  process.exit(0);
}

const insertStore = db.prepare('INSERT INTO stores (slug, name, address, store_description) VALUES (?, ?, ?, ?)');
const insertCategory = db.prepare('INSERT INTO categories (store_id, name, sort_order, supports_half_and_half) VALUES (?, ?, ?, ?)');
const insertItem = db.prepare(`INSERT INTO menu_items (category_id, name, description, image_url, sort_order)
  VALUES (?, ?, ?, ?, ?)`);
const insertSize = db.prepare(`INSERT INTO item_sizes (menu_item_id, label, price_cents, sort_order)
  VALUES (?, ?, ?, ?)`);
const insertExtraGroup = db.prepare(`INSERT INTO extra_groups (store_id, name, min_select, max_select, sort_order)
  VALUES (?, ?, ?, ?, ?)`);
const insertExtra = db.prepare(`INSERT INTO extras (extra_group_id, name, price_cents, sort_order)
  VALUES (?, ?, ?, ?)`);
const attachGroup = db.prepare(`INSERT INTO menu_item_extra_groups (menu_item_id, extra_group_id, sort_order)
  VALUES (?, ?, ?)`);
const insertPromotion = db.prepare(`INSERT INTO promotions
  (store_id, code, title, description, discount_type, discount_value, min_subtotal_cents, auto_apply, days_of_week, start_time, end_time)
  VALUES (@storeId, @code, @title, @description, @discountType, @discountValue, @minSubtotalCents, @autoApply, @daysOfWeek, @startTime, @endTime)`);
const insertHours = db.prepare(
  'INSERT INTO business_hours (store_id, type, day_of_week, is_open, open_time, close_time) VALUES (?, ?, ?, 1, ?, ?)'
);
const insertAdmin = db.prepare('INSERT INTO admin_users (store_id, email, password_hash, role) VALUES (?, ?, ?, ?)');

function seedHours(storeId, pickupHours, deliveryHours) {
  for (let day = 0; day <= 6; day++) {
    insertHours.run(storeId, 'pickup', day, pickupHours[0], pickupHours[1]);
    insertHours.run(storeId, 'delivery', day, deliveryHours[0], deliveryHours[1]);
  }
}

function seedPromotions(storeId) {
  insertPromotion.run({
    storeId,
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
    storeId,
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
    storeId,
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
}

function seedAdmin(storeId, email, password) {
  const hash = bcrypt.hashSync(password, 10);
  insertAdmin.run(storeId, email, hash, 'owner');
  console.log(`  Admin user: ${email} / ${password}`);
}

function seedPizzaAndSeafoodMenu(storeId, images) {
  const pizzaCat = insertCategory.run(storeId, 'Pizzas', 0, 1).lastInsertRowid;
  const appCat = insertCategory.run(storeId, 'Appetizers', 1, 0).lastInsertRowid;
  const seafoodCat = insertCategory.run(storeId, 'Seafood', 2, 0).lastInsertRowid;
  const saladCat = insertCategory.run(storeId, 'Salads', 3, 0).lastInsertRowid;
  const drinkCat = insertCategory.run(storeId, 'Drinks', 4, 0).lastInsertRowid;

  const pizzas = [
    { name: 'Cheese', desc: 'Pizza sauce and mozzarella.', sizes: [['SM', 950], ['LG', 1350]] },
    { name: 'Pepperoni', desc: 'Pizza sauce, mozzarella and pepperoni.', sizes: [['SM', 1150], ['LG', 1650]] },
    { name: 'House Special', desc: 'Sausage, pepperoni, mushroom, onion, pepper and extra cheese.', sizes: [['SM', 1500], ['LG', 2175]] },
    { name: 'Veggie', desc: 'Black olives, broccoli, mushroom, pepper and onion.', sizes: [['SM', 1375], ['LG', 2050]] },
    { name: 'BBQ Chicken', desc: 'BBQ sauce, mozzarella and grilled chicken.', sizes: [['SM', 1350], ['LG', 1850]] },
  ];
  const toppingList = ['Extra Cheese', 'Pepperoni', 'Sausage', 'Mushroom', 'Onion', 'Green Pepper', 'Black Olives', 'Bacon'];

  // One shared "Pizza Toppings" group, attached to every pizza - edit it once (e.g. add a
  // topping) and it updates on every pizza that uses it, instead of duplicating per item.
  const toppingsGroupId = insertExtraGroup.run(storeId, 'Pizza Toppings', 0, 6, 0).lastInsertRowid;
  toppingList.forEach((t, tIdx) => insertExtra.run(toppingsGroupId, t, 150, tIdx));

  pizzas.forEach((p, idx) => {
    const itemId = insertItem.run(pizzaCat, p.name, p.desc, images.Pizzas, idx).lastInsertRowid;
    p.sizes.forEach(([label, price], sIdx) => insertSize.run(itemId, label, price, sIdx));
    attachGroup.run(itemId, toppingsGroupId, 0);
  });

  const apps = [
    { name: 'Garlic Bread', desc: 'Toasted baguette with garlic butter.', price: 595 },
    { name: 'Mozzarella Sticks', desc: 'Six pieces, served with marinara.', price: 795 },
    { name: 'Buffalo Wings', desc: 'Eight pieces, tossed in buffalo sauce.', price: 1195 },
  ];
  apps.forEach((a, idx) => {
    const itemId = insertItem.run(appCat, a.name, a.desc, images.Appetizers, idx).lastInsertRowid;
    insertSize.run(itemId, 'Regular', a.price, 0);
  });

  const seafood = [
    { name: 'Fish & Chips', desc: 'Beer-battered haddock with fries and coleslaw.', price: 1595 },
    { name: 'Fried Clams', desc: 'Whole-belly clams, fried golden.', price: 1895 },
    { name: 'Shrimp Basket', desc: 'Fried shrimp, fries, and cocktail sauce.', price: 1695 },
  ];
  seafood.forEach((s, idx) => {
    const itemId = insertItem.run(seafoodCat, s.name, s.desc, images.Seafood, idx).lastInsertRowid;
    insertSize.run(itemId, 'Regular', s.price, 0);
  });

  const salads = [
    { name: 'Garden Salad', desc: 'Lettuce, tomato, cucumber, onion.', price: 695 },
    { name: 'Greek Salad', desc: 'Lettuce, feta, olives, tomato, red onion.', price: 895 },
  ];
  const dressingGroupId = insertExtraGroup.run(storeId, 'Dressing', 1, 1, 0).lastInsertRowid;
  ['Ranch', 'Italian', 'Balsamic Vinaigrette', 'Greek'].forEach((d, dIdx) => insertExtra.run(dressingGroupId, d, 0, dIdx));
  salads.forEach((s, idx) => {
    const itemId = insertItem.run(saladCat, s.name, s.desc, images.Salads, idx).lastInsertRowid;
    insertSize.run(itemId, 'Regular', s.price, 0);
    attachGroup.run(itemId, dressingGroupId, 0);
  });

  const drinks = [
    { name: 'Soda (Can)', desc: 'Coke, Diet Coke, Sprite, or Root Beer.', price: 250 },
    { name: 'Bottled Water', desc: '16.9 oz.', price: 200 },
    { name: '2-Liter Soda', desc: 'Coke, Diet Coke, or Sprite.', price: 450 },
  ];
  drinks.forEach((d, idx) => {
    const itemId = insertItem.run(drinkCat, d.name, d.desc, images.Drinks, idx).lastInsertRowid;
    insertSize.run(itemId, 'Regular', d.price, 0);
  });
}

function seedBurgerMenu(storeId, images) {
  const burgerCat = insertCategory.run(storeId, 'Burgers', 0, 0).lastInsertRowid;
  const sideCat = insertCategory.run(storeId, 'Sides', 1, 0).lastInsertRowid;
  const shakeCat = insertCategory.run(storeId, 'Shakes', 2, 0).lastInsertRowid;

  const burgers = [
    { name: 'Classic Cheeseburger', desc: 'Beef patty, cheddar, lettuce, tomato, special sauce.', sizes: [['Single', 795], ['Double', 1095]] },
    { name: 'Bacon BBQ Burger', desc: 'Beef patty, bacon, cheddar, BBQ sauce, onion rings.', sizes: [['Single', 895], ['Double', 1195]] },
    { name: 'Veggie Burger', desc: 'Plant-based patty, lettuce, tomato, vegan mayo.', sizes: [['Single', 795], ['Double', 1095]] },
  ];
  const burgerToppingsGroupId = insertExtraGroup.run(storeId, 'Burger Toppings', 0, 5, 0).lastInsertRowid;
  ['Extra Cheese', 'Bacon', 'Fried Egg', 'Avocado', 'Grilled Onions', 'Jalapenos'].forEach((t, i) =>
    insertExtra.run(burgerToppingsGroupId, t, 125, i)
  );
  burgers.forEach((b, idx) => {
    const itemId = insertItem.run(burgerCat, b.name, b.desc, images.Burgers, idx).lastInsertRowid;
    b.sizes.forEach(([label, price], sIdx) => insertSize.run(itemId, label, price, sIdx));
    attachGroup.run(itemId, burgerToppingsGroupId, 0);
  });

  const sides = [
    { name: 'Crinkle Fries', desc: 'Golden and crispy.', price: 425 },
    { name: 'Onion Rings', desc: 'Beer-battered, six pieces.', price: 525 },
    { name: 'Loaded Fries', desc: 'Fries, cheese sauce, bacon bits, scallions.', price: 725 },
  ];
  sides.forEach((s, idx) => {
    const itemId = insertItem.run(sideCat, s.name, s.desc, images.Sides, idx).lastInsertRowid;
    insertSize.run(itemId, 'Regular', s.price, 0);
  });

  const shakes = [
    { name: 'Vanilla Shake', desc: 'Classic vanilla soft-serve shake.', price: 595 },
    { name: 'Chocolate Shake', desc: 'Rich chocolate soft-serve shake.', price: 595 },
    { name: 'Strawberry Shake', desc: 'Real strawberry soft-serve shake.', price: 625 },
  ];
  shakes.forEach((s, idx) => {
    const itemId = insertItem.run(shakeCat, s.name, s.desc, images.Shakes, idx).lastInsertRowid;
    insertSize.run(itemId, 'Regular', s.price, 0);
  });
}

const seed = db.transaction((pizzaImages, burgerImages) => {
  const charltonId = insertStore.run(
    'charlton-house',
    'Charlton House of Pizza & Seafood',
    '1 Village Green, Charlton, MA',
    'Hand-tossed pizza, fresh seafood, and salads made to order.'
  ).lastInsertRowid;
  seedPizzaAndSeafoodMenu(charltonId, pizzaImages);
  seedHours(charltonId, ['11:00', '21:00'], ['11:00', '20:30']);
  seedPromotions(charltonId);
  seedAdmin(charltonId, process.env.ADMIN_EMAIL || 'owner@charltonhouse.local', process.env.ADMIN_PASSWORD || 'change-me-on-first-login');

  const burgerId = insertStore.run(
    'demo-burger',
    'Demo Burger Co',
    '456 Sample Ave, Anytown, USA',
    'Smash burgers, crispy sides, and hand-spun shakes.'
  ).lastInsertRowid;
  seedBurgerMenu(burgerId, burgerImages);
  seedHours(burgerId, ['11:00', '22:00'], ['11:00', '21:30']);
  seedPromotions(burgerId);
  seedAdmin(burgerId, 'owner@demoburger.local', 'change-me-on-first-login');

  return { charltonId, burgerId };
});

async function run() {
  const pizzaImages = {
    Pizzas: await categoryPlaceholder('🍕', '#ffe8d6'),
    Appetizers: await categoryPlaceholder('🍟', '#ffe0b3'),
    Seafood: await categoryPlaceholder('🦐', '#d6f0ff'),
    Salads: await categoryPlaceholder('🥗', '#d9f2d9'),
    Drinks: await categoryPlaceholder('🥤', '#d6e8ff'),
  };
  const burgerImages = {
    Burgers: await categoryPlaceholder('🍔', '#ffe0d6'),
    Sides: await categoryPlaceholder('🍟', '#ffe0b3'),
    Shakes: await categoryPlaceholder('🥤', '#ffd6ea'),
  };

  const { charltonId, burgerId } = seed(pizzaImages, burgerImages);

  console.log('Seed complete: two independent demo stores created.');
  console.log(`  - Charlton House of Pizza & Seafood -> /charlton-house (store id ${charltonId})`);
  console.log(`  - Demo Burger Co -> /demo-burger (store id ${burgerId})`);
}

run();
