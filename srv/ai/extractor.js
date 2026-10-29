/**
 * Invoice understanding: document -> structured invoice.
 *
 * 1. Text layer:   PDF text extraction (pdf-parse) or plain text.
 * 2. Extraction:   LLM with a strict JSON schema when a provider is configured,
 *                  otherwise a deterministic layout parser (regex + heuristics
 *                  tuned for Indian GST invoices).
 * 3. Validation:   arithmetic cross-checks (sum of lines = subtotal, subtotal + tax = total,
 *                  qty x rate = amount, GSTIN checksum format) produce a confidence score.
 */
'use strict';
const cds = require('@sap/cds');
const llm = require('./llm');
const LOG = cds.log('extract');

const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;
const BUYER_GSTIN = process.env.BUYER_GSTIN || '36AAACA4521K1ZQ';

async function documentToText(buffer, fileName = '') {
  const isPdf = buffer.subarray(0, 5).toString() === '%PDF-' || /\.pdf$/i.test(fileName);
  if (!isPdf) return buffer.toString('utf8');
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const r = await parser.getText();
    return r.text.replace(/\n-- \d+ of \d+ --\n?/g, '\n').trim();
  } finally {
    await parser.destroy();
  }
}

// ----------------------------------------------------------------- helpers
const toNum = (s) => (s === undefined || s === null || s === '' ? null : Number(String(s).replace(/[^0-9.\-]/g, '')));
function toISODate(s) {
  if (!s) return null;
  s = String(s).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[\-\/.](\d{1,2})[\-\/.](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
const grab = (text, re) => { const m = re.exec(text); return m ? m[1].trim() : null; };

// ----------------------------------------------------------------- layout parser
function layoutParse(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const vendorName = lines.find((l) => !/tax invoice|^invoice$|gstin|^\d/i.test(l)) || null;
  const gstins = (text.match(GSTIN_RE) || []).filter((g) => g !== BUYER_GSTIN);

  const items = [];
  const ITEM_RE = /^(\d{1,3})\s+([A-Z]{2,}-[A-Z0-9\-]+)\s+(.+?)\s+([\d,]+(?:\.\d+)?)\s+([A-Z]{1,4})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})$/;
  for (const l of lines) {
    const m = ITEM_RE.exec(l);
    if (m) items.push({ lineNo: +m[1], material: m[2], description: m[3], quantity: toNum(m[4]), unit: m[5], unitPrice: toNum(m[6]), amount: toNum(m[7]) });
  }
  const taxParts = [...text.matchAll(/(?:CGST|SGST|IGST|GST|Tax)[^:\n]*:\s*([\d,]+\.\d{2})/gi)].map((m) => toNum(m[1]));

  return {
    vendorName,
    vendorGstin: gstins[0] || null,
    invoiceNumber: grab(text, /Invoice\s*(?:No|Number|#)\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-]*)/i),
    invoiceDate: toISODate(grab(text, /Invoice\s*Date\s*[:\-]?\s*([0-9]{1,4}[\-\/.][0-9]{1,2}[\-\/.][0-9]{2,4})/i)),
    dueDate: toISODate(grab(text, /Due\s*Date\s*[:\-]?\s*([0-9]{1,4}[\-\/.][0-9]{1,2}[\-\/.][0-9]{2,4})/i)),
    poNumber: grab(text, /P\.?O\.?\s*(?:No|Number|#)?\.?\s*[:\-]?\s*(\d{10})/i),
    currency: /USD|\$/.test(text) && !/INR|₹/.test(text) ? 'USD' : 'INR',
    netAmount: toNum(grab(text, /Sub\s*Total\s*[:\-]?\s*(?:INR|₹)?\s*([\d,]+\.\d{2})/i)),
    taxAmount: taxParts.length ? Math.round(taxParts.reduce((a, b) => a + b, 0) * 100) / 100 : null,
    grossAmount: toNum(grab(text, /(?:Grand\s*Total|Total\s*Amount|Amount\s*Due)[^:\n]*:\s*(?:INR|₹)?\s*([\d,]+\.\d{2})/i)),
    bankAccount: grab(text, /Bank\s*(?:Account|A\/c)[^:\n]*:\s*([A-Z0-9\-\/ ]+)/i),
    items
  };
}

// ----------------------------------------------------------------- LLM extraction
const SCHEMA_HINT = `{
  "vendorName": string, "vendorGstin": string|null, "invoiceNumber": string, "invoiceDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD"|null, "poNumber": string|null (10-digit SAP PO), "currency": "INR"|"USD"|"EUR",
  "netAmount": number, "taxAmount": number, "grossAmount": number, "bankAccount": string|null,
  "items": [{ "lineNo": number, "material": string|null, "description": string, "quantity": number,
              "unit": string, "unitPrice": number, "amount": number }]
}`;

async function llmParse(text) {
  const r = await llm.chat({
    system: 'You are an accounts-payable document AI for an SAP S/4HANA customer in India. Extract invoice data exactly as printed. Numbers must be plain JSON numbers (convert Indian digit grouping like 2,94,000.00 to 294000). Dates must be ISO YYYY-MM-DD (Indian invoices use DD-MM-YYYY). The buyer is Aurora Industries Ltd (GSTIN ' + BUYER_GSTIN + ') - never return the buyer as the vendor. Use null when a field is absent. Return JSON only.',
    messages: [{ role: 'user', content: `Schema:\n${SCHEMA_HINT}\n\nInvoice document text:\n"""\n${text.slice(0, 12000)}\n"""` }],
    json: true,
    maxTokens: 2000
  });
  const j = llm.safeJSON(r.text);
  if (!j) throw new Error('LLM returned non-JSON output');
  j.invoiceDate = toISODate(j.invoiceDate);
  j.dueDate = toISODate(j.dueDate);
  for (const k of ['netAmount', 'taxAmount', 'grossAmount']) j[k] = toNum(j[k]);
  j.items = (j.items || []).map((it, i) => ({ ...it, lineNo: it.lineNo || i + 1, quantity: toNum(it.quantity), unitPrice: toNum(it.unitPrice), amount: toNum(it.amount) }));
  return j;
}

// ----------------------------------------------------------------- validation
function validate(inv) {
  const checks = [];
  const near = (a, b, tol = 1) => a !== null && b !== null && Math.abs(a - b) <= tol;
  const required = ['vendorName', 'invoiceNumber', 'invoiceDate', 'grossAmount'];
  required.forEach((f) => checks.push({ check: `field:${f}`, ok: inv[f] !== null && inv[f] !== undefined && inv[f] !== '' }));
  checks.push({ check: 'has-line-items', ok: inv.items.length > 0 });
  const sumLines = Math.round(inv.items.reduce((s, i) => s + (i.amount || 0), 0) * 100) / 100;
  checks.push({ check: 'lines-sum-to-subtotal', ok: near(sumLines, inv.netAmount) });
  checks.push({ check: 'subtotal-plus-tax-equals-total', ok: near((inv.netAmount || 0) + (inv.taxAmount || 0), inv.grossAmount) });
  checks.push({ check: 'qty-x-rate-equals-amount', ok: inv.items.every((i) => near(i.quantity * i.unitPrice, i.amount, 1)) });
  checks.push({ check: 'gstin-format', ok: !inv.vendorGstin || new RegExp(GSTIN_RE.source).test(inv.vendorGstin) });
  const passed = checks.filter((c) => c.ok).length;
  return { confidence: Math.round((passed / checks.length) * 10000) / 100, checks };
}

/**
 * Extract a structured invoice from a document.
 * Returns { invoice, rawText, engine, confidence, checks }
 */
async function extract(buffer, fileName) {
  const rawText = await documentToText(buffer, fileName);
  const layout = layoutParse(rawText);
  let invoice = layout;
  let engine = 'layout-parser';

  if (llm.enabled()) {
    try {
      const ai = await llmParse(rawText);
      // Prefer the LLM, but keep deterministic values where the LLM left gaps
      invoice = { ...layout, ...Object.fromEntries(Object.entries(ai).filter(([, v]) => v !== null && v !== undefined && v !== '')) };
      if (!ai.items?.length) invoice.items = layout.items;
      engine = `llm:${llm.info().model}`;
    } catch (e) {
      LOG.warn('LLM extraction failed, falling back to layout parser:', e.message);
    }
  }
  // Derive missing totals
  if (invoice.netAmount === null && invoice.items.length) invoice.netAmount = Math.round(invoice.items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  if (invoice.taxAmount === null && invoice.grossAmount !== null && invoice.netAmount !== null) invoice.taxAmount = Math.round((invoice.grossAmount - invoice.netAmount) * 100) / 100;

  const v = validate(invoice);
  return { invoice, rawText, engine, confidence: v.confidence, checks: v.checks };
}

module.exports = { extract, layoutParse, validate, documentToText, toISODate };
