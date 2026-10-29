/**
 * The ProcureIQ invoice pipeline:
 *
 *   Document ─► AI extraction ─► Vendor resolution (SAP) ─► PO + GR fetch (SAP)
 *            ─► 3-way match ─► Rule engine + ML anomaly score ─► AI reviewer summary
 *            ─► persisted invoice + audit trail ─► status (Matched | Exception)
 */
'use strict';
const cds = require('@sap/cds');
const s4 = require('./sap/s4-client');
const extractor = require('./ai/extractor');
const llm = require('./ai/llm');
const { threeWayMatch } = require('./engine/three-way-match');
const rules = require('./engine/risk-rules');
const ml = require('./engine/ml-client');
const settings = require('./engine/settings');

const LOG = cds.log('pipeline');
const fmt = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function recommendation(level, matchStatus) {
  if (level === 'Critical') return 'BLOCK';
  if (level === 'High' || matchStatus !== 'MATCHED') return 'REVIEW';
  if (level === 'Medium') return 'REVIEW';
  return 'APPROVE';
}

function templateSummary({ inv, supplier, match, findings, risk, mlRes }) {
  const rec = recommendation(risk.level, match.status);
  const lines = [];
  lines.push(`**Recommendation: ${rec}** - risk ${risk.score}/100 (${risk.level}).`);
  lines.push(`${supplier ? supplier.name : inv.vendorName} billed ${fmt(inv.grossAmount)} against ${inv.poNumber ? 'PO ' + inv.poNumber : 'no purchase order'}.`);
  if (match.status === 'MATCHED') lines.push('3-way match passed on all lines within tolerance.');
  else if (match.status === 'NO_PO') lines.push('3-way match not possible - no valid PO in SAP.');
  else lines.push(`3-way match exceptions on ${match.lines.filter((l) => l.status !== 'OK').length} of ${match.lines.length} line(s)${match.varianceAmount ? `, potential overpayment ${fmt(match.varianceAmount)}` : ''}.`);
  const top = [...findings].sort((a, b) => b.weight - a.weight).slice(0, 3);
  if (top.length) lines.push('Key signals: ' + top.map((f) => f.title).join('; ') + '.');
  if (mlRes?.topFactors?.length && mlRes.anomalyScore >= 0.5) lines.push(`ML model flags the invoice as unusual (score ${mlRes.anomalyScore}), driven mainly by ${mlRes.topFactors.map((f) => f.label.toLowerCase()).join(', ')}.`);
  if (rec === 'BLOCK') lines.push('Next step: keep payment blocked and contact the vendor through master-data contact details.');
  else if (rec === 'REVIEW') lines.push('Next step: buyer to confirm the variance or request a credit note before approval.');
  else lines.push('Next step: safe to approve and post to SAP.');
  return lines.join('\n');
}

async function aiSummary(ctx) {
  const base = templateSummary(ctx);
  if (!ctx.useLLM || !llm.enabled()) return base;
  try {
    const r = await llm.chat({
      system: 'You are a senior accounts-payable controller at an SAP S/4HANA customer. Write a crisp reviewer note (max 90 words) for the approver. Start with "**Recommendation: APPROVE|REVIEW|BLOCK**". Mention the concrete numbers. No preamble.',
      messages: [{ role: 'user', content: JSON.stringify({
        invoice: { number: ctx.inv.invoiceNumber, vendor: ctx.inv.vendorName, gross: ctx.inv.grossAmount, po: ctx.inv.poNumber, date: ctx.inv.invoiceDate },
        threeWayMatch: { status: ctx.match.status, lines: ctx.match.lines.map((l) => ({ line: l.lineNo, status: l.status, message: l.message })), overpayment: ctx.match.varianceAmount },
        findings: ctx.findings.map((f) => ({ severity: f.severity, title: f.title, detail: f.detail })),
        ml: ctx.mlRes, risk: ctx.risk, suggestedRecommendation: recommendation(ctx.risk.level, ctx.match.status)
      }) }],
      maxTokens: 300,
      temperature: 0.2
    });
    return r.text?.trim() || base;
  } catch (e) {
    LOG.warn('summary LLM failed:', e.message);
    return base;
  }
}

/**
 * Process one document end-to-end and persist it.
 * @returns the created invoice ID
 */
async function processDocument(buffer, fileName, opts = {}) {
  const { Invoices, AuditLog, Vendors } = cds.entities('procureiq');
  const t0 = Date.now();
  const actor = opts.actor || 'system';

  // 0. Intake de-duplication: the exact same file must never enter the workflow twice
  const documentHash = require('crypto').createHash('sha256').update(buffer).digest('hex');
  const seen = await SELECT.one.from(Invoices).columns('ID', 'invoiceNumber', 'status').where({ documentHash });
  if (seen) {
    const err = new Error(`This document was already captured as invoice ${seen.invoiceNumber} (status ${seen.status})`);
    err.code = 'DUPLICATE_DOCUMENT';
    err.existingId = seen.ID;
    throw err;
  }

  // 1. AI extraction
  const ex = opts.forceLayout
    ? (() => { const text = buffer.toString('utf8'); const inv = extractor.layoutParse(text); const v = extractor.validate(inv); return { invoice: inv, rawText: text, engine: 'layout-parser', confidence: v.confidence, checks: v.checks }; })()
    : await extractor.extract(buffer, fileName);
  const inv = ex.invoice;
  const cfg = await settings.current();

  // 2. Vendor resolution against SAP vendor master (GSTIN first, then fuzzy name)
  let { supplier } = await s4.findSupplier({ gstin: inv.vendorGstin, name: inv.vendorName });
  if (supplier) {
    await UPSERT.into(Vendors).entries({
      ID: supplier.id, name: supplier.name, city: supplier.city, country: supplier.country, gstin: supplier.gstin,
      bankAccount: supplier.bankAccount, category: supplier.category, paymentTerms: supplier.paymentTerms,
      onboardedOn: supplier.createdOn, postingBlocked: supplier.postingBlocked
    });
    // the payment block is maintained in ProcureIQ, not replicated from SAP
    const local = await SELECT.one.from(Vendors, supplier.id).columns('paymentBlocked', 'blockReason');
    supplier = { ...supplier, paymentBlocked: !!local?.paymentBlocked, blockReason: local?.blockReason };
  }

  // 3. PO + goods receipts from S/4HANA
  const [po, grs] = await Promise.all([s4.getPurchaseOrder(inv.poNumber), s4.getGoodsReceipts(inv.poNumber)]);

  // 4. 3-way match
  const match = threeWayMatch({ vendorId: supplier?.id, currency: inv.currency, poNumber: inv.poNumber, items: inv.items }, po, grs,
    { pricePctWarn: cfg.pricePctWarn, pricePctFail: cfg.pricePctFail });

  // 5. Risk: rules + ML
  const history = await SELECT.from(Invoices).columns('ID', 'vendor_ID', 'invoiceNumber', 'grossAmount', 'invoiceDate', 'status');
  const ctx = { invoice: inv, supplier, po, match, history, validation: ex.checks, approvalLimit: cfg.approvalLimit };
  const findings = rules.evaluate(ctx);
  const mlRes = await ml.score(rules.features(ctx));
  if (mlRes.anomalyScore >= 0.5) {
    findings.push({
      code: 'ML_ANOMALY', source: 'ML', weight: 0,
      severity: mlRes.anomalyScore >= 0.8 ? 'High' : 'Medium',
      title: `ML anomaly score ${Math.round(mlRes.anomalyScore * 100)}%`,
      detail: `Model ${mlRes.model}. Top drivers: ${(mlRes.topFactors || []).map((f) => `${f.label} = ${f.value} (${Math.round(f.contribution * 100)}%)`).join('; ') || 'n/a'}.`
    });
  }
  const risk = rules.aggregate(findings, mlRes);
  const status = match.status === 'MATCHED' && risk.score < 20 ? 'Matched' : 'Exception';

  // 6. Reviewer summary (LLM or deterministic)
  const summary = await aiSummary({ inv, supplier, match, findings, risk, mlRes, useLLM: opts.useLLM !== false });

  // 7. Persist (deep insert) + audit trail
  const ID = cds.utils.uuid();
  const processingMs = Date.now() - t0;
  await INSERT.into(Invoices).entries({
    ID,
    invoiceNumber: inv.invoiceNumber,
    vendor_ID: supplier?.id || null,
    vendorName: supplier?.name || inv.vendorName,
    vendorGstin: inv.vendorGstin,
    bankAccount: inv.bankAccount,
    poNumber: inv.poNumber,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    currency: inv.currency || 'INR',
    netAmount: inv.netAmount,
    taxAmount: inv.taxAmount,
    grossAmount: inv.grossAmount,
    status,
    source: opts.source || 'Upload',
    fileName,
    documentHash,
    rawText: ex.rawText,
    extractionEngine: ex.engine,
    extractionConfidence: ex.confidence,
    matchStatus: match.status,
    riskScore: risk.score,
    riskLevel: risk.level,
    mlModel: mlRes.model,
    aiSummary: summary,
    processingMs,
    receivedAt: opts.receivedAt || new Date().toISOString(),
    items: inv.items.map((i, idx) => ({ lineNo: i.lineNo || idx + 1, material: i.material, description: i.description, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, amount: i.amount, poItem: match.lines[idx]?.poItem })),
    matchResults: [
      ...match.header.map((h) => ({ lineNo: 0, description: h.check, status: h.status, message: h.message })),
      ...match.lines.map((l) => ({ ...l }))
    ],
    anomalies: findings.map((f) => ({ code: f.code, severity: f.severity, title: f.title, detail: f.detail, source: f.source, weight: f.weight }))
  });

  const audit = [
    ['RECEIVED', `Document ${fileName} received via ${opts.source || 'Upload'}`],
    ['EXTRACTED', `Engine ${ex.engine}, confidence ${ex.confidence}%`],
    ['MATCHED', `3-way match ${match.status}${po ? ` against PO ${po.poNumber}` : ''}`],
    ['SCORED', `Risk ${risk.score}/100 (${risk.level}); ML ${mlRes.model} score ${mlRes.anomalyScore}`],
    ['ROUTED', `Status ${status} in ${processingMs} ms`]
  ];
  await INSERT.into(AuditLog).entries(audit.map(([action, detail], step) => ({ invoice_ID: ID, step, action, actor, detail })));
  if (supplier) await refreshVendorRisk(supplier.id);
  LOG.info(`${inv.invoiceNumber} -> ${status} risk=${risk.score} (${processingMs} ms)`);
  return { ID, invoiceNumber: inv.invoiceNumber, status, riskLevel: risk.level, processingMs };
}

async function refreshVendorRisk(vendorId) {
  const { Invoices, Vendors } = cds.entities('procureiq');
  const rows = await SELECT.from(Invoices).columns('riskScore').where({ vendor_ID: vendorId });
  if (!rows.length) return UPDATE(Vendors, vendorId).with({ riskScore: 0 }); // last invoice deleted
  const avg = rows.reduce((s, r) => s + Number(r.riskScore), 0) / rows.length;
  const max = Math.max(...rows.map((r) => Number(r.riskScore)));
  await UPDATE(Vendors, vendorId).with({ riskScore: Math.round((0.6 * avg + 0.4 * max) * 100) / 100 });
}

module.exports = { processDocument, recommendation, refreshVendorRisk };
