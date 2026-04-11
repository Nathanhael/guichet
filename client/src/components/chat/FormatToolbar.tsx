import React from 'react';
import { Bold, Italic, Strikethrough, Code, Quote, List } from 'lucide-react';

interface FormatToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onTextChange: (newText: string) => void;
  getText: () => string;
}

type IconComponent = React.ComponentType<{ className?: string; strokeWidth?: number }>;

interface FormatAction {
  title: string;
  Icon: IconComponent;
  apply: (text: string, start: number, end: number) => { newText: string; cursorStart: number; cursorEnd: number };
}

const FORMAT_ACTIONS: FormatAction[] = [
  {
    title: 'Bold',
    Icon: Bold,
    apply: (text, start, end) => {
      const selected = text.slice(start, end);
      const wrapped = `**${selected}**`;
      const newText = text.slice(0, start) + wrapped + text.slice(end);
      return {
        newText,
        cursorStart: selected ? start : start + 2,
        cursorEnd: selected ? start + wrapped.length : start + 2,
      };
    },
  },
  {
    title: 'Italic',
    Icon: Italic,
    apply: (text, start, end) => {
      const selected = text.slice(start, end);
      const wrapped = `*${selected}*`;
      const newText = text.slice(0, start) + wrapped + text.slice(end);
      return {
        newText,
        cursorStart: selected ? start : start + 1,
        cursorEnd: selected ? start + wrapped.length : start + 1,
      };
    },
  },
  {
    title: 'Strikethrough',
    Icon: Strikethrough,
    apply: (text, start, end) => {
      const selected = text.slice(start, end);
      const wrapped = `~~${selected}~~`;
      const newText = text.slice(0, start) + wrapped + text.slice(end);
      return {
        newText,
        cursorStart: selected ? start : start + 2,
        cursorEnd: selected ? start + wrapped.length : start + 2,
      };
    },
  },
  {
    title: 'Code',
    Icon: Code,
    apply: (text, start, end) => {
      const selected = text.slice(start, end);
      const wrapped = `\`${selected}\``;
      const newText = text.slice(0, start) + wrapped + text.slice(end);
      return {
        newText,
        cursorStart: selected ? start : start + 1,
        cursorEnd: selected ? start + wrapped.length : start + 1,
      };
    },
  },
  {
    title: 'Blockquote',
    Icon: Quote,
    apply: (text, start, _end) => {
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const newText = text.slice(0, lineStart) + '> ' + text.slice(lineStart);
      return {
        newText,
        cursorStart: start + 2,
        cursorEnd: start + 2,
      };
    },
  },
  {
    title: 'List',
    Icon: List,
    apply: (text, start, _end) => {
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const newText = text.slice(0, lineStart) + '- ' + text.slice(lineStart);
      return {
        newText,
        cursorStart: start + 2,
        cursorEnd: start + 2,
      };
    },
  },
];

export default function FormatToolbar({ textareaRef, onTextChange, getText }: FormatToolbarProps) {
  function handleAction(action: FormatAction) {
    const ta = textareaRef.current;
    if (!ta) return;
    const text = getText();
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const result = action.apply(text, start, end);
    onTextChange(result.newText);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = result.cursorStart;
      ta.selectionEnd = result.cursorEnd;
    });
  }

  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-border">
      {FORMAT_ACTIONS.map((action) => {
        const { Icon } = action;
        return (
          <button
            key={action.title}
            type="button"
            title={action.title}
            aria-label={action.title}
            onClick={() => handleAction(action)}
            className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-surface border border-transparent hover:border-border-heavy"
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
          </button>
        );
      })}
      {/* Dimmed keyboard hint rail — takes the remaining space so the cluster
          sits on the right edge, matching the brutalist mono chrome. */}
      <div className="flex-1" />
      <div className="flex items-center gap-3 pr-1 font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-text-muted opacity-50 select-none">
        <span className="hidden sm:inline-flex items-center gap-1">
          <kbd className="inline-flex items-center px-1 border border-border">Ctrl+V</kbd>
          paste
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="inline-flex items-center px-1 border border-border">⏎</kbd>
          send
        </span>
      </div>
    </div>
  );
}
