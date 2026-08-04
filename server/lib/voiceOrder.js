// Turns a spoken order transcript into cart lines by matching it against this
// store's real menu via Claude. The model's output is a proposal, never a
// source of truth: every returned id is re-checked against the store's own
// menu below before anything is trusted, the same way pricing.js never
// trusts a client-sent price.
const Anthropic = require('@anthropic-ai/sdk');
const { getFullMenu } = require('./menu');

function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function simplifyMenu(categories) {
  return categories.map((cat) => ({
    category: cat.name,
    items: cat.items.map((item) => ({
      menuItemId: item.id,
      name: item.name,
      sizes: item.sizes.map((s) => ({ sizeId: s.id, label: s.label })),
      extraGroups: item.extraGroups.map((g) => ({
        name: g.name,
        extras: g.extras.map((e) => ({ extraId: e.id, name: e.name })),
      })),
    })),
  }));
}

// Half-and-half isn't supported by voice yet - the system prompt tells the
// model to route those requests to `unmatched` instead of guessing.
const RESPONSE_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            menuItemId: { type: 'integer' },
            sizeId: { type: 'integer' },
            extraIds: { type: 'array', items: { type: 'integer' } },
            quantity: { type: 'integer' },
            notes: { type: 'string' },
          },
          required: ['menuItemId', 'sizeId', 'extraIds', 'quantity', 'notes'],
          additionalProperties: false,
        },
      },
      unmatched: { type: 'array', items: { type: 'string' } },
    },
    required: ['items', 'unmatched'],
    additionalProperties: false,
  },
};

async function askClaude(simplifiedMenu, transcript) {
  const client = new Anthropic();
  const response = await client.messages.create({
    // Haiku was fast but noticeably worse at matching loosely-phrased spoken
    // orders to the right menu item - Sonnet keeps most of Opus's language
    // understanding at a fraction of the latency. Low effort trims it
    // further for this short, single-turn task.
    model: 'claude-sonnet-5',
    max_tokens: 2048,
    system:
      "You match a customer's spoken restaurant order to a specific menu. Only use menuItemId/sizeId/extraId values that literally appear in the menu JSON provided - never invent or guess one. If a requested item, size, or extra has no reasonable match on this menu, put the customer's own words for it in \"unmatched\" instead of forcing a match. Quantities default to 1 when not stated. Half-and-half / split orders are not supported yet - route those to \"unmatched\" with a short note.",
    messages: [
      {
        role: 'user',
        content: `Menu:\n${JSON.stringify(simplifiedMenu)}\n\nCustomer said: "${transcript}"`,
      },
    ],
    output_config: { effort: 'low', format: RESPONSE_SCHEMA },
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return JSON.parse(textBlock.text);
}

// Rebuilds the same id relationships the model was given, straight from the
// DB for this exact store, and only lets through items where every id
// actually resolves - protecting against a hallucinated or out-of-store id
// even though the model was only ever shown this store's own menu.
function validateAgainstMenu(menu, claimed) {
  const itemsById = new Map();
  for (const cat of menu) {
    for (const item of cat.items) {
      itemsById.set(item.id, item);
    }
  }

  const resolved = [];
  const unmatched = [...claimed.unmatched];

  for (const line of claimed.items) {
    const item = itemsById.get(line.menuItemId);
    const size = item?.sizes.find((s) => s.id === line.sizeId);
    if (!item || !size) {
      unmatched.push(`(could not verify a matched item against the menu)`);
      continue;
    }
    const allExtras = item.extraGroups.flatMap((g) => g.extras);
    const requestedIds = new Set(line.extraIds || []);
    const extras = allExtras
      .filter((e) => requestedIds.has(e.id))
      .map((e) => ({ id: e.id, name: e.name, priceCents: e.priceCents }));

    resolved.push({
      menuItemId: item.id,
      menuItemName: item.name,
      sizeId: size.id,
      sizeLabel: size.label,
      unitPriceCents: size.priceCents + extras.reduce((sum, e) => sum + e.priceCents, 0),
      extras,
      quantity: Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : 1,
      notes: typeof line.notes === 'string' ? line.notes : '',
    });
  }

  return { items: resolved, unmatched };
}

async function parseVoiceOrder(storeId, transcript) {
  if (!isConfigured()) throw new Error('Voice ordering is not configured for this store');
  const menu = getFullMenu(storeId);
  const simplified = simplifyMenu(menu);
  const claimed = await askClaude(simplified, transcript);
  return validateAgainstMenu(menu, claimed);
}

module.exports = { isConfigured, parseVoiceOrder };
