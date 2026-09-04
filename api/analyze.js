// Photo -> dice reader. Proxies a vision request so the API key stays server-side.
//   GET  /api/analyze                 -> { available: bool, provider }
//   POST /api/analyze { image }       -> { dice: [{color,value,glitter?,sign?}, ...], provider }
//
// Provider preference:
//   1. Google Gemini  (GEMINI_API_KEY)  — free tier at ai.google.dev, model gemini-3.6-flash
//      (override with GEMINI_MODEL). A resized dice photo is well within the free RPM/RPD limits.
//   2. Anthropic      (ANTHROPIC_API_KEY) — claude-haiku-4-5, cheapest Claude with vision.
// If neither key is set the endpoint reports ai_unconfigured and the client
// falls back to manual entry (which is always available anyway).

import { DICE_COLORS } from '../lib/score.js';

export const config = { maxDuration: 30 };

const SYSTEM_PROMPT = `You are the dice reader for a Panda Royale scorekeeping app. You get ONE photo of a single player's dice pool for one round. Your job is to report every die's colour and face-up value so the app can score the round.

Panda Royale uses exactly these seven dice colours — every die in the photo is one of them:
- yellow  — solid yellow, pipped (dots)
- purple  — solid purple, pipped
- blue    — solid blue, pipped. Most blue dice have plain white pips; a FEW are the "glitter" variant with sparkly gold / metallic pips. Only those are glitter.
- red     — solid red. Each red die carries a mix of white-ink and black-ink numerals across its faces. Read the ink colour of the numeral that is face-up.
- green   — usually a large 20-sided die showing a printed NUMBER (not dots); can be 1–20.
- clear   — colourless translucent / frosted plastic, pipped. Easy to miss against a light table.
- pink    — solid pink, pipped. Usually just one, sometimes none.

Work through the photo in this order:
1. Find every die. Include ones that are tilted, touching, or half in frame. Don't invent dice that aren't there.
2. Sort them into colour groups.
3. For each die, get its value:
   - pipped die  -> count the dots on the top face.
   - numeral die (green, or a red face showing a number) -> read the printed number.
4. For each blue die decide glitter: true only if the pips are clearly sparkly gold/metallic.
5. For each red die record numeralColor: "white" or "black" for the face-up numeral.

Then output ONE JSON array, exactly one object per physical die, and NOTHING else — no prose, no markdown fences:
[{"color":"yellow","value":4},{"color":"yellow","value":6},{"color":"blue","value":2,"glitter":false},{"color":"red","value":5,"numeralColor":"white"},{"color":"green","value":17}]

Constraints:
- "color" is one of: yellow, purple, blue, red, green, clear, pink.
- "value" is a positive integer (counted pips or the printed number).
- include "glitter" (boolean) on every blue die; include "numeralColor" ("white" | "black") on every red die.
- two dice of the same colour and value are two separate objects.
- if a die is genuinely ambiguous, still give your best single guess — the player confirms or corrects every value before it counts.`;

const USER_TEXT =
  'Here is the dice photo for this round. Group the dice by colour, count the pips or read the number for each die, then respond with ONLY the JSON array — one object per die, each with its colour and value.';

// JSON schema handed to Gemini so it returns a clean array with no prose.
const GEMINI_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      color: { type: 'string', enum: [...DICE_COLORS] },
      value: { type: 'integer' },
      glitter: { type: 'boolean' },
      numeralColor: { type: 'string', enum: ['white', 'black'] },
    },
    required: ['color', 'value'],
  },
};

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

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

// Turn one loose die-ish object into the app's shape, or null if unusable.
function normalizeDie(raw, colorHint) {
  if (raw == null) return null;
  const d = typeof raw === 'object' ? raw : {};
  let color = String(d.color ?? d.colour ?? colorHint ?? '').toLowerCase().trim();
  if (color === 'transparent' || color === 'white' || color === 'frosted') color = 'clear';
  if (!DICE_COLORS.includes(color)) {
    if (colorHint && DICE_COLORS.includes(colorHint)) color = colorHint;
    else return null;
  }
  // value can arrive as value / val / number / pips / count, or the item can be a bare number
  let v = num(
    typeof raw === 'number' || typeof raw === 'string'
      ? raw
      : d.value ?? d.val ?? d.number ?? d.pips ?? d.dots ?? d.count
  );
  if (!Number.isFinite(v)) return null;
  v = Math.max(0, Math.min(99, Math.round(v)));

  const die = { color, value: v };
  if (color === 'blue') {
    die.glitter = d.glitter === true || d.sparkly === true || /glitter|sparkl|gold|metallic/i.test(String(d.variant ?? d.numeralColor ?? ''));
  }
  if (color === 'red') {
    const ink = String(d.numeralColor ?? d.ink ?? d.sign ?? d.color2 ?? '').toLowerCase();
    die.sign = ink.includes('black') || ink === 'negative' || d.negative === true ? 'negative' : 'positive';
  }
  return die;
}

// Accept whatever the model gives back: a bare array, {dice:[...]}, {result:[...]},
// or a colour-keyed object like {yellow:[3,5], blue:[{value:2,glitter:true}]}.
function coerceToDice(parsed) {
  if (Array.isArray(parsed)) {
    return parsed.map((x) => normalizeDie(x)).filter(Boolean);
  }
  if (parsed && typeof parsed === 'object') {
    const nested = parsed.dice ?? parsed.result ?? parsed.results ?? parsed.data ?? parsed.byColor ?? parsed.by_color;
    if (nested && nested !== parsed) return coerceToDice(nested);

    // a single die object
    if (parsed.color != null || parsed.colour != null) {
      const one = normalizeDie(parsed);
      return one ? [one] : [];
    }

    const out = [];
    for (const [key, val] of Object.entries(parsed)) {
      const color = key.toLowerCase();
      if (!DICE_COLORS.includes(color)) continue;
      const list = Array.isArray(val) ? val : [val];
      for (const item of list) {
        const die = normalizeDie(item, color);
        if (die) out.push(die);
      }
    }
    return out;
  }
  return [];
}

function parseModelJson(text) {
  const cleaned = String(text || '').replace(/```json|```/g, '').trim();
  // try the whole thing, then the first array, then the first object
  const candidates = [cleaned];
  const arr = cleaned.match(/\[[\s\S]*\]/);
  if (arr) candidates.push(arr[0]);
  const obj = cleaned.match(/\{[\s\S]*\}/);
  if (obj) candidates.push(obj[0]);
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* next */
    }
  }
  return null;
}

async function readWithGemini(base64) {
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
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
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_SCHEMA,
      },
    }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

async function readWithAnthropic(base64) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
    max_tokens: 2048,
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
    const parsed = parseModelJson(text);
    if (parsed == null) {
      return send(res, 502, { error: 'unreadable', message: 'The reader did not return usable data.' });
    }

    const dice = coerceToDice(parsed);
    // an empty pool is a valid answer (blank photo); only a shape we couldn't read is an error
    return send(res, 200, { dice, provider: p });
  } catch (err) {
    console.error('analyze error', err);
    return send(res, 502, { error: 'ai_error', message: String(err && err.message) });
  }
}
