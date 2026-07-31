const db = require('../db');

class LoyaltyError extends Error {}

// Caps the customer's requested redemption to their balance and to the order's discountable subtotal,
// converting points to a cents value using the configured redeem rate.
function resolveRedemption(customerId, requestedPoints, subtotalCents, settings) {
  if (!requestedPoints || requestedPoints <= 0) return { pointsRedeemed: 0, cents: 0 };
  if (!customerId) throw new LoyaltyError('Only logged-in customers can redeem loyalty points');

  const customer = db.prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(customerId);
  if (!customer) throw new LoyaltyError('Customer not found');

  if (requestedPoints < settings.loyalty_min_redeem_points) {
    throw new LoyaltyError(`You need at least ${settings.loyalty_min_redeem_points} points to redeem`);
  }
  if (requestedPoints > customer.loyalty_points) {
    throw new LoyaltyError('You do not have enough points for that redemption');
  }

  const maxCents = subtotalCents;
  let cents = Math.round(requestedPoints * settings.loyalty_redeem_value_cents);
  let pointsRedeemed = requestedPoints;
  if (cents > maxCents) {
    cents = maxCents;
    pointsRedeemed = Math.floor(cents / settings.loyalty_redeem_value_cents);
  }

  return { pointsRedeemed, cents };
}

function earnPoints(customerId, orderId, discountedSubtotalCents, settings) {
  if (!customerId) return 0;
  const points = Math.floor((discountedSubtotalCents / 100) * settings.loyalty_earn_rate_per_dollar);
  if (points <= 0) return 0;
  db.prepare('INSERT INTO loyalty_ledger (customer_id, order_id, points_delta, reason) VALUES (?, ?, ?, ?)').run(
    customerId,
    orderId,
    points,
    'order_earn'
  );
  db.prepare('UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id = ?').run(points, customerId);
  return points;
}

function redeemPoints(customerId, orderId, pointsRedeemed) {
  if (!pointsRedeemed) return;
  db.prepare('INSERT INTO loyalty_ledger (customer_id, order_id, points_delta, reason) VALUES (?, ?, ?, ?)').run(
    customerId,
    orderId,
    -pointsRedeemed,
    'order_redeem'
  );
  db.prepare('UPDATE customers SET loyalty_points = loyalty_points - ? WHERE id = ?').run(pointsRedeemed, customerId);
}

module.exports = { resolveRedemption, earnPoints, redeemPoints, LoyaltyError };
