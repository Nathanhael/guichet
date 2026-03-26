import { useState, useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { Ticket } from '../../types';
import {
  Sparkles,
  ChevronRight,
  ChevronLeft,
  BookOpen,
  TrendingUp,
  TrendingDown,
  Minus,
  FileText,
  RefreshCw,
  Search,
  Copy,
  Check,
  Brain,
} from 'lucide-react';

interface Props {
  ticket: Ticket;
}

export default function AiCopilotSidebar({ ticket }: Props) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [kbQuery, setKbQuery] = useState('');
  const [kbSearchTrigger, setKbSearchTrigger] = useState('');

  // AI Summary
  const summaryMutation = trpc.ai.summarizeChat.useMutation();

  // Sentiment
  const sentimentQuery = trpc.ai.getTicketSentiment.useQuery(
    { ticketId: ticket.id },
    { refetchInterval: 60000 }
  );

  // KB search (triggered by user)
  const kbResults = trpc.kb.search.useQuery(
    { query: kbSearchTrigger },
    { enabled: !!kbSearchTrigger }
  );

  // KB AI search (for auto-suggestions based on ticket context)
  const autoQuery = ticket.dept ? `${ticket.dept} ${ticket.agentName}` : ticket.agentName;
  const kbAutoSuggest = trpc.kb.search.useQuery(
    { query: autoQuery },
    { enabled: !!autoQuery }
  );

  // Auto-summarize when ticket changes
  useEffect(() => {
    summaryMutation.mutate({ ticketId: ticket.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => { /* clipboard access denied */ });
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const doKbSearch = () => {
    if (kbQuery.trim()) setKbSearchTrigger(kbQuery.trim());
  };

  if (collapsed) {
    return (
      <div className="w-10 border-l-2 border-black dark:border-white flex flex-col items-center pt-3 bg-black/[0.02] dark:bg-white/[0.02]">
        <button
          onClick={() => setCollapsed(false)}
          className="p-1.5 hover:bg-black/10 dark:hover:bg-white/10"
          title="Open AI Copilot"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="mt-3 writing-mode-vertical">
          <Sparkles className="h-4 w-4 text-amber-500 mx-auto mb-2" />
        </div>
      </div>
    );
  }

  const sentiment = sentimentQuery.data;
  const SentimentIcon = sentiment?.trend === 'improving' ? TrendingUp
    : sentiment?.trend === 'worsening' ? TrendingDown
    : Minus;

  const sentimentColor = sentiment?.trend === 'improving' ? 'text-emerald-600 dark:text-emerald-400'
    : sentiment?.trend === 'worsening' ? 'text-rose-600 dark:text-rose-400'
    : 'opacity-60';

  return (
    <aside className="w-72 border-l-2 border-black dark:border-white flex flex-col overflow-hidden bg-white dark:bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b-2 border-black dark:border-white bg-black/5 dark:bg-white/5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <span className="text-[10px] font-black uppercase tracking-widest">{t('ai_copilot')}</span>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 hover:bg-black/10 dark:hover:bg-white/10"
          title="Collapse"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4">
        {/* Sentiment */}
        {sentiment && sentiment.count > 0 && (
          <section>
            <h3 className="text-[9px] font-black uppercase tracking-widest opacity-40 mb-2">{t('ai_sentiment')}</h3>
            <div className="flex items-center gap-2 border-2 border-black/20 dark:border-white/20 p-2.5">
              <SentimentIcon className={`h-5 w-5 ${sentimentColor}`} />
              <div>
                <div className={`text-lg font-black ${sentimentColor}`}>
                  {sentiment.average.toFixed(1)}
                </div>
                <div className="text-[8px] font-bold uppercase tracking-widest opacity-40">
                  {sentiment.trend} · {sentiment.count} messages
                </div>
              </div>
            </div>
          </section>
        )}

        {/* AI Summary */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[9px] font-black uppercase tracking-widest opacity-40">{t('ai_summary')}</h3>
            <button
              onClick={() => summaryMutation.mutate({ ticketId: ticket.id, refresh: true })}
              disabled={summaryMutation.isPending}
              className="p-1 hover:bg-black/10 dark:hover:bg-white/10"
              title="Refresh summary"
            >
              <RefreshCw className={`h-3 w-3 ${summaryMutation.isPending ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="border-2 border-black/20 dark:border-white/20 p-2.5">
            {summaryMutation.isPending ? (
              <div className="flex items-center gap-2 text-xs opacity-40">
                <Brain className="h-3.5 w-3.5 animate-pulse" />
                <span className="font-bold uppercase tracking-widest text-[9px]">{t('ai_analyzing')}</span>
              </div>
            ) : summaryMutation.data?.summary ? (
              <p className="text-xs leading-relaxed opacity-80">{summaryMutation.data.summary}</p>
            ) : summaryMutation.error ? (
              <p className="text-xs opacity-40 italic">{t('ai_unavailable')}</p>
            ) : (
              <p className="text-xs opacity-40 italic">{t('ai_no_summary')}</p>
            )}
          </div>
        </section>

        {/* KB Articles — Auto-suggested */}
        {kbAutoSuggest.data && kbAutoSuggest.data.length > 0 && (
          <section>
            <h3 className="text-[9px] font-black uppercase tracking-widest opacity-40 mb-2">
              <BookOpen className="h-3 w-3 inline mr-1" />
              Suggested Articles
            </h3>
            <div className="space-y-1.5">
              {kbAutoSuggest.data.slice(0, 3).map((article) => (
                <div
                  key={article.id}
                  className="border border-black/20 dark:border-white/20 p-2 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer group"
                  onClick={() => copyToClipboard(article.body, article.id)}
                  title="Click to copy article body"
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-[10px] font-bold leading-tight">{article.title}</span>
                    {copiedId === article.id ? (
                      <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                    ) : (
                      <Copy className="h-3 w-3 opacity-0 group-hover:opacity-40 shrink-0" />
                    )}
                  </div>
                  <p className="text-[9px] opacity-50 mt-0.5 line-clamp-2">{article.body}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* KB Search */}
        <section>
          <h3 className="text-[9px] font-black uppercase tracking-widest opacity-40 mb-2">
            <Search className="h-3 w-3 inline mr-1" />
            Search Knowledge Base
          </h3>
          <div className="flex gap-1">
            <input
              type="text"
              value={kbQuery}
              onChange={(e) => setKbQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doKbSearch()}
              placeholder="Search articles..."
              className="flex-1 border-2 border-black dark:border-white bg-transparent px-2 py-1.5 text-[10px] font-bold placeholder:opacity-30 outline-none"
            />
            <button
              onClick={doKbSearch}
              disabled={!kbQuery.trim()}
              className="px-2 py-1.5 bg-black dark:bg-white text-white dark:text-black text-[9px] font-black uppercase disabled:opacity-50"
            >
              Go
            </button>
          </div>
          {kbResults.data && kbResults.data.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {kbResults.data.slice(0, 5).map((article) => (
                <div
                  key={article.id}
                  className="border border-black/20 dark:border-white/20 p-2 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer group"
                  onClick={() => copyToClipboard(article.body, `search-${article.id}`)}
                  title="Click to copy article body"
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-[10px] font-bold leading-tight">{article.title}</span>
                    {copiedId === `search-${article.id}` ? (
                      <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                    ) : (
                      <Copy className="h-3 w-3 opacity-0 group-hover:opacity-40 shrink-0" />
                    )}
                  </div>
                  <p className="text-[9px] opacity-50 mt-0.5 line-clamp-2">{article.body}</p>
                </div>
              ))}
            </div>
          )}
          {kbResults.data && kbResults.data.length === 0 && kbSearchTrigger && (
            <p className="text-[9px] opacity-40 mt-2 italic">No articles found</p>
          )}
        </section>

        {/* Quick Tips */}
        <section>
          <h3 className="text-[9px] font-black uppercase tracking-widest opacity-40 mb-2">
            <FileText className="h-3 w-3 inline mr-1" />
            Quick Tips
          </h3>
          <div className="space-y-1.5 text-[9px] opacity-60">
            <div className="border border-black/10 dark:border-white/10 p-2">
              <span className="font-bold">Type /</span> in the message box to use canned responses
            </div>
            <div className="border border-black/10 dark:border-white/10 p-2">
              <span className="font-bold">Sparkle button</span> improves message tone with AI
            </div>
            {sentiment && sentiment.trend === 'worsening' && (
              <div className="border border-rose-500/30 bg-rose-500/5 p-2 text-rose-700 dark:text-rose-300">
                <span className="font-bold">Sentiment dropping</span> — consider acknowledging the customer's frustration
              </div>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
