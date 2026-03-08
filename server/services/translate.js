import crypto from 'crypto';
import { readDb, writeDb } from '../db.js';

const langNames = { nl: 'Dutch', fr: 'French', en: 'English' };

function cacheKey(text, fromLang, toLang) {
  return crypto
    .createHash('md5')
    .update(`${text}|${fromLang}|${toLang}`)
    .digest('hex');
}

export async function translate(text, fromLang, toLang) {
  if (fromLang === toLang) return text;

  const db = await readDb();
  const key = cacheKey(text, fromLang, toLang);
  const cached = db.translations_cache.find((c) => c.key === key);
  if (cached) return cached.value;

  const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
  const response = await fetch(`${ollamaHost}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'translategemma:12b',
      stream: false,
      prompt: `Translate the following text from ${langNames[fromLang]} to ${langNames[toLang]}.
Return ONLY the translation, nothing else. No explanation, no quotes.

Text: ${text}`,
    }),
  });

  const data = await response.json();
  const translated = data.response.trim();

  db.translations_cache.push({ key, value: translated, fromLang, toLang, createdAt: new Date().toISOString() });
  await writeDb(db);

  return translated;
}
