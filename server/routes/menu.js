const express = require('express');
const db = require('../db');
const { getFullMenu } = require('../lib/menu');
const { getSettings } = require('../lib/pricing');
const { getTodayHoursLabel } = require('../lib/businessHours');
const { toAbsoluteUrl } = require('../lib/url');
const cardpointe = require('../lib/cardpointe');
const voiceOrder = require('../lib/voiceOrder');
const { voiceOrderLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.get('/menu', (req, res) => {
  res.json({ categories: getFullMenu(req.store.id) });
});

router.get('/settings', (req, res) => {
  const s = getSettings(req.store.id);
  res.json({
    name: s.name,
    address: s.address,
    deliveryFeeCents: s.delivery_fee_cents,
    minDeliveryCents: s.min_delivery_cents,
    taxRateBps: s.tax_rate_bps,
    pickupHoursToday: getTodayHoursLabel(req.store.id, 'pickup'),
    deliveryHoursToday: getTodayHoursLabel(req.store.id, 'delivery'),
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
    voiceOrderingEnabled: voiceOrder.isConfigured(),
    // The CardPointe "site" is just a subdomain identifier, not a secret - it's
    // needed client-side to build the hosted tokenizer iframe URL. The
    // merchant ID/username/password stay server-side only.
    cardpointeConfigured: cardpointe.isConfigured(req.store),
    cardpointeSite: s.cardpointe_site || null,
    cardpointeTestMode: Boolean(s.cardpointe_testmode),
  });
});

router.get('/announcements/active', (req, res) => {
  const announcements = db
    .prepare('SELECT * FROM announcements WHERE store_id = ? AND is_active = 1 ORDER BY created_at DESC')
    .all(req.store.id);
  res.json({ announcements: announcements.map((a) => ({ id: a.id, message: a.message })) });
});

router.post('/voice-order', voiceOrderLimiter, async (req, res) => {
  const transcript = (req.body?.transcript || '').trim();
  if (!transcript) return res.status(400).json({ error: 'transcript is required' });
  if (!voiceOrder.isConfigured()) return res.status(503).json({ error: 'Voice ordering is not available' });
  try {
    const result = await voiceOrder.parseVoiceOrder(req.store.id, transcript);
    res.json(result);
  } catch (err) {
    console.error('[voice-order] failed:', err.message);
    res.status(502).json({ error: 'Could not process that order right now, please try again' });
  }
});

module.exports = router;
