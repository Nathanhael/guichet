import React from 'react';
import type { Editor } from '@tiptap/react';
import { Bold, Italic, Strikethrough, Code, Quote, List } from 'lucide-react';

interface FormatToolbarProps {
  /** Tiptap editor instance. Each format button drives an editor command
   *  via chain().focus().toggle…().run(), with the button's active state
   *  reflecting editor.isActive(mark). */
  editor: Editor | null;
}

type IconComponent = React.ComponentType<{ className?: string; strokeWidth?: number }>;

interface FormatAction {
  title: string;
  Icon: IconComponent;
  /** Tiptap mark/node name to check for active state. */
  activeKey: string;
  /** Toggle command to run when the button is clicked. */
  run: (editor: Editor) => void;
}

const FORMAT_ACTIONS: FormatAction[] = [
  {
    title: 'Bold',
    Icon: Bold,
    activeKey: 'bold',
    run: (editor) => { editor.chain().focus().toggleBold().run(); },
  },
  {
    title: 'Italic',
    Icon: Italic,
    activeKey: 'italic',
    run: (editor) => { editor.chain().focus().toggleItalic().run(); },
  },
  {
    title: 'Strikethrough',
    Icon: Strikethrough,
    activeKey: 'strike',
    run: (editor) => { editor.chain().focus().toggleStrike().run(); },
  },
  {
    title: 'Code',
    Icon: Code,
    activeKey: 'code',
    run: (editor) => { editor.chain().focus().toggleCode().run(); },
  },
  {
    title: 'Blockquote',
    Icon: Quote,
    activeKey: 'blockquote',
    run: (editor) => { editor.chain().focus().toggleBlockquote().run(); },
  },
  {
    title: 'List',
    Icon: List,
    activeKey: 'bulletList',
    run: (editor) => { editor.chain().focus().toggleBulletList().run(); },
  },
];

export default function FormatToolbar({ editor }: FormatToolbarProps) {
  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
      {FORMAT_ACTIONS.map((action) => {
        const { Icon } = action;
        const isActive = editor?.isActive(action.activeKey) ?? false;
        return (
          <button
            key={action.title}
            type="button"
            title={action.title}
            aria-label={action.title}
            aria-pressed={isActive}
            disabled={!editor}
            onClick={() => editor && action.run(editor)}
            className={`w-7 h-7 flex items-center justify-center rounded-[var(--radius-btn)] transition-colors ${
              isActive
                ? 'text-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-hover)]'
            } disabled:opacity-40`}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        );
      })}
      {/* Dimmed keyboard hint rail — takes the remaining space so the cluster sits on the right edge. */}
      <div className="flex-1" />
      <div className="flex items-center gap-3 pr-1 text-[10px] text-[var(--color-ink-muted)] select-none">
        <span className="hidden sm:inline-flex items-center gap-1">
          <kbd className="inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] font-mono text-[10px]">Ctrl+V</kbd>
          paste
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] font-mono text-[10px]">⏎</kbd>
          send
        </span>
      </div>
    </div>
  );
}
