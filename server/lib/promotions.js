const db = require('../db');

class PromotionError extends Error {}

function isActiveNow(promo, now = new Date()) {
  if (!promo.is_active) return false;

  if (promo.starts_at && now < new Date(promo.starts_at)) return false;
  if (promo.ends_at && now > new Date(promo.ends_at)) return false;

  if (promo.days_of_week) {
    const allowedDays = promo.days_of_week.split(',').map((d) => parseInt(d, 10));
    if (!allowedDays.includes(now.getDay())) return false;
  }

  if (promo.start_time && promo.end_time) {
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = promo.start_time.split(':').map(Number);
    const [endH, endM] = promo.end_time.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    if (minutesNow < startMinutes || minutesNow > endMinutes) return false;
  }

  return true;
}

function discountForSubtotal(promo, subtotalCents) {
  if (subtotalCents < promo.min_subtotal_cents) return 0;
  const raw = promo.discount_type === 'percent' ? Math.round((subtotalCents * promo.discount_value) / 100) : promo.discount_value;
  return Math.min(raw, subtotalCents);
}

function getActivePromotions() {
  const all = db.prepare('SELECT * FROM promotions WHERE is_active = 1').all();
  const now = new Date();
  return all.filter((p) => isActiveNow(p, now));
}

// Returns the single best (largest discount) auto-applying promotion for this subtotal, or null.
function getBestAutoPromotion(subtotalCents) {
  const active = getActivePromotions().filter((p) => p.auto_apply);
  let best = null;
  let bestDiscount = 0;
  for (const promo of active) {
    const discount = discountForSubtotal(promo, subtotalCents);
    if (discount > bestDiscount) {
      best = promo;
      bestDiscount = discount;
    }
  }
  return best ? { promotion: best, discountCents: bestDiscount } : null;
}

function validatePromoCode(code, subtotalCents) {
  const promo = db.prepare('SELECT * FROM promotions WHERE code = ?').get(code);
  if (!promo) throw new PromotionError('Invalid promo code');
  if (!isActiveNow(promo)) throw new PromotionError('This promo code is not currently active');
  const discountCents = discountForSubtotal(promo, subtotalCents);
  if (discountCents === 0) {
    throw new PromotionError(`This code requires a minimum order of $${(promo.min_subtotal_cents / 100).toFixed(2)}`);
  }
  return { promotion: promo, discountCents };
}

// Resolves the best available discount: an entered code takes priority over automatic deals,
// but we still fall back to the best auto-apply promotion if no code was entered.
function resolveDiscount(subtotalCents, promoCode) {
  if (promoCode) {
    const { promotion, discountCents } = validatePromoCode(promoCode, subtotalCents);
    return { promotion, discountCents, source: 'code' };
  }
  const auto = getBestAutoPromotion(subtotalCents);
  return auto ? { ...auto, source: 'auto' } : { promotion: null, discountCents: 0, source: null };
}

module.exports = { getActivePromotions, getBestAutoPromotion, validatePromoCode, resolveDiscount, isActiveNow, PromotionError };
