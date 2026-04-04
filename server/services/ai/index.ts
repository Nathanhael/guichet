// ─── AI Service Layer — Public API ──────────────────────────────────────────
//
// Usage:
//   import { getProvider, isAiEnabled, logUsage, checkRateLimit, getPromptTemplate, interpolate } from '../services/ai/index.js';
//
//   if (await isAiEnabled(partnerId)) {
//     const limit = await checkRateLimit(partnerId);
//     if (!limit.allowed) throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
//
//     const provider = await getProvider(partnerId);
//     const template = await getPromptTemplate('improve', partnerId);
//     const prompt = interpolate(template, { text: userInput });
//
//     const start = Date.now();
//     const result = await provider.chat({ model: 'default', messages: [{ role: 'user', content: prompt }] });
//     await logUsage({ partnerId, userId, action: 'improve', provider: provider.name, model: result.model, ...result, latencyMs: Date.now() - start, success: true });
//   }

export type { AiProvider, ChatParams, ChatResult, AiAction, AiUsageEntry, PartnerAiConfig, ImprovementMode } from './types.js';
export { getProvider, isAiEnabled, clearProviderCache } from './factory.js';
export { checkRateLimit, getUsageCounts } from './rateLimit.js';
export { logUsage } from './usage.js';
export { getPromptTemplate, interpolate } from './prompts.js';
export { getPartnerAiConfig, isFeatureEnabled } from './config.js';
export { getCachedSummary, setCachedSummary, invalidateSummary } from './summaryCache.js';
export { formatMessagesForAi } from './messageFormatter.js';
export { verifyTicketOwnership, fetchTicketMessages } from './ticketMessages.js';
export { runAiAction } from './runAction.js';
export { autoSummarizeOnClose } from './autoSummarize.js';
export { scoreSentiment } from './sentiment.js';
export type { AiSchema } from './context.js';
export { initAiContext, getAiContext } from './context.js';
