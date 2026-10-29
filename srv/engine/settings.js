/**
 * Runtime-configurable business rules.
 *
 * Defaults come from the environment; a Finance Manager can change them at runtime from the
 * Settings page. Values are persisted in the Settings table and read on every use, so all
 * service instances see the same rules. Changes apply to invoices processed from then on.
 */
'use strict';
const cds = require('@sap/cds');

const DEFS = {
  approvalLimit:      { label: 'Approval limit (Finance Manager above)', unit: 'INR', min: 10000, max: 100000000, value: Number(process.env.APPROVAL_LIMIT || 1000000) },
  pricePctWarn:       { label: 'Price tolerance - needs buyer confirmation', unit: '%', min: 0, max: 20, value: Number(process.env.TOL_PRICE_PCT || 2) },
  pricePctFail:       { label: 'Price tolerance - blocks payment', unit: '%', min: 0, max: 50, value: Number(process.env.TOL_PRICE_PCT_FAIL || 5) },
  slaDays:            { label: 'Exception / hold SLA before escalation', unit: 'days', min: 1, max: 60, value: Number(process.env.SLA_DAYS || 5) },
  paymentHorizonDays: { label: 'Payment run horizon (pay invoices due within)', unit: 'days', min: 0, max: 90, value: Number(process.env.PAYMENT_HORIZON_DAYS || 7) }
};

const defaults = () => Object.fromEntries(Object.entries(DEFS).map(([k, d]) => [k, d.value]));

/** Current values as a plain object, e.g. { approvalLimit: 1000000, pricePctWarn: 2, ... } */
async function current() {
  const { Settings } = cds.entities('procureiq');
  const rows = await SELECT.from(Settings).columns('name', 'value');
  return { ...defaults(), ...Object.fromEntries(rows.filter((r) => r.name in DEFS).map((r) => [r.name, Number(r.value)])) };
}

/** Insert missing default rows so the Settings page can list them. */
async function init() {
  const { Settings } = cds.entities('procureiq');
  const have = new Set((await SELECT.from(Settings).columns('name')).map((r) => r.name));
  const missing = Object.entries(DEFS).filter(([k]) => !have.has(k));
  if (missing.length) await INSERT.into(Settings).entries(missing.map(([name, d]) => ({ name, value: d.value, label: d.label, unit: d.unit, minValue: d.min, maxValue: d.max })));
}

/** Validate a change against its bounds and the other values. Returns an error message or null. */
function validate(name, value, all) {
  const d = DEFS[name];
  if (!d) return `Unknown setting ${name}`;
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${d.label} must be a number`;
  if (value < d.min || value > d.max) return `${d.label} must be between ${d.min} and ${d.max} ${d.unit}`;
  const next = { ...all, [name]: value };
  if (next.pricePctFail < next.pricePctWarn) return 'The blocking price tolerance cannot be lower than the confirmation tolerance';
  return null;
}

async function update(name, value) {
  const { Settings } = cds.entities('procureiq');
  await init();
  await UPDATE(Settings, name).with({ value });
}

module.exports = { DEFS, defaults, current, init, validate, update };
