/**
 * Client for the Python ML scoring service (ml-service/).
 * If the service is unreachable the pipeline degrades gracefully to a
 * transparent statistical fallback - invoice processing never stops.
 */
'use strict';
const cds = require('@sap/cds');
const LOG = cds.log('ml');
const URL_ = process.env.ML_SERVICE_URL || 'http://localhost:8000';

let health = { up: false, model: null, checkedAt: 0 };

async function checkHealth(force = false) {
  if (!force && Date.now() - health.checkedAt < 30000) return health;
  try {
    const r = await fetch(`${URL_}/health`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    health = { up: r.ok, model: `${j.model} v${j.version}`, checkedAt: Date.now() };
  } catch {
    health = { up: false, model: null, checkedAt: Date.now() };
  }
  return health;
}

function fallback(f) {
  // Simple, explainable z-style heuristic used only when the ML service is down
  const parts = {
    amount_zscore: Math.max(0, f.amount_zscore - 2) / 6,
    max_price_var_pct: Math.max(0, f.max_price_var_pct - 2) / 15,
    qty_over_gr_ratio: Math.min(1, f.qty_over_gr_ratio),
    vendor_age_days: f.vendor_age_days < 90 ? 0.4 : 0,
    threshold_ratio: f.threshold_ratio >= 0.95 && f.threshold_ratio < 1 ? 0.4 : 0,
    has_po: f.has_po ? 0 : 0.5
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  const score = Math.min(1, total / 1.5);
  const top = Object.entries(parts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([feature, v]) => ({ feature, label: feature.replace(/_/g, ' '), value: f[feature], contribution: Math.round((v / (total || 1)) * 1000) / 1000 }));
  return { anomalyScore: Math.round(score * 1000) / 1000, isAnomaly: score >= 0.5, model: 'statistical-fallback', topFactors: top };
}

async function score(features) {
  const h = await checkHealth();
  if (h.up) {
    try {
      const r = await fetch(`${URL_}/score`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(features), signal: AbortSignal.timeout(4000) });
      if (r.ok) return await r.json();
      LOG.warn('ML service returned', r.status);
    } catch (e) {
      LOG.warn('ML service call failed, using fallback:', e.message);
      health.up = false;
    }
  }
  return fallback(features);
}

async function status() {
  const h = await checkHealth(true);
  return h.up ? { state: 'UP', model: h.model, url: URL_ } : { state: 'FALLBACK', model: 'statistical-fallback', url: URL_ };
}

module.exports = { score, status, fallback };
