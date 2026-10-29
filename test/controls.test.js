'use strict';
// Integration test for the workflow & control features: hold/dispute, SLA, bulk decisions,
// payment runs, vendor controls (payment block, four-eyes bank change), settings, audit report, delete and reset.
process.env.CDS_ENV = 'test'; // [test] profile = in-memory database; must be set before cds loads its config
const { describe, it } = require('node:test');
const cds = require('@sap/cds');
const fs = require('fs');
const path = require('path');

process.env.ML_SERVICE_URL = 'http://127.0.0.1:1'; // force the ML fallback so the test is self-contained
const { GET, POST, expect, axios } = cds.test(path.join(__dirname, '..'));
const as = (u) => ({ auth: { username: u, password: u } });
axios.defaults.validateStatus = () => true;

const P = '/odata/v4/p2p';
const today = new Date().toISOString().slice(0, 10);
const invoices = async (filter) => (await GET(`${P}/Invoices?$filter=${encodeURIComponent(filter)}&$orderby=grossAmount desc`, as('manager'))).data.value;

describe('Controls & workflow API', () => {
  it('lets the Finance Manager change the approval limit at runtime', async () => {
    let r = await POST(`${P}/updateSetting`, { name: 'approvalLimit', value: 100000 }, as('approver'));
    expect(r.status).to.equal(403);
    r = await POST(`${P}/updateSetting`, { name: 'pricePctFail', value: 1 }, as('manager'));
    expect(r.status).to.equal(400);

    r = await POST(`${P}/updateSetting`, { name: 'approvalLimit', value: 100000 }, as('manager'));
    expect(r.status).to.equal(200);
    const [big] = await invoices("status eq 'Matched' and grossAmount gt 100000 and riskLevel ne 'Critical'");
    r = await POST(`${P}/Invoices(${big.ID})/P2PService.approveInvoice`, { comment: 'ok' }, as('approver'));
    expect(r.status).to.equal(403);
    expect(r.data.error.message).to.match(/1,00,000/);

    await POST(`${P}/updateSetting`, { name: 'approvalLimit', value: 1000000 }, as('manager'));
    const log = (await GET(`${P}/AuditLog?$filter=action eq 'SETTING_CHANGED'`, as('manager'))).data.value;
    expect(log.length).to.equal(2);
  });

  it('puts an invoice on hold, discusses it and releases it', async () => {
    const [inv] = await invoices("status eq 'Matched'");
    let r = await POST(`${P}/Invoices(${inv.ID})/P2PService.holdInvoice`, { category: 'Nope', reason: 'x' }, as('clerk'));
    expect(r.status).to.equal(400);
    r = await POST(`${P}/Invoices(${inv.ID})/P2PService.holdInvoice`, { category: 'VendorDispute', reason: 'Vendor disputes the freight charge' }, as('clerk'));
    expect(r.data).to.include({ status: 'OnHold', statusBeforeHold: 'Matched', holdCategory: 'VendorDispute' });

    r = await POST(`${P}/Invoices(${inv.ID})/P2PService.approveInvoice`, { comment: 'x' }, as('manager'));
    expect(r.status).to.equal(409);

    r = await POST(`${P}/Invoices(${inv.ID})/P2PService.addComment`, { text: 'Called the vendor, credit note promised by Friday' }, as('clerk'));
    expect(r.data.authorName).to.equal('Anita Rao (AP Clerk)');
    const { data } = await GET(`${P}/Invoices(${inv.ID})?$expand=comments`, as('clerk'));
    expect(data.comments.length).to.equal(1);

    r = await POST(`${P}/Invoices(${inv.ID})/P2PService.releaseHold`, { comment: 'Resolved' }, as('clerk'));
    expect(r.data).to.include({ status: 'Matched', holdCategory: null });
  });

  it('escalates old exceptions past the SLA', async () => {
    const { data } = await GET(`${P}/kpis()`, as('manager'));
    expect(data.slaBreaches).to.be.greaterThan(0);
    const escalated = await invoices("escalated eq true and status eq 'Exception'");
    expect(escalated.length).to.equal(data.slaBreaches);
    expect((await POST(`${P}/runSlaCheck`, {}, as('clerk'))).status).to.equal(403);
    expect((await POST(`${P}/runSlaCheck`, {}, as('approver'))).data.value).to.equal(0); // already escalated at startup
  });

  it('bulk-approves with a per-invoice result', async () => {
    const matched = await invoices("status eq 'Matched' and riskLevel ne 'Critical'");
    const [exception] = await invoices("status eq 'Exception' and riskLevel ne 'Critical' and grossAmount le 1000000");
    const ids = [...matched.map((i) => i.ID), exception.ID];
    expect((await POST(`${P}/bulkApprove`, { invoiceIds: ids }, as('clerk'))).status).to.equal(403);

    const { data } = await POST(`${P}/bulkApprove`, { invoiceIds: ids }, as('approver'));
    const results = data.value;
    expect(results.filter((r) => r.ok).length).to.equal(matched.length);
    expect(results.find((r) => r.ID === exception.ID)).to.include({ ok: false });
    expect(results.find((r) => r.ID === exception.ID).message).to.match(/justification/);
  });

  it('proposes and executes a payment run with segregation of duties', async () => {
    let r = await GET(`${P}/paymentProposal(paymentDate=${today},horizonDays=7)`, as('approver'));
    const proposal = JSON.parse(r.data.value);
    expect(proposal.totals.openItems).to.be.greaterThan(0);
    const posted = proposal.items.filter((i) => i.include);
    expect(posted.length).to.equal(proposal.totals.proposedItems);
    const ids = posted.map((i) => i.ID);

    expect((await POST(`${P}/executePaymentRun`, { paymentDate: today, invoiceIds: ids }, as('approver'))).status).to.equal(403);
    expect((await POST(`${P}/executePaymentRun`, { paymentDate: '2020-01-01', invoiceIds: ids }, as('manager'))).status).to.equal(400);
    const [notPosted] = await invoices("status eq 'Exception'");
    expect((await POST(`${P}/executePaymentRun`, { paymentDate: today, invoiceIds: [notPosted.ID] }, as('manager'))).status).to.equal(409);

    // a payment block on the vendor stops the run
    const blockedVendor = posted[0].vendor_ID;
    await POST(`${P}/Vendors('${blockedVendor}')/P2PService.blockPayments`, { reason: 'Bank details under verification' }, as('approver'));
    r = await POST(`${P}/executePaymentRun`, { paymentDate: today, invoiceIds: ids }, as('manager'));
    expect(r.status).to.equal(409);
    expect(r.data.error.message).to.match(/payment block/);
    await POST(`${P}/Vendors('${blockedVendor}')/P2PService.unblockPayments`, { reason: 'Verified by phone' }, as('manager'));

    r = await POST(`${P}/executePaymentRun`, { paymentDate: today, invoiceIds: ids }, as('manager'));
    expect(r.status).to.equal(200);
    expect(r.data.runId).to.match(/^PR-\d{8}-01$/);
    expect(r.data.invoiceCount).to.equal(ids.length);
    const paid = await invoices("status eq 'Paid'");
    expect(paid.length).to.equal(ids.length);
    expect(paid[0].paymentRun_ID).to.equal(r.data.ID);
  });

  it('blocks vendor payments (Approver) and lifts them (Manager only)', async () => {
    const V = `${P}/Vendors('17300007')`;
    expect((await POST(`${V}/P2PService.blockPayments`, {}, as('approver'))).status).to.equal(400);
    let r = await POST(`${V}/P2PService.blockPayments`, { reason: 'Suspected impersonation' }, as('approver'));
    expect(r.data).to.include({ paymentBlocked: true, blockedBy: 'approver' });
    expect((await POST(`${V}/P2PService.unblockPayments`, { reason: 'x' }, as('approver'))).status).to.equal(403);
    r = await POST(`${V}/P2PService.unblockPayments`, { reason: 'Cleared by internal audit' }, as('manager'));
    expect(r.data.paymentBlocked).to.equal(false);
  });

  it('changes bank details only under four-eyes control', async () => {
    const V = `${P}/Vendors('17300001')`;
    const req = { newAccount: 'ICIC0004410-441005001234', reason: 'Vendor moved its account to ICICI', callbackConfirmed: true };
    expect((await POST(`${V}/P2PService.requestBankChange`, { ...req, callbackConfirmed: false }, as('clerk'))).status).to.equal(400);
    expect((await POST(`${V}/P2PService.requestBankChange`, { ...req, newAccount: '12345' }, as('clerk'))).status).to.equal(400);
    const { data: change } = await POST(`${V}/P2PService.requestBankChange`, req, as('clerk'));
    expect(change.status).to.equal('Pending');
    expect((await POST(`${V}/P2PService.requestBankChange`, req, as('approver'))).status).to.equal(409);

    const C = `${P}/BankChangeRequests(${change.ID})`;
    expect((await POST(`${C}/P2PService.approveBankChange`, {}, as('approver'))).status).to.equal(403);
    const r = await POST(`${C}/P2PService.approveBankChange`, { comment: 'Confirmed with cancelled cheque' }, as('manager'));
    expect(r.data).to.include({ status: 'Approved', decidedBy: 'manager' });
    expect((await GET(V, as('clerk'))).data.bankAccount).to.equal(req.newAccount);

    // an invoice still asking for the old account is now a bank-account mismatch
    const pdf = fs.readFileSync(path.join(__dirname, '../samples/invoices/01-clean-bharat-steel.pdf'));
    const up = await POST(`${P}/uploadInvoice`, { fileName: 'old-account.pdf', contentBase64: pdf.toString('base64') }, as('clerk'));
    expect(up.data.riskLevel).to.equal('Critical');

    // the requester can never approve their own change
    const { data: own } = await POST(`${P}/Vendors('17300002')/P2PService.requestBankChange`, { ...req, newAccount: 'HDFC0001111-50100099887766' }, as('manager'));
    expect((await POST(`${P}/BankChangeRequests(${own.ID})/P2PService.approveBankChange`, {}, as('manager'))).status).to.equal(403);
  });

  it('generates a PDF audit report for approvers', async () => {
    const [inv] = await invoices("status eq 'Paid'");
    expect((await GET(`${P}/Invoices(${inv.ID})/P2PService.auditReport()`, as('clerk'))).status).to.equal(403);
    const { status, data } = await GET(`${P}/Invoices(${inv.ID})/P2PService.auditReport()`, as('approver'));
    expect(status).to.equal(200);
    expect(Buffer.from(data.value, 'base64').subarray(0, 5).toString()).to.equal('%PDF-');
  });

  it('reports payables and holds in the KPIs', async () => {
    const { data } = await GET(`${P}/kpis()`, as('clerk'));
    expect(data).to.have.property('openPayables');
    expect(data).to.have.property('onHold');
  });

  it('runs on the in-memory test database', async () => {
    expect((await GET(`${P}/systemStatus()`, as('clerk'))).data.database).to.match(/in memory/);
  });

  it('permanently deletes an invoice that has not reached SAP (Manager only)', async () => {
    const [inv] = await invoices("status eq 'Exception'");
    const del = (u, reason) => POST(`${P}/Invoices(${inv.ID})/P2PService.deleteInvoice`, { reason }, as(u));
    expect((await del('approver', 'x')).status).to.equal(403);
    expect((await del('manager', ' ')).status).to.equal(400);
    const [paid] = await invoices("status eq 'Paid'");
    expect((await POST(`${P}/Invoices(${paid.ID})/P2PService.deleteInvoice`, { reason: 'x' }, as('manager'))).status).to.equal(409);

    expect((await del('manager', 'Test upload - wrong vendor document')).status).to.equal(200);
    expect((await GET(`${P}/Invoices(${inv.ID})`, as('manager'))).status).to.equal(404);
    const items = (await GET(`${P}/InvoiceItems?$filter=parent_ID eq ${inv.ID}`, as('manager'))).data.value;
    expect(items.length).to.equal(0);
    const trail = (await GET(`${P}/AuditLog?$filter=invoice_ID eq ${inv.ID}`, as('manager'))).data.value;
    expect(trail.map((a) => a.action)).to.include.members(['RECEIVED', 'DELETED']); // history is kept
  });

  it('resets all data to the demo dataset (Manager only)', async () => {
    expect((await POST(`${P}/resetData`, {}, as('approver'))).status).to.equal(403);
    const r = await POST(`${P}/resetData`, {}, as('manager'));
    expect(r.status).to.equal(200);
    expect(r.data.value).to.equal(28);
    const { data } = await GET(`${P}/kpis()`, as('manager'));
    expect(data.totalInvoices).to.equal(28);
    expect(data.statusBreakdown).to.not.match(/Paid/);
    expect((await GET(`${P}/PaymentRuns`, as('manager'))).data.value.length).to.equal(0);
    expect((await GET(`${P}/BankChangeRequests`, as('manager'))).data.value.length).to.equal(0);
    const log = (await GET(`${P}/AuditLog?$filter=action eq 'SETTING_CHANGED' or action eq 'DATA_RESET'`, as('manager'))).data.value;
    expect(log.map((a) => a.action)).to.deep.equal(['DATA_RESET']);
    // the approved bank change was forgotten too: the original account is back
    expect((await GET(`${P}/Vendors('17300001')`, as('clerk'))).data.bankAccount).to.equal('HDFC0000412-50200012345678');
  });
});
