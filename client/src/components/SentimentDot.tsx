interface SentimentDotProps {
  score: number;
  compact?: boolean;
}

/**
 * Small colored dot indicating ticket sentiment.
 * Green (>= 0.3), amber (-0.3 to 0.3), red (< -0.3).
 * Optional tooltip with score on hover.
 */
export default function SentimentDot({ score, compact }: SentimentDotProps) {
  const color =
    score >= 0.3
      ? 'bg-emerald-500'
      : score >= -0.3
        ? 'bg-amber-400'
        : 'bg-rose-500';

  const label =
    score >= 0.3 ? 'Positive' : score >= -0.3 ? 'Neutral' : 'Negative';

  const size = compact ? 'w-2 h-2' : 'w-2.5 h-2.5';

  return (
    <span
      className={`inline-block ${size} rounded-full ${color} shrink-0`}
      title={`Sentiment: ${score.toFixed(2)} (${label})`}
    />
  );
}
