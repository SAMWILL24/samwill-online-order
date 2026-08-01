const fs = require('fs');
const path = require('path');
const db = require('../db');
const { dataDir } = require('./paths');
const r2Backup = require('./r2Backup');

const backupsDir = path.join(dataDir, 'backups');
const KEEP_COUNT = Number(process.env.BACKUP_KEEP_COUNT) || 7;
const INTERVAL_MS = (Number(process.env.BACKUP_INTERVAL_HOURS) || 24) * 60 * 60 * 1000;

// Local snapshots protect against a bad migration or accidental data
// corruption; the R2 upload (when configured) additionally protects against
// losing the Railway Volume itself, since it lands in a separate, fully
// private bucket - never the signage server's public media bucket.
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

  if (r2Backup.isConfigured()) {
    await r2Backup.uploadBackup(destination, filename);
    await r2Backup.pruneRemoteBackups(KEEP_COUNT);
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
