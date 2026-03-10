import { get, run, query } from '../db.js';
import config from '../config.js';
import logger from '../utils/logger.js';

const MODEL = config.OLLAMA_MODEL || 'gemmatranslate4b';

export async function getLLMSummary(periodType, periodValue) {
    const periodKey = `${periodType}:${periodValue}`;

    // Check cache first
    const cached = get('SELECT * FROM llm_summaries WHERE period = ?', [periodKey]);
    if (cached) {
        return {
            sentiment: cached.sentiment,
            questions: JSON.parse(cached.questions || '[]'),
            summary: cached.summary,
            updatedAt: cached.updatedAt
        };
    }

    // If not cached, generate it
    return await generateLLMSummary(periodType, periodValue);
}

async function generateLLMSummary(periodType, periodValue) {
    const periodKey = `${periodType}:${periodValue}`;
    logger.info({ periodKey }, 'Generating LLM summary');

    // 1. Fetch messages for the period
    let messages;
    if (periodType === 'day') {
        messages = await getMessagesForDay(periodValue);
    } else if (periodType === 'week') {
        messages = await getMessagesForWeek(periodValue);
    } else if (periodType === 'month') {
        messages = await getMessagesForMonth(periodValue);
    }

    if (!messages || messages.length === 0) {
        return { sentiment: 'No data', questions: [], summary: 'No tickets found for this period.', updatedAt: new Date().toISOString() };
    }

    // 2. Prepare text for LLM
    const textToAnalyze = messages
        .map(m => `${m.senderName}: ${m.processedText || m.text || ''}`)
        .join('\n')
        .slice(0, 4000);

    // 3. Call Ollama
    try {
        const ollamaHost = config.OLLAMA_HOST;
        const response = await fetch(`${ollamaHost}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                stream: false,
                format: 'json',
                prompt: `Analyze the following support ticket messages:
        
${textToAnalyze}

Return a JSON object with these keys: "sentiment", "top3Questions" (array of exactly 3 strings), "summary".
Sentiment should be one of: Positive, Neutral, Negative, Frustrated, Mixed.
Summary should be 1-2 sentences focusing on what agents are struggling with.`,
            }),
        });

        const data = await response.json();
        let result;
        const rawResponse = data.response;

        try {
            const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON object found in response');
            result = JSON.parse(jsonMatch[0]);

            if (!result.sentiment || !result.summary) {
                throw new Error('Missing required keys in LLM response');
            }
            result.top3Questions = Array.isArray(result.top3Questions) ? result.top3Questions.slice(0, 3) : [];
        } catch (e) {
            logger.error({ err: e.message, response: rawResponse }, 'Failed to parse LLM JSON response');
            result = {
                sentiment: 'Mixed',
                top3Questions: [],
                summary: 'The AI provided a complex response that could not be summarized.'
            };
        }

        // 4. Cache it
        run(
            'INSERT OR REPLACE INTO llm_summaries (period, sentiment, questions, summary, updatedAt) VALUES (?, ?, ?, ?, ?)',
            [periodKey, result.sentiment, JSON.stringify(result.top3Questions), result.summary, new Date().toISOString()]
        );

        return { ...result, questions: result.top3Questions, updatedAt: new Date().toISOString() };
    } catch (err) {
        logger.error({ err: err.message }, 'LLM generation failed');
        return { sentiment: 'Error', questions: [], summary: 'AI summary currently unavailable.', updatedAt: new Date().toISOString() };
    }
}

async function getMessagesForDay(date) {
    return query('SELECT text, processedText, senderName FROM messages WHERE substr(createdAt, 1, 10) = ? AND system = 0 AND whisper = 0', [date]);
}

async function getMessagesForWeek(weekStr) {
    return query("SELECT text, processedText, senderName FROM messages WHERE strftime('%Y-%W', createdAt) = ? AND system = 0 AND whisper = 0", [weekStr]);
}

async function getMessagesForMonth(monthStr) {
    return query('SELECT text, processedText, senderName FROM messages WHERE substr(createdAt, 1, 7) = ? AND system = 0 AND whisper = 0', [monthStr]);
}

export async function summarizeConversation(ticketId) {
    logger.info({ ticketId }, 'Summarizing conversation');
    
    const messages = query(
        'SELECT senderName, originalText FROM messages WHERE ticketId = ? AND system = 0 AND whisper = 0 ORDER BY timestamp ASC',
        [ticketId]
    );

    if (!messages || messages.length === 0) {
        return 'No conversation recorded.';
    }

    const textToAnalyze = messages
        .map(m => `${m.senderName}: ${m.originalText}`)
        .join('\n')
        .slice(0, 4000);

    const start = Date.now();
    try {
        const ollamaHost = config.OLLAMA_HOST;
        const response = await fetch(`${ollamaHost}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                stream: false,
                prompt: `Summarize the following support chat between a customer agent and an expert. 
Focus on the technical problem and the final resolution. 
Be concise (2-3 sentences max).
Return ONLY the summary, no preamble.

Chat:
${textToAnalyze}`,
            }),
        });

        if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);

        const data = await response.json();
        const summary = data.response?.trim();
        const duration = Date.now() - start;

        logger.info({ ticketId, duration }, 'Conversation summary generated');

        if (!summary) throw new Error('Ollama returned empty summary');

        run('UPDATE tickets SET summary = ? WHERE id = ?', [summary, ticketId]);
        return summary;
    } catch (err) {
        logger.error({ ticketId, err: err.message }, 'Failed to summarize conversation');
        return 'Summary unavailable.';
    }
}
