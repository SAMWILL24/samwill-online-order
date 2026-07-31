const express = require('express');
const { getActivePromotions } = require('../lib/promotions');
const { toAbsoluteUrl } = require('../lib/url');

const router = express.Router();

router.get('/active', (req, res) => {
  const promos = getActivePromotions().map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    imageUrl: toAbsoluteUrl(p.image_url),
    discountType: p.discount_type,
    discountValue: p.discount_value,
    minSubtotalCents: p.min_subtotal_cents,
    requiresCode: Boolean(p.code),
    code: p.code,
  }));
  res.json({ promotions: promos });
});

module.exports = router;
