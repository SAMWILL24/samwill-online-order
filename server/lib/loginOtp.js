const crypto = require('crypto');
const db = require('../db');

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MIN_RESEND_INTERVAL_MS = 30 * 1000;

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// storeId is null for the store-less platform-admin gate login (server.js's
// bare /admin) - "IS ?" (not "=") is used throughout so that comparison
// still matches NULL rows correctly.
//
// Returns the raw code - only this call site ever sees it (to put in the
// emailed message); the database only ever stores its hash. Any earlier
// unused code for this account is invalidated first, so only the most
// recently sent code can ever succeed.
function createOtp(storeId, accountType, accountId) {
  db.prepare(
    'UPDATE login_otp_codes SET used_at = datetime(\'now\') WHERE store_id IS ? AND account_type = ? AND account_id = ? AND used_at IS NULL'
  ).run(storeId, accountType, accountId);

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  db.prepare(
    'INSERT INTO login_otp_codes (store_id, account_type, account_id, code_hash, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(storeId, accountType, accountId, hashCode(code), expiresAt);

  return code;
}

// 0 if a resend is allowed right now, otherwise the ms still left to wait.
function msUntilResendAllowed(storeId, accountType, accountId) {
  const row = db
    .prepare(
      'SELECT created_at FROM login_otp_codes WHERE store_id IS ? AND account_type = ? AND account_id = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1'
    )
    .get(storeId, accountType, accountId);
  if (!row) return 0;

  const elapsed = Date.now() - new Date(row.created_at.replace(' ', 'T') + 'Z').getTime();
  return Math.max(0, MIN_RESEND_INTERVAL_MS - elapsed);
}

// Returns { ok: true } on a correct, unexpired, not-yet-exhausted code
// (marking it used so it can't be replayed), or { ok: false, reason } where
// reason is "no_code", "expired", "locked", or "invalid".
function verifyOtp(storeId, accountType, accountId, submittedCode) {
  const row = db
    .prepare(
      'SELECT * FROM login_otp_codes WHERE store_id IS ? AND account_type = ? AND account_id = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1'
    )
    .get(storeId, accountType, accountId);

  if (!row) return { ok: false, reason: 'no_code' };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'locked' };
  }

  if (hashCode(String(submittedCode || '')) !== row.code_hash) {
    db.prepare('UPDATE login_otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    const remaining = MAX_ATTEMPTS - (row.attempts + 1);
    return { ok: false, reason: remaining > 0 ? 'invalid' : 'locked', attemptsRemaining: Math.max(0, remaining) };
  }

  db.prepare('UPDATE login_otp_codes SET used_at = datetime(\'now\') WHERE id = ?').run(row.id);
  return { ok: true };
}

module.exports = { createOtp, verifyOtp, msUntilResendAllowed };
