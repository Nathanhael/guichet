import React from 'react';

interface FormatToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onTextChange: (newText: string) => void;
  getText: () => string;
}

interface FormatAction {
  label: string;
  title: string;
  apply: (text: string, start: number, end: number) => { newText: string; cursorStart: number; cursorEnd: number };
}

const FORMAT_ACTIONS: FormatAction[] = [
  {
    label: 'B',
    title: 'Bold',
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
    label: 'I',
    title: 'Italic',
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
    label: '</>',
    title: 'Code',
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
    label: '""',
    title: 'Blockquote',
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
    label: '\u2022',
    title: 'List',
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
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border bg-bg-elevated">
      {FORMAT_ACTIONS.map((action) => (
        <button
          key={action.title}
          type="button"
          title={action.title}
          onClick={() => handleAction(action)}
          className="px-1.5 py-0.5 font-mono text-[10px] text-text-secondary hover:text-text-primary hover:bg-bg-surface"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
