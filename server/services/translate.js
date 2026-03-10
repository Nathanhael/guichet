import { get, run } from '../db.js';
import config from '../config.js';
import logger from '../utils/logger.js';

const langNames = { nl: 'Dutch', fr: 'French', en: 'English' };

export async function translate(text, fromLang, toLang) {
  if (fromLang === toLang) return text;

  const key = `${fromLang}:${toLang}:${text}`;
  const cached = get('SELECT value FROM translations_cache WHERE key = ?', [key]);
  if (cached) return cached.value;

  const ollamaHost = config.OLLAMA_HOST;
  logger.info({ fromLang, toLang, text: text.substring(0, 50) + '...' }, 'Requesting translation');
  try {
    const response = await fetch(`${ollamaHost}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        model: 'gemmatranslate4b',
        stream: false,
        prompt: `Translate the following text from ${langNames[fromLang]} to ${langNames[toLang]}.
Return ONLY the translation, nothing else. No explanation, no quotes.

Text: ${text}`,
      }),
    });

    if (!response.ok) throw new Error(`Ollama returned status ${response.status}`);

    const data = await response.json();
    const translated = data.response.trim();

    run(
      'INSERT OR REPLACE INTO translations_cache (key, value, fromLang, toLang, createdAt) VALUES (?, ?, ?, ?, ?)',
      [key, translated, fromLang, toLang, new Date().toISOString()]
    );

    return translated;
  } catch (err) {
    logger.error({ err: err.message }, 'Ollama translation failed');
    return '(translation unavailable)';
  }
}
