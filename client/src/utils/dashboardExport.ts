/**
 * Dashboard export — CSV generator for the redesigned dashboard.
 *
 * Pure builder: takes the already-fetched zone payloads (Scorecard / Dept /
 * Staff / Trends) plus the active filters and emits a single CSV blob the
 * admin can attach to a board report. Composition lives client-side so we
 * don't need a dedicated tRPC procedure (each zone already round-trips on
 * the same filter inputs).
 *
 * PDF migration is a follow-up — the FilterBar's Export PDF button stays
 * disabled until that handler is wired.
 */

import type { ScorecardData } from '../components/admin/dashboard/Scorecard';
import type { DeptRow } from '../components/admin/dashboard/DeptBreakdownTable';
import type { StaffRow } from '../components/admin/dashboard/StaffBreakdownTable';
import type { TrendsData } from '../components/admin/dashboard/TrendsZone';

export interface DashboardExportFilters {
  dateFrom: string;
  dateTo: string;
  dept?: string;
  excludeWeekends: boolean;
}

export interface DashboardExportSnapshot {
  filters: DashboardExportFilters;
  scorecard: ScorecardData;
  deptBreakdown: DeptRow[];
  staffBreakdown: StaffRow[];
  trends: TrendsData;
}

function escape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function row(...cells: unknown[]): string {
  return cells.map(escape).join(',');
}

export function buildDashboardCsv(snapshot: DashboardExportSnapshot): string {
  const lines: string[] = [];

  lines.push(row('Date range', snapshot.filters.dateFrom, snapshot.filters.dateTo));
  if (snapshot.filters.dept) {
    lines.push(row('Department', snapshot.filters.dept));
  }
  if (snapshot.filters.excludeWeekends) {
    lines.push(row('Exclude weekends', 'yes'));
  }
  lines.push('');

  lines.push('Scorecard');
  lines.push(row('Metric', 'Value', 'Previous', 'Delta %'));
  lines.push(row('SLA %', snapshot.scorecard.sla.value, snapshot.scorecard.sla.prevValue, snapshot.scorecard.sla.deltaPct));
  lines.push(row('CSAT', snapshot.scorecard.csat.value, snapshot.scorecard.csat.prevValue, snapshot.scorecard.csat.deltaPct));
  lines.push(row('Volume', snapshot.scorecard.volume.value, snapshot.scorecard.volume.prevValue, snapshot.scorecard.volume.deltaPct));
  lines.push('');

  if (snapshot.deptBreakdown.length > 0) {
    lines.push('Department breakdown');
    lines.push(row('Name', 'Volume', 'SLA %', 'CSAT', 'Breaches'));
    for (const d of snapshot.deptBreakdown) {
      lines.push(row(d.name, d.volume, d.slaPct, d.csat, d.breachCount));
    }
    lines.push('');
  }

  if (snapshot.staffBreakdown.length > 0) {
    lines.push('Staff breakdown');
    lines.push(row('Name', 'Handled', 'Avg response (min)', 'CSAT'));
    for (const s of snapshot.staffBreakdown) {
      lines.push(row(s.name, s.handled, s.avgResponseMinutes, s.csat));
    }
    lines.push('');
  }

  const buckets = new Set<string>();
  for (const p of snapshot.trends.series.volume) buckets.add(p.bucket);
  for (const p of snapshot.trends.series.csat) buckets.add(p.bucket);
  for (const p of snapshot.trends.series.avgResponseMinutes) buckets.add(p.bucket);
  if (buckets.size > 0) {
    lines.push(`Trends (${snapshot.trends.granularity})`);
    lines.push(row('Bucket', 'Volume', 'CSAT', 'Avg response (min)'));
    const indexed = (series: { bucket: string; value: number | null }[]) => {
      const m = new Map<string, number | null>();
      for (const p of series) m.set(p.bucket, p.value);
      return m;
    };
    const vol = indexed(snapshot.trends.series.volume);
    const csat = indexed(snapshot.trends.series.csat);
    const resp = indexed(snapshot.trends.series.avgResponseMinutes);
    for (const bucket of Array.from(buckets).sort()) {
      lines.push(row(bucket, vol.get(bucket) ?? null, csat.get(bucket) ?? null, resp.get(bucket) ?? null));
    }
  }

  return lines.join('\n');
}

export function exportDashboardCsv(snapshot: DashboardExportSnapshot): void {
  const csv = buildDashboardCsv(snapshot);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `dashboard_${snapshot.filters.dateFrom}_${snapshot.filters.dateTo}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ─── HTML / PDF ─────────────────────────────────────────────────────────────
// PDF export goes through the browser's native print pipeline ("Save as PDF"
// in the print dialog). Cheaper than bundling jspdf and good enough for a
// once-a-day morning-glance attachment. `buildDashboardHtml` is the pure
// builder so we can fixture-test the markup; `exportDashboardPdf` is the
// thin wrapper that opens a print window.

function htmlEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmt(value: number | null, suffix = ''): string {
  if (value === null || value === undefined) return '—';
  return `${value}${suffix}`;
}

export function buildDashboardHtml(snapshot: DashboardExportSnapshot): string {
  const f = snapshot.filters;
  const sc = snapshot.scorecard;

  const deptRows = snapshot.deptBreakdown
    .map(
      (d) =>
        `<tr><td>${htmlEscape(d.name)}</td><td>${d.volume}</td><td>${fmt(d.slaPct, '%')}</td><td>${fmt(d.csat)}</td><td>${d.breachCount}</td></tr>`,
    )
    .join('');

  const staffRows = snapshot.staffBreakdown
    .map(
      (s) =>
        `<tr><td>${htmlEscape(s.name)}</td><td>${s.handled}</td><td>${fmt(s.avgResponseMinutes, ' min')}</td><td>${fmt(s.csat)}</td></tr>`,
    )
    .join('');

  const buckets = new Set<string>();
  for (const p of snapshot.trends.series.volume) buckets.add(p.bucket);
  for (const p of snapshot.trends.series.csat) buckets.add(p.bucket);
  for (const p of snapshot.trends.series.avgResponseMinutes) buckets.add(p.bucket);
  const indexed = (s: { bucket: string; value: number | null }[]) => {
    const m = new Map<string, number | null>();
    for (const p of s) m.set(p.bucket, p.value);
    return m;
  };
  const vol = indexed(snapshot.trends.series.volume);
  const csat = indexed(snapshot.trends.series.csat);
  const resp = indexed(snapshot.trends.series.avgResponseMinutes);
  const trendRows = Array.from(buckets)
    .sort()
    .map(
      (b) =>
        `<tr><td>${htmlEscape(b)}</td><td>${fmt(vol.get(b) ?? null)}</td><td>${fmt(csat.get(b) ?? null)}</td><td>${fmt(resp.get(b) ?? null, ' min')}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Dashboard ${htmlEscape(f.dateFrom)} to ${htmlEscape(f.dateTo)}</title>
<style>
  body { font-family: Inter, system-ui, sans-serif; color: #1f2937; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 24px 0 8px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; }
  .meta { font-size: 12px; color: #6b7280; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
  th { font-weight: 600; color: #374151; background: #f9fafb; }
  .scorecard { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 12px 0 24px; }
  .card { padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; }
  .card .label { font-size: 11px; color: #6b7280; text-transform: uppercase; }
  .card .value { font-size: 22px; font-weight: 600; margin: 4px 0; }
  .card .delta { font-size: 11px; color: #6b7280; }
  @media print { body { padding: 12px; } }
</style>
</head>
<body>
<h1>Dashboard</h1>
<div class="meta">${htmlEscape(f.dateFrom)} to ${htmlEscape(f.dateTo)}${f.dept ? ` · dept: ${htmlEscape(f.dept)}` : ''}${f.excludeWeekends ? ' · excl. weekends' : ''}</div>

<h2>Scorecard</h2>
<div class="scorecard">
  <div class="card"><div class="label">SLA %</div><div class="value">${fmt(sc.sla.value, '%')}</div><div class="delta">prev ${fmt(sc.sla.prevValue, '%')} · Δ ${fmt(sc.sla.deltaPct, '%')}</div></div>
  <div class="card"><div class="label">CSAT</div><div class="value">${fmt(sc.csat.value)}</div><div class="delta">prev ${fmt(sc.csat.prevValue)} · Δ ${fmt(sc.csat.deltaPct, '%')}</div></div>
  <div class="card"><div class="label">Volume</div><div class="value">${fmt(sc.volume.value)}</div><div class="delta">prev ${fmt(sc.volume.prevValue)} · Δ ${fmt(sc.volume.deltaPct, '%')}</div></div>
</div>

${deptRows ? `<h2>Department breakdown</h2><table><thead><tr><th>Department</th><th>Volume</th><th>SLA %</th><th>CSAT</th><th>Breaches</th></tr></thead><tbody>${deptRows}</tbody></table>` : ''}

${staffRows ? `<h2>Staff breakdown</h2><table><thead><tr><th>Name</th><th>Handled</th><th>Avg response</th><th>CSAT</th></tr></thead><tbody>${staffRows}</tbody></table>` : ''}

${trendRows ? `<h2>Trends (${htmlEscape(snapshot.trends.granularity)})</h2><table><thead><tr><th>Bucket</th><th>Volume</th><th>CSAT</th><th>Avg response</th></tr></thead><tbody>${trendRows}</tbody></table>` : ''}
</body>
</html>`;
}

export function exportDashboardPdf(snapshot: DashboardExportSnapshot): void {
  const html = buildDashboardHtml(snapshot);
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}
