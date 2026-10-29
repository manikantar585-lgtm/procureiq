/**
 * ProcureIQ Copilot - an agent that answers AP / procurement questions by calling tools
 * over live data (ProcureIQ DB + SAP S/4HANA APIs) and company policy (RAG).
 *
 * With an LLM configured it runs a ReAct-style tool-calling loop.
 * Without one it uses a deterministic intent router over the same tools, so the demo
 * always works offline.
 */
'use strict';
const cds = require('@sap/cds');
const llm = require('./llm');
const knowledge = require('./knowledge');
const s4 = require('../sap/s4-client');

const LOG = cds.log('copilot');
const MAX_STEPS = 6;
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const E = () => cds.entities('procureiq');

// ------------------------------------------------------------------ tools
const TOOLS = [
  {
    name: 'search_invoices',
    description: 'Search supplier invoices in ProcureIQ. Use for lists, counts, "which invoices...", "show me high risk", "pending approval" questions.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['Matched', 'Exception', 'Approved', 'Rejected', 'Posted'], description: 'Workflow status. Matched = clean & waiting for approval.' },
        riskLevel: { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'] },
        minRiskLevel: { type: 'string', enum: ['Medium', 'High', 'Critical'], description: 'Return this level and above' },
        vendor: { type: 'string', description: 'Vendor name (partial) or SAP supplier number' },
        anomalyCode: { type: 'string', description: 'e.g. DUPLICATE_INVOICE, BANK_ACCOUNT_MISMATCH, PRICE_VARIANCE, QTY_EXCEEDS_GR, SPLIT_INVOICING, GSTIN_MISMATCH, PO_NOT_FOUND, NEW_VENDOR' },
        minAmount: { type: 'number' },
        fromDate: { type: 'string', description: 'YYYY-MM-DD invoice date from' },
        toDate: { type: 'string', description: 'YYYY-MM-DD invoice date to' },
        sortBy: { type: 'string', enum: ['risk', 'amount', 'date'] },
        limit: { type: 'number' }
      }
    },
    run: async (a) => {
      const { Invoices, Anomalies } = E();
      const q = SELECT.from(Invoices).columns('ID', 'invoiceNumber', 'vendor_ID', 'vendorName', 'poNumber', 'invoiceDate', 'grossAmount', 'status', 'riskScore', 'riskLevel', 'matchStatus');
      const where = [];
      if (a.status) where.push({ status: a.status });
      if (a.riskLevel) where.push({ riskLevel: a.riskLevel });
      if (a.minRiskLevel) where.push({ riskLevel: { in: ['Low', 'Medium', 'High', 'Critical'].slice(['Low', 'Medium', 'High', 'Critical'].indexOf(a.minRiskLevel)) } });
      if (a.minAmount) where.push({ grossAmount: { '>=': a.minAmount } });
      if (a.fromDate) where.push({ invoiceDate: { '>=': a.fromDate } });
      if (a.toDate) where.push({ invoiceDate: { '<=': a.toDate } });
      where.forEach((w) => q.where(w));
      let rows = await q;
      if (a.vendor) {
        const v = a.vendor.toLowerCase();
        rows = rows.filter((r) => (r.vendorName || '').toLowerCase().includes(v) || r.vendor_ID === a.vendor);
      }
      if (a.anomalyCode) {
        const hits = new Set((await SELECT.from(Anomalies).columns('parent_ID').where({ code: a.anomalyCode })).map((x) => x.parent_ID));
        rows = rows.filter((r) => hits.has(r.ID));
      }
      const sort = { risk: (x, y) => y.riskScore - x.riskScore, amount: (x, y) => y.grossAmount - x.grossAmount, date: (x, y) => String(y.invoiceDate).localeCompare(x.invoiceDate) }[a.sortBy || 'risk'];
      rows.sort(sort);
      const total = rows.reduce((s, r) => s + Number(r.grossAmount), 0);
      return { count: rows.length, totalAmount: total, invoices: rows.slice(0, a.limit || 10).map(({ ID, ...r }) => r) };
    }
  },
  {
    name: 'get_invoice',
    description: 'Full details of one invoice: extracted data, 3-way match lines, risk findings, AI summary and audit trail. Use to explain why an invoice is blocked or risky.',
    parameters: { type: 'object', properties: { invoiceNumber: { type: 'string' } }, required: ['invoiceNumber'] },
    run: async ({ invoiceNumber }) => {
      const { Invoices, InvoiceItems, MatchResults, Anomalies, AuditLog } = E();
      const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const all = await SELECT.from(Invoices).columns('ID', 'invoiceNumber');
      const hit = all.find((i) => norm(i.invoiceNumber) === norm(invoiceNumber)) || all.find((i) => norm(i.invoiceNumber).includes(norm(invoiceNumber)));
      if (!hit) return { error: `Invoice ${invoiceNumber} not found` };
      const inv = await SELECT.one.from(Invoices, hit.ID).columns((i) => { i`.*`; });
      delete inv.rawText;
      const [items, match, anomalies, audit] = await Promise.all([
        SELECT.from(InvoiceItems).where({ parent_ID: hit.ID }).orderBy('lineNo'),
        SELECT.from(MatchResults).where({ parent_ID: hit.ID }).orderBy('lineNo'),
        SELECT.from(Anomalies).where({ parent_ID: hit.ID }).orderBy({ weight: 'desc' }),
        SELECT.from(AuditLog).where({ invoice_ID: hit.ID }).orderBy('createdAt', 'step')
      ]);
      const strip = (r) => { const { ID, parent_ID, ...x } = r; return x; };
      return { invoice: inv, items: items.map(strip), threeWayMatch: match.map(strip), riskFindings: anomalies.map(strip), audit: audit.map((a) => ({ at: a.createdAt, action: a.action, actor: a.actor, detail: a.detail })) };
    }
  },
  {
    name: 'get_purchase_order',
    description: 'Live lookup of a purchase order and its goods receipts in SAP S/4HANA.',
    parameters: { type: 'object', properties: { poNumber: { type: 'string', description: '10 digit SAP PO number, e.g. 4500000117' } }, required: ['poNumber'] },
    run: async ({ poNumber }) => {
      const [po, grs] = await Promise.all([s4.getPurchaseOrder(poNumber), s4.getGoodsReceipts(poNumber)]);
      if (!po) return { error: `PO ${poNumber} not found in SAP S/4HANA` };
      const supplier = await s4.getSupplier(po.supplier);
      return { purchaseOrder: po, supplierName: supplier?.name, goodsReceipts: grs };
    }
  },
  {
    name: 'vendor_analysis',
    description: 'Risk and spend profile of a vendor: SAP master data, invoice count, spend, exceptions, risk signals.',
    parameters: { type: 'object', properties: { vendor: { type: 'string', description: 'Vendor name (partial) or SAP supplier number' } }, required: ['vendor'] },
    run: async ({ vendor }) => {
      const { Vendors, Invoices, Anomalies } = E();
      const vs = await SELECT.from(Vendors);
      const v = vs.find((x) => x.ID === vendor) || vs.find((x) => x.name.toLowerCase().includes(String(vendor).toLowerCase())) ||
        vs.find((x) => String(vendor).toLowerCase().split(/\s+/).filter((w) => w.length > 3).some((w) => x.name.toLowerCase().includes(w)));
      if (!v) return { error: `Vendor ${vendor} not found`, knownVendors: vs.map((x) => x.name) };
      const invs = await SELECT.from(Invoices).columns('ID', 'invoiceNumber', 'invoiceDate', 'grossAmount', 'status', 'riskLevel', 'riskScore').where({ vendor_ID: v.ID });
      const an = invs.length ? await SELECT.from(Anomalies).columns('code', 'severity', 'title').where({ parent_ID: { in: invs.map((i) => i.ID) } }) : [];
      const signals = {};
      an.forEach((a) => (signals[a.code] = (signals[a.code] || 0) + 1));
      return {
        vendor: v,
        invoiceCount: invs.length,
        totalSpend: invs.filter((i) => i.status !== 'Rejected').reduce((s, i) => s + Number(i.grossAmount), 0),
        exceptions: invs.filter((i) => i.status === 'Exception').length,
        riskSignals: signals,
        invoices: invs.map(({ ID, ...i }) => i)
      };
    }
  },
  {
    name: 'spend_analytics',
    description: 'Aggregated spend and processing analytics grouped by vendor, month, category or status.',
    parameters: { type: 'object', properties: { groupBy: { type: 'string', enum: ['vendor', 'month', 'category', 'status', 'riskLevel'] } }, required: ['groupBy'] },
    run: async ({ groupBy }) => {
      const { Invoices, Vendors } = E();
      const rows = await SELECT.from(Invoices).columns('vendorName', 'vendor_ID', 'invoiceDate', 'grossAmount', 'status', 'riskLevel').where({ status: { '!=': 'Rejected' } });
      const cats = Object.fromEntries((await SELECT.from(Vendors).columns('ID', 'category')).map((v) => [v.ID, v.category]));
      const key = { vendor: (r) => r.vendorName, month: (r) => String(r.invoiceDate).slice(0, 7), category: (r) => cats[r.vendor_ID] || 'Unknown', status: (r) => r.status, riskLevel: (r) => r.riskLevel }[groupBy];
      const agg = {};
      rows.forEach((r) => { const k = key(r); agg[k] ||= { group: k, invoices: 0, amount: 0 }; agg[k].invoices++; agg[k].amount += Number(r.grossAmount); });
      return { groupBy, rows: Object.values(agg).sort((a, b) => (groupBy === 'month' ? a.group.localeCompare(b.group) : b.amount - a.amount)) };
    }
  },
  {
    name: 'search_policy',
    description: 'Search company AP policy, SAP P2P guide and fraud playbook (RAG). Use for rules, limits, tolerances, compliance (GST, MSME), "what should I do" questions.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run: async ({ query }) => ({ passages: knowledge.search(query, 3) })
  }
];
const TOOL_MAP = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

async function runTool(name, args, trace, sources) {
  const t = TOOL_MAP[name];
  if (!t) return { error: `unknown tool ${name}` };
  trace.push(`${name}(${JSON.stringify(args)})`);
  try {
    const res = await t.run(args || {});
    if (name === 'search_policy') res.passages?.forEach((p) => sources.push({ kind: 'policy', ref: p.id, title: p.title }));
    if (name === 'get_invoice' && res.invoice) sources.push({ kind: 'invoice', ref: res.invoice.ID, title: `Invoice ${res.invoice.invoiceNumber}` });
    if (name === 'get_purchase_order' && res.purchaseOrder) sources.push({ kind: 'sap', ref: res.purchaseOrder.poNumber, title: `SAP PO ${res.purchaseOrder.poNumber}` });
    if (name === 'search_invoices') (res.invoices || []).slice(0, 5).forEach((i) => sources.push({ kind: 'invoice-number', ref: i.invoiceNumber, title: `Invoice ${i.invoiceNumber}` }));
    return res;
  } catch (e) {
    LOG.error(name, e);
    return { error: e.message };
  }
}

const SYSTEM = () => `You are ProcureIQ Copilot, an AI assistant for the Accounts Payable and Procurement team of Aurora Industries Ltd, an SAP S/4HANA customer in Hyderabad, India. Today is ${new Date().toISOString().slice(0, 10)}.
- Always ground answers in tool results. Never invent invoice numbers, amounts, vendors or policy rules.
- Use search_policy for any question about rules, limits or what to do; cite the policy section in the answer.
- Amounts are INR; format with Indian grouping (e.g. ₹9,77,984) and use lakh/crore where natural.
- Be concise and action-oriented: lead with the answer, then a short bullet list or a compact markdown table, then a recommended next step.
- Refer to invoices by their invoice number and to SAP objects by number (PO 4500000117).`;

// ------------------------------------------------------------------ LLM agent loop
async function askLLM(question, history) {
  const trace = [], sources = [];
  const messages = [...history.slice(-6).map((h) => ({ role: h.role, content: h.content })), { role: 'user', content: question }];
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await llm.chat({ system: SYSTEM(), messages, tools: TOOLS.map(({ run, ...t }) => t), maxTokens: 1200 });
    if (!r.toolCalls.length) return { answer: r.text, toolCalls: trace, sources: dedupe(sources) };
    messages.push({ role: 'assistant', content: r.text, toolCalls: r.toolCalls });
    for (const call of r.toolCalls) {
      const res = await runTool(call.name, call.args, trace, sources);
      messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(res).slice(0, 12000) });
    }
  }
  return { answer: 'I gathered the data but hit the reasoning step limit. Please narrow the question.', toolCalls: trace, sources: dedupe(sources) };
}
const dedupe = (s) => s.filter((x, i) => s.findIndex((y) => y.ref === x.ref) === i);

// ------------------------------------------------------------------ offline router
const INV_RE = /\b([A-Z]{3}\/\d{2}-\d{3}\/\d{4})\b/i;
const PO_RE = /\b(45\d{8})\b/;

function table(rows, cols) {
  if (!rows.length) return '_No matching records._';
  return `| ${cols.map((c) => c[0]).join(' | ')} |\n|${cols.map(() => '---').join('|')}|\n` + rows.map((r) => `| ${cols.map((c) => c[1](r)).join(' | ')} |`).join('\n');
}
const invCols = [['Invoice', (r) => r.invoiceNumber], ['Vendor', (r) => r.vendorName], ['Amount', (r) => inr(r.grossAmount)], ['Status', (r) => r.status], ['Risk', (r) => `${r.riskLevel} (${Math.round(r.riskScore)})`]];

async function askOffline(question) {
  const q = question.toLowerCase();
  const trace = [], sources = [];
  const run = (n, a) => runTool(n, a, trace, sources);
  let answer;

  const invNo = INV_RE.exec(question)?.[1];
  const poNo = PO_RE.exec(question)?.[1];
  if (invNo) {
    const d = await run('get_invoice', { invoiceNumber: invNo });
    if (d.error) answer = d.error;
    else {
      const i = d.invoice;
      answer = `**${i.invoiceNumber}** from **${i.vendorName}** - ${inr(i.grossAmount)}, status **${i.status}**, risk **${i.riskLevel} (${Math.round(i.riskScore)}/100)**.\n\n${i.aiSummary}\n\n` +
        (d.riskFindings.length ? '**Risk findings**\n' + d.riskFindings.map((f) => `- **${f.severity}** · ${f.title}: ${f.detail}`).join('\n') : 'No risk findings.') +
        '\n\n**3-way match**\n' + table(d.threeWayMatch.filter((m) => m.lineNo > 0), [['Line', (m) => m.lineNo], ['Material', (m) => m.material || '-'], ['Inv qty', (m) => m.invoiceQty], ['PO qty', (m) => m.poQty ?? '-'], ['GR qty', (m) => m.grQty ?? '-'], ['Price var', (m) => (m.priceVariancePct ?? 0) + '%'], ['Result', (m) => m.status]]);
    }
  } else if (poNo) {
    const d = await run('get_purchase_order', { poNumber: poNo });
    answer = d.error || `**SAP PO ${poNo}** · ${d.supplierName} · dated ${d.purchaseOrder.poDate}\n\n` +
      table(d.purchaseOrder.items.map((it) => ({ ...it, gr: d.goodsReceipts.filter((g) => g.poItem === it.poItem).reduce((s, g) => s + g.quantity, 0) })),
        [['Item', (r) => r.poItem], ['Material', (r) => r.material], ['Description', (r) => r.description], ['Ordered', (r) => `${r.quantity} ${r.unit}`], ['Received', (r) => r.gr], ['Net price', (r) => inr(r.netPrice)]]);
  } else if (/polic|rule|limit|toleran|allowed|should i|what do|msme|gst|approv(al)? matrix|how (do|does|to)|procedure/.test(q)) {
    const d = await run('search_policy', { query: question });
    answer = d.passages.length ? d.passages.map((p) => `**${p.title}**\n${p.content.split('\n').slice(0, 6).join('\n')}`).join('\n\n') : 'I could not find this in the policy documents.';
  } else if (/duplicate/.test(q)) {
    const d = await run('search_invoices', { anomalyCode: 'DUPLICATE_INVOICE' });
    answer = `Found **${d.count}** duplicate invoice(s) worth ${inr(d.totalAmount)} - blocked before payment.\n\n` + table(d.invoices, invCols);
  } else if (/bank|fraud|impersonat/.test(q)) {
    const d = await run('search_invoices', { anomalyCode: 'BANK_ACCOUNT_MISMATCH' });
    const s = await run('search_invoices', { anomalyCode: 'SPLIT_INVOICING' });
    answer = `**${d.count}** invoice(s) request payment to a bank account that differs from the SAP vendor master, and **${s.count}** show split-invoicing patterns.\n\n` + table([...d.invoices, ...s.invoices], invCols) + '\n\nNext step: keep these blocked and call the vendors back on master-data phone numbers (AP-POL-004 › Bank account changes).';
  } else if (/high.?risk|critical|risky|suspicious|exception|blocked|problem/.test(q)) {
    const d = await run('search_invoices', { minRiskLevel: 'High', sortBy: 'risk' });
    answer = `**${d.count}** invoice(s) are High or Critical risk, totalling ${inr(d.totalAmount)}.\n\n` + table(d.invoices, invCols);
  } else if (/pending|approv|waiting|queue/.test(q)) {
    const d = await run('search_invoices', { status: 'Matched', sortBy: 'amount' });
    answer = `**${d.count}** clean invoice(s) worth ${inr(d.totalAmount)} are waiting for approval.\n\n` + table(d.invoices, invCols);
  } else if (/price|overcharg|variance|expensive/.test(q)) {
    const d = await run('search_invoices', { anomalyCode: 'PRICE_VARIANCE' });
    answer = `**${d.count}** invoice(s) were billed above the contracted PO price.\n\n` + table(d.invoices, invCols);
  } else if (/vendor|supplier/.test(q) && !/top|spend|most/.test(q)) {
    const name = question.replace(/.*(?:vendor|supplier)\s*/i, '').replace(/[?.]/g, '').trim();
    const d = await run('vendor_analysis', { vendor: name || question });
    answer = d.error ? `${d.error}. Known vendors: ${d.knownVendors.join(', ')}` :
      `**${d.vendor.name}** (SAP ${d.vendor.ID}, ${d.vendor.category}, onboarded ${d.vendor.onboardedOn}) - ${d.invoiceCount} invoice(s), spend ${inr(d.totalSpend)}, ${d.exceptions} open exception(s), vendor risk ${d.vendor.riskScore}.\n\n` +
      (Object.keys(d.riskSignals).length ? 'Signals: ' + Object.entries(d.riskSignals).map(([k, v]) => `${k} ×${v}`).join(', ') : 'No risk signals.');
  } else if (/spend|top|most|month|trend|category/.test(q)) {
    const g = /month|trend/.test(q) ? 'month' : /category/.test(q) ? 'category' : 'vendor';
    const d = await run('spend_analytics', { groupBy: g });
    answer = `Spend by ${g}:\n\n` + table(d.rows.slice(0, 10), [[g[0].toUpperCase() + g.slice(1), (r) => r.group], ['Invoices', (r) => r.invoices], ['Amount', (r) => inr(r.amount)]]);
  } else {
    const d = await run('search_invoices', { minRiskLevel: 'High' });
    const p = await run('search_invoices', { status: 'Matched' });
    answer = `Here is where things stand: **${p.count}** clean invoice(s) (${inr(p.totalAmount)}) are ready for approval and **${d.count}** need attention because of High/Critical risk.\n\nTry asking:\n- "Which invoices are high risk?"\n- "Why is ${d.invoices[0]?.invoiceNumber || 'an invoice'} blocked?"\n- "Show PO 4500000117 in SAP"\n- "What is our price tolerance policy?"\n- "Top vendors by spend"`;
  }
  return { answer, toolCalls: trace, sources: dedupe(sources) };
}

async function ask(question, historyJson) {
  let history = [];
  try { history = historyJson ? JSON.parse(historyJson) : []; } catch { /* ignore */ }
  if (llm.enabled()) {
    try {
      const r = await askLLM(question, history);
      return { ...r, engine: `agent:${llm.info().model}` };
    } catch (e) {
      LOG.warn('LLM agent failed, using offline router:', e.message);
    }
  }
  return { ...(await askOffline(question)), engine: 'offline-router' };
}

module.exports = { ask, TOOLS, askOffline };
