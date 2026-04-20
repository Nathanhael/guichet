import { AlertTriangle } from 'lucide-react';
import { useT } from '../i18n';
import Modal, { ModalBody, ModalFooter, ModalHeader } from './ui/Modal';
import Button from './ui/Button';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const t = useT();

  return (
    <Modal open onClose={onCancel} dismissOnBackdrop>
      <ModalHeader
        title={
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-urgent-soft)] text-[var(--color-urgent)]">
              <AlertTriangle className="h-4 w-4" />
            </span>
            {title}
          </span>
        }
        onClose={onCancel}
      />
      <ModalBody>
        <p>{message}</p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onCancel}>
          {cancelLabel || t('cancel')}
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          {confirmLabel || t('yes_close')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
