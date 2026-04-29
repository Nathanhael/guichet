import { ReactNode, useEffect, useState } from 'react';
import Modal, { ModalHeader, ModalBody, ModalFooter } from './Modal';
import Button from './Button';
import Toast from '../Toast';

/**
 * Tailwind class constants reused by callers that hand-roll a field inside
 * `<FormModal>`'s children. Single source of truth — previously copy-pasted
 * across five platform modal files.
 */
export const FIELD_LABEL = 'block text-[12px] font-medium text-[var(--color-ink-soft)] mb-1.5';
export const INPUT =
  'w-full h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';

/**
 * Minimal mutation interface FormModal depends on. Compatible with tRPC v11's
 * useMutation return shape; keeps test mocks free of tRPC machinery.
 */
export interface MutationLike<TInput, TOutput = unknown> {
  mutate: (input: TInput) => void;
  isPending: boolean;
  isSuccess?: boolean;
  data?: TOutput;
  error?: { message: string } | null;
  reset?: () => void;
}

export interface FormModalProps<TInput, TOutput = unknown> {
  open: boolean;
  onClose: () => void;
  /** Title for the standard header layout. Ignored when `headerSlot` is provided. */
  title?: string;
  /** Subtitle for the standard header layout. Ignored when `headerSlot` is provided. */
  subtitle?: string;
  /** Custom header content. Replaces the standard title+subtitle layout entirely. */
  headerSlot?: ReactNode;
  mutation: MutationLike<TInput, TOutput>;
  /** Build the mutation input from current form state, or return null to abort. */
  onSubmit: () => TInput | null;
  submitLabel: string;
  submitVariant?: 'primary' | 'danger';
  /** Called once after `mutation.isSuccess` transitions true, before invalidate + onClose + reset. */
  onSuccessData?: (data: TOutput) => void;
  /** Called once after `mutation.isSuccess` transitions true; before onClose + reset. */
  invalidate?: () => void;
  /** Caller-owned disabled gate (combined with mutation.isPending). */
  disabled?: boolean;
  maxWidth?: number;
  dismissOnBackdrop?: boolean;
  dismissOnEscape?: boolean;
  id?: string;
  /** Cancel button label. Defaults to "Cancel" — pass a translated string when needed. */
  cancelLabel?: string;
  children: ReactNode;
}

function FormModalImpl<TInput, TOutput = unknown>({
  open,
  onClose,
  title,
  subtitle,
  headerSlot,
  mutation,
  onSubmit,
  submitLabel,
  submitVariant = 'primary',
  onSuccessData,
  invalidate,
  disabled = false,
  maxWidth = 560,
  dismissOnBackdrop,
  dismissOnEscape,
  id,
  cancelLabel = 'Cancel',
  children,
}: FormModalProps<TInput, TOutput>) {
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Mirror error → local toast state. Re-fires when error.message changes (e.g.
  // user retries and gets a different error).
  useEffect(() => {
    if (mutation.error) setToastMessage(mutation.error.message);
    else setToastMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: react only to the error.message edge
  }, [mutation.error?.message]);

  // Success lifecycle: onSuccessData → invalidate → onClose → reset.
  // The reset() call clears mutation.isSuccess so this effect does not re-fire
  // on the next render (which would otherwise re-trigger onClose).
  useEffect(() => {
    if (!mutation.isSuccess) return;
    if (onSuccessData && mutation.data !== undefined) onSuccessData(mutation.data);
    invalidate?.();
    onClose();
    mutation.reset?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: react only to the success edge
  }, [mutation.isSuccess]);

  function handleSubmit() {
    const input = onSubmit();
    if (input === null) return;
    mutation.mutate(input);
  }

  function handleToastClose() {
    setToastMessage(null);
    mutation.reset?.();
  }

  const submitDisabled = disabled || mutation.isPending;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        id={id}
        maxWidth={maxWidth}
        dismissOnBackdrop={dismissOnBackdrop}
        dismissOnEscape={dismissOnEscape}
      >
        <ModalHeader
          onClose={onClose}
          title={!headerSlot ? title : undefined}
          subtitle={!headerSlot ? subtitle : undefined}
        >
          {headerSlot}
        </ModalHeader>
        <ModalBody>{children}</ModalBody>
        <ModalFooter>
          <Button variant="secondary" size="md" onClick={onClose}>{cancelLabel}</Button>
          <Button variant={submitVariant} size="md" disabled={submitDisabled} onClick={handleSubmit}>
            {submitLabel}
          </Button>
        </ModalFooter>
      </Modal>
      {toastMessage ? <Toast message={toastMessage} type="error" onClose={handleToastClose} /> : null}
    </>
  );
}

interface TypedConfirmProps {
  matchValue: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

function TypedConfirm({ matchValue, label, onChange, placeholder }: TypedConfirmProps) {
  return (
    <>
      <label className={FIELD_LABEL}>{label}</label>
      <input
        type="text"
        placeholder={placeholder ?? matchValue}
        className={INPUT}
        onChange={(e) => onChange(e.target.value)}
        autoFocus
      />
    </>
  );
}

const FormModal = Object.assign(FormModalImpl, { TypedConfirm });
export default FormModal;
