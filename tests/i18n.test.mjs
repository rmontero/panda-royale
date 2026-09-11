// i18n parity guard — fails if the five locales in index.html's I18N table
// drift apart (a key added to one locale but not the others). Runs under
// `npm test` (node --test). It parses the I18N object literal out of the
// single-file app and compares each locale's key set to English.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

// Extract the `const I18N = { ... };` object literal and evaluate just that.
function loadI18N() {
  const marker = 'const I18N = {';
  const start = html.indexOf(marker);
  assert.ok(start !== -1, 'I18N table not found in index.html');
  // Brace-match from the opening `{` of the literal to its close, ignoring
  // braces that appear inside string literals (the table has none in keys, but
  // values can contain `{n}` placeholders inside quotes — skip those).
  const open = start + marker.length - 1; // index of the `{`
  let depth = 0;
  let i = open;
  let quote = null;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const objText = html.slice(open, i); // `{ ... }`
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${objText});`)();
}

const EXPECTED_LOCALES = ['en', 'es', 'de', 'fr', 'pt'];

test('I18N has exactly the five expected locales', () => {
  const I18N = loadI18N();
  assert.deepEqual(Object.keys(I18N).sort(), [...EXPECTED_LOCALES].sort());
});

test('every locale has the identical key set (5-locale parity)', () => {
  const I18N = loadI18N();
  const en = new Set(Object.keys(I18N.en));
  for (const locale of EXPECTED_LOCALES) {
    if (locale === 'en') continue;
    const keys = new Set(Object.keys(I18N[locale]));
    const missing = [...en].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !en.has(k));
    assert.equal(
      missing.length,
      0,
      `locale "${locale}" is MISSING keys present in en: ${missing.join(', ')}`,
    );
    assert.equal(
      extra.length,
      0,
      `locale "${locale}" has EXTRA keys not in en: ${extra.join(', ')}`,
    );
  }
});

test('no locale has an empty string value (untranslated leak)', () => {
  const I18N = loadI18N();
  for (const locale of EXPECTED_LOCALES) {
    for (const [k, v] of Object.entries(I18N[locale])) {
      assert.ok(String(v).length > 0, `locale "${locale}" key "${k}" is empty`);
    }
  }
});
