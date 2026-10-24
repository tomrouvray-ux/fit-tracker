// Food recognition with Claude (vision). Runs from the browser with the user's own API key.

import { state } from './store.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'barcode', 'notes'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'grams', 'kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'confidence'],
        properties: {
          name: { type: 'string', description: 'Short food name, e.g. "Grilled chicken breast"' },
          grams: { type: 'number', description: 'Estimated edible weight in grams (ml for drinks)' },
          kcal: { type: 'number' },
          protein: { type: 'number', description: 'grams' },
          carbs: { type: 'number', description: 'grams' },
          fat: { type: 'number', description: 'grams' },
          fiber: { type: 'number', description: 'grams' },
          sugar: { type: 'number', description: 'grams' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    barcode: { type: 'string', description: 'Digits of a product barcode if one is clearly legible, otherwise empty string' },
    notes: { type: 'string', description: 'One short sentence on assumptions (portion, cooking method), or empty' },
  },
};

const SYSTEM = `You estimate nutrition for a food diary. Identify each distinct food or drink and estimate the portion actually shown or described, in grams, then give totals for that portion (not per 100 g).
Use typical UK/EU recipes and portion sizes unless the photo or text says otherwise. Account for visible oils, sauces and dressings.
If the photo shows a packaged product, read the label or nutrition panel when visible and use it. If a barcode is clearly legible, return its digits.
Be realistic rather than optimistic. If something is not food, return no items and say so in notes.`;

export function hasKey() {
  return !!state.settings.anthropicKey;
}

export async function analyzeFood({ imageDataUrl, text }) {
  const key = state.settings.anthropicKey;
  if (!key) throw new Error('Add your Claude API key in Settings first.');
  const content = [];
  if (imageDataUrl) {
    const [, mediaType, data] = imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.*)$/) || [];
    content.push({ type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data } });
  }
  content.push({ type: 'text', text: text ? `What I ate: ${text}` : 'Log the food in this photo.' });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: state.settings.aiModel || 'claude-opus-5-5',
      max_tokens: 16000,
      system: SYSTEM,
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content }],
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body.error && body.error.message) || `HTTP ${res.status}`;
    if (res.status === 401) throw new Error('Claude rejected the API key. Check it in Settings.');
    if (res.status === 429) throw new Error('Claude is rate limiting requests. Try again in a minute.');
    throw new Error('Claude error: ' + msg);
  }
  if (body.stop_reason === 'refusal') throw new Error('Claude declined to analyse this image.');
  if (body.stop_reason === 'max_tokens') throw new Error('The answer was cut off. Try again.');
  const block = (body.content || []).find(b => b.type === 'text');
  if (!block) throw new Error('Claude returned no answer.');
  const out = JSON.parse(block.text);
  out.items = (out.items || []).filter(i => i.grams > 0 || i.kcal > 0);
  return out;
}
