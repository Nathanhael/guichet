import { useState, useCallback } from 'react';

export type PanelToast = {
  message: string;
  type: 'success' | 'error';
} | null;

type MutationError = { message: string };

type DefaultsInput<TData, TVars> = {
  invalidate: () => Promise<unknown> | unknown;
  onSuccess?: (data: TData, vars: TVars) => void;
  onError?: (err: MutationError, vars: TVars) => void;
  successMessage?: string;
};

type BuiltMutationOptions<TData, TVars> = {
  onSuccess: (data: TData, vars: TVars) => void | Promise<void>;
  onError: (err: MutationError, vars: TVars) => void;
};

// Shared toast + invalidation wiring for admin panels.
// Each panel hand-rolled the same pattern: setToast on mutation error,
// invalidate() on success, optionally clear local form state. This hook
// consolidates the convention so a panel just expresses the panel-specific
// callbacks and the success/error plumbing happens in one place.
export function usePanelMutations() {
  const [toast, setToast] = useState<PanelToast>(null);

  const defaults = useCallback(
    <TData = unknown, TVars = unknown>(
      input: DefaultsInput<TData, TVars>,
    ): BuiltMutationOptions<TData, TVars> => ({
      onSuccess: async (data, vars) => {
        input.onSuccess?.(data, vars);
        await input.invalidate();
        if (input.successMessage) {
          setToast({ message: input.successMessage, type: 'success' });
        }
      },
      onError: (err, vars) => {
        setToast({ message: err.message, type: 'error' });
        input.onError?.(err, vars);
      },
    }),
    [],
  );

  return { toast, setToast, defaults };
}
