/**
 * Payment run - the "Pay" in Procure-to-Pay.
 *
 * Mirrors SAP F110 (Automatic Payment Program): from the open items (invoices posted to SAP) it proposes
 * what to pay on a payment date - everything due within the run horizon, plus invoices that are
 * worth paying early because a cash discount is still available. Vendors with a payment block are excluded.
 * Pure functions: no I/O, fully unit-tested.
 */
'use strict';

/**
 * Payment terms with cash discount conditions. In S/4HANA these come from the payment terms
 * configuration of the supplier (company code data); the keys match the demo supplier master.
 */
const TERMS = {
  NT07: { text: 'Net 7 days', netDays: 7 },
  NT15: { text: 'Net 15 days', netDays: 15 },
  NT30: { text: '2% within 10 days, net 30', netDays: 30, discountPct: 2, discountDays: 10 },
  NT45: { text: '1% within 15 days, net 45', netDays: 45, discountPct: 1, discountDays: 15 },
  NT60: { text: '1.5% within 20 days, net 60', netDays: 60, discountPct: 1.5, discountDays: 20 }
};

const DAY = 86400000;
const r2 = (n) => Math.round(n * 100) / 100;
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const daysBetween = (to, from) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
const fmt = (n) => 'INR ' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const termsFor = (key) => TERMS[key] || { text: key ? `${key} (no cash discount)` : 'Due immediately', netDays: 0 };

/**
 * Evaluate one open item for a payment date.
 * @param inv     { ID, invoiceNumber, vendor_ID, vendorName, invoiceDate, dueDate, grossAmount }
 * @param vendor  { paymentTerms, paymentBlocked, blockReason } | undefined
 * @param opts    { paymentDate: 'YYYY-MM-DD', horizonDays }
 */
function evaluateItem(inv, vendor, { paymentDate, horizonDays = 7 }) {
  const terms = termsFor(vendor?.paymentTerms);
  const gross = Number(inv.grossAmount) || 0;
  const dueDate = inv.dueDate || addDays(inv.invoiceDate, terms.netDays);
  const daysToDue = daysBetween(dueDate, paymentDate); // negative = overdue
  const discountDeadline = terms.discountPct && inv.invoiceDate ? addDays(inv.invoiceDate, terms.discountDays) : null;
  const discountOpen = !!discountDeadline && paymentDate <= discountDeadline;
  const discountValue = terms.discountPct ? r2((gross * terms.discountPct) / 100) : 0;

  let include = false, reason;
  if (vendor?.paymentBlocked) reason = `Vendor payment block${vendor.blockReason ? `: ${vendor.blockReason}` : ''}`;
  else if (daysToDue < 0) { include = true; reason = `Overdue ${-daysToDue} day(s)`; }
  else if (daysToDue <= horizonDays) { include = true; reason = `Due in ${daysToDue} day(s)`; }
  else if (discountOpen) { include = true; reason = `Pay early: ${terms.discountPct}% cash discount until ${discountDeadline}`; }
  else reason = `Not due until ${dueDate}`;

  const discount = include && discountOpen ? discountValue : 0;
  return {
    ID: inv.ID,
    invoiceNumber: inv.invoiceNumber,
    vendor_ID: inv.vendor_ID,
    vendorName: inv.vendorName,
    invoiceDate: inv.invoiceDate,
    dueDate,
    daysToDue,
    paymentTerms: terms.text,
    grossAmount: gross,
    discountDeadline,
    discount,
    lostDiscount: discountDeadline && !discountOpen ? discountValue : 0,
    payAmount: r2(gross - discount),
    include,
    blocked: !!vendor?.paymentBlocked,
    reason
  };
}

const AGING = [
  ['Overdue > 30 days', (d) => d < -30],
  ['Overdue 1-30 days', (d) => d < 0],
  ['Due in 0-7 days', (d) => d <= 7],
  ['Due in 8-30 days', (d) => d <= 30],
  ['Due in > 30 days', () => true]
];

function aging(items) {
  const out = AGING.map(([bucket]) => ({ bucket, amount: 0, invoices: 0 }));
  items.forEach((i) => { const b = out[AGING.findIndex(([, f]) => f(i.daysToDue))]; b.amount = r2(b.amount + i.grossAmount); b.invoices++; });
  return out;
}

/** Weekly cash-out forecast starting at the payment date; everything overdue lands in the first column. */
function forecast(items, paymentDate, weeks = 8) {
  const out = [{ week: 'Overdue', from: null, amount: 0, invoices: 0 }];
  for (let w = 0; w < weeks; w++) out.push({ week: `Wk ${w + 1}`, from: addDays(paymentDate, w * 7), amount: 0, invoices: 0 });
  const later = { week: 'Later', from: addDays(paymentDate, weeks * 7), amount: 0, invoices: 0 };
  items.forEach((i) => {
    const b = i.daysToDue < 0 ? out[0] : out[1 + Math.floor(i.daysToDue / 7)] || later;
    b.amount = r2(b.amount + i.payAmount); b.invoices++;
  });
  return later.invoices ? [...out, later] : out;
}

/**
 * Build a payment proposal for the open items.
 * @param openItems   invoices in status Posted
 * @param vendorsById { [vendorId]: vendor }
 */
function proposal(openItems, vendorsById, { paymentDate, horizonDays = 7 }) {
  const items = openItems.map((inv) => evaluateItem(inv, vendorsById[inv.vendor_ID], { paymentDate, horizonDays }))
    .sort((a, b) => b.include - a.include || a.daysToDue - b.daysToDue);
  const sum = (list, k) => r2(list.reduce((s, i) => s + i[k], 0));
  const proposed = items.filter((i) => i.include);
  return {
    paymentDate,
    horizonDays,
    totals: {
      openItems: items.length,
      openAmount: sum(items, 'grossAmount'),
      overdueItems: items.filter((i) => i.daysToDue < 0).length,
      overdueAmount: sum(items.filter((i) => i.daysToDue < 0), 'grossAmount'),
      proposedItems: proposed.length,
      proposedGross: sum(proposed, 'grossAmount'),
      discount: sum(proposed, 'discount'),
      payAmount: sum(proposed, 'payAmount'),
      lostDiscount: sum(items, 'lostDiscount'),
      blockedItems: items.filter((i) => i.blocked).length
    },
    aging: aging(items),
    forecast: forecast(items.filter((i) => !i.blocked), paymentDate),
    items
  };
}

module.exports = { TERMS, termsFor, evaluateItem, aging, forecast, proposal, addDays, daysBetween, fmt };
