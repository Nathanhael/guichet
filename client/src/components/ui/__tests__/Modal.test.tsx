import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Modal, { ModalHeader, ModalBody, ModalFooter } from '../Modal';

describe('Modal', () => {
  it('does not render when open is false', () => {
    render(
      <Modal open={false} onClose={() => {}}>
        <ModalBody>hidden</ModalBody>
      </Modal>,
    );
    expect(screen.queryByText('hidden')).toBeNull();
  });

  it('renders children and dialog role when open', () => {
    render(
      <Modal open onClose={() => {}}>
        <ModalBody>visible</ModalBody>
      </Modal>,
    );
    expect(screen.getByText('visible')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <ModalBody>x</ModalBody>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on Escape when dismissOnEscape=false', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} dismissOnEscape={false}>
        <ModalBody>x</ModalBody>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not bubble clicks inside the card up to the backdrop', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <ModalBody>
          <button>inner</button>
        </ModalBody>
      </Modal>,
    );
    fireEvent.click(screen.getByText('inner'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ModalHeader renders a close button that fires onClose', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <ModalHeader title="Transfer ticket" onClose={onClose} />
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ModalHeader prefers custom actions over the default close button', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <ModalHeader title="T" onClose={onClose} actions={<button>Save</button>} />
      </Modal>,
    );
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('ModalFooter right-aligns children for the action row', () => {
    render(
      <Modal open onClose={() => {}}>
        <ModalFooter>
          <button>Cancel</button>
          <button>OK</button>
        </ModalFooter>
      </Modal>,
    );
    const footer = screen.getByRole('button', { name: 'OK' }).parentElement!;
    expect(footer.className).toContain('justify-end');
  });
});
