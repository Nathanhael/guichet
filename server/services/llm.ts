import { get, run, query } from '../db.js';
import config from '../config.js';
import logger from '../utils/logger.js';
import { getLLMProvider } from './llm/factory.js';

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

export interface LLMSummaryResult {
    sentiment: string;
    questions: string[];
    summary: string;
    updatedAt: string;
}

export async function getLLMSummary(periodType: string, periodValue: string, partnerId: string): Promise<LLMSummaryResult> {
    const periodKey = `${periodType}:${periodValue}`;
    logger.info({ periodKey, partnerId }, 'Generating LLM summary');

    try {
        const existing = await get('SELECT * FROM llm_summaries WHERE period = $1 AND partner_id = $2', [periodKey, partnerId]) as any;
        if (existing) {
            const updatedAt = new Date(existing.updated_at);
            const now = new Date();
            const diffMs = now.getTime() - updatedAt.getTime();
            if (diffMs < 30 * 60 * 1000) { // 30 min cache
                return { 
                    sentiment: existing.sentiment, 
                    questions: JSON.parse(existing.questions || '[]'), 
                    summary: existing.summary, 
                    updatedAt: existing.updated_at 
                };
            }
        }

        let messages: MessageRow[] = [];
        if (periodType === 'day') {
            messages = await getMessagesForDay(periodValue, partnerId);
        } else if (periodType === 'week') {
            messages = await getMessagesForWeek(periodValue, partnerId);
        } else if (periodType === 'month') {
            messages = await getMessagesForMonth(periodValue, partnerId);
        }

        if (!messages || messages.length === 0) {
            return { sentiment: 'No data', questions: [], summary: 'No tickets found for this period.', updatedAt: new Date().toISOString() };
        }

        const partner = await get('SELECT * FROM partners WHERE id = $1', [partnerId]) as any;
        const aiRules = partner?.ai_rules || 'You are a professional support specialist.';

        const textToAnalyze = messages
            .map(m => `${m.senderName}: ${m.processedText || m.text || ''}`)
            .join('\n')
            .slice(0, 4000);

        const prompt = `${aiRules}
        Analyze the following support ticket messages for the ${partner?.industry || 'general'} industry:
        
${textToAnalyze}

Return a JSON object with these keys: "sentiment", "top3Questions" (array of exactly 3 strings), "summary".
Sentiment should be one of: Positive, Neutral, Negative, Frustrated, Mixed.
Summary should be 1-2 sentences focusing on what agents are struggling with.`;

        const provider = getLLMProvider();
        let result: LLMParsedResult;

        try {
            result = await provider.generateJSON<LLMParsedResult>(prompt, { type: 'summarize', model: partner.ollama_model });
            
            if (!result.sentiment || !result.summary) {
                throw new Error('Missing required keys in LLM response');
            }
            result.top3Questions = Array.isArray(result.top3Questions) ? result.top3Questions.slice(0, 3) : [];
        } catch (e: unknown) {
            logger.error({ err: e instanceof Error ? e.message : String(e) }, 'Failed to parse LLM JSON response');
            result = {
                sentiment: 'Mixed',
                top3Questions: [],
                summary: 'The AI provided a complex response that could not be summarized.'
            };
        }

        await run(
            'INSERT INTO llm_summaries (period, partner_id, sentiment, questions, summary, updated_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (period, partner_id) DO UPDATE SET sentiment = EXCLUDED.sentiment, questions = EXCLUDED.questions, summary = EXCLUDED.summary, updated_at = EXCLUDED.updated_at',
            [periodKey, partnerId, result.sentiment, JSON.stringify(result.top3Questions), result.summary, new Date().toISOString()]
        );

        return { sentiment: result.sentiment, questions: result.top3Questions, summary: result.summary, updatedAt: new Date().toISOString() };
    } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'LLM generation failed');
        return { sentiment: 'Error', questions: [], summary: 'AI summary currently unavailable.', updatedAt: new Date().toISOString() };
    }
}

export async function analyzeSentiment(text: string): Promise<number> {
    if (!text || text.length < 5) return 0;

    try {
        const prompt = `Analyze the sentiment of this support message: "${text}"
Return a JSON object with a single key "score" which is a float between -1.0 (Very Negative/Angry) and 1.0 (Very Positive/Happy). 0.0 is Neutral.`;

        const provider = getLLMProvider();
        const result = await provider.generateJSON<{ score: number }>(prompt, { type: 'sentiment' });
        return typeof result.score === 'number' ? result.score : 0;
    } catch (err) {
        logger.error({ err }, 'Sentiment analysis failed');
        return 0;
    }
}

async function getMessagesForDay(date: string, partnerId: string): Promise<MessageRow[]> {
    return (await query('SELECT m.text, m.translated_text as "processedText", m.sender_name as "senderName" FROM messages m JOIN tickets t ON m.ticket_id = t.id WHERE t.created_at::date = $1 AND t.partner_id = $2 AND m.system = 0 AND m.whisper = 0', [date, partnerId])) as unknown as Promise<MessageRow[]>;
}

async function getMessagesForWeek(weekStr: string, partnerId: string): Promise<MessageRow[]> {
    return (await query(`SELECT m.text, m.translated_text as "processedText", m.sender_name as "senderName" FROM messages m JOIN tickets t ON m.ticket_id = t.id WHERE to_char(t.created_at, 'YYYY-WW') = $1 AND t.partner_id = $2 AND m.system = 0 AND m.whisper = 0`, [weekStr, partnerId])) as unknown as Promise<MessageRow[]>;
}

async function getMessagesForMonth(monthStr: string, partnerId: string): Promise<MessageRow[]> {
    return (await query('SELECT m.text, m.translated_text as "processedText", m.sender_name as "senderName" FROM messages m JOIN tickets t ON m.ticket_id = t.id WHERE t.created_at::text LIKE $1 AND t.partner_id = $2 AND m.system = 0 AND m.whisper = 0', [`${monthStr}%`, partnerId])) as unknown as MessageRow[];
}

export async function summarizeConversation(ticketId: string, partnerId: string): Promise<string> {
    logger.info({ ticketId, partnerId }, 'Summarizing conversation');
    
    const messages = (await query(
        'SELECT sender_name as "senderName", text as "originalText" FROM messages WHERE ticket_id = $1 AND system = 0 AND whisper = 0 ORDER BY created_at ASC',
        [ticketId]
    )) as unknown as ConversationMessageRow[];

    if (!messages || messages.length === 0) {
        return 'No conversation recorded.';
    }

    const partner = await get('SELECT industry, ai_rules, ollama_model FROM partners WHERE id = $1', [partnerId]) as any;
    const aiRules = partner?.ai_rules || 'You are a professional support specialist.';

    const textToAnalyze = messages
        .map((m) => `${m.senderName}: ${m.originalText}`)
        .join('\n')
        .slice(0, 4000);

    const start = Date.now();
    try {
        const prompt = `${aiRules}
        Summarize the following support chat between a customer agent and a support specialist for the ${partner?.industry || 'general'} industry. 
        Focus on the technical problem and the final resolution. 
        Be concise (2-3 sentences max).
        Return ONLY the summary, no preamble.

Chat:
${textToAnalyze}`;

        const provider = getLLMProvider();
        const summary = await provider.generate(prompt, { type: 'summarize_ticket', model: partner.ollama_model });
        
        const duration = Date.now() - start;
        logger.info({ ticketId, duration }, 'Conversation summary generated');

        if (!summary) throw new Error('Provider returned empty summary');

        await run('UPDATE tickets SET summary = $1 WHERE id = $2', [summary, ticketId]);
        return summary;
    } catch (err: unknown) {
        logger.error({ ticketId, err: err instanceof Error ? err.message : String(err) }, 'Failed to summarize conversation');
        return 'Summary unavailable.';
    }
}
