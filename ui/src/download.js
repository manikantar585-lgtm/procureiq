// Client-side file downloads (CSV exports, PDF reports)

function save(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const cell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+@]/.test(s) || /^-\D/.test(s)) s = "'" + s; // never let a spreadsheet evaluate document text as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** @param columns [[header, (row) => value], ...] */
export function downloadCsv(fileName, columns, rows) {
  const lines = [columns.map(([h]) => cell(h)).join(','), ...rows.map((r) => columns.map(([, f]) => cell(f(r))).join(','))];
  save(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), fileName); // BOM so Excel reads UTF-8
}

export function downloadBase64(fileName, base64, type = 'application/pdf') {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  save(new Blob([bytes], { type }), fileName);
}

export const stamp = () => new Date().toISOString().slice(0, 10);
