/**
 * P2PService implementation - workflow actions, AI pipeline entry points, KPIs.
 */
'use strict';
const cds = require('@sap/cds');
const { processDocument, refreshVendorRisk } = require('./pipeline');
const copilot = require('./ai/copilot');
const s4 = require('./sap/s4-client');
const ml = require('./engine/ml-client');
const llm = require('./ai/llm');
const { APPROVAL_LIMIT } = require('./engine/risk-rules');

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

module.exports = class P2PService extends cds.ApplicationService {
  init() {
    const { Invoices, AuditLog, InvoiceItems } = cds.entities('procureiq');
    const keyOf = (req) => { const p = req.params[0]; return typeof p === 'object' ? p.ID : p; };
    const audit = (invoice_ID, action, req, detail) => INSERT.into(AuditLog).entries({ invoice_ID, step: 10, action, actor: req.user.id, detail });
    const reload = (ID) => SELECT.one.from(this.entities.Invoices, ID);

    // ---------------------------------------------------------------- AI pipeline
    this.on('uploadInvoice', async (req) => {
      const { fileName, contentBase64 } = req.data;
      if (!fileName || !contentBase64) return req.reject(400, 'fileName and contentBase64 are required');
      const buffer = Buffer.from(contentBase64.replace(/^data:[^,]+,/, ''), 'base64');
      if (buffer.length > MAX_UPLOAD_BYTES) return req.reject(413, 'File exceeds 10 MB');
      if (!/\.(pdf|txt)$/i.test(fileName)) return req.reject(415, 'Only PDF and TXT invoices are supported');
      try {
        return await processDocument(buffer, fileName, { actor: req.user.id, source: 'Upload' });
      } catch (e) {
        if (e.code === 'DUPLICATE_DOCUMENT') return req.reject(409, e.message);
        cds.log('p2p').error(e);
        return req.reject(422, `Could not process invoice: ${e.message}`);
      }
    });

    this.on('askCopilot', async (req) => {
      const { question, history } = req.data;
      if (!question?.trim()) return req.reject(400, 'question is required');
      return copilot.ask(question.trim().slice(0, 2000), history);
    });

    // ---------------------------------------------------------------- workflow
    this.on('approveInvoice', 'Invoices', async (req) => {
      const ID = keyOf(req);
      const inv = await SELECT.one.from(Invoices, ID);
      if (!inv) return req.reject(404, 'Invoice not found');
      if (!['Matched', 'Exception'].includes(inv.status)) return req.reject(409, `Invoice in status ${inv.status} cannot be approved`);
      const isManager = req.user.is('Manager');
      if (Number(inv.grossAmount) > APPROVAL_LIMIT && !isManager) return req.reject(403, `Amount above ₹${APPROVAL_LIMIT.toLocaleString('en-IN')} requires Finance Manager approval (AP-POL-004)`);
      if (inv.riskLevel === 'Critical' && !isManager) return req.reject(403, 'Critical-risk invoices can only be released by a Finance Manager');
      if (inv.status === 'Exception' && !req.data.comment?.trim()) return req.reject(400, 'A justification comment is required to approve an exception');
      await UPDATE(Invoices, ID).with({ status: 'Approved', decisionBy: req.user.id, decisionComment: req.data.comment || null });
      await audit(ID, 'APPROVED', req, req.data.comment || 'Approved');
      return reload(ID);
    });

    this.on('rejectInvoice', 'Invoices', async (req) => {
      const ID = keyOf(req);
      const inv = await SELECT.one.from(Invoices, ID);
      if (!inv) return req.reject(404, 'Invoice not found');
      if (['Posted', 'Rejected'].includes(inv.status)) return req.reject(409, `Invoice is already ${inv.status}`);
      if (!req.data.reason?.trim()) return req.reject(400, 'A rejection reason is required');
      await UPDATE(Invoices, ID).with({ status: 'Rejected', decisionBy: req.user.id, decisionComment: req.data.reason });
      await audit(ID, 'REJECTED', req, req.data.reason);
      if (inv.vendor_ID) await refreshVendorRisk(inv.vendor_ID);
      return reload(ID);
    });

    this.on('postToSAP', 'Invoices', async (req) => {
      const ID = keyOf(req);
      const inv = await SELECT.one.from(Invoices, ID);
      if (!inv) return req.reject(404, 'Invoice not found');
      if (inv.status !== 'Approved') return req.reject(409, 'Only approved invoices can be posted to SAP');
      inv.items = await SELECT.from(InvoiceItems).where({ parent_ID: ID }).orderBy('lineNo');
      try {
        const r = await s4.postSupplierInvoice(inv);
        await UPDATE(Invoices, ID).with({ status: 'Posted', sapDocument: r.document, sapFiscalYear: r.fiscalYear });
        await audit(ID, 'POSTED', req, `SAP supplier invoice ${r.document}/${r.fiscalYear}${r.simulated ? ' (simulated posting)' : ''}`);
      } catch (e) {
        await audit(ID, 'POST_FAILED', req, e.message);
        return req.reject(502, `SAP posting failed: ${e.message}`);
      }
      return reload(ID);
    });

    // ---------------------------------------------------------------- analytics
    this.on('kpis', async () => {
      const rows = await SELECT.from(Invoices).columns('status', 'riskLevel', 'grossAmount', 'vendorName', 'invoiceDate', 'processingMs', 'matchStatus', 'ID');
      const { MatchResults, Anomalies } = cds.entities('procureiq');
      const total = rows.length || 1;
      const count = (f) => rows.filter(f).length;
      const by = (key, val = () => 1) => rows.reduce((m, r) => ((m[key(r)] = (m[key(r)] || 0) + val(r)), m), {});
      const live = rows.filter((r) => r.status !== 'Rejected');

      // "savings" = overpayments prevented: duplicates, variances & over-billing on invoices not paid as billed
      const blocked = rows.filter((r) => ['Exception', 'Rejected'].includes(r.status));
      const blockedIds = new Set(blocked.map((r) => r.ID));
      const an = await SELECT.from(Anomalies).columns('parent_ID', 'code');
      const dupIds = new Set(an.filter((a) => a.code === 'DUPLICATE_INVOICE' && blockedIds.has(a.parent_ID)).map((a) => a.parent_ID));
      let savings = blocked.filter((r) => dupIds.has(r.ID)).reduce((s, r) => s + Number(r.grossAmount), 0);
      const mr = await SELECT.from(MatchResults).columns('parent_ID', 'invoiceQty', 'grQty', 'invoicePrice', 'poPrice').where({ lineNo: { '>': 0 } });
      mr.filter((m) => blockedIds.has(m.parent_ID) && !dupIds.has(m.parent_ID)).forEach((m) => {
        const q = Number(m.invoiceQty), g = Number(m.grQty), p = Number(m.invoicePrice), pp = Number(m.poPrice);
        if (g && q > g) savings += (q - g) * p;
        if (pp && p > pp) savings += (p - pp) * Math.min(q, g || q);
      });

      const vendorSpend = Object.entries(by((r) => r.vendorName, (r) => Number(r.grossAmount))).filter(([k]) => k !== 'null');
      const monthly = {};
      live.forEach((r) => {
        const m = String(r.invoiceDate).slice(0, 7);
        monthly[m] ||= { month: m, amount: 0, invoices: 0, exceptions: 0 };
        monthly[m].amount += Number(r.grossAmount); monthly[m].invoices++;
        if (r.matchStatus !== 'MATCHED') monthly[m].exceptions++;
      });
      return {
        totalInvoices: rows.length,
        totalSpend: live.reduce((s, r) => s + Number(r.grossAmount), 0),
        autoMatchedPct: Math.round((count((r) => r.matchStatus === 'MATCHED') / total) * 10000) / 100,
        exceptions: count((r) => r.status === 'Exception'),
        highRisk: count((r) => ['High', 'Critical'].includes(r.riskLevel) && r.status !== 'Rejected'),
        pendingApproval: count((r) => ['Matched', 'Exception'].includes(r.status)),
        posted: count((r) => r.status === 'Posted'),
        avgProcessingMs: Math.round(rows.reduce((s, r) => s + (r.processingMs || 0), 0) / total),
        savingsIdentified: Math.round(savings * 100) / 100,
        statusBreakdown: JSON.stringify(by((r) => r.status)),
        riskBreakdown: JSON.stringify(by((r) => r.riskLevel)),
        spendByVendor: JSON.stringify(vendorSpend.sort((a, b) => b[1] - a[1]).slice(0, 8).map(([vendor, amount]) => ({ vendor, amount }))),
        monthlyTrend: JSON.stringify(Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)))
      };
    });

    this.on('systemStatus', async () => {
      const sap = s4.status();
      const m = await ml.status();
      const l = llm.info();
      return { sapMode: sap.mode, sapEndpoint: sap.endpoint, llmProvider: l.provider, llmModel: l.model, mlService: m.state, mlModel: m.model };
    });

    this.on('sapPurchaseOrder', async (req) => {
      const po = await s4.getPurchaseOrder(req.data.poNumber);
      if (!po) return req.reject(404, `PO ${req.data.poNumber} not found in SAP`);
      const [grs, supplier] = await Promise.all([s4.getGoodsReceipts(po.poNumber), s4.getSupplier(po.supplier)]);
      return JSON.stringify({ purchaseOrder: po, supplier, goodsReceipts: grs });
    });

    return super.init();
  }
};
