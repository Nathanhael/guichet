const FILE_TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF',
  docx: 'Word',
  doc: 'Word',
  xlsx: 'Excel',
  xls: 'Excel',
  csv: 'CSV',
  txt: 'Text',
};

/** Map a file extension to a human-readable label. Pass `'uppercase'` as fallback to use the raw extension in uppercase (e.g. "ZIP") instead of the generic "File". */
export function getFileTypeLabel(ext: string, fallback?: 'uppercase'): string {
  return FILE_TYPE_LABELS[ext] ?? (fallback === 'uppercase' ? ext.toUpperCase() : 'File');
}
