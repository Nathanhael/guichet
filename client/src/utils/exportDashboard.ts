/**
 * Dashboard export utilities — CSV and PDF generation
 * Works entirely client-side (no server dependency).
 */

// ─── CSV ────────────────────────────────────────────────────────────────────

function escapeCSV(value: unknown): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function arrayToCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(escapeCSV).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCSV).join(','));
  }
  return lines.join('\n');
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface DashboardStats {
  total: number;
  todayTotal: number;
  todayOpen: number;
  todayClosed: number;
  avgResponseMinutes: number;
  p95ResponseMinutes: number;
  avgRating: number | null;
  totalRatings: number;
  abandonedCount: number;
  oldestWaitMinutes: number;
  waitingOver3: number;
  resolutionRate: number;
  dailyTrend: { date: string; total: number }[];
  supportStats: { name: string; total: number; today: number; avgRating: number | null }[];
  agentStats: { name: string; total: number; today: number }[];
  deptCounts: Record<string, number>;
}

interface StaffRating {
  supportId: string;
  supportName: string;
  avgRating: number;
  totalRatings: number;
}

export function exportDashboardCSV(stats: DashboardStats, staffRatings?: StaffRating[]) {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  let csv = '';

  // Summary section
  csv += arrayToCSV(
    ['Metric', 'Value'],
    [
      ['Total Tickets', stats.total],
      ['Today Total', stats.todayTotal],
      ['Today Open', stats.todayOpen],
      ['Today Closed', stats.todayClosed],
      ['Avg Response (min)', stats.avgResponseMinutes],
      ['p95 Response (min)', stats.p95ResponseMinutes],
      ['Avg Rating', stats.avgRating],
      ['Total Ratings', stats.totalRatings],
      ['Abandoned', stats.abandonedCount],
      ['Resolution Rate %', stats.resolutionRate],
      ['Oldest Waiting (min)', stats.oldestWaitMinutes],
      ['Waiting >3min', stats.waitingOver3],
    ]
  );

  // Department counts
  const deptEntries = Object.entries(stats.deptCounts);
  if (deptEntries.length > 0) {
    csv += '\n\nDepartment Distribution\n';
    csv += arrayToCSV(
      ['Department', 'Ticket Count'],
      deptEntries.map(([dept, count]) => [dept, count])
    );
  }

  // Daily trend
  if (stats.dailyTrend.length > 0) {
    csv += '\n\nDaily Trend\n';
    csv += arrayToCSV(
      ['Date', 'Total'],
      stats.dailyTrend.map((d) => [d.date, d.total])
    );
  }

  // Support performance
  if (stats.supportStats.length > 0) {
    csv += '\n\nSupport Performance\n';
    csv += arrayToCSV(
      ['Name', 'Total', 'Today', 'Avg Rating'],
      stats.supportStats.map((s) => [s.name, s.total, s.today, s.avgRating])
    );
  }

  // Agent performance
  if (stats.agentStats.length > 0) {
    csv += '\n\nAgent Performance\n';
    csv += arrayToCSV(
      ['Name', 'Total', 'Today'],
      stats.agentStats.map((a) => [a.name, a.total, a.today])
    );
  }

  // Staff satisfaction
  if (staffRatings && staffRatings.length > 0) {
    csv += '\n\nTeam Satisfaction\n';
    csv += arrayToCSV(
      ['Support Staff', 'Avg Rating', 'Total Ratings'],
      staffRatings.map((s) => [s.supportName, s.avgRating, s.totalRatings])
    );
  }

  downloadBlob(csv, `tessera-dashboard-${timestamp}.csv`, 'text/csv;charset=utf-8');
}

// ─── PDF (via browser print) ────────────────────────────────────────────────

export function exportDashboardPDF(stats: DashboardStats, staffRatings?: StaffRating[]) {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const deptEntries = Object.entries(stats.deptCounts);

  const html = `<!DOCTYPE html>
<html><head>
<title>Tessera Dashboard Report — ${timestamp}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 40px; color: #111; font-size: 12px; }
  h1 { font-size: 22px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 4px; }
  h2 { font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; margin: 24px 0 10px; border-bottom: 2px solid #111; padding-bottom: 4px; }
  .subtitle { font-size: 10px; opacity: 0.5; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 16px 0; }
  .card { border: 2px solid #111; padding: 10px; }
  .card-label { font-size: 8px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; opacity: 0.5; }
  .card-value { font-size: 20px; font-weight: 900; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th { font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; text-align: left; padding: 6px 8px; border-bottom: 2px solid #111; }
  td { padding: 5px 8px; border-bottom: 1px solid #ddd; font-size: 11px; }
  @media print { body { padding: 20px; } }
</style>
</head><body>
<h1>Tessera Dashboard Report</h1>
<div class="subtitle">Generated ${new Date().toLocaleString()}</div>

<h2>Key Metrics</h2>
<div class="grid">
  <div class="card"><div class="card-label">Total Tickets</div><div class="card-value">${stats.total}</div></div>
  <div class="card"><div class="card-label">Avg Response</div><div class="card-value">${stats.avgResponseMinutes}m</div></div>
  <div class="card"><div class="card-label">p95 Response</div><div class="card-value">${stats.p95ResponseMinutes}m</div></div>
  <div class="card"><div class="card-label">Avg Rating</div><div class="card-value">${stats.avgRating ?? '—'}</div></div>
  <div class="card"><div class="card-label">Abandoned</div><div class="card-value">${stats.abandonedCount}</div></div>
  <div class="card"><div class="card-label">Resolution Rate</div><div class="card-value">${stats.resolutionRate}%</div></div>
  <div class="card"><div class="card-label">Waiting >3min</div><div class="card-value">${stats.waitingOver3}</div></div>
</div>

${deptEntries.length > 0 ? `
<h2>Department Distribution</h2>
<table>
  <thead><tr><th>Department</th><th>Tickets</th></tr></thead>
  <tbody>${deptEntries.map(([d, c]) => `<tr><td>${d}</td><td>${c}</td></tr>`).join('')}</tbody>
</table>` : ''}

${stats.supportStats.length > 0 ? `
<h2>Support Performance</h2>
<table>
  <thead><tr><th>Name</th><th>Total</th><th>Today</th><th>Avg Rating</th></tr></thead>
  <tbody>${stats.supportStats.map(s => `<tr><td>${s.name}</td><td>${s.total}</td><td>${s.today}</td><td>${s.avgRating ?? '—'}</td></tr>`).join('')}</tbody>
</table>` : ''}

${stats.agentStats.length > 0 ? `
<h2>Agent Performance</h2>
<table>
  <thead><tr><th>Name</th><th>Total</th><th>Today</th></tr></thead>
  <tbody>${stats.agentStats.map(a => `<tr><td>${a.name}</td><td>${a.total}</td><td>${a.today}</td></tr>`).join('')}</tbody>
</table>` : ''}

${staffRatings && staffRatings.length > 0 ? `
<h2>Team Satisfaction</h2>
<table>
  <thead><tr><th>Support Staff</th><th>Avg Rating</th><th>Total Ratings</th></tr></thead>
  <tbody>${staffRatings.map(s => `<tr><td>${s.supportName}</td><td>${Number(s.avgRating).toFixed(1)}</td><td>${s.totalRatings}</td></tr>`).join('')}</tbody>
</table>` : ''}

${stats.dailyTrend.length > 0 ? `
<h2>Ticket Trend</h2>
<table>
  <thead><tr><th>Date</th><th>Total</th></tr></thead>
  <tbody>${stats.dailyTrend.map(d => `<tr><td>${d.date}</td><td>${d.total}</td></tr>`).join('')}</tbody>
</table>` : ''}

</body></html>`;

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    // Popup blocked — fall back to download as HTML
    downloadBlob(html, `tessera-dashboard-${timestamp}.html`, 'text/html;charset=utf-8');
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  // Use setTimeout to ensure content is rendered before triggering print
  setTimeout(() => {
    try { printWindow.print(); } catch { /* user closed window */ }
  }, 300);
}
