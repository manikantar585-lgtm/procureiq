/**
 * Fraud & compliance rule engine + feature builder for the ML model.
 *
 * Every rule returns an explainable finding (code, severity, weight, human readable detail)
 * so auditors can see exactly why an invoice was blocked.
 */
'use strict';

const APPROVAL_LIMIT = Number(process.env.APPROVAL_LIMIT || 1000000); // INR 10 lakh
const DAY = 86400000;
const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
const normNo = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normAcct = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const fmt = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/**
 * @param ctx {
 *   invoice  : extracted invoice,
 *   supplier : SAP supplier (normalised) | null,
 *   po       : SAP PO | null,
 *   match    : 3-way match result,
 *   history  : previous invoices [{ID, vendor_ID, invoiceNumber, grossAmount, invoiceDate, status}],
 *   validation: extractor checks
 * }
 */
function evaluate(ctx) {
  const { invoice, supplier, po, match, history = [], validation } = ctx;
  const out = [];
  const add = (code, severity, weight, title, detail) => out.push({ code, severity, weight, title, detail, source: 'RULE' });
  const vendorHist = supplier ? history.filter((h) => h.vendor_ID === supplier.id && h.status !== 'Rejected') : [];

  // --- vendor master checks
  if (!supplier) add('VENDOR_UNKNOWN', 'High', 35, 'Vendor not in SAP vendor master', `"${invoice.vendorName}" (GSTIN ${invoice.vendorGstin || 'n/a'}) could not be matched to any S/4HANA supplier.`);
  else {
    if (supplier.postingBlocked) add('VENDOR_BLOCKED', 'Critical', 60, 'Vendor is blocked for posting', `Supplier ${supplier.id} has a posting block in SAP.`);
    if (invoice.bankAccount && supplier.bankAccount && normAcct(invoice.bankAccount) !== normAcct(supplier.bankAccount)) {
      add('BANK_ACCOUNT_MISMATCH', 'Critical', 55, 'Bank account differs from vendor master',
        `Invoice asks for payment to ${invoice.bankAccount}, but SAP vendor master holds ${supplier.bankAccount}. This is the #1 pattern in vendor-impersonation (BEC) fraud - confirm with the vendor by phone using master-data contact details before paying.`);
    }
    if (invoice.vendorGstin && supplier.gstin && invoice.vendorGstin !== supplier.gstin) {
      add('GSTIN_MISMATCH', 'High', 35, 'GSTIN does not belong to this vendor',
        `Invoice GSTIN ${invoice.vendorGstin} != registered GSTIN ${supplier.gstin}. Input tax credit may be disallowed under GST rules.`);
    }
    const ageDays = supplier.createdOn && invoice.invoiceDate ? days(invoice.invoiceDate, supplier.createdOn) : null;
    if (ageDays !== null && ageDays < 90) add('NEW_VENDOR', 'Medium', 12, 'Recently onboarded vendor', `Vendor was created in SAP ${ageDays} days before this invoice.`);
  }

  // --- duplicates
  const sameNo = vendorHist.find((h) => normNo(h.invoiceNumber) === normNo(invoice.invoiceNumber));
  if (sameNo) add('DUPLICATE_INVOICE', 'Critical', 50, 'Duplicate invoice number', `Invoice ${invoice.invoiceNumber} from this vendor was already received (status: ${sameNo.status}). Paying it again would be a duplicate payment of ${fmt(invoice.grossAmount)}.`);
  else {
    const sameAmt = vendorHist.find((h) => Math.abs(Number(h.grossAmount) - invoice.grossAmount) < 1 && Math.abs(days(invoice.invoiceDate, h.invoiceDate)) <= 30);
    if (sameAmt) add('POSSIBLE_DUPLICATE', 'High', 30, 'Same amount billed twice within 30 days', `Invoice ${sameAmt.invoiceNumber} has the identical amount ${fmt(invoice.grossAmount)}.`);
  }

  // --- approval-limit gaming
  const ratio = invoice.grossAmount / APPROVAL_LIMIT;
  const recent = vendorHist.filter((h) => Math.abs(days(invoice.invoiceDate, h.invoiceDate)) <= 14);
  const recentSum = recent.reduce((s, h) => s + Number(h.grossAmount), 0);
  if (recent.length && recentSum + invoice.grossAmount > APPROVAL_LIMIT && invoice.grossAmount < APPROVAL_LIMIT && recent.every((h) => Number(h.grossAmount) < APPROVAL_LIMIT)) {
    add('SPLIT_INVOICING', 'High', 28, 'Possible split invoicing', `${recent.length + 1} invoices from this vendor within 14 days total ${fmt(recentSum + invoice.grossAmount)} - above the ${fmt(APPROVAL_LIMIT)} approval limit, while each one stays below it.`);
  } else if (ratio >= 0.95 && ratio < 1) {
    add('THRESHOLD_PROXIMITY', 'Medium', 10, 'Amount just below approval limit', `${fmt(invoice.grossAmount)} is ${(ratio * 100).toFixed(1)}% of the ${fmt(APPROVAL_LIMIT)} approval limit.`);
  }

  // --- 3-way match driven
  if (match.status === 'NO_PO') add('PO_NOT_FOUND', 'High', 30, 'No valid purchase order', match.header[0].message + '. Maverick (non-PO) spend requires manager approval.');
  const failQty = match.lines.filter((l) => /received|ordered qty/.test(l.message || '') && l.status === 'FAIL');
  if (failQty.length) add('QTY_EXCEEDS_GR', 'High', 30, 'Billed for goods not received', failQty.map((l) => `Line ${l.lineNo}: ${l.message}`).join(' | ') + `. Potential overpayment ${fmt(match.varianceAmount)}.`);
  if (po && match.lines.some((l) => l.grQty === 0)) add('NO_GOODS_RECEIPT', 'High', 25, 'No goods receipt posted', 'GR-based invoice verification: goods/services have not been confirmed as received in SAP.');
  const priceLines =match.lines.filter((l) => l.priceVariancePct > 0 && /above PO price/.test(l.message || ''));
  if (priceLines.length) {
    const worst = Math.max(...priceLines.map((l) => l.priceVariancePct));
    add('PRICE_VARIANCE', worst > 5 ? 'High' : 'Medium', worst > 5 ? 25 : 12, 'Price above contracted PO price', priceLines.map((l) => `Line ${l.lineNo} ${l.material}: ${fmt(l.invoicePrice)} vs PO ${fmt(l.poPrice)} (+${l.priceVariancePct}%)`).join(' | '));
  }
  if (match.lines.some((l) => /unordered/.test(l.message || ''))) add('UNORDERED_ITEM', 'High', 25, 'Item not on purchase order', 'Invoice contains line(s) that do not exist on the PO.');
  if (po && invoice.invoiceDate && po.poDate && days(invoice.invoiceDate, po.poDate) < 0) add('INVOICE_BEFORE_PO', 'Medium', 15, 'Invoice dated before the PO', `Invoice ${invoice.invoiceDate} precedes PO date ${po.poDate} (after-the-fact PO).`);

  // --- document hygiene
  const d = invoice.invoiceDate ? new Date(invoice.invoiceDate + 'T00:00:00Z').getUTCDay() : null;
  if (d === 0) add('SUNDAY_INVOICE', 'Low', 3, 'Invoice dated on a Sunday', 'Unusual for B2B billing; low weight signal.');
  if (invoice.grossAmount >= 50000 && invoice.grossAmount % 1000 === 0) add('ROUND_AMOUNT', 'Low', 5, 'Suspiciously round amount', `${fmt(invoice.grossAmount)} is an exact multiple of 1,000 including tax.`);
  const arith = (validation || []).filter((c) => !c.ok && /sum|total|rate/.test(c.check));
  if (arith.length) add('ARITHMETIC_ERROR', 'Medium', 15, 'Invoice arithmetic does not add up', arith.map((c) => c.check).join(', '));

  return out;
}

/** Numeric feature vector for the IsolationForest model. Order matters - keep in sync with ml-service/features.py */
function features(ctx) {
  const { invoice, supplier, po, match, history = [] } = ctx;
  const vendorHist = supplier ? history.filter((h) => h.vendor_ID === supplier.id) : [];
  const amounts = vendorHist.map((h) => Number(h.grossAmount));
  const mean = amounts.length ? amounts.reduce((a, b) => a + b, 0) / amounts.length : invoice.grossAmount;
  const sd = amounts.length > 1 ? Math.sqrt(amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / (amounts.length - 1)) : mean * 0.5 || 1;
  const priceVars = match.lines.map((l) => l.priceVariancePct || 0);
  const overGr = match.lines.map((l) => (l.grQty ? Math.max(0, (l.invoiceQty - l.grQty) / l.grQty) : l.status === 'FAIL' ? 1 : 0));
  return {
    log_amount: Math.log10(Math.max(1, invoice.grossAmount || 1)),
    amount_zscore: Math.max(-5, Math.min(10, ((invoice.grossAmount || 0) - mean) / (sd || 1))),
    line_count: invoice.items.length,
    max_price_var_pct: priceVars.length ? Math.max(...priceVars) : 0,
    qty_over_gr_ratio: overGr.length ? Math.max(...overGr) : 0,
    days_po_to_invoice: po && invoice.invoiceDate ? days(invoice.invoiceDate, po.poDate) : 0,
    vendor_age_days: supplier?.createdOn && invoice.invoiceDate ? Math.min(3650, days(invoice.invoiceDate, supplier.createdOn)) : 0,
    threshold_ratio: (invoice.grossAmount || 0) / APPROVAL_LIMIT,
    vendor_invoices_30d: vendorHist.filter((h) => Math.abs(days(invoice.invoiceDate, h.invoiceDate)) <= 30).length,
    has_po: po ? 1 : 0
  };
}

function aggregate(findings, ml) {
  const ruleScore = findings.reduce((s, f) => s + Number(f.weight), 0);
  const mlScore = ml ? Math.round(ml.anomalyScore * 25) : 0; // ML contributes up to 25 points
  let score = Math.min(100, ruleScore + mlScore);
  // severity floors: a single critical finding must never be averaged away
  if (findings.some((f) => f.severity === 'Critical')) score = Math.max(score, 75);
  else if (findings.some((f) => f.severity === 'High')) score = Math.max(score, 45);
  const level = score >= 70 ? 'Critical' : score >= 45 ? 'High' : score >= 20 ? 'Medium' : 'Low';
  return { score, level };
}

module.exports = { evaluate, features, aggregate, APPROVAL_LIMIT };
