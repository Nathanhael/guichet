import { get, run, query } from '../db.js';
import config from '../config.js';
import logger from '../utils/logger.js';

interface OllamaResponse {
    response: string;
}

interface LLMParsedResult {
    sentiment: string;
    top3Questions: string[];
    summary: string;
}

interface MessageRow {
    text: string;
    processedText: string | null;
    senderName: string;
}

interface ConversationMessageRow {
    senderName: string;
    originalText: string;
}

const MODEL = config.OLLAMA_MODEL || 'gemmatranslate4b';

export interface LLMSummaryResult {
    sentiment: string;
    questions: string[];
    summary: string;
    updatedAt: string;
}

export async function getLLMSummary(periodType: string, periodValue: string): Promise<LLMSummaryResult> {
    const periodKey = `${periodType}:${periodValue}`;

    const cached = await get('SELECT * FROM llm_summaries WHERE period = $1', [periodKey]);
    if (cached) {
        return {
            sentiment: cached.sentiment,
            questions: JSON.parse(cached.questions || '[]'),
            summary: cached.summary,
            updatedAt: cached.updated_at
        };
    }

    return await generateLLMSummary(periodType, periodValue);
}

async function generateLLMSummary(periodType: string, periodValue: string): Promise<LLMSummaryResult> {
    const periodKey = `${periodType}:${periodValue}`;
    logger.info({ periodKey }, 'Generating LLM summary');

    let messages: MessageRow[] = [];
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

    const textToAnalyze = messages
        .map(m => `${m.senderName}: ${m.processedText || m.text || ''}`)
        .join('\n')
        .slice(0, 4000);

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

        const data = await response.json() as OllamaResponse;
        let result: LLMParsedResult;
        const rawResponse = data.response;

        try {
            const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON object found in response');
            result = JSON.parse(jsonMatch[0]);

            if (!result.sentiment || !result.summary) {
                throw new Error('Missing required keys in LLM response');
            }
            result.top3Questions = Array.isArray(result.top3Questions) ? result.top3Questions.slice(0, 3) : [];
        } catch (e: unknown) {
            logger.error({ err: e instanceof Error ? e.message : String(e), response: rawResponse }, 'Failed to parse LLM JSON response');
            result = {
                sentiment: 'Mixed',
                top3Questions: [],
                summary: 'The AI provided a complex response that could not be summarized.'
            };
        }

        await run(
            'INSERT INTO llm_summaries (period, sentiment, questions, summary, updated_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (period) DO UPDATE SET sentiment = EXCLUDED.sentiment, questions = EXCLUDED.questions, summary = EXCLUDED.summary, updated_at = EXCLUDED.updated_at',
            [periodKey, result.sentiment, JSON.stringify(result.top3Questions), result.summary, new Date().toISOString()]
        );

        return { sentiment: result.sentiment, questions: result.top3Questions, summary: result.summary, updatedAt: new Date().toISOString() };
    } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'LLM generation failed');
        return { sentiment: 'Error', questions: [], summary: 'AI summary currently unavailable.', updatedAt: new Date().toISOString() };
    }
}

async function getMessagesForDay(date: string): Promise<MessageRow[]> {
    return query('SELECT text, translated_text as "processedText", sender_name as "senderName" FROM messages WHERE created_at::date = $1 AND system = 0 AND whisper = 0', [date]) as Promise<MessageRow[]>;
}

async function getMessagesForWeek(weekStr: string): Promise<MessageRow[]> {
    return query(`SELECT text, translated_text as "processedText", sender_name as "senderName" FROM messages WHERE to_char(created_at, 'YYYY-WW') = $1 AND system = 0 AND whisper = 0`, [weekStr]) as Promise<MessageRow[]>;
}

async function getMessagesForMonth(monthStr: string): Promise<MessageRow[]> {
    return query('SELECT text, translated_text as "processedText", sender_name as "senderName" FROM messages WHERE created_at::text LIKE $1 AND system = 0 AND whisper = 0', [`${monthStr}%`]) as Promise<MessageRow[]>;
}

export async function summarizeConversation(ticketId: string): Promise<string> {
    logger.info({ ticketId }, 'Summarizing conversation');
    
    const messages = await query(
        'SELECT sender_name as "senderName", text as "originalText" FROM messages WHERE ticket_id = $1 AND system = 0 AND whisper = 0 ORDER BY created_at ASC',
        [ticketId]
    ) as ConversationMessageRow[];

    if (!messages || messages.length === 0) {
        return 'No conversation recorded.';
    }

    const textToAnalyze = messages
        .map((m) => `${m.senderName}: ${m.originalText}`)
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

        const data = await response.json() as OllamaResponse;
        const summary = data.response?.trim();
        const duration = Date.now() - start;

        logger.info({ ticketId, duration }, 'Conversation summary generated');

        if (!summary) throw new Error('Ollama returned empty summary');

        await run('UPDATE tickets SET summary = $1 WHERE id = $2', [summary, ticketId]);
        return summary;
    } catch (err: unknown) {
        logger.error({ ticketId, err: err instanceof Error ? err.message : String(err) }, 'Failed to summarize conversation');
        return 'Summary unavailable.';
    }
}
