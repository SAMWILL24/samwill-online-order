const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const { dataDir } = require('../lib/paths');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'online-order.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// schema.sql only ever CREATEs - a table that already exists on a live
// database (like production) never picks up columns added to it later. Each
// entry here is a column added after the table's first release; applying
// them by hand keeps existing rows (orders, accounts, etc.) intact instead
// of requiring the database to be wiped and reseeded on every schema change.
const columnMigrations = [
  { table: 'stores', column: 'kitchen_display_token', ddl: 'ALTER TABLE stores ADD COLUMN kitchen_display_token TEXT' },
  { table: 'stores', column: 'printer_enabled', ddl: "ALTER TABLE stores ADD COLUMN printer_enabled INTEGER NOT NULL DEFAULT 0" },
  { table: 'stores', column: 'printer_key', ddl: 'ALTER TABLE stores ADD COLUMN printer_key TEXT' },
];

for (const { table, column, ddl } of columnMigrations) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(ddl);
  }
}

module.exports = db;
