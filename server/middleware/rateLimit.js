const rateLimit = require('express-rate-limit');

// Keyed by IP (the default) rather than per-store, since it's the caller's
// address that matters for brute-force protection, not which store they're
// hitting - a single attacker trying every store's login shouldn't get a
// fresh allowance for each slug.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

// Forgot-password triggers an outbound email, which is more expensive to
// receive spammed than a login attempt, so it gets a stricter allowance.
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please try again later.' },
});

module.exports = { loginLimiter, forgotPasswordLimiter };
