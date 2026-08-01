const express = require('express');
const db = require('../db');
const { priceCart, OrderValidationError } = require('../lib/pricing');
const { resolveDiscount, PromotionError } = require('../lib/promotions');
const { resolveRedemption, earnPoints, redeemPoints, LoyaltyError } = require('../lib/loyalty');
const { optionalCustomerAuth, requireCustomerAuth } = require('../middleware/auth');
const cardpointe = require('../lib/cardpointe');
const { sendOrderConfirmation, sendNewOrderAlert } = require('../lib/orderEmails');
const { enqueuePrintJob } = require('../lib/printQueue');

const router = express.Router();

const VALID_TYPES = ['pickup', 'delivery', 'curbside'];

function serializeOrder(order) {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const itemIds = items.map((i) => i.id);
  const extrasByItem = {};
  if (itemIds.length) {
    const placeholders = itemIds.map(() => '?').join(',');
    const extras = db.prepare(`SELECT * FROM order_item_extras WHERE order_item_id IN (${placeholders})`).all(...itemIds);
    for (const e of extras) {
      (extrasByItem[e.order_item_id] = extrasByItem[e.order_item_id] || []).push({
        name: e.extra_name,
        priceCents: e.price_cents,
        half: e.half,
      });
    }
  }

  let address = null;
  if (order.address_id) {
    address = db.prepare('SELECT * FROM addresses WHERE id = ?').get(order.address_id);
  }

  let promotion = null;
  if (order.promotion_id) {
    const promo = db.prepare('SELECT title, code FROM promotions WHERE id = ?').get(order.promotion_id);
    if (promo) promotion = promo;
  }

  return {
    id: order.id,
    storeId: order.store_id,
    type: order.type,
    status: order.status,
    requestedTime: order.requested_time,
    subtotalCents: order.subtotal_cents,
    deliveryFeeCents: order.delivery_fee_cents,
    taxCents: order.tax_cents,
    tipCents: order.tip_cents,
    promotionDiscountCents: order.promotion_discount_cents,
    loyaltyRedeemCents: order.loyalty_redeem_cents,
    loyaltyPointsEarned: order.loyalty_points_earned,
    loyaltyPointsRedeemed: order.loyalty_points_redeemed,
    promotion: promotion && { title: promotion.title, code: promotion.code },
    totalCents: order.total_cents,
    paymentStatus: order.payment_status,
    refundedCents: order.refunded_cents,
    notes: order.notes,
    createdAt: order.created_at,
    guest: order.customer_id ? null : { name: order.guest_name, email: order.guest_email, phone: order.guest_phone },
    address: address && { line1: address.line1, line2: address.line2, city: address.city, state: address.state, zip: address.zip },
    items: items.map((i) => ({
      menuItemName: i.menu_item_name,
      sizeLabel: i.size_label,
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      notes: i.notes,
      extras: extrasByItem[i.id] || [],
      isHalfAndHalf: Boolean(i.is_half_and_half),
      secondMenuItemName: i.second_menu_item_name,
    })),
  };
}

router.post('/', optionalCustomerAuth, async (req, res) => {
  const { type, requestedTime, cart, guest, address, tipCents, notes, promoCode, redeemPoints: requestedPoints } = req.body || {};
  const storeId = req.store.id;

  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: 'type must be "pickup" or "delivery"' });
  }
  if (!requestedTime || typeof requestedTime !== 'string') {
    return res.status(400).json({ error: 'requestedTime is required' });
  }
  if (type === 'delivery' && (!address || !address.line1 || !address.city || !address.state || !address.zip)) {
    return res.status(400).json({ error: 'A complete delivery address is required' });
  }
  if (!req.customerId && (!guest || !guest.name || !guest.email || !guest.phone)) {
    return res.status(400).json({ error: 'Guest name, email and phone are required when not logged in' });
  }

  let priced;
  try {
    priced = priceCart(storeId, cart, type);
  } catch (err) {
    if (err instanceof OrderValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }

  let discount;
  try {
    discount = resolveDiscount(storeId, priced.subtotalCents, promoCode);
  } catch (err) {
    if (err instanceof PromotionError) return res.status(400).json({ error: err.message });
    throw err;
  }

  let redemption;
  try {
    redemption = resolveRedemption(req.customerId, requestedPoints, priced.subtotalCents - discount.discountCents, priced.settings);
  } catch (err) {
    if (err instanceof LoyaltyError) return res.status(400).json({ error: err.message });
    throw err;
  }

  const safeTip = Number.isInteger(tipCents) && tipCents >= 0 ? tipCents : 0;
  const discountedSubtotalCents = Math.max(0, priced.subtotalCents - discount.discountCents - redemption.cents);
  const taxCents = Math.round(discountedSubtotalCents * (priced.settings.tax_rate_bps / 10000));
  const totalCents = discountedSubtotalCents + priced.deliveryFeeCents + taxCents + safeTip;

  // CardPointe's auth+capture is a single synchronous call, so the charge is
  // attempted before anything is written - a declined card never creates an
  // order row at all (unlike the old Stripe flow, which created a pending
  // order first and confirmed it later via webhook).
  let paymentStatus = 'pending';
  let retref = null;
  if (cardpointe.isConfigured(req.store)) {
    const { cardToken } = req.body || {};
    if (!cardToken) return res.status(400).json({ error: 'cardToken is required to place an order' });
    let charge;
    try {
      charge = await cardpointe.authAndCapture(req.store, {
        token: cardToken,
        amountCents: totalCents,
        orderId: `pending-${storeId}-${Date.now()}`,
      });
    } catch (err) {
      console.error('[cardpointe] auth request failed:', err.message);
      return res.status(502).json({ error: 'Payment provider error, please try again' });
    }
    if (!charge.approved) {
      return res.status(402).json({ error: charge.resptext || 'Card was declined' });
    }
    paymentStatus = 'paid';
    retref = charge.retref;
  }

  const createOrder = db.transaction(() => {
    let addressId = null;
    if (type === 'delivery') {
      const info = db
        .prepare('INSERT INTO addresses (customer_id, label, line1, line2, city, state, zip) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(req.customerId || null, address.label || null, address.line1, address.line2 || null, address.city, address.state, address.zip);
      addressId = info.lastInsertRowid;
    }

    const orderInfo = db
      .prepare(
        `INSERT INTO orders
          (store_id, customer_id, guest_name, guest_email, guest_phone, type, requested_time, status, subtotal_cents, delivery_fee_cents, tax_cents, tip_cents, total_cents, address_id, notes,
           promotion_id, promo_code_entered, promotion_discount_cents, loyalty_redeem_cents, loyalty_points_redeemed, cardpointe_retref, payment_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        storeId,
        req.customerId || null,
        req.customerId ? null : guest.name,
        req.customerId ? null : guest.email,
        req.customerId ? null : guest.phone,
        type,
        requestedTime,
        paymentStatus === 'paid' ? 'confirmed' : 'placed',
        priced.subtotalCents,
        priced.deliveryFeeCents,
        taxCents,
        safeTip,
        totalCents,
        addressId,
        typeof notes === 'string' ? notes.slice(0, 1000) : null,
        discount.promotion ? discount.promotion.id : null,
        promoCode || null,
        discount.discountCents,
        redemption.cents,
        redemption.pointsRedeemed,
        retref,
        paymentStatus
      );

    const orderId = orderInfo.lastInsertRowid;

    for (const line of priced.lines) {
      const itemInfo = db
        .prepare(
          `INSERT INTO order_items
            (order_id, menu_item_id, menu_item_name, size_id, size_label, quantity, unit_price_cents, notes,
             is_half_and_half, second_menu_item_id, second_menu_item_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          orderId,
          line.menuItem.id,
          line.menuItem.name,
          line.size.id,
          line.size.label,
          line.quantity,
          line.unitPriceCents,
          line.notes,
          line.isHalfAndHalf ? 1 : 0,
          line.isHalfAndHalf ? line.secondMenuItem.id : null,
          line.isHalfAndHalf ? line.secondMenuItem.name : null
        );

      for (const extra of line.extras) {
        db.prepare(
          'INSERT INTO order_item_extras (order_item_id, extra_id, extra_name, price_cents, half) VALUES (?, ?, ?, ?, ?)'
        ).run(itemInfo.lastInsertRowid, extra.id, extra.name, extra.price_cents, extra.half || 'whole');
      }
    }

    if (redemption.pointsRedeemed > 0) {
      redeemPoints(req.customerId, orderId, redemption.pointsRedeemed);
    }
    const pointsEarned = earnPoints(req.customerId, orderId, discountedSubtotalCents, priced.settings);
    if (pointsEarned > 0) {
      db.prepare('UPDATE orders SET loyalty_points_earned = ? WHERE id = ?').run(pointsEarned, orderId);
    }

    return orderId;
  });

  let orderId;
  try {
    orderId = createOrder();
  } catch (err) {
    console.error('[orders] Failed to create order:', err);
    return res.status(500).json({ error: 'Could not place order, please try again' });
  }

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const io = req.app.get('io');
  io.to(`admin:${storeId}`).emit('order:new', serializeOrder(order));

  // Fire-and-forget: a slow or down email provider must never delay the
  // order-confirmation response the customer is waiting on.
  const recipientEmail = order.customer_id
    ? db.prepare('SELECT email FROM customers WHERE id = ?').get(order.customer_id)?.email
    : order.guest_email;
  sendOrderConfirmation(req.store, serializeOrder(order), recipientEmail).catch((err) =>
    console.error('[email] order confirmation failed:', err.message)
  );
  sendNewOrderAlert(req.store, serializeOrder(order)).catch((err) =>
    console.error('[email] new order alert failed:', err.message)
  );
  try {
    enqueuePrintJob(req.store, serializeOrder(order));
  } catch (err) {
    console.error('[print] failed to enqueue kitchen ticket:', err.message);
  }

  res.status(201).json({
    order: serializeOrder(order),
    payment: cardpointe.isConfigured(req.store)
      ? { charged: true }
      : { charged: false, note: 'Payments are not configured for this store; order created without payment processing.' },
  });
});

router.get('/mine', requireCustomerAuth, (req, res) => {
  const orders = db
    .prepare('SELECT * FROM orders WHERE customer_id = ? AND store_id = ? ORDER BY created_at DESC')
    .all(req.customerId, req.store.id);
  res.json({ orders: orders.map(serializeOrder) });
});

router.get('/:id', optionalCustomerAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND store_id = ?').get(req.params.id, req.store.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.customer_id && order.customer_id !== req.customerId) {
    return res.status(403).json({ error: 'Not authorized to view this order' });
  }
  res.json({ order: serializeOrder(order) });
});

module.exports = { router, serializeOrder };
