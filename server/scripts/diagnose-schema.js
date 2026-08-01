// One-off diagnostic: for every table this app expects, report the columns
// the LIVE database actually has vs. what schema.sql currently defines, so
// missing-column bugs (schema.sql only ever CREATEs - it never ALTERs an
// existing table) can be found and fixed with certainty instead of guesswork.
const fs = require('fs');
const path = require('path');
const db = require('../db');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
const tableNames = [...schema.matchAll(/^CREATE TABLE IF NOT EXISTS (\w+)/gm)].map((m) => m[1]);

for (const table of tableNames) {
  const liveColumns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const blockMatch = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`));
  const block = blockMatch ? blockMatch[1] : '';
  const declaredColumns = [...block.matchAll(/^\s*(\w+)\s+(TEXT|INTEGER|REAL|BLOB)\b/gm)].map((m) => m[1]);
  const missing = declaredColumns.filter((c) => !liveColumns.includes(c));
  if (missing.length > 0) {
    console.log(`${table}: MISSING [${missing.join(', ')}]`);
  } else {
    console.log(`${table}: ok`);
  }
}
