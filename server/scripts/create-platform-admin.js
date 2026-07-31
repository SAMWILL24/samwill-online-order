// Creates (or resets the password of) the SAMWILL-operator login that can sign in
// through any store's admin login page and manage that store. Usage:
//
//   node scripts/create-platform-admin.js --email=sam@samwill.net --password=changeme123

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
const email = args.email;
const password = args.password;

if (!email || !password) {
  console.error('Usage: node scripts/create-platform-admin.js --email=<email> --password=<password>');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
const normalizedEmail = email.toLowerCase();

const existing = db.prepare('SELECT id FROM platform_admins WHERE email = ?').get(normalizedEmail);
if (existing) {
  db.prepare('UPDATE platform_admins SET password_hash = ? WHERE id = ?').run(hash, existing.id);
  console.log(`Platform admin "${normalizedEmail}" password updated.`);
} else {
  db.prepare('INSERT INTO platform_admins (email, password_hash) VALUES (?, ?)').run(normalizedEmail, hash);
  console.log(`Platform admin "${normalizedEmail}" created.`);
}
console.log('This login now works on every store\'s /admin/login page.');
