// Photo -> dice reader. Proxies a vision request so the API key stays server-side.
//   GET  /api/analyze                 -> { available: bool, provider }
//   POST /api/analyze { image }       -> { dice: [...] }   (image = data URL or bare base64 JPEG)
//
// Provider preference:
//   1. Google Gemini  (GEMINI_API_KEY)  — free tier at ai.google.dev, model gemini-2.0-flash.
//      A resized dice photo is well within the free RPM/RPD limits.
//   2. Anthropic      (ANTHROPIC_API_KEY) — claude-haiku-4-5, cheapest Claude with vision.
// If neither key is set the endpoint reports ai_unconfigured and the client
// falls back to manual entry (which is always available anyway).

import { DICE_COLORS } from '../lib/score.js';

export const config = { maxDuration: 30 };

const SYSTEM_PROMPT = `You are reading a photo of dice from the board game Panda Royale for score tracking.
Dice come in exactly these colors, each with a specific meaning:
- yellow: standard die
- purple: standard die
- blue: standard die; a small number of blue dice are a "glitter" variant with metallic/sparkly gold-colored numerals instead of plain white numerals
- red: has some numerals printed in black ink and some in white ink on the same die; report the ink color of the numeral shown face-up as "white" or "black"
- green: standard die, often a large many-sided die with high numbers
- clear (translucent/frosted white plastic): standard die
- pink: standard die, usually just one

For every individual die visible in the photo, report: color (one of yellow, purple, blue, red, green, clear, pink), the face-up numeric value, and for blue dice a boolean "glitter" (true if it is the sparkly gold-numeral variant), and for red dice a "numeralColor" of "white" or "black".

Respond with ONLY a raw JSON array, no markdown fences, no other text. Example:
[{"color":"yellow","value":4},{"color":"blue","value":2,"glitter":false},{"color":"red","value":5,"numeralColor":"white"}]

If you are unsure about a die, still include your best guess - the person reviews and corrects everything before it's used.`;

const USER_TEXT =
  'List every die in this photo per your instructions. Respond with only the JSON array.';

function provider() {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

function send(res, status, body) {
  res.status(status).setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function normalizeDie(d) {
  const color = DICE_COLORS.includes(d && d.color) ? d.color : 'yellow';
  const die = {
    color,
    value: Math.max(0, Math.min(99, Math.round(Number(d && d.value) || 0))),
  };
  if (color === 'blue') die.glitter = !!(d && d.glitter);
  if (color === 'red') die.sign = d && d.numeralColor === 'black' ? 'negative' : 'positive';
  return die;
}

function parseDiceArray(text) {
  const match = String(text || '')
    .replace(/```json|```/g, '')
    .match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readWithGemini(base64) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: 'image/jpeg', data: base64 } },
            { text: USER_TEXT },
          ],
        },
      ],
      generationConfig: { temperature: 0, maxOutputTokens: 1024, responseMimeType: 'application/json' },
    }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return text;
}

async function readWithAnthropic(base64) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
          { type: 'text', text: USER_TEXT },
        ],
      },
    ],
  });
  const block = (message.content || []).find((b) => b.type === 'text');
  return (block && block.text) || '';
}

export default async function handler(req, res) {
  const p = provider();

  if (req.method === 'GET') {
    return send(res, p ? 200 : 503, { available: !!p, provider: p });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }
  if (!p) {
    return send(res, 503, {
      error: 'ai_unconfigured',
      message: 'Photo reading is off. Set GEMINI_API_KEY (free) or ANTHROPIC_API_KEY to enable it.',
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    if (!body.image || typeof body.image !== 'string') {
      return send(res, 400, { error: 'missing_image' });
    }
    const base64 = body.image.includes(',') ? body.image.split(',')[1] : body.image;

    const text = p === 'gemini' ? await readWithGemini(base64) : await readWithAnthropic(base64);
    const parsed = parseDiceArray(text);
    if (!parsed) return send(res, 502, { error: 'unreadable', message: 'Could not parse a dice list.' });

    return send(res, 200, { dice: parsed.map(normalizeDie), provider: p });
  } catch (err) {
    console.error('analyze error', err);
    return send(res, 502, { error: 'ai_error', message: String(err && err.message) });
  }
}
