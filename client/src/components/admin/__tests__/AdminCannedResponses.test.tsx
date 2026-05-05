/**
 * Behavior tests for AdminCannedResponses. Covers the cannedTranslation
 * feature flag's UI branches:
 *   - Off: only the single-body editor renders.
 *   - On: 3-tab editor + source-lang picker + regenerate button + stale warning.
 *   - On + admin edits a translation tab + saves → mutation receives bodyTranslations patch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AdminCannedResponses from '../AdminCannedResponses';

interface MockCanned {
  id: string;
  dept: string | null;
  title: string;
  body: string;
  shortcut: string | null;
  sourceLang: string;
  bodyTranslations: Record<string, string>;
  staleTranslations: Record<string, boolean>;
  createdAt: string;
}

const h = vi.hoisted(() => ({
  aiConfigData: { cannedTranslation: false } as Record<string, unknown>,
  listData: [] as MockCanned[],
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  deleteMutate: vi.fn(),
  regenerateMutate: vi.fn(),
  backfillMutate: vi.fn(),
}));

vi.mock('../../../i18n', () => ({
  // Return a string with the {count} placeholder so the component's .replace
  // call produces a visible number for assertions.
  useT: () => (key: string) => {
    if (key === 'admin_canned_translate_backfill_banner') {
      return "{count} canned responses don't have translations yet";
    }
    return key;
  },
}));

vi.mock('../../../utils/trpc', () => ({
  trpc: {
    useUtils: () => ({
      cannedResponse: { list: { invalidate: vi.fn() } },
    }),
    partner: {
      getAiConfig: {
        useQuery: () => ({ data: h.aiConfigData, isLoading: false }),
      },
    },
    cannedResponse: {
      list: {
        useQuery: () => ({
          data: h.listData,
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      create: {
        useMutation: (opts: { onSuccess?: () => void }) => ({
          mutate: (...args: unknown[]) => { h.createMutate(...args); opts?.onSuccess?.(); },
          isPending: false,
          error: null,
        }),
      },
      update: {
        useMutation: (opts: { onSuccess?: () => void }) => ({
          mutate: (...args: unknown[]) => { h.updateMutate(...args); opts?.onSuccess?.(); },
          isPending: false,
          error: null,
        }),
      },
      delete: {
        useMutation: (opts: { onSuccess?: () => void }) => ({
          mutate: (...args: unknown[]) => { h.deleteMutate(...args); opts?.onSuccess?.(); },
          isPending: false,
          error: null,
        }),
      },
      regenerate: {
        useMutation: (opts: { onSuccess?: () => void }) => ({
          mutate: (...args: unknown[]) => { h.regenerateMutate(...args); opts?.onSuccess?.(); },
          isPending: false,
          error: null,
        }),
      },
      backfillUntranslated: {
        useMutation: (opts: { onSuccess?: () => void }) => ({
          mutate: (...args: unknown[]) => { h.backfillMutate(...args); opts?.onSuccess?.(); },
          isPending: false,
          error: null,
        }),
      },
    },
  },
}));

vi.mock('../../../store/useStore', () => ({
  useStoreShallow: (
    selector: (s: { bionicReading: boolean; user: { lang: string } | null }) => unknown,
  ) => selector({ bionicReading: false, user: { lang: 'en' } }),
}));

vi.mock('../../../hooks/usePartner', () => ({
  usePartner: () => ({ manifest: { departments: [] } }),
}));

vi.mock('../../../validation/adminSchemas', () => ({
  cannedResponseCreateSchema: {},
  validateForm: () => null,
}));

function makeCanned(over: Partial<MockCanned> = {}): MockCanned {
  return {
    id: over.id ?? 'c1',
    dept: over.dept ?? null,
    title: over.title ?? 'Greeting',
    body: over.body ?? 'Hello there',
    shortcut: over.shortcut ?? null,
    sourceLang: over.sourceLang ?? 'en',
    bodyTranslations: over.bodyTranslations ?? {},
    staleTranslations: over.staleTranslations ?? {},
    createdAt: over.createdAt ?? new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.aiConfigData = { cannedTranslation: false };
  h.listData = [];
});

describe('AdminCannedResponses — feature OFF', () => {
  it('does not render the source-language picker on create', () => {
    render(<AdminCannedResponses />);
    expect(screen.queryByTestId('new-source-lang')).not.toBeInTheDocument();
  });

  it('does not render the 3-tab editor when editing a row', () => {
    h.listData = [makeCanned({ bodyTranslations: { nl: 'Hallo', fr: 'Bonjour' } })];
    render(<AdminCannedResponses />);
    fireEvent.click(screen.getByLabelText('canned_edit_for_aria'));
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByTestId('edit-source-lang')).not.toBeInTheDocument();
    expect(screen.queryByTestId('regenerate-nl')).not.toBeInTheDocument();
  });

  it('shows the auto-translation OFF pill next to the title', () => {
    render(<AdminCannedResponses />);
    expect(screen.getByText('admin_canned_translation_off_pill')).toBeInTheDocument();
  });

  it('shows the auto-translation OFF banner explaining the state', () => {
    render(<AdminCannedResponses />);
    expect(screen.getByText('admin_canned_translation_off_banner')).toBeInTheDocument();
  });
});

describe('AdminCannedResponses — feature ON', () => {
  beforeEach(() => {
    h.aiConfigData = { cannedTranslation: true };
  });

  it('renders the source-language picker on create', () => {
    render(<AdminCannedResponses />);
    expect(screen.getByTestId('new-source-lang')).toBeInTheDocument();
  });

  it('does NOT show the OFF pill or banner when feature is on', () => {
    render(<AdminCannedResponses />);
    expect(screen.queryByText('admin_canned_translation_off_pill')).not.toBeInTheDocument();
    expect(screen.queryByText('admin_canned_translation_off_banner')).not.toBeInTheDocument();
  });

  it('renders three language tabs in the edit form (one source + two translation)', () => {
    h.listData = [makeCanned({ bodyTranslations: { nl: 'Hallo', fr: 'Bonjour' } })];
    render(<AdminCannedResponses />);
    fireEvent.click(screen.getByLabelText('canned_edit_for_aria'));

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    const labels = tabs.map((b) => b.textContent ?? '');
    expect(labels.some((l) => l.includes('NL'))).toBe(true);
    expect(labels.some((l) => l.includes('FR'))).toBe(true);
    expect(labels.some((l) => l.includes('EN'))).toBe(true);
  });

  it('shows the per-language stale warning when staleTranslations[lang] is true', () => {
    h.listData = [makeCanned({
      bodyTranslations: { nl: 'oude', fr: 'ancien' },
      staleTranslations: { nl: true, fr: false },
    })];
    render(<AdminCannedResponses />);
    fireEvent.click(screen.getByLabelText('canned_edit_for_aria'));
    // Switch to NL tab.
    fireEvent.click(screen.getByRole('tab', { name: /NL/ }));
    expect(screen.getByText('admin_canned_translate_stale')).toBeInTheDocument();
  });

  it('clicking Regenerate on the NL tab calls regenerate with langs=["nl"]', () => {
    h.listData = [makeCanned({
      bodyTranslations: { nl: 'oude', fr: 'ancien' },
      staleTranslations: { nl: true, fr: false },
    })];
    render(<AdminCannedResponses />);
    fireEvent.click(screen.getByLabelText('canned_edit_for_aria'));
    fireEvent.click(screen.getByRole('tab', { name: /NL/ }));
    fireEvent.click(screen.getByTestId('regenerate-nl'));
    expect(h.regenerateMutate).toHaveBeenCalledWith({ id: 'c1', langs: ['nl'] });
  });

  it('saves bodyTranslations only when the admin touched a translation tab', () => {
    h.listData = [makeCanned({ bodyTranslations: { nl: 'Hallo', fr: 'Bonjour' } })];
    render(<AdminCannedResponses />);
    fireEvent.click(screen.getByLabelText('canned_edit_for_aria'));
    // Switch to NL tab and edit.
    fireEvent.click(screen.getByRole('tab', { name: /NL/ }));
    fireEvent.change(screen.getByTestId('edit-body-nl'), { target: { value: 'Hallo (edited)' } });

    fireEvent.click(screen.getByText('save'));

    expect(h.updateMutate).toHaveBeenCalledTimes(1);
    const arg = h.updateMutate.mock.calls[0][0];
    expect(arg.bodyTranslations).toEqual({ nl: 'Hallo (edited)' });
    expect(arg.body).toBe('Hello there');
  });

  it('does NOT include bodyTranslations on save when only title was changed', () => {
    h.listData = [makeCanned({ bodyTranslations: { nl: 'Hallo', fr: 'Bonjour' } })];
    render(<AdminCannedResponses />);
    fireEvent.click(screen.getByLabelText('canned_edit_for_aria'));
    fireEvent.change(screen.getAllByDisplayValue('Greeting')[0], { target: { value: 'Renamed' } });

    fireEvent.click(screen.getByText('save'));

    expect(h.updateMutate).toHaveBeenCalledTimes(1);
    const arg = h.updateMutate.mock.calls[0][0];
    expect(arg.bodyTranslations).toBeUndefined();
    expect(arg.title).toBe('Renamed');
  });

  it('shows a list-level stale indicator when any translation is flagged stale', () => {
    h.listData = [makeCanned({ staleTranslations: { nl: true } })];
    render(<AdminCannedResponses />);
    // The list row for "Greeting" should include an alert icon with the stale tooltip.
    const titleCell = screen.getByText('Greeting');
    const indicator = titleCell.parentElement?.querySelector('[title="admin_canned_translate_stale"]');
    expect(indicator).toBeTruthy();
  });
});

describe('AdminCannedResponses — backfill banner', () => {
  beforeEach(() => {
    h.aiConfigData = { cannedTranslation: true };
  });

  it('does not show the banner when every canned has translations', () => {
    h.listData = [
      makeCanned({ id: 'a', title: 'A', bodyTranslations: { nl: 'x' } }),
      makeCanned({ id: 'b', title: 'B', bodyTranslations: { fr: 'y' } }),
    ];
    render(<AdminCannedResponses />);
    expect(screen.queryByTestId('canned-backfill-banner')).not.toBeInTheDocument();
  });

  it('shows the banner with the count of untranslated canneds', () => {
    h.listData = [
      makeCanned({ id: 'a', title: 'A', bodyTranslations: {} }),
      makeCanned({ id: 'b', title: 'B', bodyTranslations: {} }),
      makeCanned({ id: 'c', title: 'C', bodyTranslations: { nl: 'present' } }),
    ];
    render(<AdminCannedResponses />);
    const banner = screen.getByTestId('canned-backfill-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain('2');
  });

  it('does NOT show the banner when feature is OFF, even with empty translations', () => {
    h.aiConfigData = { cannedTranslation: false };
    h.listData = [makeCanned({ bodyTranslations: {} })];
    render(<AdminCannedResponses />);
    expect(screen.queryByTestId('canned-backfill-banner')).not.toBeInTheDocument();
  });

  it('clicking the Translate-all button calls the backfillUntranslated mutation', () => {
    h.listData = [makeCanned({ bodyTranslations: {} })];
    render(<AdminCannedResponses />);
    fireEvent.click(screen.getByTestId('canned-backfill-button'));
    expect(h.backfillMutate).toHaveBeenCalledTimes(1);
  });
});
