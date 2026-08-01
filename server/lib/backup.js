const fs = require('fs');
const path = require('path');
const db = require('../db');
const { dataDir } = require('./paths');

const backupsDir = path.join(dataDir, 'backups');
const KEEP_COUNT = Number(process.env.BACKUP_KEEP_COUNT) || 7;
const INTERVAL_MS = (Number(process.env.BACKUP_INTERVAL_HOURS) || 24) * 60 * 60 * 1000;

// This protects against accidental data corruption or a bad migration, since
// it lives on the same Railway Volume as the live database - it is NOT
// offsite protection against losing the Volume itself. Moving these to
// external storage (e.g. Cloudflare R2, already used by the signage server)
// would be the next step up if that risk needs covering too.
async function runBackup() {
  fs.mkdirSync(backupsDir, { recursive: true });
  const filename = `online-order-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
  const destination = path.join(backupsDir, filename);

  // better-sqlite3's built-in backup() takes a consistent snapshot even while
  // the database is being written to (unlike a plain file copy, which could
  // grab a half-written page during a WAL checkpoint).
  await db.backup(destination);

  const files = fs
    .readdirSync(backupsDir)
    .filter((f) => f.startsWith('online-order-') && f.endsWith('.sqlite'))
    .sort();
  const excess = files.length - KEEP_COUNT;
  for (let i = 0; i < excess; i++) {
    fs.rmSync(path.join(backupsDir, files[i]), { force: true });
  }

  return destination;
}

function scheduleBackups() {
  runBackup().catch((err) => console.error('[backup] initial backup failed:', err.message));
  setInterval(() => {
    runBackup().catch((err) => console.error('[backup] scheduled backup failed:', err.message));
  }, INTERVAL_MS);
}

module.exports = { runBackup, scheduleBackups };
