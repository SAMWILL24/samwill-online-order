// Onboards a new independent store (run by the SAMWILL operator - there is no
// self-serve signup yet). Usage:
//
//   node scripts/create-store.js --slug=pizza-place --name="Pizza Place" \
//     --admin-email=owner@pizzaplace.com --admin-password=changeme123 \
//     [--address="123 Main St"] [--description="Fresh pizza made daily."]
//
// The store is reachable at /<slug> once deployed; the slug can be changed later
// from that store's own Restaurant Profile settings page.

const bcrypt = require('bcryptjs');
const db = require('../db');

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([a-z-]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const slug = args.slug;
const name = args.name;
const adminEmail = args['admin-email'];
const adminPassword = args['admin-password'];

if (!slug || !name || !adminEmail || !adminPassword) {
  console.error('Usage: node scripts/create-store.js --slug=<slug> --name="<name>" --admin-email=<email> --admin-password=<password> [--address="..."] [--description="..."]');
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(slug)) {
  console.error('slug must be lowercase letters, numbers, and hyphens only (e.g. "pizza-place")');
  process.exit(1);
}

const existing = db.prepare('SELECT id FROM stores WHERE slug = ?').get(slug);
if (existing) {
  console.error(`A store with slug "${slug}" already exists (id ${existing.id}).`);
  process.exit(1);
}

const create = db.transaction(() => {
  const storeInfo = db
    .prepare('INSERT INTO stores (slug, name, address, store_description) VALUES (?, ?, ?, ?)')
    .run(slug, name, args.address || '', args.description || '');
  const storeId = storeInfo.lastInsertRowid;

  const insertHours = db.prepare(
    'INSERT INTO business_hours (store_id, type, day_of_week, is_open, open_time, close_time) VALUES (?, ?, ?, 1, ?, ?)'
  );
  for (let day = 0; day <= 6; day++) {
    insertHours.run(storeId, 'pickup', day, '11:00', '21:00');
    insertHours.run(storeId, 'delivery', day, '11:00', '20:30');
  }

  const hash = bcrypt.hashSync(adminPassword, 10);
  db.prepare('INSERT INTO admin_users (store_id, email, password_hash, role) VALUES (?, ?, ?, ?)').run(
    storeId,
    adminEmail.toLowerCase(),
    hash,
    'owner'
  );

  return storeId;
});

const storeId = create();
console.log(`Store "${name}" created (id ${storeId}).`);
console.log(`  Storefront: /${slug}`);
console.log(`  Admin login: /${slug}/admin/login`);
console.log(`  Admin email: ${adminEmail.toLowerCase()}`);
console.log('No menu yet - add categories/items from the Menu section of the admin dashboard.');
