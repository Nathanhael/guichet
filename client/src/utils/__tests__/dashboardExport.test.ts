import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildDashboardCsv,
  buildDashboardHtml,
  exportDashboardCsv,
  exportDashboardPdf,
  type DashboardExportSnapshot,
} from '../dashboardExport';

const SNAPSHOT: DashboardExportSnapshot = {
  filters: {
    dateFrom: '2026-04-19',
    dateTo: '2026-04-25',
    dept: undefined,
    excludeWeekends: false,
  },
  scorecard: {
    sla: { value: 94.5, prevValue: 92, deltaPct: 2.7, band: 'amber' },
    csat: { value: 4.5, prevValue: 4.3, deltaPct: 4.7, band: 'neutral' },
    volume: { value: 142, prevValue: 130, deltaPct: 9.2, band: 'neutral' },
  },
  deptBreakdown: [
    { id: 'sales', name: 'Sales', volume: 80, slaPct: 92, csat: 4.4, breachCount: 2 },
    { id: 'support', name: 'Support', volume: 62, slaPct: null, csat: null, breachCount: 0 },
  ],
  staffBreakdown: [
    { id: 'u-alice', name: 'Alice', handled: 90, avgResponseMinutes: 12, csat: 4.5 },
    { id: 'u-bob', name: 'Bob', handled: 52, avgResponseMinutes: null, csat: null },
  ],
  trends: {
    granularity: 'daily',
    series: {
      volume: [
        { bucket: '2026-04-19', value: 5 },
        { bucket: '2026-04-20', value: 7 },
      ],
      csat: [
        { bucket: '2026-04-19', value: 4 },
        { bucket: '2026-04-20', value: null },
      ],
      avgResponseMinutes: [
        { bucket: '2026-04-19', value: 12 },
        { bucket: '2026-04-20', value: 8 },
      ],
    },
  },
};

describe('buildDashboardCsv', () => {
  it('opens with the filter window so the export carries its own context', () => {
    const csv = buildDashboardCsv(SNAPSHOT);
    expect(csv).toMatch(/Date range,2026-04-19,2026-04-25/);
  });

  it('emits a Scorecard section with the three cards (value / prev / delta)', () => {
    const csv = buildDashboardCsv(SNAPSHOT);
    expect(csv).toMatch(/Scorecard/);
    expect(csv).toMatch(/SLA %,94\.5,92,2\.7/);
    expect(csv).toMatch(/CSAT,4\.5,4\.3,4\.7/);
    expect(csv).toMatch(/Volume,142,130,9\.2/);
  });

  it('emits a Department breakdown section with the dept rows', () => {
    const csv = buildDashboardCsv(SNAPSHOT);
    expect(csv).toMatch(/Department breakdown/);
    expect(csv).toMatch(/Sales,80,92,4\.4,2/);
  });

  it('emits a Staff breakdown section with the staff rows', () => {
    const csv = buildDashboardCsv(SNAPSHOT);
    expect(csv).toMatch(/Staff breakdown/);
    expect(csv).toMatch(/Alice,90,12,4\.5/);
  });

  it('emits a Trends section with one column per series + bucket', () => {
    const csv = buildDashboardCsv(SNAPSHOT);
    expect(csv).toMatch(/Trends \(daily\)/);
    expect(csv).toMatch(/Bucket,Volume,CSAT,Avg response \(min\)/);
    expect(csv).toMatch(/2026-04-19,5,4,12/);
  });

  it('renders null values as empty cells (no "null" text)', () => {
    const csv = buildDashboardCsv(SNAPSHOT);
    expect(csv).not.toMatch(/null/);
    // Bob has null avgResponseMinutes + null csat
    expect(csv).toMatch(/Bob,52,,/);
    // Support row has null slaPct + null csat
    expect(csv).toMatch(/Support,62,,,0/);
  });

  it('escapes commas and quotes in dept / staff names', () => {
    const csv = buildDashboardCsv({
      ...SNAPSHOT,
      deptBreakdown: [
        { id: 'x', name: 'Foo, Inc.', volume: 1, slaPct: 50, csat: null, breachCount: 0 },
      ],
      staffBreakdown: [
        { id: 'x', name: 'O\'"Hara', handled: 1, avgResponseMinutes: null, csat: null },
      ],
    });
    expect(csv).toMatch(/"Foo, Inc\.",1,50,,0/);
    expect(csv).toMatch(/"O'""Hara",1,,/);
  });
});

describe('exportDashboardCsv', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:fake');
    revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    clickSpy = vi.fn();
    HTMLAnchorElement.prototype.click = clickSpy as unknown as () => void;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('triggers a browser download with a CSV blob and a stamped filename', () => {
    exportDashboardCsv(SNAPSHOT);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('uses the filter dates in the filename', () => {
    let lastDownload = '';
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        Object.defineProperty(el, 'download', {
          set(v: string) {
            lastDownload = v;
          },
          get() {
            return lastDownload;
          },
        });
      }
      return el;
    });
    exportDashboardCsv(SNAPSHOT);
    expect(lastDownload).toMatch(/dashboard.*2026-04-19.*2026-04-25\.csv$/);
  });
});

describe('buildDashboardHtml', () => {
  it('emits a complete HTML document with a doctype and meta charset', () => {
    const html = buildDashboardHtml(SNAPSHOT);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toMatch(/<meta\s+charset="utf-8"/i);
  });

  it('puts the filter window in the page header', () => {
    const html = buildDashboardHtml(SNAPSHOT);
    expect(html).toMatch(/2026-04-19/);
    expect(html).toMatch(/2026-04-25/);
  });

  it('renders a Scorecard section with the three card values', () => {
    const html = buildDashboardHtml(SNAPSHOT);
    expect(html).toMatch(/Scorecard/);
    expect(html).toMatch(/94\.5/); // SLA value
    expect(html).toMatch(/4\.5/);  // CSAT value
    expect(html).toMatch(/142/);   // Volume value
  });

  it('renders the department breakdown rows', () => {
    const html = buildDashboardHtml(SNAPSHOT);
    expect(html).toMatch(/Department/);
    expect(html).toMatch(/Sales/);
    expect(html).toMatch(/Support/);
  });

  it('renders the staff breakdown rows', () => {
    const html = buildDashboardHtml(SNAPSHOT);
    expect(html).toMatch(/Staff/);
    expect(html).toMatch(/Alice/);
    expect(html).toMatch(/Bob/);
  });

  it('renders the trends bucket rows with the granularity in the heading', () => {
    const html = buildDashboardHtml(SNAPSHOT);
    expect(html).toMatch(/Trends \(daily\)/);
    expect(html).toMatch(/2026-04-19/);
  });

  it('renders null cells as em-dash (not the literal "null")', () => {
    const html = buildDashboardHtml(SNAPSHOT);
    expect(html).not.toMatch(/>null</);
    expect(html).toMatch(/—/);
  });

  it('escapes HTML special characters in dept / staff names', () => {
    const html = buildDashboardHtml({
      ...SNAPSHOT,
      deptBreakdown: [
        { id: 'x', name: '<script>alert(1)</script>', volume: 1, slaPct: 50, csat: null, breachCount: 0 },
      ],
      staffBreakdown: [
        { id: 'y', name: 'A & B "C"', handled: 1, avgResponseMinutes: null, csat: null },
      ],
    });
    expect(html).toMatch(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    expect(html).not.toMatch(/<script>alert/);
    expect(html).toMatch(/A &amp; B &quot;C&quot;/);
  });
});

describe('exportDashboardPdf', () => {
  let openSpy: ReturnType<typeof vi.fn>;
  let printSpy: ReturnType<typeof vi.fn>;
  let writeSpy: ReturnType<typeof vi.fn>;
  let closeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    printSpy = vi.fn();
    writeSpy = vi.fn();
    closeSpy = vi.fn();
    const fakeWindow = {
      document: { write: writeSpy, close: closeSpy, title: '' },
      print: printSpy,
      close: vi.fn(),
      focus: vi.fn(),
    };
    openSpy = vi.fn(() => fakeWindow);
    Object.defineProperty(window, 'open', { value: openSpy, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a new window, writes the HTML document, and triggers print', () => {
    exportDashboardPdf(SNAPSHOT);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const writtenHtml = writeSpy.mock.calls[0][0];
    expect(writtenHtml).toMatch(/^<!doctype html>/i);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('does nothing when window.open is blocked (returns null)', () => {
    openSpy.mockReturnValue(null);
    Object.defineProperty(window, 'open', { value: openSpy, configurable: true });
    expect(() => exportDashboardPdf(SNAPSHOT)).not.toThrow();
    expect(printSpy).not.toHaveBeenCalled();
  });
});
