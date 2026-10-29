export const inr = (n, digits = 0) =>
  n === null || n === undefined ? '–' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits });

/** ₹12.4 L / ₹1.06 Cr style compact amounts */
export const inrCompact = (n) => {
  const v = Number(n || 0);
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  if (v >= 1e3) return `₹${(v / 1e3).toFixed(1)} K`;
  return `₹${v.toFixed(0)}`;
};

export const date = (d) => (d ? new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '–');
export const dateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');

export const RISK_STATE = { Low: 'Positive', Medium: 'Critical', High: 'Negative', Critical: 'Negative' };
export const STATUS_DESIGN = { Matched: 'Information', Exception: 'Critical', Approved: 'Positive', Posted: 'Positive', Rejected: 'Negative', Received: 'Neutral', Extracted: 'Neutral' };
export const LINE_STATE = { OK: 'Positive', WARN: 'Critical', FAIL: 'Negative' };
export const SEVERITY_ICON = { Low: 'message-information', Medium: 'message-warning', High: 'message-error', Critical: 'error' };
