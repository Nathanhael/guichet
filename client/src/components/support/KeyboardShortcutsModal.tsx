import { useT } from '../../i18n';
import Modal, { ModalHeader, ModalBody } from '../ui/Modal';
import SectionLabel from '../ui/SectionLabel';

interface Shortcut {
  labelKey: string;
  keys: string[];
}

interface Group {
  titleKey: string;
  shortcuts: Shortcut[];
}

const GROUPS: Group[] = [
  {
    titleKey: 'cmd_group_palette',
    shortcuts: [
      { labelKey: 'cmd_open_palette', keys: ['Ctrl', 'K'] },
      { labelKey: 'cmd_open_palette', keys: ['?'] },
    ],
  },
  {
    titleKey: 'cmd_group_navigation',
    shortcuts: [
      { labelKey: 'cmd_focus_message', keys: ['/'] },
      { labelKey: 'cmd_next_tab', keys: ['Ctrl', '\u2193'] },
      { labelKey: 'cmd_prev_tab', keys: ['Ctrl', '\u2191'] },
      { labelKey: 'cmd_toggle_sidebar', keys: ['Ctrl', 'B'] },
      { labelKey: 'cmd_jump_to_tab_1', keys: ['Ctrl', '1'] },
      { labelKey: 'cmd_jump_to_tab_2', keys: ['Ctrl', '2'] },
      { labelKey: 'cmd_jump_to_tab_3', keys: ['Ctrl', '3'] },
      { labelKey: 'cmd_jump_to_tab_4', keys: ['Ctrl', '4'] },
      { labelKey: 'cmd_prev_unread', keys: ['Alt', '\u2191'] },
      { labelKey: 'cmd_next_unread', keys: ['Alt', '\u2193'] },
      { labelKey: 'cmd_search_messages', keys: ['Ctrl', 'F'] },
    ],
  },
  {
    titleKey: 'cmd_group_actions',
    shortcuts: [
      { labelKey: 'cmd_toggle_whisper', keys: ['Ctrl', '/'] },
      { labelKey: 'cmd_transfer_ticket', keys: ['Alt', 'T'] },
      { labelKey: 'cmd_close_tab', keys: ['Alt', 'W'] },
      { labelKey: 'cmd_close_ticket', keys: ['Ctrl', 'Enter'] },
      { labelKey: 'cmd_open_label_picker', keys: ['Ctrl', 'L'] },
      { labelKey: 'cmd_open_canned', keys: ['Ctrl', 'J'] },
    ],
  },
  {
    titleKey: 'cmd_group_status',
    shortcuts: [
      { labelKey: 'cmd_open_status_picker', keys: ['Ctrl', '.'] },
    ],
  },
  {
    titleKey: 'cmd_group_view',
    shortcuts: [
      { labelKey: 'cmd_toggle_focus', keys: ['Ctrl', 'Shift', 'F'] },
      { labelKey: 'cmd_toggle_customer_info', keys: ['Ctrl', 'Shift', 'A'] },
      { labelKey: 'cmd_exit_focus', keys: ['Esc'] },
    ],
  },
];

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  const t = useT();

  return (
    <Modal open={open} onClose={onClose} id="keyboard-shortcuts" maxWidth={560}>
      <ModalHeader
        onClose={onClose}
        title={t('keyboard_shortcuts') || 'Keyboard shortcuts'}
        subtitle={t('keyboard_shortcuts_subtitle') || 'Press Ctrl+K to run any command from the palette.'}
      />
      <ModalBody className="pb-5 max-h-[60vh] overflow-y-auto custom-scrollbar">
        <div className="flex flex-col gap-5">
          {GROUPS.map((group) => (
            <section key={group.titleKey} className="flex flex-col gap-1.5">
              <SectionLabel as="h3">{t(group.titleKey) || group.titleKey}</SectionLabel>
              <ul className="flex flex-col divide-y divide-[var(--color-border)]">
                {group.shortcuts.map((s, i) => (
                  <li
                    key={`${group.titleKey}-${s.labelKey}-${i}`}
                    className="flex items-center justify-between gap-4 py-2"
                  >
                    <span className="text-[13px] text-[var(--color-ink)]">
                      {t(s.labelKey) || s.labelKey}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      {s.keys.map((k, idx) => (
                        <kbd
                          key={`${k}-${idx}`}
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[var(--color-ink-muted)] select-none"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </ModalBody>
    </Modal>
  );
}
