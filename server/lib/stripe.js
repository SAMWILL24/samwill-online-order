const key = process.env.STRIPE_SECRET_KEY;
const isConfigured = Boolean(key && key.startsWith('sk_'));

const stripe = isConfigured ? require('stripe')(key) : null;

if (!isConfigured) {
  console.warn('[stripe] STRIPE_SECRET_KEY not set (or invalid) - orders will be created without real payment processing.');
}

module.exports = { stripe, isConfigured };
