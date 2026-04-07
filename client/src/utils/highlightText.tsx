import React from 'react';

/**
 * Wraps all occurrences of `query` in `text` with <mark> elements.
 * Case-insensitive. Returns an array of React nodes.
 * If query is empty or not found, returns the original text as-is.
 */
export function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  if (parts.length === 1) return text; // no match

  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i}>{part}</mark>
      : part
  );
}
