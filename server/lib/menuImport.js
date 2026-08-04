// Turns pasted menu text or a photo of a physical menu into structured
// categories/items/sizes via Claude. Unlike voiceOrder.js, there's no
// existing menu to validate the model's output against - the output IS the
// new data - so instead of an id cross-check we just sanity-clamp shapes
// and sizes before handing it back for the admin to review and commit.
const Anthropic = require('@anthropic-ai/sdk');

function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const RESPONSE_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      categories: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  sizes: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        label: { type: 'string' },
                        priceCents: { type: 'integer' },
                      },
                      required: ['label', 'priceCents'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['name', 'description', 'sizes'],
                additionalProperties: false,
              },
            },
          },
          required: ['name', 'items'],
          additionalProperties: false,
        },
      },
    },
    required: ['categories'],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT =
  "You extract a restaurant menu from the text or photo provided into structured JSON. Group items into sensible categories (e.g. Appetizers, Entrees, Pizza, Drinks, Desserts) using the source's own section headings when present. Every item needs at least one size - if the source lists only one price for an item with no size variants, give it a single size labeled \"Regular\". Convert every price to integer cents (e.g. $12.99 -> 1299, never a decimal). If an item has no description, use an empty string - never invent one. Do not invent items that aren't in the source, and don't skip items you can read. If part of the source is illegible, do your best reasonable reading rather than omitting it.";

async function askClaude(content) {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    output_config: { effort: 'medium', format: RESPONSE_SCHEMA },
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  return JSON.parse(textBlock.text);
}

// Clamps array sizes and coerces types so a malformed or oversized model
// response can't blow up the review UI or the eventual bulk insert.
function sanitize(raw) {
  const categories = Array.isArray(raw.categories) ? raw.categories : [];
  return categories.slice(0, 60).map((cat) => ({
    name: typeof cat.name === 'string' ? cat.name.slice(0, 120) : 'Untitled',
    items: (Array.isArray(cat.items) ? cat.items : []).slice(0, 150).map((item) => ({
      name: typeof item.name === 'string' ? item.name.slice(0, 120) : 'Untitled item',
      description: typeof item.description === 'string' ? item.description.slice(0, 500) : '',
      sizes: (Array.isArray(item.sizes) ? item.sizes : [])
        .slice(0, 10)
        .filter((s) => typeof s.label === 'string' && Number.isInteger(s.priceCents) && s.priceCents >= 0)
        .map((s) => ({ label: s.label.slice(0, 40), priceCents: Math.min(s.priceCents, 10_000_00) })),
    })),
  }));
}

async function parseMenuFromText(text) {
  if (!isConfigured()) throw new Error('Menu import is not configured');
  const trimmed = text.trim().slice(0, 20000);
  if (!trimmed) throw new Error('No menu text provided');
  const claimed = await askClaude(`Menu text:\n${trimmed}`);
  return sanitize(claimed);
}

async function parseMenuFromImage(base64Data, mediaType) {
  if (!isConfigured()) throw new Error('Menu import is not configured');
  const claimed = await askClaude([
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
    { type: 'text', text: 'Extract the menu from this photo.' },
  ]);
  return sanitize(claimed);
}

module.exports = { isConfigured, parseMenuFromText, parseMenuFromImage };
