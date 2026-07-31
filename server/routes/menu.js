const express = require('express');
const db = require('../db');
const { getFullMenu } = require('../lib/menu');
const { getSettings } = require('../lib/pricing');
const { getTodayHoursLabel } = require('../lib/businessHours');
const { toAbsoluteUrl } = require('../lib/url');

const router = express.Router();

router.get('/menu', (req, res) => {
  res.json({ categories: getFullMenu() });
});

router.get('/settings', (req, res) => {
  const s = getSettings();
  res.json({
    name: s.name,
    address: s.address,
    deliveryFeeCents: s.delivery_fee_cents,
    minDeliveryCents: s.min_delivery_cents,
    taxRateBps: s.tax_rate_bps,
    pickupHoursToday: getTodayHoursLabel('pickup'),
    deliveryHoursToday: getTodayHoursLabel('delivery'),
    deliveryRadiusMiles: s.delivery_radius_miles,
    isOpenOverride: s.is_open_override,
    loyaltyEarnRatePerDollar: s.loyalty_earn_rate_per_dollar,
    loyaltyRedeemValueCents: s.loyalty_redeem_value_cents,
    loyaltyMinRedeemPoints: s.loyalty_min_redeem_points,
    pickupEnabled: Boolean(s.pickup_enabled),
    deliveryEnabled: Boolean(s.delivery_enabled),
    curbsideEnabled: Boolean(s.curbside_enabled),
    themeAccentColor: s.theme_accent_color,
    onlineOrderingEnabled: Boolean(s.online_ordering_enabled),
    storeDescription: s.store_description,
    prepTimeMinutes: s.prep_time_minutes,
    orderMode: s.order_mode,
    adImageUrl: toAbsoluteUrl(s.ad_image_url),
    headerImageUrl: toAbsoluteUrl(s.header_image_url),
    footerImageUrl: toAbsoluteUrl(s.footer_image_url),
    digitalMenuUrl: s.digital_menu_url,
  });
});

router.get('/announcements/active', (req, res) => {
  const announcements = db.prepare('SELECT * FROM announcements WHERE is_active = 1 ORDER BY created_at DESC').all();
  res.json({ announcements: announcements.map((a) => ({ id: a.id, message: a.message })) });
});

module.exports = router;
