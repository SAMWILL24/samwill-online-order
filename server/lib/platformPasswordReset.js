const crypto = require('crypto');
const db = require('../db');

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// Returns the raw token - only this call site ever sees it (to put in the
// emailed link); the database only ever stores its hash.
function createResetToken(platformAdminId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  db.prepare(
    'INSERT INTO platform_reset_tokens (platform_admin_id, token_hash, expires_at) VALUES (?, ?, ?)'
  ).run(platformAdminId, hashToken(rawToken), expiresAt);
  return rawToken;
}

// Returns the platform_admin_id the token belonged to, or null if it's
// missing, expired, or already used. Marks it used on success so it can't
// be replayed.
function consumeResetToken(rawToken) {
  if (!rawToken) return null;
  const row = db
    .prepare(
      'SELECT * FROM platform_reset_tokens WHERE token_hash = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1'
    )
    .get(hashToken(rawToken));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  db.prepare('UPDATE platform_reset_tokens SET used_at = datetime(\'now\') WHERE id = ?').run(row.id);
  return row.platform_admin_id;
}

module.exports = { createResetToken, consumeResetToken };
