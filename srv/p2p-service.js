/**
 * P2PService implementation - workflow actions, AI pipeline entry points, payments, controls, KPIs.
 */
'use strict';
const cds = require('@sap/cds');
const { processDocument, refreshVendorRisk } = require('./pipeline');
const copilot = require('./ai/copilot');
const s4 = require('./sap/s4-client');
const ml = require('./engine/ml-client');
const llm = require('./ai/llm');
const settings = require('./engine/settings');
const payments = require('./engine/payment-run');
const { escalateOverdue } = require('./workflow');
const { buildAuditReport } = require('./reports/audit-report');
const demo = require('./demo-data');

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_BULK = 100;
const HOLDABLE = ['Matched', 'Exception', 'Approved'];
const HOLD_CATEGORIES = { VendorDispute: 'Vendor dispute', AwaitingCreditNote: 'Awaiting credit note', AwaitingGoodsReceipt: 'Awaiting goods receipt', BuyerConfirmation: 'Buyer confirmation', Other: 'Other' };
const BANK_ACCOUNT_RE = /^[A-Z]{4}0[A-Z0-9]{6}-\d{6,18}$/; // IFSC-account number, as in the SAP vendor master
const today = () => new Date().toISOString().slice(0, 10);
const r2 = (n) => Math.round(n * 100) / 100;
const inr =(n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

module.exports = class P2PService extends cds.ApplicationService {
  init() {
    const { Invoices, AuditLog, InvoiceItems, MatchResults, Anomalies, InvoiceComments, Vendors, BankChangeRequests, PaymentRuns } = cds.entities('procureiq');
    const keyOf = (req) => { const p = req.params[0]; return typeof p === 'object' ? p.ID : p; };
    const audit = (invoice_ID, action, req, detail) => INSERT.into(AuditLog).entries({ invoice_ID, step: 10, action, actor: req.user.id, detail });
    const auditVendor = (vendor_ID, action, req, detail) => INSERT.into(AuditLog).entries({ vendor_ID, step: 10, action, actor: req.user.id, detail });
    const reload = (ID) => SELECT.one.from(this.entities.Invoices, ID);
    const DECISION_COLUMNS = ['ID', 'invoiceNumber', 'status', 'grossAmount', 'riskLevel', 'vendor_ID'];

    // ---------------------------------------------------------------- decision rules (shared by single + bulk)
    /** @returns [httpStatus, message] when the invoice cannot be approved, else null */
    const approvalError = (inv, comment, user, cfg) => {
      if (!['Matched', 'Exception'].includes(inv.status)) return [409, `Invoice in status ${inv.status} cannot be approved`];
      const isManager = user.is('Manager');
      if (Number(inv.grossAmount) > cfg.approvalLimit && !isManager) return [403, `Amount above ₹${cfg.approvalLimit.toLocaleString('en-IN')} requires Finance Manager approval (AP-POL-004)`];
      if (inv.riskLevel === 'Critical' && !isManager) return [403, 'Critical-risk invoices can only be released by a Finance Manager'];
      if (inv.status === 'Exception' && !comment?.trim()) return [400, 'A justification comment is required to approve an exception'];
      return null;
    };
    const rejectionError = (inv, reason) => {
      if (['Posted', 'Rejected', 'Paid'].includes(inv.status)) return [409, `Invoice is already ${inv.status}`];
      if (!reason?.trim()) return [400, 'A rejection reason is required'];
      return null;
    };
    const approve = async (inv, comment, req) => {
      await UPDATE(Invoices, inv.ID).with({ status: 'Approved', decisionBy: req.user.id, decisionComment: comment || null });
      await audit(inv.ID, 'APPROVED', req, comment || 'Approved');
    };
    const reject = async (inv, reason, req) => {
      await UPDATE(Invoices, inv.ID).with({ status: 'Rejected', decisionBy: req.user.id, decisionComment: reason });
      await audit(inv.ID, 'REJECTED', req, reason);
    };

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
      const inv = await SELECT.one.from(Invoices, ID).columns(DECISION_COLUMNS);
      if (!inv) return req.reject(404, 'Invoice not found');
      const err = approvalError(inv, req.data.comment, req.user, await settings.current());
      if (err) return req.reject(...err);
      await approve(inv, req.data.comment, req);
      return reload(ID);
    });

    this.on('rejectInvoice', 'Invoices', async (req) => {
      const ID = keyOf(req);
      const inv = await SELECT.one.from(Invoices, ID).columns(DECISION_COLUMNS);
      if (!inv) return req.reject(404, 'Invoice not found');
      const err = rejectionError(inv, req.data.reason);
      if (err) return req.reject(...err);
      await reject(inv, req.data.reason, req);
      if (inv.vendor_ID) await refreshVendorRisk(inv.vendor_ID);
      return reload(ID);
    });

    const bulk = (decide, apply, label) => async (req) => {
      const { invoiceIds = [] } = req.data;
      const text = req.data.comment ?? req.data.reason;
      if (!invoiceIds.length) return req.reject(400, 'Select at least one invoice');
      if (invoiceIds.length > MAX_BULK) return req.reject(400, `At most ${MAX_BULK} invoices per bulk action`);
      const cfg = await settings.current();
      const rows = await SELECT.from(Invoices).columns(DECISION_COLUMNS).where({ ID: { in: invoiceIds } });
      const byId = Object.fromEntries(rows.map((r) => [r.ID, r]));
      const results = [];
      for (const ID of invoiceIds) {
        const inv = byId[ID];
        if (!inv) { results.push({ ID, invoiceNumber: null, ok: false, message: 'Invoice not found' }); continue; }
        const err = decide(inv, text, req.user, cfg);
        if (err) { results.push({ ID, invoiceNumber: inv.invoiceNumber, ok: false, message: err[1] }); continue; }
        await apply(inv, text, req);
        results.push({ ID, invoiceNumber: inv.invoiceNumber, ok: true, message: label });
      }
      return results;
    };
    this.on('bulkApprove', bulk(approvalError, approve, 'Approved'));
    this.on('bulkReject', bulk((inv, reason) => rejectionError(inv, reason), async (inv, reason, req) => {
      await reject(inv, reason, req);
      if (inv.vendor_ID) await refreshVendorRisk(inv.vendor_ID);
    }, 'Rejected'));

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

    // ---------------------------------------------------------------- hold / dispute / discussion
    this.on('holdInvoice', 'Invoices', async (req) => {
      const ID = keyOf(req);
      const inv = await SELECT.one.from(Invoices, ID).columns('ID', 'status');
      if (!inv) return req.reject(404, 'Invoice not found');
      if (!HOLDABLE.includes(inv.status)) return req.reject(409, `Invoice in status ${inv.status} cannot be put on hold`);
      const { category } = req.data;
      const reason = req.data.reason?.trim();
      if (!HOLD_CATEGORIES[category]) return req.reject(400, `Hold category must be one of ${Object.keys(HOLD_CATEGORIES).join(', ')}`);
      if (!reason) return req.reject(400, 'A reason is required to put an invoice on hold');
      await UPDATE(Invoices, ID).with({
        status: 'OnHold', statusBeforeHold: inv.status, holdCategory: category, holdReason: reason,
        heldBy: req.user.id, heldAt: new Date().toISOString(), escalated: false, escalatedAt: null // the SLA clock restarts on hold
      });
      await audit(ID, 'ON_HOLD', req, `${HOLD_CATEGORIES[category]}: ${reason}`);
      return reload(ID);
    });

    this.on('releaseHold', 'Invoices', async (req) => {
      const ID = keyOf(req);
      const inv = await SELECT.one.from(Invoices, ID).columns('ID', 'status', 'statusBeforeHold');
      if (!inv) return req.reject(404, 'Invoice not found');
      if (inv.status !== 'OnHold') return req.reject(409, 'Invoice is not on hold');
      const back = inv.statusBeforeHold || 'Exception';
      const comment = req.data.comment?.trim();
      await UPDATE(Invoices, ID).with({ status: back, statusBeforeHold: null, holdCategory: null, holdReason: null, heldBy: null, heldAt: null, escalated: false, escalatedAt: null });
      await audit(ID, 'RELEASED', req, `Hold released, back to ${back}${comment ? `: ${comment}` : ''}`);
      return reload(ID);
    });

    this.on('addComment', 'Invoices', async (req) => {
      const ID = keyOf(req);
      const text = req.data.text?.trim();
      if (!text) return req.reject(400, 'Comment text is required');
      if (text.length > 1000) return req.reject(400, 'Comments are limited to 1000 characters');
      if (!(await SELECT.one.from(Invoices, ID).columns('ID'))) return req.reject(404, 'Invoice not found');
      const comment = { ID: cds.utils.uuid(), parent_ID: ID, text, author: req.user.id, authorName: req.user.attr?.name || req.user.id };
      await INSERT.into(InvoiceComments).entries(comment);
      return SELECT.one.from(this.entities.InvoiceComments, comment.ID);
    });

    this.on('runSlaCheck', (req) => escalateOverdue(req.user.id));

    // ---------------------------------------------------------------- permanent deletion
    this.on('deleteInvoice', 'Invoices', async (req) => {
      const ID = keyOf(req);
      const inv = await SELECT.one.from(Invoices, ID).columns('ID', 'invoiceNumber', 'status', 'vendor_ID', 'vendorName', 'grossAmount');
      const reason = req.data.reason?.trim();
      if (!inv) return req.reject(404, 'Invoice not found');
      if (['Posted', 'Paid'].includes(inv.status)) return req.reject(409, `Invoice ${inv.invoiceNumber} is ${inv.status} in SAP and cannot be deleted - reverse it in SAP instead`);
      if (!reason) return req.reject(400, 'A reason is required to delete an invoice');
      for (const child of [InvoiceItems, MatchResults, Anomalies, InvoiceComments]) await DELETE.from(child).where({ parent_ID: ID });
      await DELETE.from(Invoices, ID);
      // the audit trail is never deleted: it keeps the earlier entries and records the deletion
      await audit(ID, 'DELETED', req, `Invoice ${inv.invoiceNumber} from ${inv.vendorName} (${inr(inv.grossAmount)}, ${inv.status}) permanently deleted: ${reason}`);
      if (inv.vendor_ID) await refreshVendorRisk(inv.vendor_ID);
      return true;
    });

    this.on('resetData', (req) => demo.resetAll(req.user.id));

    // ---------------------------------------------------------------- audit report
    this.on('auditReport', 'Invoices', async (req) => {
      const ID = keyOf(req);
      const inv = await SELECT.one.from(Invoices, ID);
      if (!inv) return req.reject(404, 'Invoice not found');
      const [items, match, anomalies, comments, trail, vendor, run] = await Promise.all([
        SELECT.from(InvoiceItems).where({ parent_ID: ID }).orderBy('lineNo'),
        SELECT.from(MatchResults).where({ parent_ID: ID }).orderBy('lineNo'),
        SELECT.from(Anomalies).where({ parent_ID: ID }).orderBy({ weight: 'desc' }),
        SELECT.from(InvoiceComments).where({ parent_ID: ID }).orderBy('createdAt'),
        SELECT.from(AuditLog).where({ invoice_ID: ID }).orderBy('createdAt', 'step'),
        inv.vendor_ID ? SELECT.one.from(Vendors, inv.vendor_ID) : null,
        inv.paymentRun_ID ? SELECT.one.from(PaymentRuns, inv.paymentRun_ID) : null
      ]);
      const pdf = await buildAuditReport({ inv, items, match, anomalies, comments, audit: trail, vendor, run, company: 'Aurora Industries Ltd', generatedBy: req.user.attr?.name || req.user.id });
      return pdf.toString('base64');
    });

    // ---------------------------------------------------------------- payments
    const openItems = () => SELECT.from(Invoices).columns('ID', 'invoiceNumber', 'vendor_ID', 'vendorName', 'invoiceDate', 'dueDate', 'grossAmount', 'status');
    const vendorMap = async () => Object.fromEntries((await SELECT.from(Vendors).columns('ID', 'paymentTerms', 'paymentBlocked', 'blockReason')).map((v) => [v.ID, v]));

    this.on('paymentProposal', async (req) => {
      const cfg = await settings.current();
      const paymentDate = req.data.paymentDate || today();
      const horizonDays = req.data.horizonDays ?? cfg.paymentHorizonDays;
      const [open, vendors] = await Promise.all([openItems().where({ status: 'Posted' }), vendorMap()]);
      return JSON.stringify(payments.proposal(open, vendors, { paymentDate, horizonDays }));
    });

    this.on('executePaymentRun', async (req) => {
      const invoiceIds = [...new Set(req.data.invoiceIds || [])];
      const paymentDate = req.data.paymentDate || today();
      if (paymentDate < today()) return req.reject(400, 'The payment date cannot be in the past');
      if (!invoiceIds.length) return req.reject(400, 'Select at least one invoice to pay');
      const [rows, vendors] = await Promise.all([openItems().where({ ID: { in: invoiceIds } }), vendorMap()]);
      const problems = [];
      if (rows.length !== invoiceIds.length) problems.push(`${invoiceIds.length - rows.length} invoice(s) not found`);
      rows.filter((r) => r.status !== 'Posted').forEach((r) => problems.push(`${r.invoiceNumber} is ${r.status} - only invoices posted to SAP can be paid`));
      const items = rows.filter((r) => r.status === 'Posted').map((r) => payments.evaluateItem(r, vendors[r.vendor_ID], { paymentDate }));
      items.filter((i) => i.blocked).forEach((i) => problems.push(`${i.invoiceNumber}: ${i.reason}`));
      if (problems.length) return req.reject(409, problems.join('; '));

      const { count } = await SELECT.one.from(PaymentRuns).columns('count(1) as count').where({ paymentDate });
      const run = {
        ID: cds.utils.uuid(),
        runId: `PR-${paymentDate.replace(/-/g, '')}-${String(count + 1).padStart(2, '0')}`,
        paymentDate,
        invoiceCount: items.length,
        grossAmount: r2(items.reduce((s, i) => s + i.grossAmount, 0)),
        discountAmount: r2(items.reduce((s, i) => s + i.discount, 0)),
        paidAmount: r2(items.reduce((s, i) => s + i.payAmount, 0)),
        executedBy: req.user.id
      };
      await INSERT.into(PaymentRuns).entries(run);
      for (const i of items) {
        await UPDATE(Invoices, i.ID).with({ status: 'Paid', paymentRun_ID: run.ID, paidOn: paymentDate, paidAmount: i.payAmount, discountTaken: i.discount });
        await audit(i.ID, 'PAID', req, `Paid ${inr(i.payAmount)} in payment run ${run.runId} (value date ${paymentDate})${i.discount ? `, cash discount ${inr(i.discount)}` : ''}`);
      }
      await INSERT.into(AuditLog).entries({ step: 10, action: 'PAYMENT_RUN', actor: req.user.id, detail: `${run.runId}: ${items.length} invoice(s), ${inr(run.paidAmount)} paid, ${inr(run.discountAmount)} cash discount` });
      return SELECT.one.from(this.entities.PaymentRuns, run.ID);
    });

    // ---------------------------------------------------------------- vendor controls
    const vendorOr404 = async (req) => (await SELECT.one.from(Vendors, keyOf(req))) || req.reject(404, 'Vendor not found');

    this.on('blockPayments', 'Vendors', async (req) => {
      const v = await vendorOr404(req);
      const reason = req.data.reason?.trim();
      if (v.paymentBlocked) return req.reject(409, 'Vendor is already blocked for payment');
      if (!reason) return req.reject(400, 'A reason is required to block a vendor');
      await UPDATE(Vendors, v.ID).with({ paymentBlocked: true, blockReason: reason, blockedBy: req.user.id, blockedAt: new Date().toISOString() });
      await auditVendor(v.ID, 'PAYMENT_BLOCK', req, reason);
      return SELECT.one.from(this.entities.Vendors, v.ID);
    });

    this.on('unblockPayments', 'Vendors', async (req) => {
      const v = await vendorOr404(req);
      const reason = req.data.reason?.trim();
      if (!v.paymentBlocked) return req.reject(409, 'Vendor is not blocked');
      if (!reason) return req.reject(400, 'A reason is required to lift a payment block');
      await UPDATE(Vendors, v.ID).with({ paymentBlocked: false, blockReason: null, blockedBy: null, blockedAt: null });
      await auditVendor(v.ID, 'PAYMENT_UNBLOCK', req, reason);
      return SELECT.one.from(this.entities.Vendors, v.ID);
    });

    this.on('requestBankChange', 'Vendors', async (req) => {
      const v = await vendorOr404(req);
      const newAccount = String(req.data.newAccount || '').trim().toUpperCase();
      const reason = req.data.reason?.trim();
      if (!BANK_ACCOUNT_RE.test(newAccount)) return req.reject(400, 'Enter the account as IFSC-account number, e.g. HDFC0000412-50200012345678');
      if (newAccount === v.bankAccount) return req.reject(400, 'The new account is the same as the current one');
      if (!reason) return req.reject(400, 'A reason is required');
      if (!req.data.callbackConfirmed) return req.reject(400, 'Confirm that the vendor was called back on the phone number in the vendor master (AP-POL-004)');
      if (await SELECT.one.from(BankChangeRequests).where({ vendor_ID: v.ID, status: 'Pending' })) return req.reject(409, 'There is already a pending bank change for this vendor');
      const ID = cds.utils.uuid();
      await INSERT.into(BankChangeRequests).entries({ ID, vendor_ID: v.ID, oldAccount: v.bankAccount, newAccount, reason, callbackConfirmed: true, requestedBy: req.user.id });
      await auditVendor(v.ID, 'BANK_CHANGE_REQUESTED', req, `${v.bankAccount} -> ${newAccount}: ${reason}`);
      return SELECT.one.from(this.entities.BankChangeRequests, ID);
    });

    const decideBankChange = (approved) => async (req) => {
      const ID = keyOf(req);
      const r = await SELECT.one.from(BankChangeRequests, ID);
      const comment = req.data.comment?.trim();
      if (!r) return req.reject(404, 'Bank change request not found');
      if (r.status !== 'Pending') return req.reject(409, `Request is already ${r.status}`);
      if (r.requestedBy === req.user.id) return req.reject(403, 'Four-eyes principle: a bank change must be approved by someone other than the requester');
      if (!approved && !comment) return req.reject(400, 'A reason is required to reject a bank change');
      await UPDATE(BankChangeRequests, ID).with({ status: approved ? 'Approved' : 'Rejected', decidedBy: req.user.id, decidedAt: new Date().toISOString(), decisionComment: comment || null });
      if (approved) {
        await UPDATE(Vendors, r.vendor_ID).with({ bankAccount: r.newAccount });
        s4.updateSupplierBankAccount(r.vendor_ID, r.newAccount);
      }
      await auditVendor(r.vendor_ID, approved ? 'BANK_CHANGED' : 'BANK_CHANGE_REJECTED', req,
        `${r.oldAccount} -> ${r.newAccount} (requested by ${r.requestedBy})${comment ? `: ${comment}` : ''}`);
      return SELECT.one.from(this.entities.BankChangeRequests, ID);
    };
    this.on('approveBankChange', 'BankChangeRequests', decideBankChange(true));
    this.on('rejectBankChange', 'BankChangeRequests', decideBankChange(false));

    // ---------------------------------------------------------------- settings
    this.on('updateSetting', async (req) => {
      const { name } = req.data;
      const value = Number(req.data.value);
      const cfg = await settings.current();
      const err = settings.validate(name, value, cfg);
      if (err) return req.reject(400, err);
      await settings.update(name, value);
      const d = settings.DEFS[name];
      await INSERT.into(AuditLog).entries({ step: 10, action: 'SETTING_CHANGED', actor: req.user.id, detail: `${d.label}: ${cfg[name]} -> ${value} ${d.unit}` });
      return SELECT.one.from(this.entities.Settings, name);
    });

    // ---------------------------------------------------------------- analytics
    this.on('kpis', async () => {
      const rows = await SELECT.from(Invoices).columns('status', 'riskLevel', 'grossAmount', 'vendorName', 'invoiceDate', 'dueDate', 'processingMs', 'matchStatus', 'escalated', 'ID');
      const total = rows.length || 1;
      const count = (f) => rows.filter(f).length;
      const sum = (list) => r2(list.reduce((s, r) => s + Number(r.grossAmount), 0));
      const by = (key, val = () => 1) => rows.reduce((m, r) => ((m[key(r)] = (m[key(r)] || 0) + val(r)), m), {});
      const live = rows.filter((r) => r.status !== 'Rejected');
      const open = rows.filter((r) => r.status === 'Posted');

      // "savings" = overpayments prevented: duplicates, variances & over-billing on invoices not paid as billed
      const blocked = rows.filter((r) => ['Exception', 'OnHold', 'Rejected'].includes(r.status));
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
        totalSpend: sum(live),
        autoMatchedPct: Math.round((count((r) => r.matchStatus === 'MATCHED') / total) * 10000) / 100,
        exceptions: count((r) => r.status === 'Exception'),
        highRisk: count((r) => ['High', 'Critical'].includes(r.riskLevel) && r.status !== 'Rejected'),
        pendingApproval: count((r) => ['Matched', 'Exception'].includes(r.status)),
        posted: count((r) => r.status === 'Posted'),
        avgProcessingMs: Math.round(rows.reduce((s, r) => s + (r.processingMs || 0), 0) / total),
        savingsIdentified: Math.round(savings * 100) / 100,
        openPayables: sum(open),
        overduePayables: sum(open.filter((r) => r.dueDate && r.dueDate < today())),
        onHold: count((r) => r.status === 'OnHold'),
        slaBreaches: count((r) => r.escalated && ['Exception', 'OnHold'].includes(r.status)),
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
      return { sapMode: sap.mode, sapEndpoint: sap.endpoint, llmProvider: l.provider, llmModel: l.model, mlService: m.state, mlModel: m.model, database: demo.storage() };
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
